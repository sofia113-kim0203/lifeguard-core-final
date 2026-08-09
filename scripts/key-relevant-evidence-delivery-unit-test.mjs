/**
 * Targeted unit tests — KEY_RELEVANT_EVIDENCE delivery into ONE_PATH.
 * No network / DB / Claude.
 */
import assert from "node:assert/strict";
import {
  buildKeyRelevantEvidenceForOnePath,
  buildKeyRelevantMemoryPacket,
} from "../server/keyCore/keyRelevantMemoryPacket.js";
import { buildOnePathClaudeFirstRequest } from "../server/keyCore/keyOnePathClaudeFirst.js";
import { ANTHROPIC_WEB_SEARCH_TOOL } from "../server/keyCore/keyBorrowedSensesSpeak.js";

const DOC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeMemoryRow() {
  return {
    id: "mem-1",
    memory_version: 3,
    commit_status: "committed",
    read_status: "confirmed_facts",
    rejected_fact_count: 0,
    primary_document_id: DOC_A,
    document_ids: [DOC_A],
    confirmation_source: "key_claude_original_document",
    contracts: [
      {
        insurer_name: "한화손해보험",
        product_name: "간편건강보험",
        policy_number: "LA20249638413000",
        source_document_id: DOC_A,
        monthly_premium: 30000,
        fact_refs: [
          {
            fact_type: "insurer",
            literal: "한화손해보험",
            source_document_id: DOC_A,
            verification_status: "key_confirmed_from_original",
          },
          {
            fact_type: "product_name",
            literal: "간편건강보험",
            source_document_id: DOC_A,
            verification_status: "key_confirmed_from_original",
          },
        ],
      },
    ],
  };
}

function extractEvidenceFromRequest(req) {
  const texts = (req?.messages?.[0]?.content || [])
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""));
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t);
      if (parsed?.KEY_RELEVANT_EVIDENCE) return parsed.KEY_RELEVANT_EVIDENCE;
    } catch {
      /* not json */
    }
  }
  return null;
}

// A — confirmed policy/memory facts appear in KEY_RELEVANT_EVIDENCE
test("A_confirmed_facts_included_in_key_relevant_evidence", () => {
  const built = buildKeyRelevantMemoryPacket({
    question: "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    memoryRow: makeMemoryRow(),
    memoryLoad: { status: "hit" },
    chart: { confirmed_contracts: makeMemoryRow().contracts },
    allowMultiContracts: true,
  });
  const evidence = buildKeyRelevantEvidenceForOnePath(built);
  assert.ok(evidence);
  assert.ok(evidence.confirmed_facts.length >= 2);
  assert.ok(
    evidence.confirmed_facts.some((f) => f.fact_type === "insurer"),
  );
  assert.ok(
    evidence.focused_contracts.some((c) => c.source_document_id === DOC_A),
  );
});

// B — pending/unverified candidate not treated as verified fact
test("B_pending_unverified_not_in_verified_evidence", () => {
  const built = buildKeyRelevantMemoryPacket({
    question: "내 보험 알려줘",
    memoryRow: makeMemoryRow(),
    memoryLoad: { status: "hit" },
    keyConfirmedSourceFacts: [
      {
        fact_type: "insurer",
        literal_value: "후보보험사",
        source_document_id: DOC_A,
        verification_status: "pending_unverified",
      },
      {
        fact_type: "coverage_name",
        literal_value: "OCR후보담보",
        source_document_id: DOC_A,
        verification_status: "ocr_candidate",
      },
    ],
  });
  // Force-inject pending rows into packet confirmed_facts to prove filter.
  built.packet.confirmed_facts.push(
    {
      fact_type: "insurer",
      literal: "후보보험사",
      source_document_id: DOC_A,
      verification_status: "pending_unverified",
    },
    {
      fact_type: "coverage_name",
      literal: "OCR후보담보",
      source_document_id: DOC_A,
      verification_status: "ocr_candidate",
    },
  );
  const evidence = buildKeyRelevantEvidenceForOnePath(built);
  assert.ok(evidence);
  assert.equal(
    evidence.confirmed_facts.some((f) => f.verification_status === "pending_unverified"),
    false,
  );
  assert.equal(
    evidence.confirmed_facts.some((f) => /ocr/i.test(String(f.verification_status ?? ""))),
    false,
  );
  assert.equal(
    evidence.confirmed_facts.some((f) => f.literal === "후보보험사"),
    false,
  );
});

// C — packet reaches actual ONE_PATH Claude request body
test("C_evidence_reaches_one_path_claude_request", () => {
  const built = buildKeyRelevantMemoryPacket({
    question: "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    memoryRow: makeMemoryRow(),
    memoryLoad: { status: "hit" },
    allowMultiContracts: true,
  });
  const req = buildOnePathClaudeFirstRequest({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    history: [],
    policyTruthContext: { confirmed_contracts: makeMemoryRow().contracts },
    keyRelevantMemoryPacket: built,
  });
  const evidence = extractEvidenceFromRequest(req);
  assert.ok(evidence, "KEY_RELEVANT_EVIDENCE missing from ONE_PATH messages");
  assert.equal(evidence.authority, "verified_current_over_customer_card");
  assert.ok(evidence.confirmed_facts.length >= 1);
  assert.equal(req.selection_plan.key_relevant_evidence_delivered, true);
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("KEY_RELEVANT_EVIDENCE"));
  assert.match(req.system[0].text, /KEY_RELEVANT_EVIDENCE_AUTHORITY/);
  // Customer card still present (not globally deleted).
  const cardBlock = (req.messages[0].content || []).find((b) =>
    String(b.text ?? "").includes("key_customer_card"),
  );
  assert.ok(cardBlock);
});

// D — product-search / web_search tools preserved
test("D_product_search_web_search_preserved", () => {
  const built = buildKeyRelevantMemoryPacket({
    question: "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    memoryRow: makeMemoryRow(),
    memoryLoad: { status: "hit" },
  });
  const req = buildOnePathClaudeFirstRequest({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    history: [],
    keyRelevantMemoryPacket: built,
  });
  assert.ok(Array.isArray(req.tools));
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].name, ANTHROPIC_WEB_SEARCH_TOOL.name);
  assert.equal(req.selection_plan.web_tool_candidate, true);
  assert.ok(extractEvidenceFromRequest(req));
});

test("no_packet_means_no_evidence_block", () => {
  const req = buildOnePathClaudeFirstRequest({
    question: "안녕하세요",
    history: [],
    keyRelevantMemoryPacket: null,
  });
  assert.equal(extractEvidenceFromRequest(req), null);
  assert.equal(req.selection_plan.key_relevant_evidence_delivered, false);
});

if (process.exitCode) {
  console.error("KEY_RELEVANT_EVIDENCE_DELIVERY_UNIT=FAIL");
} else {
  console.log("KEY_RELEVANT_EVIDENCE_DELIVERY_UNIT=PASS");
}
