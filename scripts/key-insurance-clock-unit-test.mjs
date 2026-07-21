/**
 * Insurance Clock Slice 1 — pure unit lock (no network).
 * Seats A/B/D/E/F storage + source honesty + no regress.
 */
import assert from "node:assert/strict";
import {
  assembleInsuranceClockItemsForHand,
  buildConsentExpiryClocksFromGrants,
  buildInsuranceClockHandBrief,
  buildInsuranceClockUpdatesFromUtterance,
  buildPolicyDateClocksFromPolicies,
  filterInsuranceClocksByScope,
  mergeInsuranceClockItems,
  parseCustomerStatedDeadline,
} from "../server/keyCore/keyInsuranceClock.js";
import {
  buildInsuranceClocksFromPolicyDateFacts,
  buildPolicyDateFactFromDocumentEvidence,
  buildPolicyDateFactsFromUtterance,
} from "../server/keyCore/keyPolicyDateFacts.js";
import { buildAuthorityHandBrief } from "../server/entity/entityAuthorityConsent.js";
import { applyCustomerViewModeToUserPayload } from "../server/keyCore/keyCustomerViewContext.js";

const NOW = new Date("2026-07-13T10:00:00+09:00"); // Monday
const CUSTOMER = "cust-clock-a";
const ENTITY_A = "entity-qa-a";
const ENTITY_B = "entity-qa-b";

const openSurgery = {
  claim_case_key: "customer_statement:kind:surgery",
  claim_scope: "personal",
  entity_id: null,
  status: "preparing",
  source: "customer_statement",
  medical_event: { event_kind: "surgery" },
};

// --- Seat A: explicit next-Friday deadline (Asia/Seoul anchor) ---
{
  const parsed = parseCustomerStatedDeadline(
    "다음 주 금요일까지 진단서를 제출해야 해.",
    { now: NOW, timeZone: "Asia/Seoul" },
  );
  assert.equal(parsed.status, "active");
  assert.equal(parsed.due_at, "2026-07-24");
  assert.equal(parsed.next_check_at, "2026-07-24");
  assert.equal(parsed.relative_anchor_date, "2026-07-13");
  assert.equal(parsed.timezone, "Asia/Seoul");

  const built = buildInsuranceClockUpdatesFromUtterance({
    question: "다음 주 금요일까지 진단서를 제출해야 해.",
    existingCases: [openSurgery],
    existingClocks: [],
    customerId: CUSTOMER,
    messageId: "msg-a-1",
    now: NOW,
  });
  assert.equal(built.ok, true);
  assert.equal(built.updates[0].clock_type, "claim_followup");
  assert.equal(built.updates[0].source, "customer_statement");
  assert.equal(built.updates[0].due_at, "2026-07-24");
  assert.equal(built.updates[0].entity_id, null);
  assert.equal(built.updates[0].subject_id, openSurgery.claim_case_key);
  assert.equal(built.updates[0].source_message_id, "msg-a-1");
  assert.equal(built.updates[0].relative_anchor_date, "2026-07-13");
  assert.equal(built.updates[0].evidence?.timezone, "Asia/Seoul");
}

// --- Seat B: vague — no invented due_at (even beside dated claim clock) ---
{
  const parsed = parseCustomerStatedDeadline("서류를 곧 내야 해.", { now: NOW });
  assert.equal(parsed.status, "unknown_date");
  assert.equal(parsed.due_at, null);
  assert.ok(parsed.next_check_at);

  const dated = buildInsuranceClockUpdatesFromUtterance({
    question: "다음 주 금요일까지 진단서를 제출해야 해.",
    existingCases: [openSurgery],
    existingClocks: [],
    customerId: CUSTOMER,
    messageId: "msg-a-prior",
    now: NOW,
  });
  const built = buildInsuranceClockUpdatesFromUtterance({
    question: "서류를 곧 내야 해.",
    existingCases: [openSurgery],
    existingClocks: dated.updates,
    customerId: CUSTOMER,
    messageId: "msg-b-1",
    now: NOW,
  });
  assert.equal(built.ok, true);
  assert.equal(built.updates[0].status, "unknown_date");
  assert.equal(built.updates[0].due_at, null);
  assert.ok(String(built.updates[0].subject_id).startsWith("utterance:unknown:"));
}

// --- Seat C: consent expiry from SSOT expires_at ---
{
  const grants = [
    {
      id: "grant-a1",
      entity_id: ENTITY_A,
      consent_scope: "insurance_consultation",
      status: "active",
      expires_at: "2026-08-01T00:00:00.000Z",
    },
  ];
  const brief = buildAuthorityHandBrief({
    ok: true,
    grants,
    scopes_entity_level: ["insurance_consultation"],
    subjects: {},
    authority_types: ["representative"],
  });
  assert.equal(brief.consent_deadlines.length, 1);
  assert.equal(brief.consent_deadlines[0].expires_at, "2026-08-01T00:00:00.000Z");

  const clocks = buildConsentExpiryClocksFromGrants({
    grants,
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    now: NOW,
  });
  assert.equal(clocks.length, 1);
  assert.equal(clocks[0].clock_type, "consent_expiry");
  assert.equal(clocks[0].due_at, "2026-08-01");
  assert.equal(clocks[0].source, "authority_consent");
  assert.equal(clocks[0].entity_id, ENTITY_A);
}

// --- Seat D: policy renewal only with verified date ---
{
  const withDate = buildPolicyDateClocksFromPolicies({
    policies: [
      { id: "pol-1", renewal_date: "2026-12-01", entity_id: null },
      { id: "pol-2" }, // no date — skip
    ],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(withDate.length, 1);
  assert.equal(withDate[0].clock_type, "policy_renewal");
  assert.equal(withDate[0].due_at, "2026-12-01");
  assert.equal(withDate[0].entity_id, null);
  assert.equal(withDate[0].source, "document_evidence");

  const corp = buildPolicyDateClocksFromPolicies({
    policies: [{ id: "pol-corp", renewal_date: "2026-11-15", entity_id: ENTITY_A }],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(corp[0].entity_id, ENTITY_A);
}

// --- Seat E: complete + no regress ---
{
  const created = buildInsuranceClockUpdatesFromUtterance({
    question: "다음 주 금요일까지 진단서를 제출해야 해.",
    existingCases: [openSurgery],
    existingClocks: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  const active = created.updates[0];
  const completed = buildInsuranceClockUpdatesFromUtterance({
    question: "진단서 제출했어.",
    existingCases: [openSurgery],
    existingClocks: [active],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.updates[0].status, "completed");

  // Undated / non-statement merge must not reopen completed.
  const mergedBlocked = mergeInsuranceClockItems(
    completed.updates,
    [
      {
        ...active,
        status: "active",
        due_at: null,
        source: "system",
        note: "should_not_reopen",
      },
    ],
    { now: NOW },
  );
  assert.equal(mergedBlocked[0].status, "completed");

  // Explicit dated customer_statement supersedes completed (Seat A).
  const reopenDated = buildInsuranceClockUpdatesFromUtterance({
    question: "다음 주 금요일까지 진단서를 제출해야 해.",
    existingCases: [openSurgery],
    existingClocks: completed.updates,
    customerId: CUSTOMER,
    messageId: "msg_reopen_dated",
    now: NOW,
  });
  assert.equal(reopenDated.ok, true);
  assert.equal(reopenDated.updates[0].status, "active");
  assert.equal(reopenDated.updates[0].due_at, "2026-07-24");
  assert.equal(reopenDated.updates[0].source_message_id, "msg_reopen_dated");
  const mergedSupersede = mergeInsuranceClockItems(completed.updates, reopenDated.updates, {
    now: NOW,
  });
  assert.equal(mergedSupersede[0].status, "active");
  assert.equal(mergedSupersede[0].due_at, "2026-07-24");
  assert.equal(mergedSupersede[0].completed_at, null);

  // Vague creates utterance:unknown — does not reopen completed claim_case (Seat E).
  const reopenVague = buildInsuranceClockUpdatesFromUtterance({
    question: "서류를 곧 내야 해.",
    existingCases: [openSurgery],
    existingClocks: completed.updates,
    customerId: CUSTOMER,
    messageId: "msg_reopen_vague",
    now: NOW,
  });
  assert.equal(reopenVague.ok, true);
  assert.equal(reopenVague.updates[0].status, "unknown_date");
  assert.match(String(reopenVague.updates[0].subject_id), /^utterance:unknown:/);
  const afterVague = mergeInsuranceClockItems(completed.updates, reopenVague.updates, {
    now: NOW,
  });
  const surgeryStill = afterVague.find((c) => c.subject_id === openSurgery.claim_case_key);
  assert.equal(surgeryStill.status, "completed");
}

// --- Seat F: personal / corporate isolation ---
{
  const items = [
    {
      id: "c1",
      customer_id: CUSTOMER,
      entity_id: null,
      clock_type: "claim_followup",
      subject_type: "claim_case",
      subject_id: "personal-claim",
      due_at: "2026-07-20",
      next_check_at: "2026-07-20",
      status: "active",
      source: "customer_statement",
    },
    {
      id: "c2",
      customer_id: CUSTOMER,
      entity_id: ENTITY_A,
      clock_type: "consent_expiry",
      subject_type: "authority_consent",
      subject_id: "grant-a1",
      due_at: "2026-08-01",
      next_check_at: "2026-08-01",
      status: "active",
      source: "authority_consent",
    },
    {
      id: "c3",
      customer_id: CUSTOMER,
      entity_id: ENTITY_B,
      clock_type: "consent_expiry",
      subject_type: "authority_consent",
      subject_id: "grant-b1",
      due_at: "2026-08-15",
      next_check_at: "2026-08-15",
      status: "active",
      source: "authority_consent",
    },
  ];
  const personal = filterInsuranceClocksByScope(items, { mode: "personal" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].entity_id, null);

  const corpA = filterInsuranceClocksByScope(items, {
    mode: "corporate",
    entityId: ENTITY_A,
  });
  assert.equal(corpA.length, 1);
  assert.equal(corpA[0].entity_id, ENTITY_A);

  const payload = {
    current_context: {
      insurance_clock: buildInsuranceClockHandBrief(items, { now: NOW }),
    },
    available_verified_evidence: { personal: {}, corporate: [] },
  };
  const personalView = applyCustomerViewModeToUserPayload(payload, {
    mode: "personal",
    entity_id: null,
  });
  assert.equal(personalView.current_context.insurance_clock.upcoming.length, 1);
  assert.ok(
    personalView.current_context.insurance_clock.upcoming.every((r) => !r.entity_id),
  );

  const corpView = applyCustomerViewModeToUserPayload(payload, {
    mode: "corporate",
    entity_id: ENTITY_A,
  });
  assert.equal(corpView.current_context.insurance_clock.upcoming.length, 1);
  assert.equal(corpView.current_context.insurance_clock.upcoming[0].entity_id, ENTITY_A);
}

// --- Seat G: next-session brief honesty ---
{
  const brief = buildInsuranceClockHandBrief(
    [
      {
        id: "u1",
        clock_type: "claim_followup",
        subject_id: "s1",
        due_at: "2026-07-24",
        next_check_at: "2026-07-24",
        status: "active",
        source: "customer_statement",
      },
      {
        id: "u2",
        clock_type: "claim_followup",
        subject_id: "s2",
        due_at: null,
        next_check_at: "2026-07-16",
        status: "unknown_date",
        source: "customer_statement",
      },
      {
        id: "u3",
        clock_type: "claim_followup",
        subject_id: "s3",
        due_at: "2026-07-10",
        next_check_at: "2026-07-10",
        status: "completed",
        source: "customer_statement",
        completed_at: "2026-07-12T00:00:00.000Z",
      },
    ],
    { now: NOW },
  );
  assert.equal(brief.upcoming.length, 1);
  assert.equal(brief.unknown_date.length, 1);
  assert.equal(brief.completed_recent.length, 1);
  assert.equal(brief.upcoming[0].due_at, "2026-07-24");
  assert.equal(brief.unknown_date[0].due_at, null);
}

// Assemble: consent projected + stored claim followup
{
  const assembled = assembleInsuranceClockItemsForHand({
    storedClocks: [
      {
        id: "stored-1",
        customer_id: CUSTOMER,
        entity_id: null,
        clock_type: "claim_followup",
        subject_id: "claim-1",
        due_at: "2026-07-24",
        next_check_at: "2026-07-24",
        status: "active",
        source: "customer_statement",
      },
    ],
    corporateContexts: [
      {
        entity_id: ENTITY_A,
        authority_brief: {
          consent_deadlines: [
            {
              id: "g1",
              entity_id: ENTITY_A,
              consent_scope: "claim_support",
              expires_at: "2026-09-01",
              status: "active",
            },
          ],
        },
      },
    ],
    policies: [],
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    mode: "both",
    now: NOW,
  });
  assert.ok(assembled.some((c) => c.clock_type === "claim_followup"));
  assert.ok(assembled.some((c) => c.clock_type === "consent_expiry"));
}

// --- Premium / Lapse Slice: fact → clock (1:1, no renewal/maturity substitute) ---
{
  const premiumUtt = buildPolicyDateFactsFromUtterance({
    question: "보험료 납입기한이 2026년 8월 20일이야.",
    customerId: CUSTOMER,
    messageId: "msg-premium-1",
    now: NOW,
  });
  assert.equal(premiumUtt.ok, true);
  assert.equal(premiumUtt.updates[0].fact_key, "policy.premium_due_date");
  assert.equal(premiumUtt.updates[0].date_value, "2026-08-20");
  assert.equal(premiumUtt.updates[0].source, "customer_statement");
  assert.equal(premiumUtt.updates[0].source_message_id, "msg-premium-1");
  const premiumClocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: premiumUtt.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(premiumClocks.length, 1);
  assert.equal(premiumClocks[0].clock_type, "premium_due");
  assert.equal(premiumClocks[0].due_at, "2026-08-20");
  assert.equal(premiumClocks[0].source_message_id, "msg-premium-1");

  const lapseUtt = buildPolicyDateFactsFromUtterance({
    question: "실효 예정일은 2026-09-01이야.",
    customerId: CUSTOMER,
    messageId: "msg-lapse-1",
    now: NOW,
  });
  assert.equal(lapseUtt.ok, true);
  assert.equal(lapseUtt.updates[0].fact_key, "policy.lapse_scheduled_date");
  const lapseClocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: lapseUtt.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(lapseClocks[0].clock_type, "lapse_scheduled");
  assert.equal(lapseClocks[0].due_at, "2026-09-01");

  const reinstateDoc = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    documentId: "doc-reinstate-1",
    factKey: "policy.reinstate_by_date",
    dateValue: "2026-10-15",
    now: NOW,
  });
  assert.equal(reinstateDoc.ok, true);
  const reinstateClocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: reinstateDoc.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(reinstateClocks[0].clock_type, "reinstate_by");
  assert.equal(reinstateClocks[0].due_at, "2026-10-15");
  assert.equal(reinstateClocks[0].evidence_id, "doc-reinstate-1");
  assert.equal(reinstateClocks[0].source, "document_evidence");

  // Vague / no calendar date → no fact stored
  const vaguePremium = buildPolicyDateFactsFromUtterance({
    question: "보험료 납입기한이 곧이야.",
    customerId: CUSTOMER,
    messageId: "msg-vague-premium",
    now: NOW,
  });
  assert.equal(vaguePremium.ok, false);
  assert.equal(vaguePremium.reason, "no_explicit_calendar_date");

  // Renewal must NOT become premium_due / lapse / reinstate
  const renewalOnly = buildPolicyDateFactFromDocumentEvidence({
    customerId: CUSTOMER,
    documentId: "doc-renewal-only",
    factKey: "policy.renewal_date",
    dateValue: "2026-12-01",
    now: NOW,
  });
  const renewalClocks = buildInsuranceClocksFromPolicyDateFacts({
    facts: renewalOnly.updates,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(renewalClocks.length, 1);
  assert.equal(renewalClocks[0].clock_type, "policy_renewal");
  assert.ok(!renewalClocks.some((c) => c.clock_type === "premium_due"));
  assert.ok(!renewalClocks.some((c) => c.clock_type === "lapse_scheduled"));
  assert.ok(!renewalClocks.some((c) => c.clock_type === "reinstate_by"));

  // No regress: completed premium_due stays completed
  const completed = {
    id: "clk_premium_done",
    customer_id: CUSTOMER,
    entity_id: null,
    clock_type: "premium_due",
    subject_id: "utt-premium",
    due_at: "2026-08-20",
    next_check_at: "2026-08-20",
    status: "completed",
    source: "customer_statement",
    completed_at: "2026-07-12T00:00:00.000Z",
  };
  const merged = mergeInsuranceClockItems([completed], premiumClocks, { now: NOW });
  // Different subject_ids → both kept; completed row must not become active
  const completedRow = merged.find((c) => c.id === "clk_premium_done");
  assert.ok(completedRow);
  assert.equal(completedRow.status, "completed");
  // Same subject supersede must not regress completed → active
  const sameSubjectUpdate = {
    ...premiumClocks[0],
    subject_id: completed.subject_id,
    id: "clk_premium_done",
    status: "active",
  };
  const noRegress = mergeInsuranceClockItems([completed], [sameSubjectUpdate], { now: NOW });
  assert.equal(noRegress.find((c) => c.subject_id === completed.subject_id)?.status, "completed");

  // Personal / corporate isolation for premium_due
  const scoped = [
    {
      id: "p1",
      customer_id: CUSTOMER,
      entity_id: null,
      clock_type: "premium_due",
      subject_id: "personal-prem",
      due_at: "2026-08-20",
      next_check_at: "2026-08-20",
      status: "active",
      source: "customer_statement",
    },
    {
      id: "p2",
      customer_id: CUSTOMER,
      entity_id: ENTITY_A,
      clock_type: "lapse_scheduled",
      subject_id: "corp-lapse",
      due_at: "2026-09-01",
      next_check_at: "2026-09-01",
      status: "active",
      source: "document_evidence",
      evidence_id: "doc-lapse-a",
    },
  ];
  assert.equal(filterInsuranceClocksByScope(scoped, { mode: "personal" }).length, 1);
  assert.equal(
    filterInsuranceClocksByScope(scoped, { mode: "corporate", entityId: ENTITY_A }).length,
    1,
  );

  // Policy field projection — explicit only; renewal must not fill premium_due
  const fromPol = buildPolicyDateClocksFromPolicies({
    policies: [
      {
        id: "pol-mix",
        renewal_date: "2026-12-01",
        premium_due_date: "2026-08-20",
        end_date: "2027-01-01",
      },
    ],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.ok(fromPol.some((c) => c.clock_type === "policy_renewal"));
  assert.ok(fromPol.some((c) => c.clock_type === "premium_due" && c.due_at === "2026-08-20"));
  assert.ok(!fromPol.some((c) => c.clock_type === "lapse_scheduled"));
  assert.ok(!fromPol.some((c) => c.due_at === "2027-01-01"));
}

console.log("key-insurance-clock-unit-test: PASS");
