/**
 * TOKEN SURGERY S4 — product-turn insurance_clock card handoff omit.
 * Also locks S1–S3 product-turn omits (no regression).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isExplicitCurrentInsuranceProductRequest } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { buildOnePathClaudeFirstRequest } from "../server/keyCore/keyOnePathClaudeFirst.js";
import { buildKeyRelevantMemoryPacket } from "../server/keyCore/keyRelevantMemoryPacket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const PRODUCT_Q =
  "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘";
const CLAIM_Q = "실손 청구에 필요한 서류랑 제출 상태 알려줘";
const OTHER_Q = "내 보험 현황 알려줘";

const evidenceIn = {
  packages: [
    {
      claim_case_id: "case-1",
      claim_scope: "personal",
      status: "preparing",
      held_evidence: [{ id: "e1", evidence_type: "original_document", label: "진단서" }],
      submitted_evidence: [],
      insurer_evidence: [],
      outcome_evidence: [],
      statement_evidence: [],
      application_disclosure_evidence: [],
      explanation_consent_evidence: [],
      terms_document_evidence: [],
      missing_evidence_labels: [],
      next_action: null,
      note: "keep_evidence",
    },
  ],
  item_count: 1,
  packs_separated: true,
  note: "keep_evidence",
};

const claimRow = {
  claim_case_key: "case-1",
  status: "preparing",
  card_source: "key_claude_claim_case",
};

const ledgerIn = {
  goals: [{ id: "g1", type: "goal", content: "보장 점검", status: "active" }],
  preferences: [],
  decisions: [],
  open_questions: [],
  life_threads: [],
  outcomes: [],
  item_count: 1,
  packs_separated: true,
  note: "keep_ledger",
};

const clockIn = {
  hand: "key_insurance_clock",
  upcoming: [{ id: "c1", label: "갱신", status: "active" }],
  overdue: [],
  unknown_date: [],
  completed_recent: [],
  packs_separated: true,
  product_focus: null,
  note: "keep_clock",
};

const contracts = [
  {
    id: "c1",
    insurer: "테스트생명",
    product_name: "테스트암보험",
    policy_number: "P-1",
    source_document_id: "doc-1",
  },
];

function gateNull(question, value) {
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? null
    : value || null;
}

function gateCases(question, cases) {
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? []
    : Array.isArray(cases)
      ? cases
      : [];
}

function extractCard(req) {
  for (const m of req.messages || []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      const text = typeof b?.text === "string" ? b.text : "";
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.key_customer_card) return parsed.key_customer_card;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function extractKeyRelevant(req) {
  for (const m of req.messages || []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      const text = typeof b?.text === "string" ? b.text : "";
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.KEY_RELEVANT_EVIDENCE) return parsed.KEY_RELEVANT_EVIDENCE;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function handoff(question) {
  return {
    claimEvidenceBrief: gateNull(question, evidenceIn),
    activeClaimCases: gateCases(question, [claimRow]),
    lifeLedgerBrief: gateNull(question, ledgerIn),
    insuranceClockBrief: gateNull(question, clockIn),
  };
}

function buildReq(question, ssot) {
  const packet = buildKeyRelevantMemoryPacket({
    question,
    history: [],
    memoryRow: {
      memory_commit_id: "mem-1",
      memory_version: 1,
      read_status: "confirmed_facts",
      contracts,
      confirmed_facts: [
        {
          fact_type: "product_name",
          literal: "테스트암보험",
          verification_status: "confirmed",
          contract_identity_key: "c1",
          source_document_id: "doc-1",
        },
      ],
      primary_document_id: "doc-1",
    },
    memoryLoad: { ok: true, status: "ok" },
    chart: { confirmed_contracts: contracts },
    keyConfirmedSourceFacts: null,
    allowMultiContracts: true,
  });
  return buildOnePathClaudeFirstRequest({
    question,
    history: [],
    policyTruthContext: {
      confirmed_contracts: contracts,
      confirmed_facts: [{ fact_type: "product_name", literal: "테스트암보험" }],
    },
    readyCardMeta: {
      status: "hit",
      materials_connected: true,
      document_status: {
        active_count: 1,
        documents: [{ id: "doc-1", original_filename: "증권.pdf" }],
      },
    },
    readyCardSsot: {
      activeDocuments: [{ id: "doc-1", original_filename: "증권.pdf" }],
      ...ssot,
      policies: contracts,
      policy_count: 1,
    },
    keyRelevantMemoryPacket: packet,
    customerId: "cust-1",
    conversationId: "conv-1",
  });
}

{
  const directSrc = readFileSync(
    join(REPO, "server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(
    /insuranceClockBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null\s*\n\s*: insuranceClockBrief \|\| null/.test(
      directSrc,
    ),
    true,
    "S4 insuranceClockBrief gate required",
  );
  assert.equal(
    /lifeLedgerBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null/.test(
      directSrc,
    ),
    true,
    "S3 gate must remain",
  );
  assert.equal(
    /activeClaimCases:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? \[\]/.test(
      directSrc,
    ),
    true,
    "S2 gate must remain",
  );
  assert.equal(
    /claimEvidenceBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null/.test(
      directSrc,
    ),
    true,
    "S1 gate must remain",
  );
  console.log("PASS source Exact Change lock (S4 + S3 + S2 + S1)");
}

// T1 product → no insurance_clock
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(PRODUCT_Q), true);
  const card = extractCard(buildReq(PRODUCT_Q, handoff(PRODUCT_Q)));
  assert.equal(Object.prototype.hasOwnProperty.call(card, "insurance_clock"), false);
  console.log("PASS T1 product turn omits insurance_clock");
}

// T2 other → keep
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(OTHER_Q), false);
  const card = extractCard(buildReq(OTHER_Q, handoff(OTHER_Q)));
  assert.ok(card?.insurance_clock);
  assert.equal(card.insurance_clock.upcoming[0].id, "c1");
  console.log("PASS T2 other turn keeps insurance_clock");
}

// T3 claim → keep
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(CLAIM_Q), false);
  const card = extractCard(buildReq(CLAIM_Q, handoff(CLAIM_Q)));
  assert.ok(card?.insurance_clock);
  console.log("PASS T3 claim turn keeps insurance_clock");
}

// T4–T6 S1–S3 regression on product
{
  const card = extractCard(buildReq(PRODUCT_Q, handoff(PRODUCT_Q)));
  assert.equal(Object.prototype.hasOwnProperty.call(card, "claim_evidence"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "active_claims"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "life_ledger"), false);
  console.log("PASS T4/T5/T6 S1–S3 regressions");
}

// T7 KEY_RELEVANT unchanged
{
  const reqWith = buildReq(CLAIM_Q, {
    claimEvidenceBrief: evidenceIn,
    activeClaimCases: [claimRow],
    lifeLedgerBrief: ledgerIn,
    insuranceClockBrief: clockIn,
  });
  const reqOmit = buildReq(PRODUCT_Q, handoff(PRODUCT_Q));
  const kreWith = extractKeyRelevant(reqWith);
  const kreOmit = extractKeyRelevant(reqOmit);
  assert.ok(kreWith && kreOmit);
  assert.equal(Array.isArray(kreOmit.focused_contracts), true);
  assert.deepEqual(
    extractCard(reqOmit).insurance_contracts,
    extractCard(reqWith).insurance_contracts,
  );
  console.log("PASS T7 KEY_RELEVANT_EVIDENCE unchanged");
}

console.log(
  JSON.stringify({
    KEY_INSURANCE_CLOCK_PRODUCT_TURN_OMIT_UNIT: "PASS",
    PRODUCTION: 0,
  }),
);
