/**
 * Corporate fact Hand for the single Claude-first KEY path.
 * Loads membership-scoped corporate verified contexts + gap/rec evidence
 * alongside personal chart.
 *
 * Reuses: loadEntityContextRecords, assertCorporateEntity, assertEntityAccess,
 * createCorporateEntitySession, loadCorporateMemorySnapshot, buildCorporateSnapshot,
 * listMyCorporateEntities, corporateGap/Recommendation pure functions.
 *
 * Does NOT call: resolveEntitySession, runCorporateKeyLoopTurn, corporate compose/speech,
 * loadCorporateKeyContext, workspace/panel compose.
 * Does NOT fail the whole turn when a client sends a stale/foreign entity_id.
 */
import { loadEntityContextRecords } from "../entity/entityRecordLoader.js";
import { assertCorporateEntity, assertEntityAccess } from "../entity/entityGuard.js";
import { ENTITY_RESOLVER_V1 } from "../entity/entityResolver.js";
import {
  createCorporateEntitySession,
  SESSION_ROUTING_REASONS,
} from "../entity/entitySession.js";
import { ENTITY_TYPES } from "../entity/entityTypes.js";
import { loadCorporateMemorySnapshot } from "../entity/corporate/corporateMemorySnapshot.js";
import {
  buildCorporateSnapshot,
  CORPORATE_SNAPSHOT_V1,
} from "../entity/corporate/corporateSnapshot.js";
import {
  buildCorporateGapInputFromSnapshot,
  analyzeCorporateCoverageGaps,
} from "../entity/corporate/corporateGap.js";
import {
  buildCorporateRecommendationInputFromGap,
  generateCorporateRecommendations,
} from "../entity/corporate/corporateRecommendation.js";
import { listMyCorporateEntities } from "../entity/listMyCorporateEntities.js";

export const CORPORATE_AUTH_FAILED_CUSTOMER_TEXT =
  "이 법인의 정보를 확인할 권한이 확인되지 않았습니다.";

export const CLAUDE_CORPORATE_FACT_PACK_V1 = "claude-corporate-fact-pack-v1";
export const CLAUDE_CORPORATE_GAP_EVIDENCE_V1 = "claude-corporate-gap-evidence-v1";
export const CLAUDE_CORPORATE_REC_CANDIDATE_V1 = "claude-corporate-rec-candidate-v1";

/**
 * Build read-only Claude fact pack from corporate snapshot + memory.
 * Separates verified / partial / unknown / provenance. Never invents facts.
 */
export function buildClaudeCorporateFactPack({
  entityRecord = null,
  membership = null,
  snapshot = null,
  memorySnapshot = null,
} = {}) {
  const entityId = entityRecord?.entity_id ?? entityRecord?.id ?? null;
  const role = membership?.member_role
    ? String(membership.member_role).trim().toLowerCase()
    : null;

  const verified_facts = [];
  const partial_facts = [];
  const unknowns = Array.isArray(snapshot?.derived?.unknowns)
    ? [...snapshot.derived.unknowns]
    : [];

  if (entityRecord?.display_name) {
    verified_facts.push({
      key: "identity.display_name",
      value: String(entityRecord.display_name),
      source: "entities",
    });
  }
  if (entityId) {
    verified_facts.push({
      key: "identity.entity_id",
      value: String(entityId),
      source: "entities",
    });
  }
  if (role) {
    verified_facts.push({
      key: "authorization.membership_role",
      value: role,
      source: "entity_memberships",
    });
  }

  const derived = snapshot?.derived ?? {};
  const derivedKnown = [
    ["industry", derived.industry],
    ["group_insurance_status", derived.group_insurance_status],
    ["employee_count", derived.employee_count],
    ["executive_protection", derived.executive_protection],
    ["fire_insurance", derived.fire_insurance],
    ["liability", derived.liability],
  ];
  for (const [field, value] of derivedKnown) {
    if (value == null || value === "" || value === "unknown") continue;
    if (unknowns.includes(field)) continue;
    verified_facts.push({
      key: `derived.${field}`,
      value,
      source: CORPORATE_SNAPSHOT_V1,
    });
  }

  for (const fact of memorySnapshot?.facts ?? []) {
    const key = String(fact?.fact_key ?? "").trim();
    const value = String(fact?.fact_value ?? "").trim();
    if (!key || !value) continue;
    const importance = String(fact?.importance ?? "low").toLowerCase();
    const entry = {
      key,
      value,
      source: memorySnapshot?.memory_namespace ?? "entity_memory_facts",
      importance,
    };
    if (importance === "low") {
      partial_facts.push(entry);
    } else {
      verified_facts.push(entry);
    }
  }

  return {
    contract_version: CLAUDE_CORPORATE_FACT_PACK_V1,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_id: entityId,
    display_name: entityRecord?.display_name ?? null,
    authorization_verified: true,
    membership_role: role,
    verified_facts,
    partial_facts,
    unknowns,
    provenance: {
      snapshot_contract: snapshot?.contract_version ?? null,
      memory_namespace: memorySnapshot?.memory_namespace ?? "entity_memory_facts",
      memory_version:
        entityRecord?.memory_version ?? memorySnapshot?.memory_version ?? null,
      entity_id: entityId,
      fact_count: memorySnapshot?.fact_count ?? null,
    },
  };
}

/**
 * FACT + JUDGMENT CANDIDATE only — no customer speech, products, premiums, or risk scores.
 */
export function buildClaudeCorporateGapRecEvidence({ snapshot = null } = {}) {
  if (!snapshot?.identity?.entity_id) {
    return {
      gap_evidence: [],
      recommendation_candidates: [],
      unknowns: [],
      invented_coverage: false,
      invented_recommendation: false,
    };
  }

  const gapInput = buildCorporateGapInputFromSnapshot({ corporateSnapshot: snapshot });
  const gapAnalysis = analyzeCorporateCoverageGaps({ gapInput });
  const gapContext = {
    analysis: gapAnalysis,
    contract_version: gapAnalysis.contract_version,
    entity_id: gapAnalysis.entity_id,
    snapshot_version: gapAnalysis.snapshot_version,
  };
  const recommendationInput = buildCorporateRecommendationInputFromGap({ gapContext });
  const recAnalysis = generateCorporateRecommendations({ recommendationInput });

  const entityId = gapAnalysis.entity_id;
  const gap_evidence = (gapAnalysis.gaps ?? []).map((gap) => ({
    contract_version: CLAUDE_CORPORATE_GAP_EVIDENCE_V1,
    entity_id: entityId,
    item: gap.item,
    status: gap.status,
    known_gap: gap.known_gap === true,
    unknown_gap: gap.unknown_gap === true,
    sufficient: gap.sufficient === true,
    reason: gap.reason ?? null,
    snapshot_field: gap.snapshot_field ?? null,
    provenance: gap.provenance ?? null,
  }));

  const recommendation_candidates = [
    ...(recAnalysis.priority_items ?? []),
    ...(recAnalysis.maintain_items ?? []),
    ...(recAnalysis.deferred_items ?? []),
  ].map((row) => ({
    contract_version: CLAUDE_CORPORATE_REC_CANDIDATE_V1,
    entity_id: entityId,
    item: row.item,
    action: row.action,
    confidence: row.confidence ?? null,
    reason: row.reason ?? null,
    provenance: row.provenance ?? null,
    action_meaning:
      row.action === "address_gap"
        ? "known_gap_review_candidate_not_risk_rank"
        : row.action_meaning ?? null,
  }));

  const unknowns = [
    ...new Set([
      ...(Array.isArray(snapshot?.derived?.unknowns) ? snapshot.derived.unknowns : []),
      ...gap_evidence.filter((g) => g.unknown_gap).map((g) => g.item),
    ]),
  ];

  return {
    gap_evidence,
    recommendation_candidates,
    unknowns,
    invented_coverage: gapAnalysis.summary?.invented_coverage === false ? false : false,
    invented_recommendation: recAnalysis.invented_recommendation === false ? false : false,
    priority_meaning: "known_gap_review_candidates_not_severity_rank",
  };
}

async function loadOneCorporateBundle({
  userSupabase,
  customerId,
  authUserId,
  entityId,
  loadEntityContextRecordsImpl,
  loadCorporateMemorySnapshotImpl,
  buildCorporateSnapshotImpl,
}) {
  const loaded = await loadEntityContextRecordsImpl(userSupabase, {
    conversationContext: { entity_type: ENTITY_TYPES.CORPORATE, entity_id: entityId },
    customerId,
    authUserId,
  });
  if (!loaded?.entityRecord) return null;

  const corporate = assertCorporateEntity(loaded.entityRecord);
  if (!corporate.ok) return null;

  const access = assertEntityAccess({
    entity: corporate.entity,
    membership: loaded.membership,
    requireMembership: true,
  });
  if (!access.ok) return null;

  const entityForLoad = {
    id: access.entity.entity_id,
    entity_id: access.entity.entity_id,
    entity_type: access.entity.entity_type,
    entity_status: access.entity.entity_status,
    entity_scope: access.entity.entity_scope,
    display_name: access.entity.display_name,
    memory_version: access.entity.memory_version,
    metadata_json: access.entity.metadata_json ?? {},
  };

  const memorySnapshot = await loadCorporateMemorySnapshotImpl(
    userSupabase,
    access.entity.entity_id,
    { entityRecord: entityForLoad },
  );
  const snapshot = buildCorporateSnapshotImpl({
    entityRecord: entityForLoad,
    memorySnapshot,
  });

  createCorporateEntitySession({
    entityRecord: access.entity,
    membership: access.membership,
    routing_reason: SESSION_ROUTING_REASONS.EXPLICIT_CORPORATE,
    conversation_id: null,
    customer_id: customerId,
    resolver_version: ENTITY_RESOLVER_V1,
  });

  const factPack = buildClaudeCorporateFactPack({
    entityRecord: access.entity,
    membership: access.membership,
    snapshot,
    memorySnapshot,
  });
  const evidence = buildClaudeCorporateGapRecEvidence({ snapshot });

  return { factPack, evidence };
}

/**
 * Load all corporate contexts + gap/rec evidence the authenticated user may access.
 * Client entity_type/entity_id hints are ignored for widening access.
 * Never fails the personal turn — returns empty arrays on list/load issues.
 */
export async function loadAllowedCorporateContextsForClaude({
  userSupabase = null,
  customerId = null,
  authUserId = null,
  listMyCorporateEntitiesImpl = listMyCorporateEntities,
  loadEntityContextRecordsImpl = loadEntityContextRecords,
  loadCorporateMemorySnapshotImpl = loadCorporateMemorySnapshot,
  buildCorporateSnapshotImpl = buildCorporateSnapshot,
} = {}) {
  const empty = {
    ok: true,
    corporate_contexts: [],
    corporate_gap_evidence: [],
    corporate_recommendation_candidates: [],
    corporate_unknowns: [],
    invented_coverage: false,
    invented_recommendation: false,
    priority_meaning: "known_gap_review_candidates_not_severity_rank",
  };

  if (!userSupabase || !authUserId) {
    return { ...empty, skipped_reason: "auth_context_missing" };
  }

  const listed = await listMyCorporateEntitiesImpl(userSupabase, { authUserId });
  if (!listed?.ok) {
    return { ...empty, skipped_reason: listed?.reason ?? "list_failed" };
  }

  const rows = Array.isArray(listed.entities) ? listed.entities : [];
  const corporate_contexts = [];
  const corporate_gap_evidence = [];
  const corporate_recommendation_candidates = [];
  const corporate_unknowns = [];

  for (const row of rows) {
    const entityId = String(row?.entity_id ?? "").trim();
    if (!entityId) continue;
    try {
      const bundle = await loadOneCorporateBundle({
        userSupabase,
        customerId,
        authUserId,
        entityId,
        loadEntityContextRecordsImpl,
        loadCorporateMemorySnapshotImpl,
        buildCorporateSnapshotImpl,
      });
      if (!bundle?.factPack?.authorization_verified || !bundle.factPack.entity_id) continue;
      corporate_contexts.push(bundle.factPack);
      corporate_gap_evidence.push(...(bundle.evidence?.gap_evidence ?? []));
      corporate_recommendation_candidates.push(
        ...(bundle.evidence?.recommendation_candidates ?? []),
      );
      for (const u of bundle.evidence?.unknowns ?? []) {
        corporate_unknowns.push({ entity_id: bundle.factPack.entity_id, unknown: u });
      }
    } catch {
      // Skip this entity; do not fail the whole KEY turn.
    }
  }

  return {
    ok: true,
    corporate_contexts,
    corporate_gap_evidence,
    corporate_recommendation_candidates,
    corporate_unknowns,
    invented_coverage: false,
    invented_recommendation: false,
    priority_meaning: "known_gap_review_candidates_not_severity_rank",
    skipped_reason: null,
  };
}
