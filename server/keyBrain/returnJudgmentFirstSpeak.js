/**
 * P5-C — RETURN_JUDGMENT sentence (reuse compose · no Bridge replay · no inventory).
 * CONN-002 — stored coverage_gap top_concerns[0] → 1-line when panel wins priority.
 * CONN-003-B — Gap vs Underwriting score compare via resolveKeyPanelPriority.
 * CONN-004 — Design Next Action weave after Primary Speak (not priority judge).
 * CONN-005 — Continuity Weave before Primary on RETURN_JUDGMENT maintenance branch.
 */
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";
import { extractFactBundleEvidence } from "../salesDirectorFormatter.js";
import {
  buildHumanUnderstandingFrame,
  buildKeyStructuredResponse,
} from "../humanUnderstandingLoop.js";
import { buildCoverageGapContextFromPayload } from "../salesDirectorCoverageGapContext.js";
import { resolveKeyPanelPriority } from "./keyPanelPriorityJudge.js";
import { appendReturnJudgmentContinuityWeave } from "./returnJudgmentContinuityWeave.js";

export const RETURN_JUDGMENT_SPEAK_SCHEMA_VERSION = "return-judgment-speak-p5c-v1";
export const CONN_002_SPEAK_SCHEMA_VERSION = "conn-002-coverage-gap-p5c-v1";
export const CONN_003_SPEAK_SCHEMA_VERSION = "conn-003-gap-uw-priority-p5c-v1";
export const CONN_004_SPEAK_SCHEMA_VERSION = "conn-004-design-weave-p5c-v1";
export { CONN_005_SPEAK_SCHEMA_VERSION } from "./returnJudgmentContinuityWeave.js";

export const RETURN_JUDGMENT_FORBIDDEN_PATTERNS = [
  /지난번\s*같이\s*보던\s*기준/i,
  /올려\s*주신\s*자료를\s*받았/i,
  /자료를\s*다\s*살펴봤/i,
  /찾아왔어요/i,
  /memory/i,
  /memory_fact/i,
  /저장(?:해|된)/i,
  /기억(?:하고|나요|해\s*드)/i,
  /보험\s*\d+\s*건/i,
  /분석\s*결과\s*요약/i,
  /파일명/i,
  /시스템\s*알림/i,
  /업로드\s*(?:가\s*)?완료/i,
  /분석\s*중/i,
  /가입\s*하세요/i,
  /반드시\s*추가/i,
  /가입\s*가능합니다/i,
  /가입\s*불가능합니다/i,
];

/** CONN-004 — weave must not restate primary judgment (Tom: action only). */
export const RETURN_JUDGMENT_WEAVE_JUDGMENT_FORBIDDEN = [
  /가장\s*중요/i,
  /부족(?:합니다|해|함|한)/i,
  /가입\s*조건/i,
  /인수심사\s*확인/i,
  /먼저\s*같이\s*짚/i,
  /단정(?:하기|할)/i,
  /필요해\s*보입니다/i,
];

export const RETURN_JUDGMENT_WEAVE_ACTION_REQUIRED =
  /(?:설계|검토|살펴).{0,16}(?:보겠습니다|해보겠습니다)/i;

const RETURN_JUDGMENT_FALLBACK = "지금 걸리는 부분부터 같이 보면 됩니다.";
const RETURN_JUDGMENT_GAP_GENERIC = "지난 분석 이후 바뀐 부분이 있는지부터 확인해볼까요.";

export function jobHasStoredCoverageGap(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  const payload = result?.coverage_gap ?? null;
  const ctx = buildCoverageGapContextFromPayload(payload, { jobId: analysisJob.id ?? null });
  return ctx.loaded === true && (ctx.top_concerns?.length ?? 0) > 0;
}

export function buildReturnJudgmentCoverageGapDraft(factBundle = {}) {
  const concerns = (factBundle.coverage_gap_top_concerns ?? []).filter(Boolean);
  const first = String(concerns[0] ?? "").trim();
  if (!first) return null;
  const axis = first.includes("보장") ? first : `${first} 보장`;
  return `${axis} 쪽부터 먼저 같이 짚어보면 좋겠습니다.`;
}

export function buildReturnJudgmentUnderwritingDraft(factBundle = {}) {
  const reviewFlags = (factBundle.underwriting_review_flags ?? []).filter(Boolean);
  const overallRisk = String(factBundle.underwriting_overall_risk ?? "").toLowerCase();

  if (
    reviewFlags.length >= 2 ||
    overallRisk === "high" ||
    overallRisk === "critical"
  ) {
    return "지금은 가입 조건부터 같이 확인하는 게 먼저입니다. 건강 관련 정보 기준으로 심사 경로를 먼저 보는 편이 좋겠습니다.";
  }
  if (reviewFlags.length === 1) {
    return `${reviewFlags[0]} 관련 인수심사 확인이 먼저 필요해 보입니다.`;
  }
  if (Number(factBundle.underwriting_risk_score) > 0) {
    return "가입 가능 여부는 단정하기 어렵고, 저장된 분석 기준으로 인수심사 확인이 먼저 필요합니다.";
  }
  return null;
}

export function isReturnJudgmentDesignWeaveEligible(factBundle = {}) {
  const designUsed =
    factBundle.design_used === true || factBundle.has_stored_design_analysis === true;
  if (!designUsed) return false;
  const actions = (factBundle.design_next_actions ?? []).filter(Boolean);
  const coverages = (factBundle.design_priority_coverages ?? []).filter(Boolean);
  return actions.length > 0 || coverages.length > 0;
}

function resolveDesignWeaveLabel(factBundle = {}) {
  const coverages = (factBundle.design_priority_coverages ?? []).filter(Boolean);
  if (coverages[0]) return String(coverages[0]).trim();
  const action = String((factBundle.design_next_actions ?? [])[0] ?? "").trim();
  if (!action) return null;
  const coverageReview = action.match(/^(.+?)\s*보장\s*검토$/);
  if (coverageReview) return coverageReview[1].trim();
  if (action.endsWith(" 검토")) return action.replace(/\s*검토$/, "").trim();
  return action;
}

export function buildReturnJudgmentDesignWeave({ factBundle = {}, primaryPanel = null } = {}) {
  if (!isReturnJudgmentDesignWeaveEligible(factBundle)) return null;
  const label = resolveDesignWeaveLabel(factBundle);

  if (primaryPanel === "coverage_gap") {
    if (!label) return null;
    return `그러니 ${label}부터 같이 설계해보겠습니다.`;
  }
  if (primaryPanel === "underwriting") {
    return "그 기준에 맞춰 설계안을 같이 검토해보겠습니다.";
  }
  if (label) {
    return `${label}부터 설계안을 같이 살펴보겠습니다.`;
  }
  return null;
}

export function weaveRepeatsPrimaryJudgment(primaryText = "", weaveText = "") {
  const primary = String(primaryText ?? "");
  const weave = String(weaveText ?? "");
  const sharedJudgmentPhrases = [
    "부족",
    "짚어",
    "가입 조건",
    "인수심사",
    "먼저입니다",
    "확인하는 게",
    "필요해 보",
  ];
  for (const phrase of sharedJudgmentPhrases) {
    if (primary.includes(phrase) && weave.includes(phrase)) return true;
  }
  if (/보장/.test(primary) && /부족|가장|중요/.test(weave)) return true;
  return false;
}

export function scanReturnJudgmentWeaveSentence(weaveText = "") {
  const trimmed = String(weaveText ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (!RETURN_JUDGMENT_WEAVE_ACTION_REQUIRED.test(trimmed)) {
    return { ok: false, reason: "not_action" };
  }
  for (const pattern of RETURN_JUDGMENT_WEAVE_JUDGMENT_FORBIDDEN) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `judgment_forbidden:${pattern.source}` };
    }
  }
  return scanReturnJudgmentSentence(trimmed);
}

export function appendReturnJudgmentDesignWeave(
  primaryResult,
  { factBundle = {}, primaryPanel = null } = {},
) {
  if (!primaryResult?.text) return primaryResult;

  const weaveRaw = buildReturnJudgmentDesignWeave({ factBundle, primaryPanel });
  if (!weaveRaw) return primaryResult;

  if (weaveRepeatsPrimaryJudgment(primaryResult.text, weaveRaw)) {
    return primaryResult;
  }

  const weaveScan = scanReturnJudgmentWeaveSentence(weaveRaw);
  if (!weaveScan.ok) return primaryResult;

  const primaryTrimmed = primaryResult.text.trim().replace(/\.\s*$/, "");
  const weavePolished = polishLifeguardCustomerText(weaveRaw);
  const combined = `${primaryTrimmed}. ${weavePolished}`;
  const combinedScan = scanReturnJudgmentSentence(combined);
  if (!combinedScan.ok) return primaryResult;

  const polishedCombined = polishLifeguardCustomerText(combined);
  const finalScan = scanReturnJudgmentSentence(polishedCombined);
  if (!finalScan.ok) return primaryResult;

  const baseOutlet = primaryResult.persona_outlet ?? "return_judgment_p5c";
  return {
    ...primaryResult,
    text: polishedCombined,
    conn_004_weave_wired: true,
    conn_004_weave_text: weavePolished,
    conn_004_design_next_action_weave: true,
    persona_outlet: `${baseOutlet}+conn_004_design_next_action_weave`,
    generation_mode: `${primaryResult.generation_mode ?? "return_judgment_p5c"}_conn_004_weave`,
  };
}

function finalizeWithMaintenanceCompound(result, { factBundle, priority } = {}) {
  if (!result) return null;
  const withDesign = appendReturnJudgmentDesignWeave(result, {
    factBundle,
    primaryPanel: priority?.primary_panel ?? null,
  });
  return appendReturnJudgmentContinuityWeave(withDesign, {
    factBundle,
    primaryScanFn: scanReturnJudgmentSentence,
  });
}

function finalizeWithDesignWeave(result, { factBundle, priority } = {}) {
  return finalizeWithMaintenanceCompound(result, { factBundle, priority });
}

function jobHasPanelResults(analysisJob = {}) {
  const result = analysisJob?.result_json ?? analysisJob?.resultJson ?? null;
  if (!result || typeof result !== "object") return false;
  return Boolean(
    result.coverage_gap ||
      result.underwriting_risk ||
      result.recommendation ||
      result.insurance_design,
  );
}

export function buildReturnJudgment({ analysisJob = {}, loadedContext = null, contextSnapshot = null } = {}) {
  const hasPanels = jobHasPanelResults(analysisJob);
  return {
    schema_version: "key-return-judgment-p5c-v1",
    actor: "KEY",
    gate: "P5-C-ENTRY",
    analysis_job_id: analysisJob.id ?? null,
    panel_results_present: hasPanels,
    posture: hasPanels ? "return_judgment_ready" : "return_judgment_hold",
    judgment_scope: {
      knowable: hasPanels ? ["stored_panels_available", "return_judgment_next_step"] : [],
      unknowable: hasPanels ? [] : ["panel_highlights_before_results"],
      must_not_claim: ["bridge_replay", "memory_inventory", "product_push"],
    },
    context_snapshot_id: contextSnapshot?.context_snapshot_id ?? null,
    customer_context_status: loadedContext
      ? {
          memory: loadedContext.memory ?? "empty",
          policies: loadedContext.policies ?? "empty",
          documents: loadedContext.documents ?? "empty",
        }
      : null,
    recorded_at: new Date().toISOString(),
  };
}

export function scanReturnJudgmentSentence(text = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 140) return { ok: false, reason: "too_long" };
  for (const pattern of RETURN_JUDGMENT_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `forbidden:${pattern.source}` };
    }
  }
  return { ok: true, reason: null };
}

export function buildReturnJudgmentDraft(factBundle = {}, humanFrame = {}) {
  if (factBundle.coverage_gap_used || factBundle.has_stored_coverage_analysis) {
    const gapDraft = buildReturnJudgmentCoverageGapDraft(factBundle);
    if (gapDraft) return gapDraft;
    if (factBundle.coverage_gap_top_concerns?.length) {
      return RETURN_JUDGMENT_GAP_GENERIC;
    }
  }
  const labels = factBundle.recommendation_priority_labels ?? [];
  if (labels.length > 0 || factBundle.recommendation_used || factBundle.has_stored_recommendation_analysis) {
    return "우선 담보 쪽부터 같이 짚어보면 좋겠습니다.";
  }
  if (humanFrame.main_blocker === "premium_burden") {
    return "가장 무거운 계약부터 순서를 정리해 보면, 줄일지 유지할지가 보입니다.";
  }
  return RETURN_JUDGMENT_FALLBACK;
}

function finalizeReturnJudgmentFromCoverageGapPanel({
  factBundle = {},
  analysisJob = null,
  loadedContext = null,
} = {}) {
  const candidate = buildReturnJudgmentCoverageGapDraft(factBundle);
  const scan = candidate ? scanReturnJudgmentSentence(candidate) : { ok: false, reason: "empty_draft" };
  if (!scan.ok || !candidate) {
    return null;
  }

  const polished = polishLifeguardCustomerText(candidate);
  const finalScan = scanReturnJudgmentSentence(polished);
  if (!finalScan.ok) {
    return null;
  }

  return {
    text: polished,
    persona_outlet: "conn_002_stored_coverage_gap_top_concern",
    generation_mode: "return_judgment_conn_002_panel",
    conn_002_panel_wired: true,
    coverage_gap_top_concerns: factBundle.coverage_gap_top_concerns ?? [],
    key_first_judgment: buildReturnJudgment({ analysisJob, loadedContext }),
  };
}

function finalizeReturnJudgmentFromUnderwritingPanel({
  factBundle = {},
  analysisJob = null,
  loadedContext = null,
} = {}) {
  const candidate = buildReturnJudgmentUnderwritingDraft(factBundle);
  const scan = candidate ? scanReturnJudgmentSentence(candidate) : { ok: false, reason: "empty_draft" };
  if (!scan.ok || !candidate) {
    return null;
  }

  const polished = polishLifeguardCustomerText(candidate);
  const finalScan = scanReturnJudgmentSentence(polished);
  if (!finalScan.ok) {
    return null;
  }

  return {
    text: polished,
    persona_outlet: "conn_003_stored_underwriting_priority",
    generation_mode: "return_judgment_conn_003_panel",
    conn_003_panel_wired: true,
    underwriting_review_flags: factBundle.underwriting_review_flags ?? [],
    key_first_judgment: buildReturnJudgment({ analysisJob, loadedContext }),
  };
}

function tryPriorityPanelSpeak({
  primaryPanel,
  factBundle,
  analysisJob,
  loadedContext,
} = {}) {
  if (primaryPanel === "coverage_gap") {
    const gapUsed =
      factBundle.coverage_gap_used === true || factBundle.has_stored_coverage_analysis === true;
    if (jobHasStoredCoverageGap(analysisJob) && gapUsed) {
      return finalizeReturnJudgmentFromCoverageGapPanel({ factBundle, analysisJob, loadedContext });
    }
  }
  if (primaryPanel === "underwriting") {
    const uwUsed =
      factBundle.underwriting_used === true || factBundle.has_stored_underwriting_analysis === true;
    if (uwUsed) {
      return finalizeReturnJudgmentFromUnderwritingPanel({ factBundle, analysisJob, loadedContext });
    }
  }
  return null;
}

export function finalizeReturnJudgmentSentence({ keyTurnResult = null, analysisJob = null, loadedContext = null } = {}) {
  const agentTurn = keyTurnResult?.agentTurn ?? null;
  const factBundle = {
    ...(agentTurn?.factBundle ?? {}),
    question: "",
    return_judgment: true,
    classification_intent: "return_judgment",
  };

  const priority = resolveKeyPanelPriority({ factBundle });
  const loserPanel =
    priority.primary_panel === "coverage_gap"
      ? "underwriting"
      : priority.primary_panel === "underwriting"
        ? "coverage_gap"
        : null;

  if (priority.primary_panel) {
    const winnerResult = tryPriorityPanelSpeak({
      primaryPanel: priority.primary_panel,
      factBundle,
      analysisJob,
      loadedContext,
    });
    if (winnerResult) {
      return finalizeWithDesignWeave(
        {
          ...winnerResult,
          conn_003_priority: priority,
        },
        { factBundle, priority },
      );
    }

    if (loserPanel && priority.panel_scores[loserPanel] > 0) {
      const loserResult = tryPriorityPanelSpeak({
        primaryPanel: loserPanel,
        factBundle,
        analysisJob,
        loadedContext,
      });
      if (loserResult) {
        return finalizeWithDesignWeave(
          {
            ...loserResult,
            conn_003_priority: priority,
            conn_003_fallback_from: priority.primary_panel,
          },
          { factBundle, priority },
        );
      }
    }
  }

  const humanFrame = buildHumanUnderstandingFrame({
    question: "",
    factBundle,
    conversationContext: { classificationIntent: "return_judgment" },
  });

  const basisTaggedFacts = {
    evidence_summary: extractFactBundleEvidence(factBundle),
  };

  let candidate = buildReturnJudgmentDraft(factBundle, humanFrame);

  try {
    const composedNext = buildKeyStructuredResponse(
      humanFrame,
      basisTaggedFacts,
      factBundle,
      { resolvedIntent: humanFrame.resolved_intent },
      { nextActionOnly: true },
    );
    if (composedNext && scanReturnJudgmentSentence(composedNext).ok) {
      candidate = composedNext;
    }
  } catch {
    // draft fallback
  }

  let scan = scanReturnJudgmentSentence(candidate);
  if (!scan.ok) {
    candidate = buildReturnJudgmentDraft(factBundle, humanFrame);
    scan = scanReturnJudgmentSentence(candidate);
  }
  if (!scan.ok) {
    candidate = RETURN_JUDGMENT_FALLBACK;
    scan = scanReturnJudgmentSentence(candidate);
  }
  if (!scan.ok) return null;

  const polished = polishLifeguardCustomerText(candidate);
  const finalScan = scanReturnJudgmentSentence(polished);
  if (!finalScan.ok) {
    return finalizeWithDesignWeave(
      {
        text: RETURN_JUDGMENT_FALLBACK,
        persona_outlet: "return_judgment_template_fallback",
        generation_mode: "return_judgment_p5c",
        key_first_judgment: buildReturnJudgment({ analysisJob, loadedContext }),
      },
      { factBundle, priority },
    );
  }

  return finalizeWithDesignWeave(
    {
      text: polished,
      persona_outlet: "buildKeyStructuredResponse_next_action",
      generation_mode: "return_judgment_p5c",
      key_first_judgment: buildReturnJudgment({ analysisJob, loadedContext }),
    },
    { factBundle, priority },
  );
}

export { jobHasPanelResults };
