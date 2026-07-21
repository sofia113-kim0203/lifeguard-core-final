/**
 * Policy Date Foundation — pure unit lock (no network).
 */
import assert from "node:assert/strict";
import {
  buildInsuranceClocksFromPolicyDateFacts,
  buildPolicyDateFactFromDocumentEvidence,
  buildPolicyDateFactsFromUtterance,
  canonicalizePolicyDateFactKey,
  mergePolicyDateFacts,
  normalizePolicyDateFacts,
  parsePolicyDateLiteral,
} from "../server/keyCore/keyPolicyDateFacts.js";
import { assembleInsuranceClockItemsForHand } from "../server/keyCore/keyInsuranceClock.js";
import { KEY_CONFIRMED_SOURCE_FACT_TYPES } from "../server/documentPolicyUploadPersist.js";

const NOW = new Date("2026-07-22T10:00:00+09:00");
const CUSTOMER = "cust-pdfact";
const DOC = "doc-qa-renewal-1";
const ENTITY_A = "entity-a";

assert.ok(KEY_CONFIRMED_SOURCE_FACT_TYPES.includes("policy.renewal_date"));
assert.ok(KEY_CONFIRMED_SOURCE_FACT_TYPES.includes("policy.maturity_date"));
assert.ok(KEY_CONFIRMED_SOURCE_FACT_TYPES.includes("policy.effective_from"));

assert.equal(canonicalizePolicyDateFactKey("renewal_date"), "policy.renewal_date");
assert.equal(parsePolicyDateLiteral("2026-12-15"), "2026-12-15");
assert.equal(parsePolicyDateLiteral("2026년 12월 15일"), "2026-12-15");
assert.equal(parsePolicyDateLiteral("10년 갱신형"), null);
assert.equal(parsePolicyDateLiteral("보험기간 20년"), null);

// Document evidence → fact + clock
{
  const built = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    entityId: null,
    documentId: DOC,
    factKey: "policy.renewal_date",
    dateValue: "2026-12-15",
    qaFixture: true,
    now: NOW,
  });
  assert.equal(built.ok, true);
  assert.equal(built.updates[0].source, "document_evidence");
  assert.equal(built.updates[0].entity_id, null);
  assert.equal(built.updates[0].evidence_id, DOC);
  assert.equal(built.updates[0].qa_fixture, true);

  const clocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: built.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(clocks.length, 1);
  assert.equal(clocks[0].clock_type, "policy_renewal");
  assert.equal(clocks[0].due_at, "2026-12-15");
  assert.equal(clocks[0].source, "document_evidence");
  assert.equal(clocks[0].evidence_id, DOC);
}

// Maturity separate — never substitute effective_from
{
  const eff = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    documentId: "doc-eff",
    factKey: "policy.effective_from",
    dateValue: "2020-01-01",
    now: NOW,
  });
  const clocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: eff.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(clocks.length, 0);

  const mat = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    documentId: "doc-mat",
    factKey: "policy.maturity_date",
    dateValue: "2040-01-01",
    now: NOW,
  });
  const matClocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: mat.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(matClocks[0].clock_type, "policy_maturity");
  assert.equal(matClocks[0].due_at, "2040-01-01");
}

// Customer statement with explicit date
{
  const built = buildPolicyDateFactsFromUtterance({
    question: "내 계약 갱신일은 2026년 12월 15일이야.",
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(built.ok, true);
  assert.equal(built.updates[0].fact_key, "policy.renewal_date");
  assert.equal(built.updates[0].date_value, "2026-12-15");
  assert.equal(built.updates[0].source, "customer_statement");
}

// Period prose rejected
{
  const built = buildPolicyDateFactsFromUtterance({
    question: "이 상품은 10년 갱신형이야.",
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(built.ok, false);
}

// Corporate scope on fact
{
  const built = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    documentId: "doc-corp",
    factKey: "policy.renewal_date",
    dateValue: "2027-03-01",
    now: NOW,
  });
  assert.equal(built.updates[0].entity_id, ENTITY_A);
  const assembled = assembleInsuranceClockItemsForHand({
    storedClocks: [],
    policyDateFacts: built.updates,
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    mode: "corporate",
    now: NOW,
  });
  assert.equal(assembled.length, 1);
  assert.equal(assembled[0].entity_id, ENTITY_A);
  const personal = assembleInsuranceClockItemsForHand({
    storedClocks: [],
    policyDateFacts: built.updates,
    customerId: CUSTOMER,
    mode: "personal",
    now: NOW,
  });
  assert.equal(personal.length, 0);
}

// Dedupe + no invent from end_date on policies
{
  const a = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    documentId: DOC,
    factKey: "policy.renewal_date",
    dateValue: "2026-12-15",
    now: NOW,
  });
  const merged = mergePolicyDateFacts(a.updates, a.updates, { now: NOW });
  assert.equal(merged.length, 1);
  const fromEnd = assembleInsuranceClockItemsForHand({
    policies: [{ id: "p1", end_date: "2030-01-01", coverage_summary: { end_date: "2030-01-01" } }],
    customerId: CUSTOMER,
    mode: "personal",
    now: NOW,
  });
  assert.equal(fromEnd.length, 0);
}

assert.equal(normalizePolicyDateFacts([{ fact_key: "policy.renewal_date" }]).length, 0);

console.log("key-policy-date-foundation-unit-test: PASS");
