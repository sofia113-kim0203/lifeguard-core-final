/**
 * TOKEN SURGERY S2 — product-turn active_claims card handoff omit.
 * Mirrors Exact Change in keyClaudeFirstDirect ONE_PATH readyCardSsot assembly.
 * Also locks S1 claim_evidence product-turn omit (no regression).
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

const contracts = [
  {
    id: "c1",
    insurer: "테스트생명",
    product_name: "테스트암보험",
    policy_number: "P-1",
    source_document_id: "doc-1",
  },
];

function handoffActiveClaimCases(question, cases) {
  // Exact Change contract (keyClaudeFirstDirect readyCardSsot.activeClaimCases).
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? []
    : Array.isArray(cases)
      ? cases
      : [];
}

function handoffClaimEvidenceBrief(question, brief) {
  // S1 Exact Change — must remain for product turns.
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? null
    : brief || null;
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

function buildReq(question, { claimEvidenceBrief, activeClaimCases }) {
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
      activeClaimCases,
      claimEvidenceBrief,
      insuranceClockBrief: null,
      lifeLedgerBrief: null,
      policies: contracts,
      policy_count: 1,
    },
    keyRelevantMemoryPacket: packet,
    customerId: "cust-1",
    conversationId: "conv-1",
  });
}

// Source lock — S2 Exact Change + S1 retained.
{
  const directSrc = readFileSync(
    join(REPO, "server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(
    /activeClaimCases:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? \[\]\s*\n\s*: Array\.isArray\(activeClaimCases\)\s*\n\s*\? activeClaimCases\s*\n\s*: \[\]/.test(
      directSrc,
    ),
    true,
    "Direct readyCardSsot must gate activeClaimCases on product request",
  );
  assert.equal(
    /claimEvidenceBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null\s*\n\s*: claimEvidenceBrief \|\| null/.test(
      directSrc,
    ),
    true,
    "S1 claimEvidenceBrief product-turn omit must remain",
  );
  console.log("PASS source Exact Change lock (S2 + S1)");
}

// T1 — product recommend → no active_claims card handoff
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(PRODUCT_Q), true);
  const cases = handoffActiveClaimCases(PRODUCT_Q, [claimRow]);
  assert.deepEqual(cases, []);
  const req = buildReq(PRODUCT_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(PRODUCT_Q, evidenceIn),
    activeClaimCases: cases,
  });
  const card = extractCard(req);
  assert.ok(card, "card missing");
  assert.equal(
    Object.prototype.hasOwnProperty.call(card, "active_claims"),
    false,
    "T1: active_claims must be absent on product turn",
  );
  console.log("PASS T1 product turn omits active_claims");
}

// T2 — claim question → active_claims kept
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(CLAIM_Q), false);
  const cases = handoffActiveClaimCases(CLAIM_Q, [claimRow]);
  assert.equal(cases.length, 1);
  const req = buildReq(CLAIM_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(CLAIM_Q, evidenceIn),
    activeClaimCases: cases,
  });
  const card = extractCard(req);
  assert.ok(card?.active_claims, "T2: active_claims missing");
  assert.equal(card.active_claims[0].claim_case_key, "case-1");
  console.log("PASS T2 claim turn keeps active_claims");
}

// T3 — other non-product → existing active_claims behavior
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(OTHER_Q), false);
  const cases = handoffActiveClaimCases(OTHER_Q, [claimRow]);
  assert.equal(cases.length, 1);
  const req = buildReq(OTHER_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(OTHER_Q, evidenceIn),
    activeClaimCases: cases,
  });
  const card = extractCard(req);
  assert.ok(card?.active_claims, "T3: active_claims missing");
  console.log("PASS T3 other turn keeps active_claims");
}

// T4 — S1 claim_evidence still omitted on product turn
{
  const req = buildReq(PRODUCT_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(PRODUCT_Q, evidenceIn),
    activeClaimCases: handoffActiveClaimCases(PRODUCT_Q, [claimRow]),
  });
  const card = extractCard(req);
  assert.equal(
    Object.prototype.hasOwnProperty.call(card, "claim_evidence"),
    false,
    "T4: S1 claim_evidence must remain absent on product turn",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(card, "active_claims"),
    false,
    "T4: S2 active_claims must also be absent on product turn",
  );
  console.log("PASS T4 S1 claim_evidence regression + S2 together");
}

// T5 — KEY_RELEVANT_EVIDENCE unchanged under product omit
{
  const reqWith = buildReq(CLAIM_Q, {
    claimEvidenceBrief: evidenceIn,
    activeClaimCases: [claimRow],
  });
  const reqOmit = buildReq(PRODUCT_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(PRODUCT_Q, evidenceIn),
    activeClaimCases: handoffActiveClaimCases(PRODUCT_Q, [claimRow]),
  });
  const kreWith = extractKeyRelevant(reqWith);
  const kreOmit = extractKeyRelevant(reqOmit);
  assert.ok(kreWith && kreOmit, "KEY_RELEVANT_EVIDENCE must remain on both");
  assert.equal(Array.isArray(kreOmit.focused_contracts), true);
  const cardOmit = extractCard(reqOmit);
  const cardWith = extractCard(reqWith);
  assert.deepEqual(cardOmit.insurance_contracts, cardWith.insurance_contracts);
  console.log("PASS T5 KEY_RELEVANT_EVIDENCE unchanged");
}

console.log(
  JSON.stringify({
    KEY_ACTIVE_CLAIMS_PRODUCT_TURN_OMIT_UNIT: "PASS",
    PRODUCTION: 0,
  }),
);
