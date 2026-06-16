/**
 * Central Brain P0-D — comprehensive coverage review (stored analysis only).
 */
import { jobHasEnginePanelResults } from "../../src/lib/analysisPanelJobUtils.js";
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { buildAdvisorAuditRecord } from "./advisorAuditLog.js";
import { sanitizeAdvisorBrainMessage } from "./advisorBrainGuardrails.js";

export const COVERAGE_REVIEW_PENDING_MESSAGE =
  "분석을 시작했습니다. 완료되면 다시 종합 점검 결과를 안내드릴 수 있습니다.";

export const ADVISOR_BRAIN_COVERAGE_REVIEW_MAX_TOKENS = 1200;

const COVERAGE_REVIEW_SYSTEM_RULES = [
  "You produce a comprehensive insurance review from stored evidence only. Do NOT run new analysis or invent data.",
  "Use customer-friendly Korean with numbered sections when helpful.",
  "Required sections (omit only when evidence is truly absent, and say 확인 필요):",
  "1) 현재 고객 상태 요약",
  "2) 주요 보장 공백",
  "3) 인수위험/주의점",
  "4) 추천 방향",
  "5) 설계 요약",
  "6) 다음 행동",
  "Never claim 100% coverage or guaranteed enrollment/claim payment.",
  "미확인 is not the same as 미보유. Use 확인 필요 / 증권 확인 필요 when data is missing.",
  "Never invent insurer names, product names, or ranks not present in the evidence JSON.",
  "Frame recommendations as preliminary 검토, not binding advice.",
  "Never mention internal system names (Advisor Brain, Central Brain, engines, analysis_jobs).",
].join(" ");

export function buildReviewBundleFromEvidenceData(data = {}) {
  const panels = data.stored_panels ?? {};
  return {
    customer_summary: {
      policy_count: data.policy_count ?? 0,
      premium_stats: data.premium_stats ?? null,
      unified: data.unified ?? null,
    },
    memory_summary: data.structured_memory ?? null,
    coverage_gap: panels.coverageGapResult ?? data.stored_job?.result_json?.coverage_gap ?? null,
    underwriting_risk:
      panels.underwritingResult ?? data.stored_job?.result_json?.underwriting_risk ?? null,
    recommendation:
      panels.recommendationResult ?? data.stored_job?.result_json?.recommendation ?? null,
    insurance_design:
      panels.designBundle ?? data.stored_job?.result_json?.insurance_design ?? null,
  };
}

export function isCoverageReviewEvidenceSufficient(reviewBundle = null, storedJob = null) {
  if (reviewBundle?.coverage_gap) return true;
  if (storedJob && jobHasEnginePanelResults(storedJob)) return true;
  return false;
}

export function buildCoverageReviewSystemPrompt() {
  return COVERAGE_REVIEW_SYSTEM_RULES;
}

export function buildCoverageReviewUserPrompt({ question, reviewBundle }) {
  return [
    "Produce a comprehensive insurance review for the customer using ONLY the review_bundle JSON below.",
    "",
    `question: ${question}`,
    "mode: coverage_review_request",
    "",
    "review_bundle:",
    JSON.stringify(reviewBundle ?? {}, null, 2),
  ].join("\n");
}

export function detectCoverageReviewEvidenceMismatch({
  hasStoredAnalysis = false,
  message = "",
} = {}) {
  const text = String(message ?? "").trim();
  if (!text || hasStoredAnalysis) {
    return { mismatched: false, reason: null };
  }

  const fabricationPatterns = [
    /100\s*%\s*보장/,
    /반드시\s*가입/,
    /(?:A|B|C|삼성|현대|KB|메리츠|한화|DB|흥국).{0,8}(?:보험|상품)/,
    /보험사.*(?:1위|추천|제외)/,
    /(?:확실|보장).{0,6}(?:가능|됩니다)/,
  ];

  if (fabricationPatterns.some((pattern) => pattern.test(text))) {
    return { mismatched: true, reason: "coverage_review_fabrication_detected" };
  }

  return { mismatched: false, reason: null };
}

async function callCoverageReviewClaude({
  system,
  user,
  fetchImpl = fetch,
  env = process.env,
  apiKey = resolveAnthropicApiKey(env),
  claudeCall = null,
}) {
  if (typeof claudeCall === "function") {
    return claudeCall({ system, user, maxTokens: ADVISOR_BRAIN_COVERAGE_REVIEW_MAX_TOKENS });
  }

  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_NOT_CONFIGURED", message: null };
  }

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: ADVISOR_BRAIN_COVERAGE_REVIEW_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      message: null,
      error_message: `Claude API error (${response.status})`,
    };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    return { ok: false, reason: "CLAUDE_EMPTY_RESPONSE", message: null };
  }

  return { ok: true, message: text, model: data?.model ?? "claude-sonnet-4-6" };
}

export async function buildCoverageReviewAnswer({
  question,
  reviewBundle,
  storedJob = null,
  env = process.env,
  fetchImpl = fetch,
  claudeCall = null,
} = {}) {
  const hasStoredAnalysis = isCoverageReviewEvidenceSufficient(reviewBundle, storedJob);
  if (!hasStoredAnalysis) {
    return {
      ok: false,
      reason: "INSUFFICIENT_STORED_EVIDENCE",
      message: null,
      has_stored_analysis: false,
    };
  }

  const system = buildCoverageReviewSystemPrompt();
  const user = buildCoverageReviewUserPrompt({ question, reviewBundle });
  const claudeResult = await callCoverageReviewClaude({
    system,
    user,
    fetchImpl,
    env,
    claudeCall,
  });

  if (!claudeResult?.ok || !claudeResult.message) {
    return {
      ok: false,
      reason: claudeResult?.reason ?? "CLAUDE_FAILED",
      message: null,
      has_stored_analysis: true,
    };
  }

  const sanitized = sanitizeAdvisorBrainMessage(claudeResult.message);
  const mismatch = detectCoverageReviewEvidenceMismatch({
    hasStoredAnalysis: true,
    message: sanitized,
  });

  if (mismatch.mismatched) {
    return {
      ok: false,
      reason: mismatch.reason,
      message: null,
      has_stored_analysis: true,
    };
  }

  return {
    ok: true,
    message: sanitized,
    model: claudeResult.model ?? null,
    has_stored_analysis: true,
    audit: buildAdvisorAuditRecord({
      userMessage: question,
      classification: { intent: "coverage_review_request" },
      allowedTools: ["stored_review_bundle"],
      finalCustomerText: sanitized,
    }),
  };
}
