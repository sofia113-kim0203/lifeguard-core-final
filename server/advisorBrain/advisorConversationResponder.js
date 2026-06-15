/**
 * Advisor Brain P1 Step 5 — advisor conversation (stored analysis, counsel-only).
 */
import { mapJobResultsToAnalysisPanels } from "../../src/lib/analysisPanelJobUtils.js";
import { buildAdvisorAuditRecord } from "./advisorAuditLog.js";
import { sanitizeAdvisorBrainMessage } from "./advisorBrainGuardrails.js";
import { isActivatableFactualLookupClassification } from "./advisorFactualLookupResponder.js";
import {
  buildStoredRecommendationEvidence,
  isRecommendationReasonClassification,
  loadLatestCompletedAnalysisJob,
} from "./advisorRecommendationReasonResponder.js";

export const ADVISOR_CONVERSATION_PATTERNS = [
  /보험\s*더\s*들어야/,
  /추가\s*가입/,
  /뭘\s*먼저\s*해야/,
  /지금\s*상태\s*어때/,
  /괜찮아/,
  /암이랑\s*뇌혈관\s*중|암.*뇌혈관.*중/,
  /무엇이\s*더\s*중요/,
  /우선순위가\s*뭐야/,
];

export const ADVISOR_CONVERSATION_EXCLUSION_PATTERNS = [
  /보험사.*추천|추천.*보험사/,
  /상품.*추천|추천.*상품/,
];

export const ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS = 900;

export const NO_STORED_CONVERSATION_MESSAGE =
  "현재 상담에 활용할 분석 결과가 없습니다.\n먼저 분석이 필요합니다.";

export const ADVISOR_CONVERSATION_STYLE_EXAMPLES = {
  bad: "뇌혈관 보장이 부족합니다.",
  good:
    "지금 자료 기준으로 보면 뇌혈관 쪽이 조금 아쉬워 보여요. 특히 혈압약 복용 이력이 있으니까 제가 먼저 확인해볼 부분은 그쪽입니다.",
};

export const ADVISOR_CONVERSATION_FOLLOW_UP_EXAMPLES = [
  "어떤 부분이 가장 걱정되세요?",
  "최근 건강검진은 받아보셨어요?",
  "왜 그렇게 생각하셨어요?",
];

const ADVISOR_CONVERSATION_SYSTEM_RULES = [
  "You are a warm, empathetic Korean-speaking insurance advisor (보험설계사) in an ongoing consultation — not a report generator or one-shot Q&A bot.",
  "Answer from stored analysis results only. Do NOT run new analysis.",
  "Speak as if you are sitting with the customer: natural, conversational Korean in 2-4 short paragraphs (at least 3 sentences total).",
  "NEVER give a one-sentence-only answer.",
  "After explaining, connect the point to the customer's situation in plain language — do not drop facts without context.",
  "When it fits naturally, end with exactly ONE follow-up question to keep the dialogue going (e.g. 어떤 부분이 가장 걱정되세요? / 최근 건강검진은 받아보셨어요? / 왜 그렇게 생각하셨어요?). Do not ask multiple follow-ups.",
  "NEVER use report/document tone: avoid stiff endings like '~입니다.' only, '분석 결과에 따르면', or analysis-report phrasing.",
  "Minimize bullet lists; prefer flowing prose. Use bullets only when comparing 2-3 priorities.",
  "Base answers on stored coverage_gap, underwriting_risk, and recommendation evidence only.",
  "Never generate new recommendations, new designs, insurer rankings, or product picks.",
  "Never invent scores, ranks, or product/insurer names not present in the evidence JSON.",
  "미확인 is not the same as 미보유 or 없음.",
  "When discussing additional coverage, frame as 검토/고려 and note that actual enrollment requires underwriting review.",
  "For priority questions, compare only evidence-backed gap levels and stored recommendation_rank values.",
  "Never assert guaranteed enrollment eligibility or claim payment.",
].join(" ");

export function isAdvisorConversationQuestion(classification = {}, question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  if (classification?.intent === "coverage_gap_check") return false;
  if (isActivatableFactualLookupClassification(classification)) return false;
  if (isRecommendationReasonClassification(classification, question)) return false;
  if (ADVISOR_CONVERSATION_EXCLUSION_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return ADVISOR_CONVERSATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildStoredConversationEvidence(panels = {}) {
  const evidence = buildStoredRecommendationEvidence(panels);
  const has_stored_analysis =
    evidence.stored_recommendations.length > 0 ||
    (evidence.coverage_gap?.items?.length ?? 0) > 0 ||
    (evidence.coverage_gap?.top_gaps?.length ?? 0) > 0 ||
    (evidence.underwriting?.items?.length ?? 0) > 0;

  return {
    ...evidence,
    has_stored_analysis,
  };
}

export function detectConversationEvidenceMismatch({
  hasStoredAnalysis = false,
  message = "",
} = {}) {
  const text = String(message ?? "").trim();
  if (!text) {
    return { mismatched: false, reason: null };
  }

  const fabricationPatterns = [
    /(?:A|B|C|삼성|현대|KB|메리츠|한화|DB|흥국).{0,6}보험사.*추천/,
    /보험사.*(?:추천|1위|제외)/,
    /(?:상품|플랜).{0,8}(?:추천|가입)/,
    /반드시\s*가입/,
    /(?:확실|보장).{0,6}가능/,
  ];

  const mismatched = fabricationPatterns.some((pattern) => pattern.test(text));
  if (mismatched) {
    return { mismatched: true, reason: "conversation_fabrication_detected" };
  }

  if (!hasStoredAnalysis) {
    const hallucinationPatterns = [
      /보장\s*공백/,
      /우선순위/,
      /뇌혈관|암보험/,
      /추가\s*가입/,
    ];
    if (hallucinationPatterns.some((pattern) => pattern.test(text))) {
      return { mismatched: true, reason: "no_stored_analysis_but_generated_answer" };
    }
  }

  return { mismatched: false, reason: null };
}

export function buildAdvisorConversationSystemPrompt() {
  return ADVISOR_CONVERSATION_SYSTEM_RULES;
}

export function buildAdvisorConversationUserPrompt({ question, evidence }) {
  return [
    "Answer the customer's advisory conversation question using only the stored evidence JSON below.",
    "This is an ongoing consultation — respond like a caring insurance advisor, not a report.",
    "",
    `question: ${question}`,
    "mode: advisor_conversation",
    "",
    "Answer style (follow strictly):",
    `BAD (too short, report tone): "${ADVISOR_CONVERSATION_STYLE_EXAMPLES.bad}"`,
    `GOOD (warm, contextual): "${ADVISOR_CONVERSATION_STYLE_EXAMPLES.good}"`,
    "",
    "Follow-up: when appropriate, end with one natural question such as:",
    ADVISOR_CONVERSATION_FOLLOW_UP_EXAMPLES.map((example) => `- ${example}`).join("\n"),
    "",
    "stored_conversation_evidence:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

/**
 * Build Advisor Brain counsel-only answer for advisor conversation questions.
 */
export async function buildAdvisorConversationAnswer({
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

  if (!isAdvisorConversationQuestion(classification, question)) {
    return { ok: false, reason: "INTENT_NOT_SUPPORTED", message: null, used_tools: [], evidence: [], audit: null };
  }

  try {
    const completedJob = await jobLoader(supabase, customerId);
    const panels = completedJob ? mapJobResultsToAnalysisPanels(completedJob) : null;
    const evidence = buildStoredConversationEvidence(panels ?? {});

    if (!evidence.has_stored_analysis) {
      return {
        ok: true,
        message: NO_STORED_CONVERSATION_MESSAGE,
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
          guardrailSummary: { no_stored_analysis: true },
          finalCustomerText: NO_STORED_CONVERSATION_MESSAGE,
        }),
        guardrail_summary: { no_stored_analysis: true },
        advisor_conversation_mode: true,
        engine_executed: false,
      };
    }

    if (typeof claudeCall !== "function") {
      return { ok: false, reason: "CLAUDE_CALLER_MISSING", message: null, used_tools: [], evidence: [], audit: null };
    }

    const claudeResult = await claudeCall({
      system: buildAdvisorConversationSystemPrompt(),
      user: buildAdvisorConversationUserPrompt({ question, evidence }),
      maxTokens: ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS,
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

    const mismatch = detectConversationEvidenceMismatch({
      hasStoredAnalysis: evidence.has_stored_analysis,
      message: claudeResult.message,
    });
    if (mismatch.mismatched) {
      return {
        ok: false,
        reason: "CONVERSATION_EVIDENCE_MISMATCH",
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
      hasCoverageEvidence: (evidence.coverage_gap?.items?.length ?? 0) > 0,
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
        unsupported_fact_sanitized: sanitizedMessage !== claudeResult.message,
      },
      finalCustomerText: sanitizedMessage,
    });

    return {
      ok: true,
      message: sanitizedMessage,
      used_tools: [],
      evidence: evidence.stored_recommendations,
      audit,
      guardrail_summary: {
        stored_job_id: completedJob?.id ?? null,
      },
      advisor_conversation_mode: true,
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
