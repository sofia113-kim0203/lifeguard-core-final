/**
 * Advisor Brain P1 Step 4 — recommendation_reason explain-only (stored results, no engine execution).
 */
import { mapJobResultsToAnalysisPanels } from "../../src/lib/analysisPanelJobUtils.js";
import { buildAdvisorAuditRecord } from "./advisorAuditLog.js";
import { sanitizeAdvisorBrainMessage } from "./advisorBrainGuardrails.js";

export const RECOMMENDATION_REASON_PATTERN =
  /왜|근거|이유|제외|1위|순위|왜\s*추천|추천.*(이유|근거|기준)/;

export const ADVISOR_BRAIN_RECOMMENDATION_REASON_MAX_TOKENS = 700;

export const NO_STORED_RECOMMENDATION_MESSAGE =
  "현재 설명할 추천 결과가 없습니다.\n먼저 추천 분석이 필요합니다.";

const RECOMMENDATION_REASON_SYSTEM_RULES = [
  "You explain stored recommendation results only. Do NOT generate new recommendations.",
  "Use customer-friendly Korean in a concise consultant tone (1-3 short paragraphs).",
  "Treat recommendations as preliminary (예비 추천), not guaranteed enrollment advice.",
  "미확인 is not the same as 미보유 or 없음.",
  "Use only these evidence fields: recommendation_rank, recommendation_score, reason, underwriting_consideration, coverage_gap_level/coverage_label.",
  "Never assert enrollment eligibility or guaranteed claim payment.",
  "Never invent insurer rankings, insurer superiority, product names, or insurer exclusion reasons.",
  "If insurer_rank_notice is present, include that current results are coverage-area based, not insurer rankings.",
].join(" ");

export function isRecommendationReasonClassification(classification = {}, question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  if (classification?.intent !== "recommendation_request") return false;
  return RECOMMENDATION_REASON_PATTERN.test(text);
}

export const INSURER_RANK_NOTICE =
  "현재 추천 결과는 보험사 순위가 아니라 보장 영역 기준 추천입니다.";

export function ensureInsurerRankNotice(message, { insurerRankQuestion = false } = {}) {
  const text = String(message ?? "").trim();
  if (!insurerRankQuestion || !text) return text;
  if (text.includes(INSURER_RANK_NOTICE)) return text;
  return `${text}\n\n${INSURER_RANK_NOTICE}`;
}

export function isInsurerRankQuestion(question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  return /보험사/.test(text) && /왜|1위|순위|제외|이유|근거/.test(text);
}

export function detectRecommendationEvidenceMismatch({
  hasRecommendationEvidence = false,
  message = "",
} = {}) {
  const text = String(message ?? "").trim();
  if (!text || hasRecommendationEvidence) {
    return { mismatched: false, reason: null };
  }

  const fabricationPatterns = [
    /추천(?:합니다|해\s*드립|드릴|했)/,
    /(?:1위|순위).{0,12}보험사/,
    /보험사.{0,12}(?:1위|제외)/,
    /(?:가입|들어).{0,8}(?:권장|추천|가능)/,
    /제외(?:됐|되었|사유)/,
  ];

  const mismatched = fabricationPatterns.some((pattern) => pattern.test(text));
  return {
    mismatched,
    reason: mismatched ? "no_stored_recommendation_but_generated_answer" : null,
  };
}

export async function loadLatestCompletedAnalysisJob(supabase, customerId) {
  if (!supabase || !customerId) return null;

  const { data, error } = await supabase
    .from("analysis_jobs")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

function pickCoverageGapEvidence(coverageGapResult = null) {
  const items = Array.isArray(coverageGapResult?.items) ? coverageGapResult.items : [];
  const topGaps = Array.isArray(coverageGapResult?.top_gaps) ? coverageGapResult.top_gaps : [];

  return {
    gap_score: coverageGapResult?.gap_score ?? null,
    top_gaps: topGaps.slice(0, 5).map((item) => ({
      coverage_label: item.coverage_label ?? item.coverage_category ?? null,
      gap_level: item.gap_level ?? null,
      reason: item.reason ?? null,
    })),
    items: items.slice(0, 8).map((item) => ({
      coverage_category: item.coverage_category ?? null,
      coverage_label: item.coverage_label ?? null,
      gap_level: item.gap_level ?? null,
      current_status: item.current_status ?? null,
      reason: item.reason ?? null,
    })),
  };
}

function pickUnderwritingEvidence(underwritingResult = null) {
  const items = Array.isArray(underwritingResult?.items) ? underwritingResult.items : [];
  return {
    overall_underwriting_risk: underwritingResult?.overall_underwriting_risk ?? null,
    risk_score: underwritingResult?.risk_score ?? null,
    items: items.slice(0, 8).map((item) => ({
      coverage_category: item.coverage_category ?? null,
      coverage_label: item.coverage_label ?? null,
      underwriting_status: item.underwriting_status ?? null,
      reason: item.reason ?? null,
    })),
  };
}

export function buildStoredRecommendationEvidence(panels = {}) {
  const recommendationResult = panels.recommendationResult ?? null;
  const coverageGapResult = panels.coverageGapResult ?? null;
  const underwritingResult = panels.underwritingResult ?? null;

  const storedRecommendations = (recommendationResult?.customer_visible_top2 ?? []).map((item) => ({
    recommendation_rank: item.recommendation_rank ?? null,
    recommendation_score: item.recommendation_score ?? null,
    reason: item.reason ?? null,
    underwriting_consideration: item.underwriting_consideration ?? null,
    coverage_label: item.coverage_label ?? null,
    coverage_category: item.coverage_category ?? null,
    coverage_gap_level: item.coverage_gap_level ?? null,
    recommendation_type: item.recommendation_type ?? null,
    priority: item.priority ?? null,
  }));

  return {
    has_recommendation: storedRecommendations.length > 0,
    stored_recommendations: storedRecommendations,
    coverage_gap: pickCoverageGapEvidence(coverageGapResult),
    underwriting: pickUnderwritingEvidence(underwritingResult),
  };
}

export function buildRecommendationReasonSystemPrompt() {
  return RECOMMENDATION_REASON_SYSTEM_RULES;
}

export function buildRecommendationReasonUserPrompt({
  question,
  evidence,
  insurerRankQuestion = false,
}) {
  const blocks = [
    "Explain the stored recommendation using only the evidence JSON below.",
    "",
    `question: ${question}`,
    `mode: recommendation_reason`,
    `insurer_rank_notice: ${
      insurerRankQuestion
        ? INSURER_RANK_NOTICE
        : "(none)"
    }`,
    "",
    "stored_recommendation_evidence:",
    JSON.stringify(evidence, null, 2),
  ];
  return blocks.join("\n");
}

/**
 * Build Advisor Brain explain-only answer for recommendation_reason questions.
 */
export async function buildRecommendationReasonAnswer({
  supabase,
  customerId,
  question,
  classification,
  env = process.env,
  fetchImpl = fetch,
  sessionId = null,
  conversationId = null,
  claudeCall,
  jobLoader = loadLatestCompletedAnalysisJob,
} = {}) {
  if (!supabase || !customerId || !question) {
    return { ok: false, reason: "INVALID_INPUT", message: null, used_tools: [], evidence: [], audit: null };
  }

  if (!isRecommendationReasonClassification(classification, question)) {
    return { ok: false, reason: "INTENT_NOT_SUPPORTED", message: null, used_tools: [], evidence: [], audit: null };
  }

  try {
    const completedJob = await jobLoader(supabase, customerId);
    const panels = completedJob ? mapJobResultsToAnalysisPanels(completedJob) : null;
    const evidence = buildStoredRecommendationEvidence(panels ?? {});

    if (!evidence.has_recommendation) {
      return {
        ok: true,
        message: NO_STORED_RECOMMENDATION_MESSAGE,
        used_tools: [],
        evidence: [],
        audit: buildAdvisorAuditRecord({
          customerId,
          sessionId,
          conversationId,
          userMessage: question,
          classification,
          allowedTools: [],
          toolResults: [],
          guardrailSummary: { no_stored_recommendation: true },
          finalCustomerText: NO_STORED_RECOMMENDATION_MESSAGE,
        }),
        guardrail_summary: { no_stored_recommendation: true },
        recommendation_reason_mode: true,
        engine_executed: false,
      };
    }

    if (typeof claudeCall !== "function") {
      return { ok: false, reason: "CLAUDE_CALLER_MISSING", message: null, used_tools: [], evidence: [], audit: null };
    }

    const system = buildRecommendationReasonSystemPrompt();
    const user = buildRecommendationReasonUserPrompt({
      question,
      evidence,
      insurerRankQuestion: isInsurerRankQuestion(question),
    });

    const claudeResult = await claudeCall({
      system,
      user,
      maxTokens: ADVISOR_BRAIN_RECOMMENDATION_REASON_MAX_TOKENS,
      fetchImpl,
      env,
    });

    if (!claudeResult.ok || !claudeResult.message) {
      return {
        ok: false,
        reason: claudeResult.reason ?? "CLAUDE_SYNTHESIS_FAILED",
        message: null,
        used_tools: [],
        evidence: evidence.stored_recommendations,
        audit: buildAdvisorAuditRecord({
          customerId,
          sessionId,
          conversationId,
          userMessage: question,
          classification,
          allowedTools: [],
          toolResults: [],
          guardrailSummary: { stored_job_id: completedJob?.id ?? null },
          finalCustomerText: null,
        }),
      };
    }

    const mismatch = detectRecommendationEvidenceMismatch({
      hasRecommendationEvidence: evidence.has_recommendation,
      message: claudeResult.message,
    });
    if (mismatch.mismatched) {
      return {
        ok: false,
        reason: "RECOMMENDATION_EVIDENCE_MISMATCH",
        message: null,
        used_tools: [],
        evidence: evidence.stored_recommendations,
        audit: buildAdvisorAuditRecord({
          customerId,
          sessionId,
          conversationId,
          userMessage: question,
          classification,
          allowedTools: [],
          toolResults: [],
          guardrailSummary: {
            stored_job_id: completedJob?.id ?? null,
            evidence_mismatch: mismatch.reason,
          },
          finalCustomerText: null,
        }),
      };
    }

    const sanitizedMessage = sanitizeAdvisorBrainMessage(claudeResult.message, {
      hasPremiumEvidence: false,
      hasCoverageEvidence: true,
    });
    const finalMessage = ensureInsurerRankNotice(sanitizedMessage, {
      insurerRankQuestion: isInsurerRankQuestion(question),
    });

    const audit = buildAdvisorAuditRecord({
      customerId,
      sessionId,
      conversationId,
      userMessage: question,
      classification,
      allowedTools: [],
      toolResults: [],
      guardrailSummary: {
        stored_job_id: completedJob?.id ?? null,
        insurer_rank_question: isInsurerRankQuestion(question),
        insurer_rank_notice_appended: finalMessage !== sanitizedMessage,
        unsupported_fact_sanitized: sanitizedMessage !== claudeResult.message,
      },
      finalCustomerText: finalMessage,
    });

    return {
      ok: true,
      message: finalMessage,
      used_tools: [],
      evidence: evidence.stored_recommendations,
      audit,
      guardrail_summary: {
        stored_job_id: completedJob?.id ?? null,
        insurer_rank_question: isInsurerRankQuestion(question),
      },
      recommendation_reason_mode: true,
      engine_executed: false,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "ADVISOR_BRAIN_FAILED",
      message: null,
      error_message: error instanceof Error ? error.message : "advisor_brain_failed",
      used_tools: [],
      evidence: [],
      audit: null,
    };
  }
}
