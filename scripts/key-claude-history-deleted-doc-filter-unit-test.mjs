/**
 * Soft-deleted document facts must not re-enter Claude conversation history pack.
 */
import assert from "node:assert/strict";
import {
  buildClaudeFullContextPack,
  filterHistoryExcludingInactiveDocumentAttachments,
  extractAttachMarkerFilenamesFromTurnText,
  isDeletedDocumentRecheckQuestion,
  isDocumentIdentityReadoutText,
  mergeCurrentTurnDocumentIntoActiveDocuments,
} from "../server/keyCore/keyClaudeFullContextPack.js";

assert.equal(
  isDeletedDocumentRecheckQuestion("방금 삭제한 한화생명 홍길동 문서 내용 다시 말해봐"),
  true,
);
assert.equal(isDeletedDocumentRecheckQuestion("내 보험 현황 알려줘"), false);
assert.equal(
  isDocumentIdentityReadoutText(
    "계약자/피보험자 홍길동, 성별 남, 나이 45세, 보험사 한화생명, 상품명 종신보험입니다.",
  ),
  true,
);

assert.deepEqual(
  extractAttachMarkerFilenamesFromTurnText(
    "확인해봐.\n\n(첨부: hanwha-honggildong-policy.png)",
  ),
  ["hanwha-honggildong-policy.png"],
);

{
  const history = [
    { role: "user", content: "안녕" },
    { role: "assistant", content: "안녕하세요." },
    {
      role: "user",
      content: "이 문서만 확인해봐.\n\n(첨부: hanwha-honggildong-policy.png)",
    },
    {
      role: "assistant",
      content: "계약자/피보험자 홍길동, 성별 남, 나이 45세, 보험사 한화생명, 상품명 종신보험입니다.",
    },
    { role: "user", content: "월 보험료는?" },
    { role: "assistant", content: "월 98,000원입니다." },
  ];

  // Fail-closed when activeDocuments loader failed (null) — same as empty active set
  const loaderMiss = filterHistoryExcludingInactiveDocumentAttachments(history, null);
  assert.equal(loaderMiss.length, 2);
  assert.equal(
    loaderMiss.some((t) => String(t.content).includes("홍길동")),
    false,
    "loader miss must not fail-open deleted-doc facts into Claude history",
  );
  assert.equal(
    loaderMiss.some((t) => String(t.content).includes("한화생명")),
    false,
  );
  assert.equal(
    loaderMiss.some((t) => String(t.content).includes("98,000")),
    false,
  );

  // After soft-delete: no active docs → suppress from inactive attach onward
  const scrubbed = filterHistoryExcludingInactiveDocumentAttachments(history, []);
  assert.equal(scrubbed.length, 2);
  assert.equal(scrubbed[0].content, "안녕");
  assert.equal(scrubbed[1].content, "안녕하세요.");
  assert.equal(
    scrubbed.some((t) => String(t.content).includes("홍길동")),
    false,
    "deleted-doc assistant facts must leave Claude history",
  );
  assert.equal(
    scrubbed.some((t) => String(t.content).includes("한화생명")),
    false,
  );
  assert.equal(
    scrubbed.some((t) => String(t.content).includes("98,000")),
    false,
  );

  // Loader-miss pack path (null activeDocuments) also fail-closed for general turns
  const missPack = buildClaudeFullContextPack({
    history,
    question: "내 보험료 얼마야?",
    activeDocuments: null,
  });
  const missText = JSON.stringify(missPack.pack);
  assert.equal(missText.includes("홍길동"), false);
  assert.equal(missText.includes("한화생명"), false);
  assert.equal(missText.includes("98,000"), false);

  const pack = buildClaudeFullContextPack({
    history,
    question: "방금 삭제한 한화생명 홍길동 문서 내용 다시 말해봐",
    activeDocuments: [],
  });
  const packedText = JSON.stringify(pack.pack);
  assert.equal(packedText.includes("홍길동"), false);
  assert.equal(packedText.includes("한화생명"), false);
  assert.equal(packedText.includes("종신보험"), false);
  assert.equal(packedText.includes("98,000"), false);
  assert.equal(pack.pack.recent_conversation_count, 2);

  // Deleted recheck must scrub even when activeDocuments loader failed (null)
  // and even if the deleted file is still wrongly listed as active.
  const forced = buildClaudeFullContextPack({
    history,
    question: "방금 삭제한 한화생명 홍길동 문서 내용 다시 말해봐",
    activeDocuments: [{ id: "still-listed", original_filename: "hanwha-honggildong-policy.png" }],
    forceScrubAttachSegments: true,
    scrubIdentityReadouts: true,
  });
  const forcedText = JSON.stringify(forced.pack);
  assert.equal(forcedText.includes("홍길동"), false);
  assert.equal(forcedText.includes("한화생명"), false);
  assert.equal(forcedText.includes("종신보험"), false);
  assert.equal(forcedText.includes("98,000"), false);
}

{
  // Active sibling doc keeps its turns; inactive attach segment is dropped
  const history = [
    {
      role: "user",
      content: "삼성 문서\n\n(첨부: samsung.png)",
    },
    { role: "assistant", content: "삼성화재 자녀보험입니다." },
    {
      role: "user",
      content: "한화 문서\n\n(첨부: hanwha-honggildong-policy.png)",
    },
    { role: "assistant", content: "한화생명 홍길동 종신보험입니다." },
    {
      role: "user",
      content: "다시 삼성\n\n(첨부: samsung.png)",
    },
    { role: "assistant", content: "삼성화재 맞습니다." },
  ];
  const kept = filterHistoryExcludingInactiveDocumentAttachments(history, [
    { id: "doc-samsung", original_filename: "samsung.png" },
  ]);
  assert.equal(kept.length, 4);
  assert.equal(
    kept.some((t) => String(t.content).includes("홍길동")),
    false,
  );
  assert.equal(
    kept.some((t) => String(t.content).includes("삼성화재")),
    true,
  );
}

{
  // document_id on turn also suppresses when not active
  const history = [
    { role: "user", content: "질문", document_id: "doc-gone" },
    { role: "assistant", content: "한화생명 98000원" },
  ];
  const kept = filterHistoryExcludingInactiveDocumentAttachments(history, [
    { id: "doc-live", original_filename: "other.png" },
  ]);
  assert.equal(kept.length, 0);
}

{
  // Loader [] / null must NOT scrub this-turn explicit document_id segment
  const history = [
    {
      role: "user",
      content: "삭제된 옛 문서\n\n(첨부: hanwha-honggildong-policy.png)",
    },
    {
      role: "assistant",
      content: "계약자/피보험자 홍길동, 성별 남, 나이 45세, 보험사 한화생명, 상품명 종신보험입니다.",
    },
    {
      role: "user",
      content: "방금 올린 증권 보험사와 상품명만요\n\n(첨부: kimsujung1.png)",
    },
    { role: "assistant", content: "보험사는 KB손보, 상품명은 김수정 실손입니다." },
  ];
  const currentTurn = {
    document_id: "doc-kim",
    original_filename: "kimsujung1.png",
  };
  assert.deepEqual(
    mergeCurrentTurnDocumentIntoActiveDocuments([], currentTurn),
    [{ id: "doc-kim", original_filename: "kimsujung1.png" }],
  );
  const kept = filterHistoryExcludingInactiveDocumentAttachments(history, [], {
    currentTurnDocument: currentTurn,
  });
  assert.equal(
    kept.some((t) => String(t.content).includes("홍길동")),
    false,
    "deleted prior attach facts stay blocked",
  );
  assert.equal(
    kept.some((t) => String(t.content).includes("한화생명")),
    false,
  );
  assert.equal(
    kept.some((t) => String(t.content).includes("김수정")),
    true,
    "current-turn active attach context must survive loader []",
  );
  assert.equal(
    kept.some((t) => String(t.content).includes("kimsujung1.png")),
    true,
  );

  const pack = buildClaudeFullContextPack({
    history,
    question: "방금 올린 증권 보험사와 상품명만요",
    activeDocuments: null,
    currentTurnDocument: currentTurn,
  });
  const packed = JSON.stringify(pack.pack);
  assert.equal(packed.includes("홍길동"), false);
  assert.equal(packed.includes("한화생명"), false);
  assert.equal(packed.includes("김수정"), true);
}

console.log("PASS key-claude-history-deleted-doc-filter-unit-test");
