/**
 * Corporate Recommendation Factory — Gap-only proposals (CORP-E1).
 * Reads corp-gap-v1 analysis only — never Snapshot, Memory, or Gap re-calculation.
 * Workspace · KEY not here.
 */
import { CORPORATE_GAP_V1, loadCorporateGapContext } from "./corporateGap.js";

export const CORPORATE_RECOMMENDATION_V1 = "corp-recommendation-v1";

const CORPORATE_ITEM_LABELS = {
  group_insurance: "단체보험",
  liability: "배상책임",
  fire_insurance: "화재보험",
  executive_protection: "임원보장",
  employee_benefit: "임직원복리",
};

function assertGapContext(gapContext) {
  if (!gapContext?.analysis) throw new Error("gap_context_required");
  if (gapContext.analysis.contract_version !== CORPORATE_GAP_V1) {
    throw new Error("gap_context_version_mismatch");
  }
  if (!gapContext.analysis.entity_id) throw new Error("gap_context_entity_id_required");
  if (!Array.isArray(gapContext.analysis.gaps)) throw new Error("gap_context_gaps_required");
}

function itemLabel(item) {
  return CORPORATE_ITEM_LABELS[item] ?? item;
}

function gapConfidence(gap) {
  if (gap.unknown_gap === true) return "unknown";
  if (gap.sufficient === true) return "high";
  if (gap.known_gap === true && gap.sufficient === false) return "high";
  return "low";
}

function gapToRecommendationItem(gap, action) {
  return {
    item: gap.item,
    label: itemLabel(gap.item),
    action,
    reason: gap.reason ?? "gap_reason_missing",
    provenance: gap.provenance ?? "unknown",
    confidence: gapConfidence(gap),
    // priority_items / address_gap are review candidates — not severity/urgency ranks.
    ...(action === "address_gap"
      ? { action_meaning: "known_gap_review_candidate_not_risk_rank" }
      : {}),
  };
}

/**
 * Pure builder — CorporateGapContext v1 → Recommendation engine input (Gap analysis only).
 */
export function buildCorporateRecommendationInputFromGap({ gapContext } = {}) {
  assertGapContext(gapContext);

  const { analysis } = gapContext;

  return {
    contract_version: CORPORATE_RECOMMENDATION_V1,
    gap_version: analysis.contract_version,
    entity_id: analysis.entity_id,
    entity_type: analysis.entity_type ?? "corporate",
    gap_generated_at: analysis.generated_at ?? null,
    gaps: analysis.gaps.map((gap) => ({
      item: gap.item,
      status: gap.status,
      known_gap: gap.known_gap === true,
      unknown_gap: gap.unknown_gap === true,
      sufficient: gap.sufficient === true,
      reason: gap.reason,
      provenance: gap.provenance,
    })),
  };
}

/**
 * Pure engine — corporate recommendations from Gap judgment only.
 * Proposes on proven gaps — defers unknowns honestly (Principle 10).
 */
export function generateCorporateRecommendations({
  recommendationInput,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!recommendationInput?.entity_id) throw new Error("recommendation_input_required");
  if (recommendationInput.contract_version !== CORPORATE_RECOMMENDATION_V1) {
    throw new Error("recommendation_input_version_mismatch");
  }

  const priorityItems = [];
  const maintainItems = [];
  const deferredItems = [];

  for (const gap of recommendationInput.gaps ?? []) {
    if (gap.unknown_gap === true) {
      deferredItems.push(gapToRecommendationItem(gap, "defer"));
      continue;
    }

    if (gap.sufficient === true) {
      maintainItems.push(gapToRecommendationItem(gap, "maintain"));
      continue;
    }

    if (gap.known_gap === true && gap.sufficient === false) {
      priorityItems.push(gapToRecommendationItem(gap, "address_gap"));
    }
  }

  return {
    contract_version: CORPORATE_RECOMMENDATION_V1,
    gap_version: recommendationInput.gap_version ?? CORPORATE_GAP_V1,
    entity_id: recommendationInput.entity_id,
    entity_type: recommendationInput.entity_type ?? "corporate",
    generated_at: generatedAt,
    priority_items: priorityItems,
    maintain_items: maintainItems,
    deferred_items: deferredItems,
    // Compat field name: not a severity/urgency ranking.
    priority_meaning: "known_gap_review_candidates_not_severity_rank",
    summary: {
      priority_count: priorityItems.length,
      maintain_count: maintainItems.length,
      deferred_count: deferredItems.length,
      invented_recommendation: false,
      priority_meaning: "known_gap_review_candidates_not_severity_rank",
    },
    invented_recommendation: false,
  };
}

/** Loader orchestrator — Gap loader only at Recommendation boundary. */
export async function loadCorporateRecommendationContext(supabase, entityId, options = {}) {
  if (!entityId) throw new Error("entity_id_required");

  const gapContext =
    options.gapContext ?? (await loadCorporateGapContext(supabase, entityId, options));

  const recommendationInput = buildCorporateRecommendationInputFromGap({ gapContext });
  const analysis = generateCorporateRecommendations({ recommendationInput });

  return {
    contract_version: CORPORATE_RECOMMENDATION_V1,
    entity_id: gapContext.entity_id ?? gapContext.analysis?.entity_id,
    gap_version: gapContext.contract_version ?? CORPORATE_GAP_V1,
    gap_generated_at: gapContext.analysis?.generated_at ?? null,
    snapshot_version: gapContext.snapshot_version ?? null,
    recommendation_input: recommendationInput,
    analysis,
    available: true,
    source: "compute-on-read",
  };
}
