/**
 * CONN-003-B — KEY Hand priority consolidator (Gap vs Underwriting on P5-C).
 * Reads Context Loader signals only — not raw factory payload.
 */
export const KEY_PANEL_PRIORITY_JUDGE_SCHEMA_VERSION = "key-panel-priority-judge-v1-gap-uw";

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function computeGapSpeakScore(coverageGapContext = {}) {
  const concerns = (coverageGapContext?.top_concerns ?? []).filter(Boolean);
  if (concerns.length === 0) return 0;
  return clampScore(coverageGapContext?.gap_score ?? 0);
}

export function computeUwSpeakScore(underwritingContext = {}) {
  if (underwritingContext?.loaded !== true && !(underwritingContext?.record_count > 0)) {
    return 0;
  }
  return clampScore(underwritingContext?.risk_score ?? 0);
}

export function contextsFromFactBundle(factBundle = {}) {
  return {
    coverageGapContext: {
      gap_score: factBundle.coverage_gap_score ?? null,
      top_concerns: factBundle.coverage_gap_top_concerns ?? [],
    },
    underwritingContext: {
      loaded: factBundle.underwriting_loaded === true || factBundle.underwriting_used === true,
      record_count:
        factBundle.underwriting_record_count ??
        (factBundle.underwriting_used || factBundle.has_stored_underwriting_analysis ? 1 : 0),
      risk_score: factBundle.underwriting_risk_score ?? 0,
      review_flags: factBundle.underwriting_review_flags ?? [],
      overall_underwriting_risk: factBundle.underwriting_overall_risk ?? null,
    },
  };
}

export function resolveKeyPanelPriority({
  coverageGapContext = null,
  underwritingContext = null,
  factBundle = {},
} = {}) {
  const gapCtx =
    coverageGapContext ??
    {
      gap_score: factBundle.coverage_gap_score ?? null,
      top_concerns: factBundle.coverage_gap_top_concerns ?? [],
    };
  const uwCtx =
    underwritingContext ??
    {
      loaded: factBundle.underwriting_loaded === true || factBundle.underwriting_used === true,
      record_count:
        factBundle.underwriting_record_count ??
        (factBundle.underwriting_used || factBundle.has_stored_underwriting_analysis ? 1 : 0),
      risk_score: factBundle.underwriting_risk_score ?? 0,
      review_flags: factBundle.underwriting_review_flags ?? [],
      overall_underwriting_risk: factBundle.underwriting_overall_risk ?? null,
    };

  const gapEligible =
    factBundle.coverage_gap_used === true || factBundle.has_stored_coverage_analysis === true;
  const uwEligible =
    factBundle.underwriting_used === true || factBundle.has_stored_underwriting_analysis === true;

  const gapScore = gapEligible ? computeGapSpeakScore(gapCtx) : 0;
  const uwScore = uwEligible ? computeUwSpeakScore(uwCtx) : 0;
  const hasMaterialGap = gapEligible && (gapCtx.top_concerns?.length ?? 0) > 0;

  let primary_panel = null;
  if (gapScore === 0 && uwScore === 0) {
    primary_panel = hasMaterialGap ? "coverage_gap" : null;
  } else if (uwScore > gapScore) {
    primary_panel = "underwriting";
  } else if (gapScore > uwScore) {
    primary_panel = "coverage_gap";
  } else {
    primary_panel = "underwriting";
  }

  return {
    schema_version: KEY_PANEL_PRIORITY_JUDGE_SCHEMA_VERSION,
    primary_panel,
    panel_scores: {
      coverage_gap: gapScore,
      underwriting: uwScore,
    },
  };
}
