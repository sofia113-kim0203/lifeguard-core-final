/**
 * TOKEN SURGERY S3 — product-turn life_ledger card handoff omit.
 * Also locks S1 claim_evidence + S2 active_claims product-turn omit (no regression).
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

const contracts = [
  {
    id: "c1",
    insurer: "테스트생명",
    product_name: "테스트암보험",
    policy_number: "P-1",
    source_document_id: "doc-1",
  },
];

function handoffLifeLedgerBrief(question, brief) {
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? null
    : brief || null;
}

function handoffActiveClaimCases(question, cases) {
  return isExplicitCurrentInsuranceProductRequest(question) === true
    ? []
    : Array.isArray(cases)
      ? cases
      : [];
}

function handoffClaimEvidenceBrief(question, brief) {
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

function buildReq(question, { claimEvidenceBrief, activeClaimCases, lifeLedgerBrief }) {
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
      lifeLedgerBrief,
      insuranceClockBrief: null,
      policies: contracts,
      policy_count: 1,
    },
    keyRelevantMemoryPacket: packet,
    customerId: "cust-1",
    conversationId: "conv-1",
  });
}

function productHandoff() {
  return {
    claimEvidenceBrief: handoffClaimEvidenceBrief(PRODUCT_Q, evidenceIn),
    activeClaimCases: handoffActiveClaimCases(PRODUCT_Q, [claimRow]),
    lifeLedgerBrief: handoffLifeLedgerBrief(PRODUCT_Q, ledgerIn),
  };
}

{
  const directSrc = readFileSync(
    join(REPO, "server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(
    /lifeLedgerBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null\s*\n\s*: lifeLedgerBrief \|\| null/.test(
      directSrc,
    ),
    true,
    "Direct readyCardSsot must gate lifeLedgerBrief on product request",
  );
  assert.equal(
    /activeClaimCases:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? \[\]/.test(
      directSrc,
    ),
    true,
    "S2 activeClaimCases gate must remain",
  );
  assert.equal(
    /claimEvidenceBrief:\s*\n\s*isExplicitCurrentInsuranceProductRequest\(question\) === true\s*\n\s*\? null/.test(
      directSrc,
    ),
    true,
    "S1 claimEvidenceBrief gate must remain",
  );
  console.log("PASS source Exact Change lock (S3 + S2 + S1)");
}

// T1 — product → no life_ledger / relationship_background
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(PRODUCT_Q), true);
  const req = buildReq(PRODUCT_Q, productHandoff());
  const card = extractCard(req);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "life_ledger"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(card, "relationship_background"),
    false,
  );
  console.log("PASS T1 product turn omits life_ledger");
}

// T2 — other non-product → life_ledger kept under relationship_background envelope
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(OTHER_Q), false);
  const req = buildReq(OTHER_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(OTHER_Q, evidenceIn),
    activeClaimCases: handoffActiveClaimCases(OTHER_Q, [claimRow]),
    lifeLedgerBrief: handoffLifeLedgerBrief(OTHER_Q, ledgerIn),
  });
  const card = extractCard(req);
  assert.equal("life_ledger" in card, false, "T2: life_ledger must not be top-level");
  assert.ok(card?.relationship_background?.life_ledger, "T2: life_ledger missing");
  assert.equal(card.relationship_background.life_ledger.goals[0].id, "g1");
  console.log("PASS T2 other turn keeps life_ledger");
}

// T3 — claim → life_ledger kept under relationship_background envelope
{
  assert.equal(isExplicitCurrentInsuranceProductRequest(CLAIM_Q), false);
  const req = buildReq(CLAIM_Q, {
    claimEvidenceBrief: handoffClaimEvidenceBrief(CLAIM_Q, evidenceIn),
    activeClaimCases: handoffActiveClaimCases(CLAIM_Q, [claimRow]),
    lifeLedgerBrief: handoffLifeLedgerBrief(CLAIM_Q, ledgerIn),
  });
  const card = extractCard(req);
  assert.ok(
    card?.relationship_background?.life_ledger,
    "T3: life_ledger missing",
  );
  console.log("PASS T3 claim turn keeps life_ledger");
}

// T4 — S1 claim_evidence still omitted on product
{
  const card = extractCard(buildReq(PRODUCT_Q, productHandoff()));
  assert.equal(Object.prototype.hasOwnProperty.call(card, "claim_evidence"), false);
  console.log("PASS T4 S1 claim_evidence regression");
}

// T5 — S2 active_claims still omitted on product
{
  const card = extractCard(buildReq(PRODUCT_Q, productHandoff()));
  assert.equal(Object.prototype.hasOwnProperty.call(card, "active_claims"), false);
  console.log("PASS T5 S2 active_claims regression");
}

// T6 — KEY_RELEVANT_EVIDENCE unchanged
{
  const reqWith = buildReq(CLAIM_Q, {
    claimEvidenceBrief: evidenceIn,
    activeClaimCases: [claimRow],
    lifeLedgerBrief: ledgerIn,
  });
  const reqOmit = buildReq(PRODUCT_Q, productHandoff());
  const kreWith = extractKeyRelevant(reqWith);
  const kreOmit = extractKeyRelevant(reqOmit);
  assert.ok(kreWith && kreOmit);
  assert.equal(Array.isArray(kreOmit.focused_contracts), true);
  assert.deepEqual(
    extractCard(reqOmit).insurance_contracts,
    extractCard(reqWith).insurance_contracts,
  );
  console.log("PASS T6 KEY_RELEVANT_EVIDENCE unchanged");
}

console.log(
  JSON.stringify({
    KEY_LIFE_LEDGER_PRODUCT_TURN_OMIT_UNIT: "PASS",
    PRODUCTION: 0,
  }),
);
