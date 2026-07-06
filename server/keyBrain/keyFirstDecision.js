/**
 * KEY First Decision — KEY meets customer first; factories only on visit_factories.
 * S1 shadow: record only · no branching · no customer text change.
 */
import { isOneKeyCoreS1Enabled } from "../keyCore/oneKeyCoreFlags.js";

export const KEY_FIRST_DECISION_SCHEMA_VERSION = "key-first-decision-s1-v1";

export const KEY_FIRST_OUTCOMES = {
  ANSWER_NOW: "answer_now",
  ASK_FOLLOWUP: "ask_followup",
  USE_MEMORY_ONLY: "use_memory_only",
  VISIT_FACTORIES: "visit_factories",
  DEFER_UNTIL_FACTORY_DONE: "defer_until_factory_done",
};

export const KEY_FIRST_DECISION_MODES = {
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
};

export const KEY_FIRST_FACTORY_TOOLS = [
  "coverage_gap",
  "underwriting",
  "recommendation",
  "design",
  "rebalancing",
];

const PREMIUM_BURDEN_COMPANION_CLUSTER_ID = "JC-PREMIUM-BURDEN-v1";
const COVERAGE_ANXIETY_COMPANION_CLUSTER_ID = "JC-COVERAGE-ANXIETY-v1";
const RC_CONTINUITY_COMPANION_CLUSTER_ID = "RC-CONTINUITY-COMPANION-v1";
const RC_RECOGNITION_COMPANION_CLUSTER_ID = "RC-RECOGNITION-COMPANION-v1";

const TOOL_BRAIN_SLICE_INSURANCE_PRESENCE = "insurance_presence";
const TOOL_BRAIN_SLICE_PREMIUM_BURDEN = "premium_burden";

const COVERAGE_JUDGMENT_QUESTION_RE =
  /내\s*보험\s*괜찮|보험\s*괜찮|내\s*보장\s*괜찮|암\s*보험\s*부족|암보험\s*부족|암\s*부족|내\s*보험\s*부족|보험\s*부족한(?:\s*부분)?|부족한\s*부분\s*있|뭐가\s*빠져|빠져\s*있|빠진\s*(?:게|것|부분)/;

const UNDERWRITING_BOUND_QUESTION_RE =
  /(?:고혈압|당뇨|질병|건강(?:\s*상태)?|수술|입원|진단|혈압|투약|복용).{0,24}(?:가입\s*(?:가능|돼|되)|들\s*수|거절|인수)|(?:가입\s*(?:가능|돼|되)|들\s*수|거절(?:될|되)|인수).{0,24}(?:고혈압|당뇨|질병|건강|수술|입원|진단|혈압)|건강\s*상태.{0,12}거절|(?:암|실손|운전자|뇌|심장).{0,20}(?:들\s*수|지금\s*가입|새로\s*가입|가입\s*(?:가능|돼))|가입\s*(?:가능|돼|되)/;

const PRODUCT_MENTION_RE = /(?:암|실손|운전자|뇌|심장)/;

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function isDelegationIntentQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/(?:알아서|맡길|맡겨|전적으로)/.test(q) && /(?:봐|봐줘|해|해줘|보자|확인)/.test(q)) {
    return true;
  }
  if (/그냥\s*알아서/.test(q)) return true;
  if (/(?:제일\s*필요|나한테\s*제일).{0,16}(?:봐|보|확인)/.test(q)) return true;
  return false;
}

function matchToolBrainSliceQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;
  if (
    /내\s*보험\s*(있|가입|들)/.test(q) ||
    /보험\s*(있어|가입했|들었)/.test(q) ||
    q === "내 보험 있어"
  ) {
    return TOOL_BRAIN_SLICE_INSURANCE_PRESENCE;
  }
  if (/보험료.*(부담|비싼|비싸|높)/.test(q)) {
    return TOOL_BRAIN_SLICE_PREMIUM_BURDEN;
  }
  return null;
}

export function getKeyFirstDecisionMode(env = process.env) {
  const raw = String(env.KEY_FIRST_DECISION ?? "").trim().toLowerCase();
  if (raw === KEY_FIRST_DECISION_MODES.SHADOW) return KEY_FIRST_DECISION_MODES.SHADOW;
  if (raw === KEY_FIRST_DECISION_MODES.ACTIVE) return KEY_FIRST_DECISION_MODES.ACTIVE;
  return KEY_FIRST_DECISION_MODES.OFF;
}

export function isKeyFirstDecisionShadowEnabled(env = process.env) {
  return isOneKeyCoreS1Enabled(env) && getKeyFirstDecisionMode(env) === KEY_FIRST_DECISION_MODES.SHADOW;
}

export function isKeyFirstDecisionActiveEnabled(env = process.env) {
  return isOneKeyCoreS1Enabled(env) && getKeyFirstDecisionMode(env) === KEY_FIRST_DECISION_MODES.ACTIVE;
}

export function extractFactoryToolsFromPlan(plan = null) {
  const tools = plan?.tools ?? [];
  return tools.filter((tool) => KEY_FIRST_FACTORY_TOOLS.includes(tool));
}

function dedupeFactories(factories = []) {
  const seen = new Set();
  const ordered = [];
  for (const factory of factories) {
    if (!factory || seen.has(factory)) continue;
    seen.add(factory);
    ordered.push(factory);
  }
  return ordered;
}

function buildVisitFactoriesDecision({ factories = [], reason = "", matched_rule = "" } = {}) {
  return {
    schema_version: KEY_FIRST_DECISION_SCHEMA_VERSION,
    actor: "KEY",
    gate: "KEY-FIRST-S1-shadow",
    outcome: KEY_FIRST_OUTCOMES.VISIT_FACTORIES,
    factories: dedupeFactories(factories),
    factory_visit: true,
    reason,
    matched_rule,
    shadow_only: true,
  };
}

function buildSimpleDecision(outcome, { reason = "", matched_rule = "", factories = [] } = {}) {
  return {
    schema_version: KEY_FIRST_DECISION_SCHEMA_VERSION,
    actor: "KEY",
    gate: "KEY-FIRST-S1-shadow",
    outcome,
    factories: outcome === KEY_FIRST_OUTCOMES.VISIT_FACTORIES ? dedupeFactories(factories) : [],
    factory_visit: outcome === KEY_FIRST_OUTCOMES.VISIT_FACTORIES,
    reason,
    matched_rule,
    shadow_only: true,
  };
}

function resolveVisitFactories({ classification = {}, question = "" } = {}) {
  const intent = classification.intent ?? "";
  const subIntent = classification.lookup_sub_intent ?? null;
  const companion = classification.companion_cluster ?? null;
  const legacySlice = matchToolBrainSliceQuestion(question);
  const trimmed = String(question ?? "").trim();

  if (intent === "design_priority_check" || intent === "design_review_check") {
    return buildVisitFactoriesDecision({
      factories: ["design"],
      reason: "stored design read needed",
      matched_rule: "design_stored_read",
    });
  }

  if (intent === "recommendation_priority_check") {
    return buildVisitFactoriesDecision({
      factories: ["coverage_gap", "underwriting", "recommendation"],
      reason: "recommendation priority needs gap, uw, and stored reco context",
      matched_rule: "recommendation_priority_check",
    });
  }

  if (
    intent === "coverage_gap_check" ||
    intent === "coverage_review_request" ||
    companion === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID ||
    isDelegationIntentQuestion(trimmed) ||
    COVERAGE_JUDGMENT_QUESTION_RE.test(trimmed)
  ) {
    return buildVisitFactoriesDecision({
      factories: ["coverage_gap"],
      reason: "coverage judgment needs gap factory",
      matched_rule: "coverage_gap_visit",
    });
  }

  if (intent === "factual_lookup" && subIntent === "coverage_presence") {
    if (legacySlice === TOOL_BRAIN_SLICE_INSURANCE_PRESENCE) {
      return null;
    }
    return buildVisitFactoriesDecision({
      factories: ["coverage_gap"],
      reason: "coverage presence lookup needs gap context",
      matched_rule: "factual_coverage_presence",
    });
  }

  if (intent === "underwriting_bound_check" || UNDERWRITING_BOUND_QUESTION_RE.test(trimmed)) {
    const factories = ["underwriting"];
    if (PRODUCT_MENTION_RE.test(trimmed)) {
      factories.unshift("coverage_gap");
    }
    return buildVisitFactoriesDecision({
      factories,
      reason: "underwriting bound check needs uw context",
      matched_rule: "underwriting_bound_visit",
    });
  }

  return null;
}

/**
 * KEY autonomous first decision — shadow records what KEY would choose before acting.
 */
export function resolveKeyFirstDecision({
  question = "",
  consultationIntent = null,
  keyJudgment = null,
  loadedContext = null,
  thinkingBundle = null,
} = {}) {
  const classification = consultationIntent ?? { intent: "general_consultation" };
  const intent = classification.intent ?? "general_consultation";
  const subIntent = classification.lookup_sub_intent ?? null;
  const companion = classification.companion_cluster ?? null;
  const trimmed = String(question ?? "").trim();
  const hold = keyJudgment?.hold ?? interpretRecordHold(keyJudgment);

  if (intent === "recommendation_request" || intent === "design_request") {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.ASK_FOLLOWUP, {
      reason: "binding recommendation/design request — KEY clarifies before factory visit",
      matched_rule: "blocked_binding_intent",
    });
  }

  if (hold?.needed === true && (keyJudgment?.judgment_scope?.unknowable ?? []).length > 0) {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.ASK_FOLLOWUP, {
      reason: "KEY hold — scope not yet knowable",
      matched_rule: "judgment_hold",
    });
  }

  if (companion === RC_CONTINUITY_COMPANION_CLUSTER_ID) {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.USE_MEMORY_ONLY, {
      reason: "conversation continuity — memory sufficient",
      matched_rule: "rc_continuity_companion",
    });
  }

  if (intent === "claim_eligibility_check") {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.USE_MEMORY_ONLY, {
      reason: "claim eligibility — memory and snapshot sufficient",
      matched_rule: "claim_eligibility",
    });
  }

  const visit = resolveVisitFactories({ classification, question: trimmed });
  if (visit) {
    return visit;
  }

  if (
    intent === "casual_chat" ||
    intent === "policy_detail" ||
    intent === "general_consultation" ||
    companion === RC_RECOGNITION_COMPANION_CLUSTER_ID ||
    companion === PREMIUM_BURDEN_COMPANION_CLUSTER_ID ||
    (intent === "factual_lookup" &&
      (subIntent === "policy_count" || subIntent === "insurer" || subIntent === "premium_lookup")) ||
    matchToolBrainSliceQuestion(trimmed) === TOOL_BRAIN_SLICE_INSURANCE_PRESENCE ||
    matchToolBrainSliceQuestion(trimmed) === TOOL_BRAIN_SLICE_PREMIUM_BURDEN
  ) {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.ANSWER_NOW, {
      reason: "KEY can answer now without factory visit",
      matched_rule:
        intent === "casual_chat"
          ? "casual_chat"
          : subIntent === "premium_lookup"
            ? "premium_lookup"
            : "answer_without_factory",
    });
  }

  if (loadedContext?.memory === "present" && thinkingBundle?.four_inputs?.memory > 0) {
    return buildSimpleDecision(KEY_FIRST_OUTCOMES.USE_MEMORY_ONLY, {
      reason: "memory available — no factory visit required for this turn",
      matched_rule: "memory_fallback",
    });
  }

  return buildSimpleDecision(KEY_FIRST_OUTCOMES.ANSWER_NOW, {
    reason: "default — KEY answers without factory visit",
    matched_rule: "general_fallback",
  });
}

function interpretRecordHold(keyJudgment) {
  if (!keyJudgment || typeof keyJudgment !== "object") return { needed: false };
  return keyJudgment.hold ?? { needed: false };
}

export function buildKeyFirstDecisionShadowDiff({
  decision = null,
  legacyPlan = null,
} = {}) {
  const keyFactories = decision?.outcome === KEY_FIRST_OUTCOMES.VISIT_FACTORIES ? decision.factories ?? [] : [];
  const legacyFactories = extractFactoryToolsFromPlan(legacyPlan);
  const wouldSkip = legacyFactories.filter((factory) => !keyFactories.includes(factory));
  const wouldAdd = keyFactories.filter((factory) => !legacyFactories.includes(factory));
  return {
    schema_version: "key-first-decision-shadow-diff-s1-v1",
    shadow_only: true,
    key_first_outcome: decision?.outcome ?? null,
    key_first_factories: keyFactories,
    legacy_plan_factories: legacyFactories,
    would_skip_factories: wouldSkip,
    would_add_factories: wouldAdd,
    differs: wouldSkip.length > 0 || wouldAdd.length > 0,
    customer_text_changed: false,
    legacy_execution_unchanged: true,
  };
}
