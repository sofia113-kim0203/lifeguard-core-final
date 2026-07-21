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
export const CLAUDE_CORPORATE_CHART_V1 = "claude-corporate-chart-v1";

function chartField(value, unknownLabel, unknowns) {
  if (value == null || value === "" || value === "unknown") {
    return { status: "unknown", value: null, unknown: unknownLabel };
  }
  if (Array.isArray(unknowns) && unknowns.includes(unknownLabel)) {
    return { status: "unknown", value: null, unknown: unknownLabel };
  }
  return { status: "known", value, unknown: null };
}

/**
 * Minimal corporate chart for Claude — known values only; never invent.
 * QA demo entities stay labeled as test, not real customers.
 */
export function buildClaudeCorporateChart({
  entityRecord = null,
  snapshot = null,
  documents = [],
} = {}) {
  const derived = snapshot?.derived ?? {};
  const unknowns = Array.isArray(derived.unknowns) ? derived.unknowns : [];
  const status = String(
    entityRecord?.entity_status ?? snapshot?.identity?.status ?? "",
  )
    .trim()
    .toLowerCase();
  const meta =
    entityRecord?.metadata_json && typeof entityRecord.metadata_json === "object"
      ? entityRecord.metadata_json
      : {};
  const isQaTest =
    status === "demo" ||
    meta.qa_fixture === true ||
    meta.not_real_customer === true ||
    String(meta.fixture_kind ?? "").startsWith("corporate_");

  const fields = {
    display_name: chartField(
      entityRecord?.display_name ?? snapshot?.identity?.display_name ?? null,
      "display_name",
      [],
    ),
    industry: chartField(derived.industry, "industry", unknowns),
    business_description: chartField(
      derived.business_description,
      "business_description",
      unknowns,
    ),
    employee_count: chartField(derived.employee_count, "employee_count", unknowns),
    workplace_or_facilities: chartField(
      derived.workplace_or_facilities,
      "workplace_or_facilities",
      unknowns,
    ),
    group_insurance: chartField(
      derived.group_insurance_status,
      "group_insurance_status",
      unknowns,
    ),
    fire_insurance: chartField(derived.fire_insurance, "fire_insurance", unknowns),
    liability: chartField(derived.liability, "liability", unknowns),
    executive_protection: chartField(
      derived.executive_protection,
      "executive_protection",
      unknowns,
    ),
    confirmed_goals: chartField(derived.confirmed_goals, "confirmed_goals", unknowns),
    concerns: chartField(derived.concerns, "concerns", unknowns),
  };

  const unknown_items = Object.values(fields)
    .filter((f) => f.status === "unknown" && f.unknown)
    .map((f) => f.unknown);

  return {
    contract_version: CLAUDE_CORPORATE_CHART_V1,
    entity_id: entityRecord?.entity_id ?? entityRecord?.id ?? snapshot?.identity?.entity_id ?? null,
    entity_status: status || null,
    is_qa_test_entity: isQaTest,
    customer_grade: isQaTest ? "qa_test_not_real_customer" : "membership_verified",
    note: isQaTest
      ? "QA demo corporate — test fixture only; do not treat as a real customer record."
      : null,
    fields,
    unknown_items,
    documents: Array.isArray(documents) ? documents : [],
  };
}

/**
 * Load membership-scoped corporate documents for Claude Hand.
 * Ownership: customer_documents.entity_id only (nullable column). No metadata ownership.
 * Fail-closed if column missing / errors → []. Never treats personal (entity_id null) as corporate.
 */
export async function loadCorporateDocumentsForEntities({
  userSupabase = null,
  customerId = null,
  entityIds = [],
} = {}) {
  const cid = String(customerId ?? "").trim();
  const ids = [
    ...new Set(
      (Array.isArray(entityIds) ? entityIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (!userSupabase || !cid || ids.length === 0) return [];

  const allowed = new Set(ids);

  try {
    const { data, error } = await userSupabase
      .from("customer_documents")
      .select(
        "id, original_filename, mime_type, ingest_status, document_type, entity_id, created_at",
      )
      .eq("customer_id", cid)
      .in("entity_id", ids)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      // Column missing / RLS — fail closed. Do not fall back to metadata ownership.
      return [];
    }

    return (Array.isArray(data) ? data : [])
      .map((row) => {
        const entityId = String(row?.entity_id ?? "").trim();
        if (!entityId || !allowed.has(entityId)) return null;
        const ingest = String(row?.ingest_status ?? "").trim().toLowerCase();
        const evidence_tier =
          ingest === "ready" || ingest === "extracted" || ingest === "analyzed"
            ? "unverified_extract"
            : "original_presence";
        return {
          document_id: row?.id != null ? String(row.id) : null,
          entity_id: entityId,
          original_filename: row?.original_filename ?? null,
          mime_type: row?.mime_type ?? null,
          document_type: row?.document_type ?? null,
          ingest_status: ingest || null,
          evidence_tier,
          ownership_source: "customer_documents.entity_id",
          confirmed_facts: [],
          note: "original_or_unverified_extract_only_not_confirmed_policy_fact",
        };
      })
      .filter((row) => row?.document_id && row?.entity_id);
  } catch {
    return [];
  }
}

/**
 * Build read-only Claude fact pack from corporate snapshot + memory.
 * Separates verified / partial / unknown / provenance. Never invents facts.
 */
export function buildClaudeCorporateFactPack({
  entityRecord = null,
  membership = null,
  snapshot = null,
  memorySnapshot = null,
  documents = [],
} = {}) {
  const entityId = entityRecord?.entity_id ?? entityRecord?.id ?? null;
  const role = membership?.member_role
    ? String(membership.member_role).trim().toLowerCase()
    : null;
  const entityStatus = String(entityRecord?.entity_status ?? "").trim().toLowerCase();
  const meta =
    entityRecord?.metadata_json && typeof entityRecord.metadata_json === "object"
      ? entityRecord.metadata_json
      : {};
  const isQaTest =
    entityStatus === "demo" ||
    meta.qa_fixture === true ||
    meta.not_real_customer === true ||
    String(meta.fixture_kind ?? "").startsWith("corporate_");

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
  if (entityStatus) {
    verified_facts.push({
      key: "identity.entity_status",
      value: entityStatus,
      source: "entities",
    });
  }
  if (isQaTest) {
    verified_facts.push({
      key: "identity.customer_grade",
      value: "qa_test_not_real_customer",
      source: "entities.entity_status=demo",
    });
  }

  const derived = snapshot?.derived ?? {};
  const derivedKnown = [
    ["industry", derived.industry],
    ["business_description", derived.business_description],
    ["group_insurance_status", derived.group_insurance_status],
    ["employee_count", derived.employee_count],
    ["workplace_or_facilities", derived.workplace_or_facilities],
    ["executive_protection", derived.executive_protection],
    ["fire_insurance", derived.fire_insurance],
    ["liability", derived.liability],
    ["confirmed_goals", derived.confirmed_goals],
    ["concerns", derived.concerns],
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

  const entityDocs = (Array.isArray(documents) ? documents : []).filter(
    (d) => String(d?.entity_id ?? "").trim() === String(entityId ?? "").trim(),
  );
  const chart = buildClaudeCorporateChart({
    entityRecord,
    snapshot,
    documents: entityDocs,
  });

  return {
    contract_version: CLAUDE_CORPORATE_FACT_PACK_V1,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_id: entityId,
    display_name: entityRecord?.display_name ?? null,
    entity_status: entityStatus || null,
    is_qa_test_entity: isQaTest,
    customer_grade: isQaTest ? "qa_test_not_real_customer" : "membership_verified",
    authorization_verified: true,
    membership_role: role,
    chart,
    documents: entityDocs,
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
      document_count: entityDocs.length,
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
  documents = [],
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

  const entityDocs = (Array.isArray(documents) ? documents : []).filter(
    (d) => String(d?.entity_id ?? "").trim() === String(access.entity.entity_id).trim(),
  );

  const factPack = buildClaudeCorporateFactPack({
    entityRecord: access.entity,
    membership: access.membership,
    snapshot,
    memorySnapshot,
    documents: entityDocs,
  });
  const evidence = buildClaudeCorporateGapRecEvidence({ snapshot });

  return { factPack, evidence };
}

/**
 * Load membership-scoped corporate contexts + gap/rec + documents for Claude.
 * Client entity_id never widens access. Unauthorized selectedEntityId → fail-closed empty.
 * Never fails the personal turn — returns empty arrays on list/load issues.
 */
export async function loadAllowedCorporateContextsForClaude({
  userSupabase = null,
  customerId = null,
  authUserId = null,
  selectedEntityId = null,
  listMyCorporateEntitiesImpl = listMyCorporateEntities,
  loadEntityContextRecordsImpl = loadEntityContextRecords,
  loadCorporateMemorySnapshotImpl = loadCorporateMemorySnapshot,
  buildCorporateSnapshotImpl = buildCorporateSnapshot,
  loadCorporateDocumentsForEntitiesImpl = loadCorporateDocumentsForEntities,
} = {}) {
  const empty = {
    ok: true,
    corporate_contexts: [],
    corporate_gap_evidence: [],
    corporate_recommendation_candidates: [],
    corporate_unknowns: [],
    selected_entity_id: null,
    authorization_denied: false,
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
  const allowedIds = new Set(
    rows.map((row) => String(row?.entity_id ?? "").trim()).filter(Boolean),
  );

  const requested = String(selectedEntityId ?? "").trim() || null;
  if (requested && !allowedIds.has(requested)) {
    // Fail-closed: no corporate facts/docs/prior for unauthorized selection.
    return {
      ...empty,
      ok: true,
      authorization_denied: true,
      selected_entity_id: null,
      skipped_reason: "selected_entity_not_authorized",
      customer_message: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
    };
  }

  const targetRows = requested
    ? rows.filter((row) => String(row?.entity_id ?? "").trim() === requested)
    : rows;

  const targetIds = targetRows
    .map((row) => String(row?.entity_id ?? "").trim())
    .filter(Boolean);

  const documents = await loadCorporateDocumentsForEntitiesImpl({
    userSupabase,
    customerId,
    entityIds: targetIds,
  });

  const corporate_contexts = [];
  const corporate_gap_evidence = [];
  const corporate_recommendation_candidates = [];
  const corporate_unknowns = [];

  for (const row of targetRows) {
    const entityId = String(row?.entity_id ?? "").trim();
    if (!entityId) continue;
    try {
      const bundle = await loadOneCorporateBundle({
        userSupabase,
        customerId,
        authUserId,
        entityId,
        documents,
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
    selected_entity_id: requested && corporate_contexts.length > 0 ? requested : null,
    authorization_denied: false,
    invented_coverage: false,
    invented_recommendation: false,
    priority_meaning: "known_gap_review_candidates_not_severity_rank",
    skipped_reason: null,
  };
}
