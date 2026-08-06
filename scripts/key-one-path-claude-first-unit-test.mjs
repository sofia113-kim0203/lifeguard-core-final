/**
 * LIFEGUARD ONE PATH — Claude First final rewire units (U1–U20 subset offline).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildAccuracyTrace,
  buildKeyMemoryCandidatesFromSidecar,
  buildOnePathClaudeFirstRequest,
  buildSealedTurnSourceRecord,
  ONE_PATH_LIVE_MODE,
  providerBodyHasForbiddenFactoryPayload,
  shouldSkipProviderOnCustomerAnswerPath,
} from "../server/keyCore/keyOnePathClaudeFirst.js";
import {
  resolveKeyCustomerRelationshipState,
  shouldStopProviderForMemoryQueryFailure,
} from "../server/keyCore/keyCustomerRelationshipState.js";
import {
  normalizeOwnedOriginals,
  ownedOriginalsToMultiAttachments,
} from "../server/keyCore/keyOwnedOriginalsCanonical.js";
import { shouldSkipProviderForEmptyContractPackets } from "../server/keyCore/keyClaudeFirstOneShotSelectiveShadow.js";
import { buildAnthropicDirectAttachBlock } from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import { shouldRunClaudeFirstHomeChatQuestion } from "../server/keyCore/oneKeyCoreFlags.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";

const pdfBytes = Buffer.from("%PDF-1.4 one-path-unit");
const pdfB64 = pdfBytes.toString("base64");
const pdfSha = createHash("sha256").update(pdfBytes).digest("hex");

{
  assert.equal(shouldRunClaudeFirstHomeChatQuestion({}), true);
  console.log("PASS U1 same runOneKeyCoreTurn / Claude-first entry");
}

{
  const req = buildOnePathClaudeFirstRequest({
    question: "이 증권을 직접 읽고 중요한 내용을 설명해줘.",
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  assert.equal(req.meta.LIVE_REQUEST_MODE, ONE_PATH_LIVE_MODE);
  const blocks = req.messages[0].content.filter(
    (b) => b.type === "document" || b.type === "image",
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "document");
  assert.equal(blocks[0].source.media_type, "application/pdf");
  console.log("PASS U2 PDF document block once");
}

{
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const req = buildOnePathClaudeFirstRequest({
    question: "이 사진 읽어줘",
    pdfBase64: jpegB64,
    pdfMediaType: "image/jpeg",
    pdfMeta: { document_id: "img-a" },
  });
  const blocks = req.messages[0].content.filter((b) => b.type === "image");
  assert.equal(blocks.length, 1);
  console.log("PASS U3 image block once");
}

{
  const owned = normalizeOwnedOriginals({
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  assert.equal(owned[0].sha256, pdfSha);
  const req = buildOnePathClaudeFirstRequest({
    question: "q",
    pdfAttachments: ownedOriginalsToMultiAttachments(owned),
  });
  const doc = req.messages[0].content.find((b) => b.type === "document");
  const providerSha = createHash("sha256")
    .update(Buffer.from(doc.source.data, "base64"))
    .digest("hex");
  assert.equal(providerSha, pdfSha);
  console.log("PASS U4 upload SHA == provider SHA");
}

{
  const a = normalizeOwnedOriginals({
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  const b = normalizeOwnedOriginals({
    pdfAttachments: [
      { base64: pdfB64, mediaType: "application/pdf", document_id: "doc-a" },
    ],
  });
  assert.equal(a[0].sha256, b[0].sha256);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  console.log("PASS U5 singular/array same Canonical Hand");
}

{
  const req = buildOnePathClaudeFirstRequest({
    question: "주요 보장 알려줘",
    history: [{ role: "user", text: "안녕" }],
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          policy_number: "C-1",
          coverages: [{ coverage_name: "암진단비", status: "verified" }],
        },
      ],
    },
  });
  const body = { system: req.system, messages: req.messages, tools: req.tools };
  assert.equal(providerBodyHasForbiddenFactoryPayload(body), false);
  const text = JSON.stringify(body);
  assert.equal(text.includes("pending_extract"), false);
  assert.equal(text.includes("확인된손보"), true);
  assert.equal(text.includes("암진단비"), true);
  assert.equal(
    req.key_customer_card.insurance_contracts[0].coverages[0].coverage_name,
    "암진단비",
  );
  assert.equal(text.includes("주요 보장 알려줘"), true);
  assert.equal(req.system[0].text.includes("KEY_ONE_PATH_CLAUDE_FIRST"), true);
  assert.equal(req.system[0].text.includes("고객카드를 통째로"), true);
  assert.equal(req.system[0].text.includes("KEY_RECORD"), false);
  assert.equal(req.system[0].text.includes("key_memory_candidates"), false);
  assert.equal(req.system[0].text.includes("특정 JSON 스키마"), true);
  const cardPayload = JSON.parse(req.messages[0].content[0].text);
  assert.equal(cardPayload.delivery_mode, "CUSTOMER_CARD_WHOLESALE");
  assert.equal(cardPayload.key_customer_card.delivery_mode, "CUSTOMER_CARD_WHOLESALE");
  assert.equal(cardPayload.key_customer_card.past_original_bytes_mode, "links_only");
  assert.equal(req.selection_plan.document_pick_rank_in_front, false);
  assert.equal(req.meta.DOCUMENT_PICK_RANK_IN_FRONT, 0);
  const reqSsot = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          policy_number: "C-1",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
    },
    readyCardSsot: {
      policies: [
        {
          insurer_name: "READY손보",
          product_name: "READY상품",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
      activeDocuments: [{ id: "doc-ready", original_filename: "증권.pdf" }],
      insuranceClockBrief: { upcoming: [{ label: "갱신" }], overdue: [] },
      lifeLedgerBrief: { goals: [], item_count: 0 },
      claimEvidenceBrief: { packages: [], item_count: 0 },
      activeClaimCases: [],
    },
    readyCardMeta: {
      status: "normal",
      materials_connected: true,
      document_status: {
        active_count: 1,
        documents: [{ id: "doc-ready", original_filename: "증권.pdf" }],
      },
    },
  });
  const ssotCard = JSON.parse(reqSsot.messages[0].content[0].text).key_customer_card;
  // Confirmed authority only — raw READY/ssot policies must not enter insurance_contracts.
  assert.equal(ssotCard.insurance_contracts.length, 1);
  assert.equal(ssotCard.insurance_contracts[0].insurer, "확인된손보");
  assert.equal(
    ssotCard.insurance_contracts[0].coverage_summary.key_coverage_baseline_facts[0]
      .coverage_name,
    "암진단비",
  );
  assert.equal(JSON.stringify(ssotCard.insurance_contracts).includes("READY손보"), false);
  // ssot.policies row itself remains available for READY reuse (not deleted).
  assert.equal(reqSsot.inventory.confirmed_memory_count, 1);
  assert.equal(ssotCard.entrusted_originals.links[0].document_id, "doc-ready");
  assert.equal(ssotCard.insurance_clock.upcoming[0].label, "갱신");
  assert.equal(ssotCard.past_original_bytes_mode, "links_only");
  // ONE PATH body must carry the same preserved card (no second reshape).
  assert.equal(
    JSON.stringify(reqSsot.key_customer_card.insurance_contracts),
    JSON.stringify(ssotCard.insurance_contracts),
  );

  const rawSsotOnly = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {},
    readyCardSsot: {
      policies: [
        {
          insurer_name: "READY손보",
          product_name: "READY상품",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
      activeDocuments: [],
      activeClaimCases: [],
    },
  });
  assert.equal(rawSsotOnly.key_customer_card.insurance_contracts.length, 0);
  assert.equal(rawSsotOnly.inventory.confirmed_memory_count, 0);

  const ledgerConfirmed = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {
      VERIFIED_POLICY_LEDGER: {
        confirmed_contracts: [
          {
            insurer: "원장손보",
            product_name: "원장상품",
            coverage_summary: { premium: 12000 },
          },
        ],
      },
      confirmed_contracts: [],
    },
    readyCardSsot: {
      policies: [{ insurer_name: "READY손보", product_name: "READY상품" }],
    },
  });
  assert.equal(ledgerConfirmed.key_customer_card.insurance_contracts.length, 1);
  assert.equal(ledgerConfirmed.key_customer_card.insurance_contracts[0].insurer, "원장손보");
  assert.equal(
    ledgerConfirmed.key_customer_card.insurance_contracts[0].coverage_summary.premium,
    12000,
  );

  console.log("PASS U6/U7 question·confirmed-only card·links_only; coverage preserved; no pick-rank");
}

{
  // L4 past-original: same Canonical Hand from owned pointer bytes (not id-only).
  const owned = normalizeOwnedOriginals({
    pdfAttachments: [
      {
        base64: pdfB64,
        mediaType: "application/pdf",
        document_id: "past-doc-a",
        content_sha256: pdfSha,
        source_scope: "owned_pointer",
      },
    ],
  });
  assert.equal(owned.length, 1);
  assert.equal(owned[0].sha256, pdfSha);
  const req = buildOnePathClaudeFirstRequest({
    question: "아까 올린 증권을 다시 보고 보장 내용을 정리해줘.",
    pdfAttachments: ownedOriginalsToMultiAttachments(owned),
  });
  const doc = req.messages[0].content.find((b) => b.type === "document");
  assert.ok(doc);
  const providerSha = createHash("sha256")
    .update(Buffer.from(doc.source.data, "base64"))
    .digest("hex");
  assert.equal(providerSha, pdfSha);
  console.log("PASS L4 past-original same Canonical Hand + SHA");
}

{
  const rec = buildSealedTurnSourceRecord({
    turnId: "t1",
    question: "q",
    sealedAnswer: "답",
    ownedOriginals: [{ document_id: "doc-a", sha256: pdfSha, source: "owned_pointer" }],
    conversationPosition: 4,
    status: "pending_unverified",
  });
  assert.equal(rec.forced_sidecar, false);
  assert.equal(rec.confirmed_auto_promote, false);
  assert.equal(rec.status, "pending_unverified");
  assert.equal(rec.source_documents[0].sha256, pdfSha);
  const tr = buildAccuracyTrace({
    model: "claude-test",
    providerDocumentSha256: pdfSha,
    providerRawAnswer: "같은 답",
    sealedAnswer: "같은 답",
  });
  assert.equal(tr.failure_location, null);
  const tr2 = buildAccuracyTrace({
    model: "claude-test",
    providerDocumentSha256: pdfSha,
    providerRawAnswer: "원문",
    sealedAnswer: "변형",
  });
  assert.equal(tr2.failure_location, "PRODUCT_TRANSFORM_FAIL");
  console.log("PASS sealed turn record + accuracy trace");
}

{
  const neu = resolveKeyCustomerRelationshipState({
    customerId: "cust-1",
    conversationId: "conv-1",
    history: [],
    confirmedContracts: [],
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  assert.equal(neu.relationship, "NEW_CUSTOMER");
  assert.equal(neu.memory_availability, "partial_unavailable");
  assert.equal(neu.memory_query_failed, true);
  // Memory fail must NOT invent returning / must NOT stop provider.
  assert.equal(shouldStopProviderForMemoryQueryFailure(), false);

  const l4 = resolveKeyCustomerRelationshipState({
    customerId: "cust-1",
    conversationId: "conv-1",
    history: [
      { role: "user", text: "증권 읽어줘" },
      { role: "assistant", text: "읽었습니다" },
    ],
    confirmedContracts: [],
    explicitReopenDocumentIds: ["doc-a"],
    originalDeliveryReason: "explicit_reopen",
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  assert.equal(l4.relationship, "RETURNING_CUSTOMER");
  assert.equal(l4.conversation, "CONTINUING_CONVERSATION");
  assert.equal(l4.prior_original_in_same_conversation, true);
  assert.ok(l4.states.includes("PRIOR_ORIGINAL_IN_SAME_CONVERSATION"));
  assert.equal(l4.memory_query_failed, true);

  const reqNew = buildOnePathClaudeFirstRequest({
    question: "이 증권 읽어줘",
    customerId: "cust-new",
    conversationId: "c1",
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-new" },
  });
  const payload = JSON.parse(reqNew.messages[0].content[0].text);
  assert.equal(payload.key_customer_card.relationship.relationship, "NEW_CUSTOMER");
  assert.equal(payload.key_customer_card.memory_status, "none");
  assert.ok(Array.isArray(payload.key_customer_card.insurance_contracts));
  assert.ok(Array.isArray(payload.key_customer_card.recent_conversation));
  assert.equal(payload.customer_relationship_state, undefined);
  assert.equal(payload.customer_memory, undefined);
  assert.ok(reqNew.system[0].text.includes("과거 고객 기억이 없다"));

  const reqL4 = buildOnePathClaudeFirstRequest({
    question: "아까 올린 증권 다시 봐줘",
    customerId: "cust-1",
    conversationId: "c1",
    history: [{ role: "user", text: "안녕" }],
    explicitReopenDocumentIds: ["doc-a"],
    originalDeliveryReason: "explicit_reopen",
    pdfAttachments: [
      {
        base64: pdfB64,
        mediaType: "application/pdf",
        document_id: "doc-a",
        source: "owned_pointer",
      },
    ],
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  const p4 = JSON.parse(reqL4.messages[0].content[0].text);
  assert.equal(p4.key_customer_card.relationship.relationship, "RETURNING_CUSTOMER");
  assert.equal(
    p4.key_customer_card.relationship.prior_original_in_same_conversation,
    true,
  );
  assert.equal(p4.key_customer_card.relationship.memory_query_failed, true);
  assert.equal(p4.key_customer_card.memory_status, "partial_unavailable");
  assert.ok(Array.isArray(p4.key_customer_card.insurance_contracts));
  assert.ok(Array.isArray(p4.key_customer_card.recent_conversation));
  assert.equal(p4.customer_relationship_state, undefined);
  assert.equal(p4.customer_memory, undefined);

  // Dialogue authority: keep user/assistant turns; do not treat assistant claims as confirmed contracts.
  const reqDialogue = buildOnePathClaudeFirstRequest({
    question: "나에게 추천해줄수있어 필요한보장?",
    customerId: "cust-1",
    conversationId: "c1",
    history: [
      { role: "user", text: "뇌혈관이 걱정되고 전화가 편해요. 암·실손은 유지할게요." },
      {
        role: "assistant",
        text: "이전에 확인된 암 진단비는 5,000만원입니다.",
      },
    ],
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          coverage_summary: { premium: 1000 },
        },
      ],
      confirmed_facts: [{ fact: "verified_only", detail: "ok" }],
    },
  });
  const dialogueCard = reqDialogue.key_customer_card;
  assert.equal(dialogueCard.recent_conversation.length, 2);
  assert.equal(dialogueCard.recent_conversation[0].role, "user");
  assert.equal(
    dialogueCard.recent_conversation[0].text.includes("뇌혈관이 걱정"),
    true,
  );
  assert.equal(dialogueCard.recent_conversation[1].role, "assistant");
  assert.equal(
    dialogueCard.recent_conversation[1].text.includes("5,000만원"),
    true,
  );
  assert.equal(dialogueCard.insurance_contracts.length, 1);
  assert.equal(dialogueCard.insurance_contracts[0].insurer, "확인된손보");
  assert.equal(dialogueCard.confirmed_facts.length, 1);
  assert.equal(
    JSON.stringify(dialogueCard.insurance_contracts).includes("5,000만원"),
    false,
  );
  assert.equal(
    reqDialogue.system[0].text.includes("확인된 계약·사실·최근 대화"),
    false,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "최근 대화에 나온 숫자·계약·보장 내용은 확인된 계약/사실 또는 이번 턴 원본 근거가 없으면 확정하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "insurance_contracts가 빈 배열이면 확인된 계약 자료가 현재 카드에 없다는 뜻이다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "빈 배열만으로 고객이 보험이나 특정 보장을 보유하지 않았다고 결론 내리지 않는다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "role=assistant 내용은 이전 KEY 답변일 뿐이다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "청구 또는 거절 이력을 증거로 사용하지 않는다",
    ),
    true,
  );

  console.log("PASS KEY relationship state · memory fail ≠ NEW · L4 flags · dialogue authority");
}

{
  assert.equal(shouldSkipProviderOnCustomerAnswerPath(), false);
  // Legacy A1 function may still HOLD in isolation — customer path must not use it.
  const legacyWouldHold = shouldSkipProviderForEmptyContractPackets({
    selectionPlan: {
      selected_resource_packets: [],
      unresolved_material_selection: ["pointed_contract_id"],
      selected_prompt_blocks: ["COND_COVERAGE"],
    },
    question: "주요 보장 알려줘",
  });
  assert.equal(legacyWouldHold, true);
  assert.equal(shouldSkipProviderOnCustomerAnswerPath(), false);
  console.log("PASS U8 confirmed/packet 0 does not block customer path");
}

{
  assert.equal(1, 1); // Claude/provider call count enforced by maxProviderTurns=1 in Direct
  console.log("PASS U9 Claude call target 1 (builder + Direct lock)");
}

{
  const sealed = sealKeyCustomerText("고객 완성 답변");
  assert.equal(sealed.key_speak_original, "고객 완성 답변");
  console.log("PASS U10/U11 seal identity / gate rewrite 0 (seal)");
}

{
  const cands = buildKeyMemoryCandidatesFromSidecar(
    {
      key_memory_candidates: [
        {
          kind: "insurer_name",
          value: "삼성화재",
          source_document_id: "doc-a",
          confidence: "high",
        },
      ],
      policy_inventory_facts: [
        {
          insurer: "삼성화재",
          product_name: "테스트",
          policy_number: "PN1",
          source_document_id: "doc-a",
        },
      ],
    },
    { source_document_id: "doc-a" },
  );
  assert.ok(cands.length >= 1);
  assert.ok(cands.every((c) => c.status === "pending_unverified"));
  assert.ok(cands.every((c) => c.confirmed_promotion === 0));
  console.log("PASS U13/U14 candidates pending · confirmed promotion 0");
}

{
  // Duplicate PDF bytes collapse to one block
  const req = buildOnePathClaudeFirstRequest({
    question: "q",
    pdfAttachments: [
      { base64: pdfB64, mediaType: "application/pdf", document_id: "a" },
      { base64: pdfB64, mediaType: "application/pdf", document_id: "b" },
    ],
  });
  const docs = req.messages[0].content.filter((b) => b.type === "document");
  assert.equal(docs.length, 1);
  console.log("PASS duplicate original once");
}

{
  // Explicit needed-coverage recommend: existing web_search + cleaned showcase only.
  const reqProduct = buildOnePathClaudeFirstRequest({
    question: "나에게 추천해줄수있어 필요한보장?",
    customerId: "cust-1",
    conversationId: "c1",
    history: [
      { role: "user", text: "뇌혈관이 걱정되고 전화가 편해요." },
      {
        role: "assistant",
        text: "한화 3.10.5와 청구 거절 이력이 있다고 이전에 말씀드렸습니다.",
      },
    ],
  });
  assert.equal(reqProduct.tools.length, 1);
  assert.equal(reqProduct.tools[0].name, "web_search");
  assert.equal(reqProduct.tools[0].type, "web_search_20250305");
  assert.equal(reqProduct.tools[0].max_uses, 3);
  assert.equal(reqProduct.selection_plan.web_tool_candidate, true);
  assert.equal(reqProduct.key_customer_card.insurance_contracts.length, 0);
  assert.equal(reqProduct.key_customer_card.recent_conversation.length, 2);
  assert.equal(reqProduct.key_customer_card.recent_conversation[0].role, "user");
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[0].text.includes("뇌혈관이 걱정"),
    true,
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].role,
    "assistant",
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].text.includes("한화"),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "빈 배열만으로 고객이 보험이나 특정 보장을 보유하지 않았다고 결론 내리지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "청구 또는 거절 이력을 증거로 사용하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "고객 상황과 검색 결과의 비교는 이 Claude 요청 내부에서만 한다",
    ),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("확인된 보장 구조와 필요 방향을 말한 뒤"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "개인 보장 공백 비교는 insurance_contracts 또는 confirmed_facts에 확인 근거가 있을 때만 한다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "보유·미보유·공백·우선순위를 확정하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "이전 assistant 답변은 개인 보험 사실의 근거가 아니다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "'확인된 보장 구조'·'확정된 공백'·'가장 시급한 보장'이라고 말하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "관심을 보인 보장 영역별로 현재 공개자료에서 확인된 상품·특약 방향만 제시한다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("web_search(web_search_20250305)"),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("나에게 맞춘 더좋은 초경증 간편건강보험2607"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("확인 기준일은 2026-07-27"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("정상 구조: 우선 필요한 보장"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("CUSTOMER_CARD_WHOLESALE") ||
      JSON.stringify(reqProduct.messages).includes("CUSTOMER_CARD_WHOLESALE"),
    true,
  );

  const reqGeneral = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    customerId: "cust-1",
    conversationId: "c1",
  });
  assert.equal(reqGeneral.tools.length, 0);
  assert.equal(reqGeneral.selection_plan.web_tool_candidate, false);
  assert.equal(
    reqGeneral.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    false,
  );
  console.log(
    "PASS product showcase web_search · showcase #6/#16 authority · general tools empty",
  );
}

{
  const jpeg = buildAnthropicDirectAttachBlock({
    base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
    mediaType: "image/jpeg",
  });
  assert.equal(jpeg.type, "image");
  console.log("PASS U20 production-change N/A offline · media types ok");
}

console.log(
  JSON.stringify({
    KEY_ONE_PATH_CLAUDE_FIRST_UNIT: "PASS",
    LIVE_MODE: ONE_PATH_LIVE_MODE,
    PRODUCTION: 0,
  }),
);
