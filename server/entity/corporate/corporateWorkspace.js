/**
 * Corporate Workspace Factory — Recommendation-only display (CORP-F1).
 * Reads corp-recommendation-v1 analysis only — never Gap, Snapshot, Memory, or re-judgment.
 * KEY not here.
 */
import {
  CORPORATE_RECOMMENDATION_V1,
  loadCorporateRecommendationContext,
} from "./corporateRecommendation.js";

export const CORPORATE_WORKSPACE_V1 = "corp-workspace-v1";
export const WORKSPACE_DISPLAY_V1 = "workspace-v1";

const ITEM_TO_ZONE = {
  group_insurance: "group",
  liability: "tax",
  fire_insurance: "contracts",
  executive_protection: "executive",
  employee_benefit: "employees",
};

const ACTION_TO_DISPLAY_STATUS = {
  maintain: "maintain",
  address_gap: "priority",
  defer: "deferred",
};

function assertRecommendationContext(recommendationContext) {
  if (!recommendationContext?.analysis) throw new Error("recommendation_context_required");
  if (recommendationContext.analysis.contract_version !== CORPORATE_RECOMMENDATION_V1) {
    throw new Error("recommendation_context_version_mismatch");
  }
  if (!recommendationContext.analysis.entity_id) {
    throw new Error("recommendation_context_entity_id_required");
  }
}

function recommendationItems(analysis) {
  return [
    ...(analysis.priority_items ?? []),
    ...(analysis.maintain_items ?? []),
    ...(analysis.deferred_items ?? []),
  ];
}

function itemToZone(item) {
  const zoneKey = ITEM_TO_ZONE[item.item] ?? item.item;
  return {
    zone: zoneKey,
    item: item.item,
    label: item.label,
    status: ACTION_TO_DISPLAY_STATUS[item.action] ?? item.action,
    action: item.action,
    reason: item.reason,
    provenance: item.provenance,
    confidence: item.confidence,
  };
}

/**
 * Pure builder — CorporateRecommendationContext v1 → Workspace view (display only).
 * Principle 12: Workspace expresses Recommendation — does not re-judge or modify items.
 */
export function buildCorporateWorkspaceViewFromRecommendation({
  recommendationContext,
  generatedAt = new Date().toISOString(),
} = {}) {
  assertRecommendationContext(recommendationContext);

  const { analysis } = recommendationContext;
  const priorityItems = [...(analysis.priority_items ?? [])];
  const maintainItems = [...(analysis.maintain_items ?? [])];
  const deferredItems = [...(analysis.deferred_items ?? [])];
  const zones = recommendationItems(analysis).map(itemToZone);

  return {
    contract_version: CORPORATE_WORKSPACE_V1,
    generated_from: CORPORATE_RECOMMENDATION_V1,
    display_version: WORKSPACE_DISPLAY_V1,
    entity_id: analysis.entity_id,
    entity_type: analysis.entity_type ?? "corporate",
    recommendation_generated_at: analysis.generated_at ?? null,
    workspace_generated_at: generatedAt,
    zones,
    priority_items: priorityItems,
    maintain_items: maintainItems,
    deferred_items: deferredItems,
    summary: {
      zone_count: zones.length,
      priority_count: priorityItems.length,
      maintain_count: maintainItems.length,
      deferred_count: deferredItems.length,
      invented_display: false,
    },
    invented_display: false,
  };
}

/** Loader orchestrator — Recommendation loader only at Workspace boundary. */
export async function loadCorporateWorkspaceContext(supabase, entityId, options = {}) {
  if (!entityId) throw new Error("entity_id_required");

  const recommendationContext =
    options.recommendationContext ??
    (await loadCorporateRecommendationContext(supabase, entityId, options));

  const view = buildCorporateWorkspaceViewFromRecommendation({ recommendationContext });

  return {
    contract_version: CORPORATE_WORKSPACE_V1,
    entity_id: recommendationContext.entity_id ?? recommendationContext.analysis?.entity_id,
    generated_from: CORPORATE_RECOMMENDATION_V1,
    display_version: WORKSPACE_DISPLAY_V1,
    recommendation_generated_at: recommendationContext.analysis?.generated_at ?? null,
    recommendation_context: recommendationContext,
    view,
    available: true,
    source: "compute-on-read",
  };
}
