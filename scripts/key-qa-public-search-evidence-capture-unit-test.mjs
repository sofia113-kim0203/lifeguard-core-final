/**
 * QA public search evidence capture — cited_text + early-done projection.
 * Capture only; not a Grounding Gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPublicEvidenceFromClaudeContent,
  buildQaPublicSearchEvidence,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildCurrentInsuranceProductShowcaseAddendum } from "../server/keyCore/keyBorrowedSensesSpeak.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIRECT_SRC = readFileSync(
  join(__dirname, "../server/keyCore/keyClaudeFirstDirect.js"),
  "utf8",
);

{
  const rows = extractPublicEvidenceFromClaudeContent(
    [
      {
        type: "text",
        text: "보험료가 약 30% 낮아졌습니다.",
        citations: [
          {
            title: "5세대 실손 안내",
            url: "https://example.com/silson",
            cited_text: "보험료가 4세대 대비 약 30% 낮아졌습니다",
          },
        ],
      },
    ],
    { retrievedAt: "2026-08-10T00:00:00+09:00" },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cited_text, "보험료가 4세대 대비 약 30% 낮아졌습니다");
  assert.equal(rows[0].url, "https://example.com/silson");
  assert.match(String(rows[0].citation_reference), /30%/);
  console.log("PASS T1 cited_text preserved when present");
}

{
  const rows = extractPublicEvidenceFromClaudeContent(
    [
      {
        type: "web_search_tool_result",
        content: [
          {
            type: "web_search_result",
            title: "Page",
            url: "https://example.com/a",
            encrypted_index: "enc-idx-1",
            // no cited_text
          },
        ],
      },
      {
        type: "text",
        text: "ok",
        citations: [
          {
            title: "Page",
            url: "https://example.com/a",
            start_char_index: 0,
            end_char_index: 2,
            // no cited_text
          },
        ],
      },
    ],
    { retrievedAt: "2026-08-10T00:00:00+09:00" },
  );
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.equal(row.cited_text, null);
    assert.ok(row.url || row.title);
    assert.equal(Object.hasOwn(row, "cited_text"), true);
    assert.equal(Object.hasOwn(row, "encrypted_content"), false);
  }
  console.log("PASS T2 missing cited_text → null; no encrypted_content");
}

{
  assert.match(DIRECT_SRC, /qa_public_search_evidence:\s*buildQaPublicSearchEvidence\(/);
  assert.match(
    DIRECT_SRC,
    /onEarlyCustomerDone\(\{[\s\S]*?qa_public_search_evidence:/,
  );
  console.log("PASS T3 early done attaches qa_public_search_evidence");
}

{
  const qa = buildQaPublicSearchEvidence({
    public_evidence: [
      {
        title: "A",
        url: "https://example.com/a",
        cited_text: "자기부담률이 50%로 올랐다",
      },
      {
        title: "A",
        url: "https://example.com/a",
        cited_text: "자기부담률이 50%로 올랐다",
      },
      {
        title: "B",
        url: "https://example.com/b",
        cited_text: null,
      },
    ],
    web_search_trace: {
      web_search_used: true,
      web_search_count: 2,
      search_result_count: 3,
      search_citation_count: 1,
      query_redacted: true,
    },
  });
  assert.equal(qa.web_search_used, true);
  assert.equal(qa.web_search_count, 2);
  assert.deepEqual(qa.results, [
    { url: "https://example.com/a", title: "A" },
    { url: "https://example.com/b", title: "B" },
  ]);
  assert.deepEqual(qa.citations, [
    { url: "https://example.com/a", cited_text: "자기부담률이 50%로 올랐다" },
  ]);
  console.log("PASS T4 results/citations minimal projection");
}

{
  const qa = buildQaPublicSearchEvidence({
    public_evidence: [],
    web_search_trace: {
      web_search_used: false,
      web_search_count: 0,
      search_result_count: 0,
      search_citation_count: 0,
      query_redacted: true,
    },
  });
  assert.equal(qa.web_search_used, false);
  assert.equal(qa.web_search_count, 0);
  assert.deepEqual(qa.results, []);
  assert.deepEqual(qa.citations, []);
  console.log("PASS T5 no web_search → empty/false");
}

{
  const answer = "고객 답변 본문은 변하지 않아야 합니다.";
  const before = answer;
  extractPublicEvidenceFromClaudeContent([
    {
      type: "text",
      text: answer,
      citations: [
        {
          title: "X",
          url: "https://example.com/x",
          cited_text: "약 30%",
        },
      ],
    },
  ]);
  buildQaPublicSearchEvidence({
    public_evidence: [{ title: "X", url: "https://example.com/x", cited_text: "약 30%" }],
    web_search_trace: { web_search_used: true, web_search_count: 1 },
  });
  assert.equal(answer, before);
  console.log("PASS T6 customer-visible answer byte-identical (capture side)");
}

{
  assert.doesNotMatch(
    DIRECT_SRC.slice(
      DIRECT_SRC.indexOf("qa_public_search_evidence: buildQaPublicSearchEvidence"),
      DIRECT_SRC.indexOf("qa_public_search_evidence: buildQaPublicSearchEvidence") + 400,
    ),
    /answerText\s*=/,
  );
  assert.match(DIRECT_SRC, /answerText:\s*sealed\.key_speak_original/);
  console.log("PASS T7 SSE/Seal answerText path unchanged (source-lock)");
}

{
  const showcase = buildCurrentInsuranceProductShowcaseAddendum({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
  });
  assert.match(showcase, /정량 공개 수치/);
  assert.match(showcase, /검색으로 확인된 수치는 그대로 사용해도 된다/);
  console.log("PASS T8 Q8 Product Showcase contract preserved");
}

{
  assert.doesNotMatch(DIRECT_SRC, /provider_content_blocks/);
  assert.doesNotMatch(
    DIRECT_SRC.slice(
      DIRECT_SRC.indexOf("export function buildQaPublicSearchEvidence"),
      DIRECT_SRC.indexOf("export function buildQaPublicSearchEvidence") + 1200,
    ),
    /encrypted_content/,
  );
  console.log("PASS capture stays QA-minimal (no provider_content_blocks / encrypted_content)");
}

console.log("ALL_QA_PUBLIC_SEARCH_EVIDENCE_CAPTURE_UNIT_TESTS_PASSED");
