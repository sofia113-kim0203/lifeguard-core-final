/**
 * KU-1 — KEY document intake shadow (upload → KEY before factory).
 * KU-2b — optional key_first_judgment trace step (no customer speak).
 */
import { buildKeyFirstJudgment } from "./documentFirstJudgment.js";
import { KEY_BRAIN_SHADOW_SCHEMA_VERSION } from "./shadowPlan.js";

export const KEY_DOCUMENT_INTAKE_SCHEMA_VERSION = "key-document-intake-ku1-v1";

const DOCUMENT_FIELDS = [
  "id",
  "original_filename",
  "ingest_status",
  "doc_class",
  "customer_hint_type",
  "mime_type",
  "metadata_json",
  "created_at",
];

function pickDocumentRow(document = {}) {
  const row = {};
  for (const key of DOCUMENT_FIELDS) {
    if (document[key] != null) row[key] = document[key];
  }
  return row;
}

function buildDispatchPlanShadow({ document = {}, hasAnalysisConsent = false }) {
  const workOrders = [];
  if (!hasAnalysisConsent) {
    return {
      actor: "KEY",
      executed: false,
      shadow_only: true,
      hold_reason: "analysis_consent_missing",
      factory_work_orders: [],
      deferred_factories: ["document_ocr", "policy_extract", "analysis_refresh"],
    };
  }

  workOrders.push({
    factory: "document_ocr",
    role: "KEY의_눈",
    mode: "peek_then_full_planned",
    scope: "metadata_first",
    reason: "first_orientation",
    limit: "filename_hint_mime_only_until_key_expands",
    ordered_by: "KEY",
    executed_in_ku1: false,
  });

  const hint = String(document.customer_hint_type ?? document.doc_class ?? "");
  if (/insurance|policy|certificate|coverage/i.test(hint)) {
    workOrders.push({
      factory: "policy_extract",
      scope: "contract_first_planned",
      reason: "coverage_orientation",
      limit: "contract_fields_only",
      ordered_by: "KEY",
      executed_in_ku1: false,
    });
  }

  workOrders.push({
    factory: "analysis_refresh",
    scope: "post_extract_refresh",
    reason: "unified_state_sync",
    limit: "document_linked_analysis_only",
    ordered_by: "KEY",
    executed_in_ku1: false,
  });

  return {
    actor: "KEY",
    executed: false,
    shadow_only: true,
    hold_reason: null,
    factory_work_orders: workOrders,
    gap_rec_auto_refresh: false,
    note: "KU-1 shadow — dispatch plan only · legacy pipeline continues separately",
  };
}

function buildInterpretShadow({ document = {}, hasAnalysisConsent = false }) {
  const filename = String(document.original_filename ?? "");
  const hint = String(document.customer_hint_type ?? "");
  const knowable = ["document_received"];
  const unknowable = [];
  const mustNotClaim = [];

  if (filename) knowable.push("filename_metadata");
  if (hint) knowable.push("customer_hint_type");

  if (!hasAnalysisConsent) {
    unknowable.push("document_body", "coverage", "gap", "recommendation");
    mustNotClaim.push("담보·Gap·추천 단정");
  } else {
    unknowable.push("document_body_before_key_read", "coverage_before_peek");
    mustNotClaim.push("OCR 결과를 KEY 없이 단정");
  }

  return {
    actor: "KEY",
    document_kind_guess: hint || "unknown_pending_peek",
    judgment_scope: { knowable, unknowable, must_not_claim: mustNotClaim },
    hold: {
      needed: !hasAnalysisConsent || unknowable.length > 0,
      other_document_request: null,
    },
    orient_speech_planned: {
      customer_visible_in_ku1: false,
      posture: !hasAnalysisConsent ? "hold_consent" : "provisional_metadata",
    },
  };
}

function buildReadsShadow({ document = {} }) {
  return {
    actor: "KEY",
    read_mode: "document_metadata_ku1",
    targets: [pickDocumentRow(document)],
    key_eyes_tools_planned: [
      {
        tool: "document_ocr",
        role: "KEY의_눈",
        invoke: "planned_after_ku2",
        note: "KEY reads — OCR extracts letters only",
      },
    ],
    prohibition: "OCR·Parser·Factory는 KEY의 눈과 손 — 판단 주체는 KEY",
  };
}

/**
 * Tom-required trace chain:
 * document_uploaded → key_intake_called → key_reads → key_interprets
 * → dispatch_plan_created → (legacy_pipeline_continued — appended by client after ingest)
 */
export function buildKeyDocumentIntakeShadowTrace({
  document = {},
  hasAnalysisConsent = false,
  uploadSource = "web",
  categoryKey = null,
  includeFirstJudgment = false,
} = {}) {
  const keyReads = buildReadsShadow({ document });
  const keyInterprets = buildInterpretShadow({ document, hasAnalysisConsent });
  const dispatchPlan = buildDispatchPlanShadow({ document, hasAnalysisConsent });

  const traceSteps = [
    {
      step: "document_uploaded",
      at: "uploadDocument_ssot",
      document_id: document.id ?? null,
      upload_source: uploadSource,
      category_key: categoryKey,
    },
    {
      step: "key_intake_called",
      at: "api/key-document-intake",
      mode: "shadow",
      subject: "KEY",
    },
    {
      step: "key_reads",
      actor: "KEY",
      payload: keyReads,
    },
    {
      step: "key_interprets",
      actor: "KEY",
      payload: keyInterprets,
    },
  ];

  let keyFirstJudgment = null;
  if (includeFirstJudgment) {
    keyFirstJudgment = buildKeyFirstJudgment({ document, keyInterprets });
    traceSteps.push({
      step: "key_first_judgment",
      actor: "KEY",
      gate: "KU-2b",
      payload: keyFirstJudgment,
    });
  }

  traceSteps.push({
    step: "dispatch_plan_created",
    actor: "KEY",
    payload: dispatchPlan,
  });

  return {
    schema_version: KEY_DOCUMENT_INTAKE_SCHEMA_VERSION,
    brain_schema_version: KEY_BRAIN_SHADOW_SCHEMA_VERSION,
    gate: includeFirstJudgment ? "KEY_UPLOAD_ACTIVE" : "KU-1",
    mode: "shadow",
    subject: "KEY",
    document_id: document.id ?? null,
    trace_steps: traceSteps,
    key_reads: keyReads,
    key_interprets: keyInterprets,
    key_first_judgment: keyFirstJudgment,
    dispatch_plan: dispatchPlan,
    legacy_pipeline_continued: null,
    factory_executed: false,
    customer_speak_changed: false,
  };
}

export function appendLegacyPipelineContinuedTrace(intakeTrace, { ingestStarted = true } = {}) {
  if (!intakeTrace || typeof intakeTrace !== "object") return intakeTrace;
  const continued = {
    step: "legacy_pipeline_continued",
    at: "uploadDocument_after_intake",
    ingest_enqueue_started: ingestStarted,
    note: "KU-1 shadow — existing enqueueDocumentIngest + pipeline unchanged",
  };
  return {
    ...intakeTrace,
    legacy_pipeline_continued: continued,
    trace_steps: [...(intakeTrace.trace_steps ?? []), continued],
  };
}
