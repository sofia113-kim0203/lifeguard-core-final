/**
 * Slice 4 — safe gap/rec evidence + Claude-first payload (mock only).
 * Usage: node scripts/key-claude-corporate-gap-rec-evidence-unit-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCorporateGapInputFromSnapshot,
  analyzeCorporateCoverageGaps,
} from "../server/entity/corporate/corporateGap.js";
import {
  buildCorporateRecommendationInputFromGap,
  generateCorporateRecommendations,
} from "../server/entity/corporate/corporateRecommendation.js";
import { CORPORATE_SNAPSHOT_V1 } from "../server/entity/corporate/corporateSnapshot.js";
import {
  buildClaudeCorporateGapRecEvidence,
  buildClaudeCorporateFactPack,
} from "../server/keyCore/keyClaudeCorporateContext.js";
import {
  buildUserPayload,
  runClaudeFirstDirectQuestionTurn,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { clearReadyCardCache } from "../server/keyCore/keyReadyCardCache.js";

clearReadyCardCache();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTITY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTITY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function makeSnapshot({
  entityId = ENTITY_A,
  group = "unknown",
  liability = null,
  fire = null,
  executive = null,
  employeeCount = null,
  unknowns = null,
} = {}) {
  const derivedUnknowns =
    unknowns ??
    [
      group === "unknown" || group == null ? "group_insurance_status" : null,
      liability == null || liability === "unknown" ? "liability" : null,
      fire == null || fire === "unknown" ? "fire_insurance" : null,
      executive == null || executive === "unknown" ? "executive_protection" : null,
      employeeCount == null ? "employee_count" : null,
    ].filter(Boolean);

  return {
    contract_version: CORPORATE_SNAPSHOT_V1,
    built_at: "2026-07-14T00:00:00.000Z",
    identity: {
      entity_id: entityId,
      entity_type: "corporate",
      status: "active",
      scope: "owner",
      display_name: entityId === ENTITY_A ? "A법인" : "B법인",
      memory_version: 1,
    },
    memory_summary: {
      fact_count: 0,
      fact_keys: [],
      source: "entity_memory_facts",
    },
    derived: {
      industry: null,
      group_insurance_status: group ?? "unknown",
      employee_count: employeeCount,
      executive_protection: executive,
      fire_insurance: fire,
      liability,
      unknowns: derivedUnknowns,
    },
  };
}

function runGapRec(snapshot) {
  const gapInput = buildCorporateGapInputFromSnapshot({ corporateSnapshot: snapshot });
  const analysis = analyzeCorporateCoverageGaps({ gapInput });
  const recommendationInput = buildCorporateRecommendationInputFromGap({
    gapContext: { analysis },
  });
  const rec = generateCorporateRecommendations({ recommendationInput });
  return { analysis, rec };
}

function findGap(analysis, item) {
  return (analysis.gaps ?? []).find((g) => g.item === item);
}

function findCand(rec, item) {
  return [
    ...(rec.priority_items ?? []),
    ...(rec.maintain_items ?? []),
    ...(rec.deferred_items ?? []),
  ].find((r) => r.item === item);
}

// --- empty / all unknown ---
{
  const { analysis, rec } = runGapRec(makeSnapshot({}));
  assert.equal(analysis.gaps.every((g) => g.unknown_gap === true), true);
  assert.equal(analysis.gaps.every((g) => g.sufficient === false), true);
  assert.equal(rec.deferred_items.length, analysis.gaps.length);
  assert.equal(rec.priority_items.length, 0);
  assert.equal(rec.invented_recommendation, false);
}

// --- explicit absent → known_gap + address_gap ---
{
  const { analysis, rec } = runGapRec(
    makeSnapshot({
      group: "absent",
      liability: "없음",
      fire: "없음",
      executive: "없음",
      employeeCount: 12,
      unknowns: [],
    }),
  );
  const group = findGap(analysis, "group_insurance");
  assert.equal(group.status, "known_gap");
  assert.equal(group.sufficient, false);
  assert.equal(findCand(rec, "group_insurance").action, "address_gap");
  assert.equal(
    findCand(rec, "group_insurance").action_meaning,
    "known_gap_review_candidate_not_risk_rank",
  );
}

// --- explicit present → sufficient + maintain ---
{
  const { analysis, rec } = runGapRec(
    makeSnapshot({
      group: "present",
      liability: "있음",
      fire: "yes",
      executive: "present",
      employeeCount: 12,
      unknowns: [],
    }),
  );
  assert.equal(findGap(analysis, "group_insurance").sufficient, true);
  assert.equal(findCand(rec, "group_insurance").action, "maintain");
  assert.equal(findGap(analysis, "liability").sufficient, true);
}

// --- unsupported free text → unknown, never sufficient ---
{
  const { analysis, rec } = runGapRec(
    makeSnapshot({
      group: "present",
      liability: "우리 회사 배상 적당히 있음",
      fire: "아마도 가입",
      executive: "검토중",
      employeeCount: 5,
      unknowns: [],
    }),
  );
  assert.equal(findGap(analysis, "liability").status, "unknown");
  assert.equal(findGap(analysis, "liability").sufficient, false);
  assert.equal(findCand(rec, "liability").action, "defer");
  assert.equal(findGap(analysis, "fire_insurance").status, "unknown");
  assert.equal(findGap(analysis, "executive_protection").status, "unknown");
}

// --- employee_count > 0 without benefit fact → unknown + defer ---
{
  const { analysis, rec } = runGapRec(
    makeSnapshot({
      group: "present",
      liability: "있음",
      fire: "있음",
      executive: "있음",
      employeeCount: 40,
      unknowns: [],
    }),
  );
  const benefit = findGap(analysis, "employee_benefit");
  assert.equal(benefit.status, "unknown");
  assert.equal(benefit.unknown_gap, true);
  assert.equal(benefit.sufficient, false);
  assert.match(benefit.reason, /employee_count_not_sufficiency/);
  assert.equal(findCand(rec, "employee_benefit").action, "defer");
}

// --- unknown never promoted to address_gap ---
{
  const { analysis, rec } = runGapRec(
    makeSnapshot({
      group: "unknown",
      liability: null,
      fire: null,
      executive: null,
      employeeCount: null,
    }),
  );
  assert.equal(rec.priority_items.length, 0);
  assert.equal(analysis.gaps.every((g) => g.unknown_gap), true);
}

// --- recommendation candidates have no product/premium/amount/risk score ---
{
  const evidence = buildClaudeCorporateGapRecEvidence({
    snapshot: makeSnapshot({
      group: "absent",
      liability: "없음",
      fire: "있음",
      executive: "unknown",
      employeeCount: 3,
      unknowns: ["executive_protection"],
    }),
  });
  const blob = JSON.stringify(evidence);
  assert.equal(/월\s*보험료|보장금액|premium|risk_score|상품명/.test(blob), false);
  assert.equal(evidence.invented_coverage, false);
  assert.equal(evidence.invented_recommendation, false);
  assert.equal(evidence.priority_meaning, "known_gap_review_candidates_not_severity_rank");
  for (const c of evidence.recommendation_candidates) {
    assert.ok(["address_gap", "maintain", "defer"].includes(c.action));
    assert.equal(Object.prototype.hasOwnProperty.call(c, "product_name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(c, "premium"), false);
  }
}

// --- multi-entity separation ---
{
  const a = buildClaudeCorporateGapRecEvidence({
    snapshot: makeSnapshot({ entityId: ENTITY_A, group: "absent", unknowns: ["liability", "fire_insurance", "executive_protection", "employee_count"] }),
  });
  const b = buildClaudeCorporateGapRecEvidence({
    snapshot: makeSnapshot({ entityId: ENTITY_B, group: "present", unknowns: ["liability", "fire_insurance", "executive_protection", "employee_count"] }),
  });
  assert.equal(a.gap_evidence.every((g) => g.entity_id === ENTITY_A), true);
  assert.equal(b.gap_evidence.every((g) => g.entity_id === ENTITY_B), true);
  assert.equal(JSON.stringify(a).includes(ENTITY_B), false);
  assert.equal(JSON.stringify(b).includes(ENTITY_A), false);
}

// --- payload wiring: no membership → personal only shape ---
{
  const personal = buildUserPayload({
    question: "내 보험 어때?",
    chart: { policy_count: { value: 2 } },
    allowlist: {},
    contextPack: {},
  });
  assert.equal(personal.available_verified_evidence.personal.chart.policy_count.value, 2);
  assert.deepEqual(personal.available_verified_evidence.corporate, []);
  assert.deepEqual(personal.available_verified_evidence.public_evidence, []);
}

// --- payload wiring: membership evidence + personal chart together ---
{
  const pack = buildClaudeCorporateFactPack({
    entityRecord: {
      entity_id: ENTITY_A,
      id: ENTITY_A,
      entity_type: "corporate",
      display_name: "A법인",
      memory_version: 1,
    },
    membership: { member_role: "owner" },
    snapshot: makeSnapshot({ group: "absent", unknowns: ["liability", "fire_insurance", "executive_protection", "employee_count"] }),
    memorySnapshot: { facts: [], fact_count: 0, memory_namespace: "entity_memory_facts" },
  });
  const evidence = buildClaudeCorporateGapRecEvidence({
    snapshot: makeSnapshot({ group: "absent", unknowns: ["liability", "fire_insurance", "executive_protection", "employee_count"] }),
  });
  const payload = buildUserPayload({
    question: "회사 보장 빈곳 알려줘",
    chart: { policy_count: { value: 2 }, contracts: [{ verified_fields: { insurer_name: "한화생명" } }] },
    allowlist: { allowed_entities: ["한화생명"] },
    contextPack: {},
    corporateContexts: [pack],
    corporateGapEvidence: evidence.gap_evidence,
    corporateRecommendationCandidates: evidence.recommendation_candidates,
    corporateUnknowns: evidence.unknowns.map((u) => ({ entity_id: ENTITY_A, unknown: u })),
  });
  assert.equal(payload.available_verified_evidence.personal.chart.policy_count.value, 2);
  assert.equal(payload.available_verified_evidence.corporate.length, 1);
  assert.ok(payload.available_verified_evidence.corporate[0].gap_evidence.length > 0);
  assert.ok(payload.available_verified_evidence.corporate[0].recommendation_candidates.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "guidance"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "corporate_evidence_meta"), false);
  assert.equal(
    JSON.stringify(payload.available_verified_evidence.corporate[0]).includes("한화생명"),
    false,
  );
}

const previewEnv = {
  VERCEL_ENV: "preview",
  KEY_BORROWED_SENSES: "shadow",
  KEY_CLAUDE_FIRST_DIRECT: "1",
  ANTHROPIC_API_KEY: "test-key-slice4",
};

function extractPayload(opts) {
  const body = JSON.parse(String(opts?.body ?? "{}"));
  const content = body?.messages?.[0]?.content;
  const text = Array.isArray(content)
    ? content.find((b) => b?.type === "text")?.text ?? ""
    : typeof content === "string"
      ? content
      : "";
  return JSON.parse(text);
}

{
  let claudeCalls = 0;
  const evidence = buildClaudeCorporateGapRecEvidence({
    snapshot: makeSnapshot({
      group: "absent",
      liability: "없음",
      fire: "있음",
      executive: null,
      employeeCount: 8,
      unknowns: ["executive_protection"],
    }),
  });
  const pack = buildClaudeCorporateFactPack({
    entityRecord: {
      entity_id: ENTITY_A,
      id: ENTITY_A,
      entity_type: "corporate",
      display_name: "A법인",
    },
    membership: { member_role: "owner" },
    snapshot: makeSnapshot({
      group: "absent",
      liability: "없음",
      fire: "있음",
      executive: null,
      employeeCount: 8,
      unknowns: ["executive_protection"],
    }),
    memorySnapshot: { facts: [], fact_count: 0 },
  });

  const result = await runClaudeFirstDirectQuestionTurn({
    question: "우리 회사 보장과 내 개인보험을 비교해줘",
    history: [],
    loadedContext: {
      policies: [{ insurer_name: "한화생명" }],
      policy_count: 1,
    },
    customerId: "cust-corp-gap-rec-1",
    authUserId: "user-1",
    userSupabase: { __test: true },
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const payload = extractPayload(opts);
      assert.equal(payload.available_verified_evidence?.personal?.chart != null, true);
      assert.equal(payload.available_verified_evidence.corporate.length, 1);
      assert.ok(payload.available_verified_evidence.corporate[0].gap_evidence.length > 0);
      assert.ok(payload.available_verified_evidence.corporate[0].recommendation_candidates.length > 0);
      assert.equal(/composeCorporateKeySpeech|runCorporateKeyLoopTurn/.test(JSON.stringify(opts)), false);
      return {
        ok: true,
        async json() {
          return {
            content: [{ type: "text", text: "개인 사실과 법인 근거 후보를 함께 확인했습니다." }],
          };
        },
      };
    },
    loadAllowedCorporateContextsForClaudeImpl: async () => ({
      ok: true,
      corporate_contexts: [pack],
      corporate_gap_evidence: evidence.gap_evidence,
      corporate_recommendation_candidates: evidence.recommendation_candidates,
      corporate_unknowns: evidence.unknowns.map((u) => ({ entity_id: ENTITY_A, unknown: u })),
      invented_coverage: false,
      invented_recommendation: false,
    }),
  });
  assert.equal(claudeCalls, 1);
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(result.salesDirectorTrace?.compose_mode, "key_claude_first_direct");
}

// --- dead import / speech path guard ---
{
  const hand = readFileSync(join(ROOT, "server/keyCore/keyClaudeCorporateContext.js"), "utf8");
  assert.equal(/from ["'].*corporateKeySpeech/.test(hand), false);
  assert.equal(/from ["'].*runCorporateKeyLoopTurn/.test(hand), false);
  assert.equal(/from ["'].*corporateKeyContext/.test(hand), false);
  const first = readFileSync(join(ROOT, "server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  assert.equal(/from ["'].*corporateKeySpeech/.test(first), false);
  assert.equal(/from ["'].*runCorporateKeyLoopTurn/.test(first), false);
  assert.match(first, /corporateGapEvidence|gap_evidence/);
  assert.match(first, /corporateRecommendationCandidates|recommendation_candidates/);
  assert.match(first, /available_verified_evidence/);
}

console.log("key-claude-corporate-gap-rec-evidence-unit-test: PASS");
