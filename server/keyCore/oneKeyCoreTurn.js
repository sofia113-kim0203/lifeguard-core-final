/**
 * ONE KEY Core — question = Claude-first; document / analysis_complete / bridge / return_judgment stay intake events.
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import {
  buildLoadedContextFromSnapshot,
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../customerContextSnapshot.js";
import { resolveSalesDirectorJudgmentIntent } from "../salesDirectorFormatter.js";
import { finalizeKeyCustomerText } from "./keyCustomerMonopoly.js";
import {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreBridgeEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreReturnJudgmentEnabled,
  isOneKeyCoreS1Enabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreBridgeEnv,
  resolveOneKeyCoreDocumentEnv,
  resolveOneKeyCoreReturnJudgmentEnv,
  resolveOneKeyCoreS1Env,
  shouldRunClaudeFirstHomeChatQuestion,
} from "./oneKeyCoreFlags.js";
import { runOneKeyCoreDocumentTurn } from "./oneKeyCoreDocument.js";
import { runOneKeyCoreAnalysisCompleteTurn } from "./oneKeyCoreAnalysisComplete.js";
import { runOneKeyCoreBridgeTurn } from "./oneKeyCoreBridge.js";
import { runOneKeyCoreReturnJudgmentTurn } from "./oneKeyCoreReturnJudgment.js";
import { runClaudeFirstDirectQuestionTurn } from "./keyClaudeFirstDirect.js";
import { readThreadPublicCitationsFromArgs } from "./keyThreadPublicEvidence.js";
import { readThreadVerifiedFactRefsFromArgs } from "./keyThreadVerifiedFactRefs.js";
import { readHandoffMemoFromArgs } from "./keyThreadHandoffMemo.js";

export {
  isOneKeyCoreAnalysisCompleteEnabled,
  isOneKeyCoreBridgeEnabled,
  isOneKeyCoreDocumentEnabled,
  isOneKeyCoreReturnJudgmentEnabled,
  isOneKeyCoreS1Enabled,
  resolveOneKeyCoreAnalysisCompleteEnv,
  resolveOneKeyCoreBridgeEnv,
  resolveOneKeyCoreDocumentEnv,
  resolveOneKeyCoreReturnJudgmentEnv,
  resolveOneKeyCoreS1Env,
  shouldRunClaudeFirstHomeChatQuestion,
  ONE_KEY_CORE_S1_BLOCKED_PATHS,
  ONE_KEY_CORE_RESPONSE_SOURCE,
};

/** Structured KEY audience — never inferred from question text. */
export const KEY_AUDIENCE_CUSTOMER = "customer";
export const KEY_AUDIENCE_AGENT = "agent";
export const KEY_AGENT_CONVERSATION_MODES = Object.freeze([
  "general",
  "customer_scoped",
  "customer_denied",
]);

/**
 * Only explicit "agent" is agent. Invalid / missing → customer (never silent promote).
 * @param {unknown} audience
 */
export function normalizeKeyAudience(audience) {
  return audience === KEY_AUDIENCE_AGENT
    ? KEY_AUDIENCE_AGENT
    : KEY_AUDIENCE_CUSTOMER;
}

/**
 * Agent modes only. Invalid agent mode → "general" (does not widen customer access).
 * Customer audience → null (no agent mode).
 * @param {"customer"|"agent"} audience
 * @param {unknown} conversationMode
 */
export function normalizeKeyConversationMode(audience, conversationMode) {
  if (audience !== KEY_AUDIENCE_AGENT) return null;
  const mode = String(conversationMode ?? "").trim();
  if (KEY_AGENT_CONVERSATION_MODES.includes(mode)) return mode;
  return "general";
}

/**
 * Structured agent role badge for Claude. Does not grant customer access.
 * @param {"general"|"customer_scoped"|"customer_denied"} conversationMode
 */
export function buildAgentKeyRoleContract(conversationMode) {
  const mode = normalizeKeyConversationMode(KEY_AUDIENCE_AGENT, conversationMode);
  const shared = [
    "현재 대화 상대는 보험 고객이 아니라 설계사다.",
    "설계사의 보험 지식·상담 준비·담당 고객 업무를 돕는다.",
    "설계사를 고객처럼 취급하지 않는다.",
    "설계사 본인에게 '가입하신 보험', '고객님의 보장'이라고 전제하지 않는다.",
    "고객 자료가 없으면 특정 고객의 보험·청구 상태를 아는 척하지 않는다.",
    "확인되지 않은 고객정보를 추측하지 않는다.",
    "최종 발화자는 계속 KEY 하나다. 별도 Agent AI/persona를 만들지 않는다.",
    "이 역할 계약은 말투·대화 관점용이며 고객 접근 권한을 부여하지 않는다.",
  ];
  /** @type {string[]} */
  let modeLines = [];
  if (mode === "customer_scoped") {
    modeLines = [
      "conversationMode=customer_scoped: 서버 게이트를 통과해 제공된 검증된 고객 context만 사용한다.",
      "담당 고객 상담 준비 관점으로 답한다.",
      "다른 고객정보나 미제공 사실을 추측하지 않는다.",
    ];
  } else if (mode === "customer_denied") {
    modeLines = [
      "conversationMode=customer_denied: 고객 chart·PII·briefing이 없다.",
      "해당 고객 자료에 접근할 수 없음을 자연스럽게 안내한다.",
      "고객의 존재 여부·이메일·UUID·배정 상태 상세를 노출하지 않는다.",
      "일반 보험 지식 차원의 도움은 계속 제공할 수 있다.",
    ];
  } else {
    modeLines = [
      "conversationMode=general: 고객 chart·PII·briefing이 없는 일반 보험 지식 대화다.",
      "특정 고객 정보가 있다고 전제하지 않는다.",
      "설계사 업무 관점으로 답한다.",
    ];
  }
  const contract_lines = [...shared, ...modeLines];
  return {
    audience: KEY_AUDIENCE_AGENT,
    conversation_mode: mode,
    authority_note: "role_contract_does_not_grant_customer_access",
    contract_lines,
    system_text_block: [
      "[KEY_ROLE_BADGE]",
      `audience=agent`,
      `conversationMode=${mode}`,
      ...contract_lines,
      "[/KEY_ROLE_BADGE]",
    ].join("\n"),
  };
}

function buildKeyMonopolyQuestionFailure({
  question = "",
  consultationIntent = null,
  reason = "key_turn_failed",
  trace = null,
  startedAt = Date.now(),
} = {}) {
  const outlet = finalizeKeyCustomerText("", { failureMode: true });
  const customerText = outlet.keySpeakOriginal;
  const resolvedIntent = resolveSalesDirectorJudgmentIntent(
    consultationIntent?.intent ?? "general_consultation",
    question,
  );
  return {
    ok: true,
    customerText,
    keySpeakOriginal: customerText,
    key_monopoly_failure: true,
    failure_reason: reason,
    agentTurn: {
      text: customerText,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
      consultationIntent: consultationIntent ?? classifyConsultationIntent(question),
      factBundle: {
        one_key_core: true,
        one_key_core_s1: true,
        key_monopoly_failure: true,
        question,
        classification_intent: consultationIntent?.intent ?? null,
      },
    },
    modeDecision: null,
    loadedContext: null,
    contextSnapshot: null,
    unifiedState: null,
    customerContextBundle: null,
    salesDirectorTrace: {
      one_key_core: true,
      one_key_core_s1: true,
      key_monopoly_failure: true,
      failure_reason: reason,
      one_key_core_trace: trace,
      legacy_paths_blocked: ONE_KEY_CORE_S1_BLOCKED_PATHS,
    },
    truthGate: null,
    latency: { total_ms: Date.now() - startedAt },
    loopStartedAt: startedAt,
    oneKeyCoreTrace: trace,
    traceComplete: false,
    resolvedIntent,
  };
}

/**
 * ONE KEY Core turn — routes by event (question · document · analysis_complete · bridge · return_judgment).
 */
export async function runOneKeyCoreTurn({
  event = "question",
  userSupabase,
  customerId,
  question = "",
  history = [],
  document = null,
  analysisJob = null,
  sessionId = null,
  gapHours = null,
  gate = { emit: true, reasons: [] },
  transitionObservedAt = null,
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  uploadEntryMode = null,
  shadowVisualBlocksOverride = null,
  customerQuestion = "",
  injectedPdfBytes = null,
  attachedDocumentId = null,
  attachedDocumentIds = null,
  priorAttachFollowUp = false,
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  authUserId = null,
  entityContext = null,
  readyCardHandoffToken = null,
  presenceTurn = false,
  clientTurnId = null,
  pointedContractIds = null,
  /** Phase 8 Preview-only Golden parallel capture bag. */
  phase8TraceBag = null,
  /** @type {"customer"|"agent"|undefined} */
  audience,
  /** @type {"general"|"customer_scoped"|"customer_denied"|undefined} */
  conversationMode,
  streamHandlers = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  if (event === "document") {
    return runOneKeyCoreDocumentTurn({
      userSupabase,
      customerId,
      document,
      hasAnalysisConsent,
      uploadSource,
      categoryKey,
      uploadEntryMode,
      customerQuestion: customerQuestion || question,
      history,
      injectedPdfBytes,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "analysis_complete") {
    return runOneKeyCoreAnalysisCompleteTurn({
      userSupabase,
      customerId,
      analysisJob,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "return_judgment") {
    return runOneKeyCoreReturnJudgmentTurn({
      userSupabase,
      customerId,
      sessionId,
      anchorJob: analysisJob,
      gapHours,
      gate,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  if (event === "bridge") {
    return runOneKeyCoreBridgeTurn({
      userSupabase,
      customerId,
      sessionId,
      anchorJob: analysisJob,
      gapHours,
      gate,
      transitionObservedAt,
      env,
      fetchImpl,
      startedAt,
    });
  }

  return runOneKeyCoreQuestionTurn({
    userSupabase,
    customerId,
    question,
    history,
    attachedDocumentId,
    attachedDocumentIds,
    priorAttachFollowUp,
    attachmentReferenceEnabled,
    activeAttachmentIds,
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
    sessionId,
    presenceTurn,
    authUserId,
    entityContext,
    readyCardHandoffToken,
    clientTurnId,
    pointedContractIds,
    phase8TraceBag,
    shadowVisualBlocksOverride,
    audience,
    conversationMode,
    streamHandlers,
    env,
    fetchImpl,
    startedAt,
    threadPublicCitations: readThreadPublicCitationsFromArgs(arguments[0]),
    threadVerifiedFactRefs: readThreadVerifiedFactRefsFromArgs(arguments[0]),
    threadHandoffMemo: readHandoffMemoFromArgs(arguments[0]),
  });
}

/**
 * ONE KEY Core question event (S1).
 */
async function runOneKeyCoreQuestionTurn({
  userSupabase,
  customerId,
  question,
  history = [],
  attachedDocumentId = null,
  attachedDocumentIds = null,
  priorAttachFollowUp = false,
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  sessionId = null,
  authUserId = null,
  entityContext = null,
  readyCardHandoffToken = null,
  presenceTurn = false,
  clientTurnId = null,
  pointedContractIds = null,
  phase8TraceBag = null,
  audience,
  conversationMode,
  streamHandlers = null,
  env = process.env,
  fetchImpl = fetch,
  startedAt = Date.now(),
} = {}) {
  const coreEnv = resolveOneKeyCoreS1Env(env);
  const resolvedAudience = normalizeKeyAudience(audience);
  const resolvedConversationMode = normalizeKeyConversationMode(
    resolvedAudience,
    conversationMode,
  );
  const keyRoleContract =
    resolvedAudience === KEY_AUDIENCE_AGENT
      ? buildAgentKeyRoleContract(resolvedConversationMode)
      : null;
  const trace = {
    schema_version: "one-key-core-trace-s1-v1",
    steps: [],
    legacy_paths_blocked: ONE_KEY_CORE_S1_BLOCKED_PATHS,
    customer_text_path: [],
    key_audience: resolvedAudience,
    key_conversation_mode: resolvedConversationMode,
  };

  let contextSnapshot = null;
  let unifiedState = null;
  let loadedContext = null;
  let customerContextBundle = null;

  const scopedCustomerId = String(customerId ?? "").trim();
  // Agent general-knowledge turns may omit customerId — empty warehouse, no PII load.
  // Customer home path always supplies customerId; this branch does not alter it.
  if (!scopedCustomerId) {
    contextSnapshot = {
      contract_version: "customer-context-snapshot-empty-v1",
      customer_id: null,
      profile: { status: "empty" },
      policies: { status: "empty" },
      documents: { status: "empty" },
      memory: { status: "empty" },
      conversations: { status: "empty", source: [] },
      consents: { status: "empty" },
      flags: {
        has_policies: false,
        has_documents: false,
        has_memory: false,
        has_recent_conversation: false,
        has_consents: false,
        has_profile: false,
      },
      memory_version: 0,
      bundle: null,
      context_snapshot_id: null,
    };
    unifiedState = {
      policies: [],
      documents: [],
      policy_count: 0,
      document_count: 0,
      memory_fact_count: 0,
    };
    loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
    customerContextBundle = {};
  } else {
    try {
      const turnContext = await loadSalesDirectorTurnContext(
        userSupabase,
        scopedCustomerId,
        {
          requestHistory: history,
        },
      );
      contextSnapshot = turnContext.snapshot;
      unifiedState = turnContext.unifiedState;
      loadedContext = buildLoadedContextFromSnapshot(contextSnapshot);
      customerContextBundle = snapshotToContextBundle(contextSnapshot) ?? {};
    } catch (error) {
      return buildKeyMonopolyQuestionFailure({
        question,
        consultationIntent: classifyConsultationIntent(question),
        reason: "context_snapshot_load_failed",
        trace,
        startedAt,
      });
    }
  }

  // HomeChat Claude-first is the only question path.
  const conversationHistory = (history ?? [])
    .map((turn) => {
      const text = String(turn.content ?? turn.text ?? turn.message ?? "").trim();
      // Keep both fields: Claude-first payload uses `.text`; attach helpers dual-read content/text.
      return {
        role: turn.role === "assistant" ? "assistant" : "user",
        text,
        content: text,
      };
    })
    .filter((t) => t.text);
  return runClaudeFirstDirectQuestionTurn({
    question,
    history: conversationHistory,
    loadedContext,
    customerContextBundle,
    unifiedState,
    contextSnapshot,
    userSupabase,
    customerId: scopedCustomerId || null,
    authUserId,
    entityContext,
    attachedDocumentId,
    attachedDocumentIds,
    priorAttachFollowUp,
    attachmentReferenceEnabled,
    activeAttachmentIds,
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
    sessionId,
    readyCardHandoffToken,
    presenceTurn: presenceTurn === true,
    clientTurnId,
    pointedContractIds,
    phase8TraceBag,
    audience: resolvedAudience,
    conversationMode: resolvedConversationMode,
    keyRoleContract,
    env: coreEnv,
    fetchImpl,
    startedAt,
    streamHandlers,
    threadPublicCitations: readThreadPublicCitationsFromArgs(arguments[0]),
    threadVerifiedFactRefs: readThreadVerifiedFactRefsFromArgs(arguments[0]),
    threadHandoffMemo: readHandoffMemoFromArgs(arguments[0]),
  });
}
