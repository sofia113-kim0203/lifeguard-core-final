/**
 * KB-0 — KEY Brain shadow plan (HOOK-A).
 * KEY is always the subject: reads · interprets · dispatches · synthesizes.
 * Shadow only — no customer output · no factory invoke · no preload reorder.
 */
import {
  classifyConsultationIntent,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  RC_CONTINUITY_COMPANION_CLUSTER_ID,
  RC_RECOGNITION_COMPANION_CLUSTER_ID,
} from "../intentGateLayer.js";
import { planKeyTools } from "../salesDirectorKeyToolRegistry.js";

export const KEY_BRAIN_SHADOW_SCHEMA_VERSION = "key-brain-shadow-kb0-v1";

const SHADOW_MS_BUDGET = 5;
const LEGACY_PRELOAD = ["coverage_gap", "underwriting", "recommendation", "design"];

const DOCUMENT_INVENTORY_FIELDS = [
  "id",
  "original_filename",
  "ingest_status",
  "doc_class",
  "customer_hint_type",
  "created_at",
];

function pickDocumentInventory(documents = []) {
  return (documents ?? []).slice(0, 10).map((doc) => {
    const row = {};
    for (const key of DOCUMENT_INVENTORY_FIELDS) {
      if (doc?.[key] != null) row[key] = doc[key];
    }
    return row;
  });
}

function recommendPreload(classification = {}) {
  const intent = classification.intent ?? "";
  if (intent === "casual_chat") return [];
  const cluster = classification.companion_cluster ?? null;
  if (cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID) return ["memory"];
  if (cluster === RC_RECOGNITION_COMPANION_CLUSTER_ID) return [];
  if (cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) return [];
  if (cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) return ["coverage_gap"];
  return [...LEGACY_PRELOAD];
}

function buildKeyEyesToolsPlanned(documents = []) {
  if (!documents.length) return [];
  const needsOcr = documents.some(
    (doc) => String(doc?.ingest_status ?? "").toLowerCase() !== "ready",
  );
  return [
    {
      tool: "document_ocr",
      role: "KEY의_눈",
      invoke: needsOcr ? "planned_kb1_full_read" : "planned_kb1_peek",
      note: "OCR extracts letters — KEY reads and interprets",
    },
  ];
}

function buildJudgmentScope({ documents = [], loadedContext = null, classification = {} }) {
  const knowable = [];
  const unknowable = [];
  const mustNotClaim = [];

  if (loadedContext?.has_policies) knowable.push("가입 보험 존재(메타)");
  else unknowable.push("가입 보험 구조");

  if (documents.length > 0) {
    knowable.push("등록된 서류 존재(메타)");
    const notReady = documents.filter(
      (doc) => String(doc?.ingest_status ?? "").toLowerCase() !== "ready",
    );
    if (notReady.length > 0) {
      unknowable.push("서류 본문·담보·금액");
      mustNotClaim.push("담보·Gap·추천 단정");
    } else {
      unknowable.push("서류 본문 확인 전 담보·특약 단정");
      mustNotClaim.push("OCR 결과를 KEY 없이 단정");
    }
  }

  const intent = classification.intent ?? "";
  if (intent === "coverage_gap_check" || intent === "coverage_review_request") {
    mustNotClaim.push("Gap 분석 완료 전 충분/부족 단정");
  }

  return { knowable, unknowable, must_not_claim: mustNotClaim };
}

function buildOrientSpeechPlan({ judgmentScope = {}, documents = [] }) {
  const parts = [];
  if (judgmentScope.knowable?.length) {
    parts.push(`확인된 것: ${judgmentScope.knowable.slice(0, 2).join(", ")}`);
  }
  if (judgmentScope.unknowable?.length) {
    parts.push(`아직 말하지 않을 것: ${judgmentScope.unknowable.slice(0, 2).join(", ")}`);
  }
  if (documents.some((d) => String(d?.ingest_status ?? "") !== "ready")) {
    parts.push("다른서류요청 후보: ingest 미완 — KEY가 읽기 전");
  }
  return {
    actor: "KEY",
    customer_visible_in_kb0: false,
    planned_lines: parts,
  };
}

function buildFactoryWorkOrders(recommendedTools = [], documents = []) {
  return recommendedTools
    .filter((tool) => tool !== "snapshot" && tool !== "memory")
    .map((tool) => ({
      factory: tool,
      ordered_by: "KEY",
      scope: documents.length > 0 ? "scoped_after_key_read_kb1" : "stored_read_only_kb0",
      executed_in_kb0: false,
    }));
}

function buildShadowDiff(classification, shadowTools, recommendedPreload, loadedContext, question) {
  const legacyPlan = planKeyTools(classification, loadedContext, question);
  const legacyTools = [...(legacyPlan.tools ?? [])].sort();
  const shadowSorted = [...shadowTools].sort();
  const toolsMatch =
    legacyTools.length === shadowSorted.length &&
    legacyTools.every((tool, index) => tool === shadowSorted[index]);

  return {
    intent_parity: {
      shadow: classification.intent ?? null,
      legacy: classification.intent ?? null,
      match: true,
    },
    tools_parity: {
      shadow: shadowSorted,
      legacy: legacyTools,
      match: toolsMatch,
    },
    preload_would_change: {
      shadow_recommended: recommendedPreload,
      legacy_actual: LEGACY_PRELOAD,
      strict_subset: recommendedPreload.length < LEGACY_PRELOAD.length,
    },
  };
}

/**
 * Build KEY Brain shadow plan. Never throws — returns failed plan on error.
 */
export function buildKeyBrainShadowPlan(params = {}) {
  const {
    question = "",
    history = [],
    loadedContext = null,
    unified = null,
    customerId = null,
  } = params ?? {};
  const startedAt = Date.now();
  try {
    const trimmedQuestion = String(question ?? "").replace(/\s+/g, " ").trim();
    const classification = classifyConsultationIntent(trimmedQuestion);
    const documents = pickDocumentInventory(loadedContext?.documents ?? []);
    const policies = loadedContext?.policies ?? [];
    const recommendedPreload = recommendPreload(classification);
    const legacyPlan = planKeyTools(classification, loadedContext, trimmedQuestion);
    const recommendedTools = legacyPlan.tools ?? [];
    const judgmentScope = buildJudgmentScope({
      documents,
      loadedContext,
      classification,
    });

    const primaryInputType =
      documents.length > 0
        ? trimmedQuestion
          ? "question_plus_document_metadata"
          : "document_metadata_only"
        : trimmedQuestion
          ? "question_only"
          : "empty";

    const plan = {
      schema_version: KEY_BRAIN_SHADOW_SCHEMA_VERSION,
      hook: "HOOK-A",
      gate: "KB-0",
      subject: "KEY",
      key_reads: {
        actor: "KEY",
        read_mode: documents.length > 0 ? "document_metadata" : "state_and_question",
        targets: documents,
        key_eyes_tools_planned: buildKeyEyesToolsPlanned(documents),
        prohibition: "OCR·Parser·Factory는 KEY의 눈과 손 — 판단 주체는 KEY",
      },
      key_interprets: {
        actor: "KEY",
        primary_input_type: primaryInputType,
        judgment_scope: judgmentScope,
        hold: {
          needed: judgmentScope.unknowable.length > 0 && documents.length > 0,
          other_document_request: null,
          reason: documents.length > 0 ? "KB-0 — 본문 read 전 scope only" : null,
        },
      },
      key_orient_speech_plan: buildOrientSpeechPlan({ judgmentScope, documents }),
      key_dispatches: {
        actor: "KEY",
        factory_work_orders: buildFactoryWorkOrders(recommendedTools, documents),
        preload_shadow_recommendation: recommendedPreload,
        legacy_preload_actual: LEGACY_PRELOAD,
        executed_in_kb0: false,
      },
      key_synthesize_plan: {
        actor: "KEY",
        after_factories: true,
        customer_visible_in_kb0: false,
        hand_alignment_check: judgmentScope.must_not_claim.length ? "medium" : "low",
      },
      nine_steps: {
        S1_question_understanding: {
          surface_question: trimmedQuestion,
          baseline_intent: classification.intent ?? null,
          lookup_sub_intent: classification.lookup_sub_intent ?? null,
          companion_cluster: classification.companion_cluster ?? null,
        },
        S2_input_context: {
          primary_input_type: primaryInputType,
          document_inventory: documents,
          conversation_continuity: (history?.length ?? 0) > 0 ? "follow_up" : "new_topic",
        },
        S3_situation: {
          policy_presence: policies.length > 0 ? "present" : "none",
          memory_presence: loadedContext?.has_memory ? "present" : "none",
          document_presence: documents.length > 0 ? "present" : "none",
        },
        S4_available_information: {
          policies_count: policies.length,
          documents_count: documents.length,
          memory_fact_count: unified?.memory_fact_count ?? loadedContext?.memoryFactCount ?? 0,
          profile_present: Boolean(unified?.profile?.display_name),
        },
        S5_factory_selection: {
          recommended_tools: recommendedTools,
          recommended_preload: recommendedPreload,
          rationale: "KB-0 shadow mirrors planKeyTools for diff — KEY orders factories",
        },
        S6_interim_judgment: {
          confirmed_facts: judgmentScope.knowable,
          must_not_claim: judgmentScope.must_not_claim,
        },
        S7_additional_factory: {
          needed: recommendedTools.length > 2,
          trigger_reason: recommendedTools.length > 2 ? "multi_factory_plan" : null,
        },
        S8_final_judgment: {
          speak_posture: judgmentScope.unknowable.length ? "partial" : "ready",
          judgment_owner: "KEY",
        },
        S9_explanation_plan: {
          note: "HUL compose unchanged in KB-0",
          explain_owner: "KEY",
        },
      },
      diff: buildShadowDiff(
        classification,
        recommendedTools,
        recommendedPreload,
        loadedContext,
        trimmedQuestion,
      ),
      meta: {
        shadow_ms: Math.max(0, Date.now() - startedAt),
        planner: "rule_v1",
        customer_id_present: Boolean(customerId),
        failed: false,
        failed_reason: null,
      },
    };

    if (plan.meta.shadow_ms > SHADOW_MS_BUDGET) {
      plan.meta.budget_warning = "exceeded_5ms_target";
    }

    return plan;
  } catch (error) {
    return {
      schema_version: KEY_BRAIN_SHADOW_SCHEMA_VERSION,
      hook: "HOOK-A",
      gate: "KB-0",
      subject: "KEY",
      meta: {
        shadow_ms: Math.max(0, Date.now() - startedAt),
        planner: "rule_v1",
        failed: true,
        failed_reason: String(error?.message ?? error ?? "unknown"),
      },
    };
  }
}
