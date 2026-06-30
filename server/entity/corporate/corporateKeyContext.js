/**
 * Corporate KEY compose context — Recommendation Contract primary (CORP-H1).
 * Principle 15: KEY trusts Contract — not Presentation.
 * Panel · Memory · Snapshot not here.
 */
import {
  CORPORATE_RECOMMENDATION_V1,
  loadCorporateRecommendationContext,
} from "./corporateRecommendation.js";
import {
  CORPORATE_WORKSPACE_V1,
  loadCorporateWorkspaceContext,
} from "./corporateWorkspace.js";

export const CORPORATE_KEY_COMPOSE_V1 = "corp-key-compose-v1";

const RECOMMENDATION_ITEM_BUCKETS = ["priority_items", "maintain_items", "deferred_items"];

function assertRecommendationContext(recommendationContext) {
  if (!recommendationContext?.analysis) throw new Error("recommendation_context_required");
  if (recommendationContext.analysis.contract_version !== CORPORATE_RECOMMENDATION_V1) {
    throw new Error("recommendation_context_version_mismatch");
  }
  if (!recommendationContext.analysis.entity_id) throw new Error("recommendation_context_entity_id_required");
}

/**
 * Workspace display metadata only — no zone status · no statusLabel · no Panel translation.
 */
export function extractWorkspaceDisplayMetadata(workspaceContext) {
  const view = workspaceContext?.view ?? workspaceContext;
  if (!view || view.contract_version !== CORPORATE_WORKSPACE_V1) return null;

  return {
    contract_version: view.contract_version,
    display_version: view.display_version,
    generated_from: view.generated_from,
    zone_count: view.summary?.zone_count ?? view.zones?.length ?? 0,
    priority_count: view.summary?.priority_count ?? 0,
    maintain_count: view.summary?.maintain_count ?? 0,
    deferred_count: view.summary?.deferred_count ?? 0,
    invented_display: view.invented_display === false,
    role: "presentation_metadata_only",
  };
}

/**
 * Gap explanation metadata from Recommendation lineage — no Gap re-run.
 */
export function extractGapExplanationMetadata(recommendationContext) {
  const input = recommendationContext?.recommendation_input;
  if (!input?.gaps) return null;

  return {
    contract_version: input.gap_version ?? recommendationContext.gap_version ?? null,
    gap_count: input.gaps.length,
    source: "recommendation_lineage_only",
    role: "optional_explanation_only",
  };
}

function recommendationItemsToComposeItems(analysis) {
  const items = [];

  for (const bucket of RECOMMENDATION_ITEM_BUCKETS) {
    for (const row of analysis[bucket] ?? []) {
      items.push({
        item: row.item,
        label: row.label,
        action: row.action,
        reason: row.reason,
        provenance: row.provenance,
        confidence: row.confidence,
        bucket,
        source: CORPORATE_RECOMMENDATION_V1,
      });
    }
  }

  return items;
}

/**
 * Pure builder — corp-recommendation-v1 primary · workspace metadata secondary · gap explanation optional.
 */
export function buildCorporateKeyComposeFromRecommendation({
  recommendationContext,
  workspaceDisplayMetadata = null,
  gapExplanationMetadata = null,
} = {}) {
  assertRecommendationContext(recommendationContext);

  const analysis = recommendationContext.analysis;

  return {
    contract_version: CORPORATE_KEY_COMPOSE_V1,
    entity_id: analysis.entity_id,
    entity_type: analysis.entity_type ?? "corporate",
    primary_contract: CORPORATE_RECOMMENDATION_V1,
    recommendation: {
      contract_version: analysis.contract_version,
      priority_items: analysis.priority_items ?? [],
      maintain_items: analysis.maintain_items ?? [],
      deferred_items: analysis.deferred_items ?? [],
      summary: analysis.summary ?? {},
      invented_recommendation: analysis.invented_recommendation === false,
    },
    workspace_display_metadata: workspaceDisplayMetadata,
    gap_explanation_metadata: gapExplanationMetadata,
    compose_items: recommendationItemsToComposeItems(analysis),
    principle_15: {
      trusts_contract_not_presentation: true,
      primary_source: CORPORATE_RECOMMENDATION_V1,
      panel_labels_not_used: true,
    },
    available: true,
    source: "recommendation-contract-primary",
  };
}

/** Loader — Recommendation loader at KEY boundary · Workspace metadata optional · no Memory · Snapshot · Gap re-run. */
export async function loadCorporateKeyContext(supabase, entityId, options = {}) {
  if (!entityId) throw new Error("entity_id_required");

  const recommendationContext =
    options.recommendationContext ??
    (await loadCorporateRecommendationContext(supabase, entityId, options));

  let workspaceDisplayMetadata = null;
  if (options.includeWorkspaceMetadata !== false) {
    try {
      const workspaceContext =
        options.workspaceContext ??
        (await loadCorporateWorkspaceContext(supabase, entityId, {
          ...options,
          recommendationContext,
        }));
      workspaceDisplayMetadata = extractWorkspaceDisplayMetadata(workspaceContext);
    } catch {
      workspaceDisplayMetadata = null;
    }
  }

  const gapExplanationMetadata =
    options.gapExplanationMetadata ??
    extractGapExplanationMetadata(recommendationContext);

  const compose = buildCorporateKeyComposeFromRecommendation({
    recommendationContext,
    workspaceDisplayMetadata,
    gapExplanationMetadata,
  });

  return {
    ...compose,
    recommendation_context: recommendationContext,
  };
}
