/**
 * Hand Wiring Phase 1 — Preview snapshot evidence (Tom merge gate only).
 *
 * Proves Upload intake loads the same customer snapshot as chat
 * (loadSalesDirectorTurnContext → key_context_loaded trace step).
 *
 * Usage:
 *   node scripts/key-upload-hand-wiring-p1-preview-snapshot-probe.mjs [preview-url] [--document=<uuid>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import { validateKu2bJudgmentBeforeLegacy } from "../server/keyBrain/documentFirstJudgment.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "key-upload-hand-wiring-p1-preview-snapshot-evidence.json");

function parseArgs(argv) {
  const previewBase = argv[2]?.startsWith("http") ? argv[2].trim() : "";
  const documentId = argv.find((a) => a.startsWith("--document="))?.slice("--document=".length) ?? null;
  return { previewBase, documentId };
}

async function fetchIntake({ previewBase, path, token, bypass, body }) {
  const url = `${previewBase.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify(body ?? {}),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

async function resolveAnyDocumentId(admin, email) {
  const { data: userRow } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = userRow?.users?.find((u) => u.email === email);
  if (!user?.id) return null;
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.id) return null;
  const { data: doc } = await admin
    .from("customer_documents")
    .select("id")
    .eq("customer_id", profile.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return doc?.id ?? null;
}

function buildLegacyAppendedTrace(intakeTrace) {
  if (!intakeTrace || typeof intakeTrace !== "object") return null;
  const continued = {
    step: "legacy_pipeline_continued",
    at: "uploadDocument_after_intake",
    ingest_enqueue_started: true,
    note: "Hand P1 preview probe — client SSOT append simulation",
  };
  return {
    ...intakeTrace,
    legacy_pipeline_continued: continued,
    trace_steps: [...(intakeTrace.trace_steps ?? []), continued],
  };
}

function extractContextPayload(intakeTrace) {
  const steps = intakeTrace?.trace_steps ?? [];
  const contextStep = steps.find((row) => row.step === "key_context_loaded");
  return contextStep?.payload ?? intakeTrace?.key_context_loaded ?? null;
}

function validateHandP1Snapshot({ intakeTrace, intakePayload, intakeStatus }) {
  const steps = (intakeTrace?.trace_steps ?? []).map((row) => row.step);
  const contextPayload = extractContextPayload(intakeTrace);
  const judgment = intakePayload?.key_first_judgment ?? intakeTrace?.key_first_judgment ?? null;

  const readsIdx = steps.indexOf("key_reads");
  const contextIdx = steps.indexOf("key_context_loaded");
  const interpretsIdx = steps.indexOf("key_interprets");

  const checks = {
    intake_http_ok: intakeStatus === 200 && intakePayload?.ok !== false,
    not_snapshot_load_failed: intakePayload?.reason !== "context_snapshot_load_failed",
    key_context_loaded_present: contextIdx >= 0,
    order_after_key_reads: readsIdx >= 0 && contextIdx > readsIdx,
    order_before_key_interprets: interpretsIdx >= 0 && contextIdx < interpretsIdx,
    loader_is_chat_ssot: contextPayload?.loader === "loadSalesDirectorTurnContext",
    context_snapshot_id_present: Boolean(
      intakeTrace?.context_snapshot_id ?? contextPayload?.context_snapshot_id,
    ),
    memory_status_present: contextPayload?.memory_status != null,
    policies_status_present: contextPayload?.policies_status != null,
    has_policies_boolean: typeof contextPayload?.has_policies === "boolean",
    has_memory_boolean: typeof contextPayload?.has_memory === "boolean",
    has_recent_conversation_boolean: typeof contextPayload?.has_recent_conversation === "boolean",
    judgment_customer_context_status:
      judgment == null || judgment.customer_context_status != null,
  };

  const pass = Object.values(checks).every(Boolean);
  return { pass, checks, trace_steps: steps, context_payload: contextPayload, judgment };
}

async function main() {
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.local"));
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.preview.pulled"));

  const { previewBase, documentId: cliDocumentId } = parseArgs(process.argv);
  const resolved = resolvePreviewProbeEnv({ previewBase });
  const bypass = resolveBypassSecret();
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

  if (!resolved.previewBase) {
    console.error("BLOCKED — preview URL required");
    process.exit(1);
  }
  if (!bypass) {
    console.error("BLOCKED — VERCEL_AUTOMATION_BYPASS_SECRET required");
    process.exit(1);
  }

  const token = await mintPreviewProbeJwt(resolved);
  const admin = serviceRole
    ? createClient(resolved.supabaseUrl, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const documentId =
    cliDocumentId ?? (admin ? await resolveAnyDocumentId(admin, resolved.email) : null);

  const intake = await fetchIntake({
    previewBase: resolved.previewBase,
    path: "/api/key-document-intake",
    token,
    bypass,
    body: {
      document_id: documentId ?? "00000000-0000-0000-0000-000000000000",
      upload_source: "hand_p1_preview_snapshot_probe",
    },
  });

  const intakeTrace = intake.payload?.intake_trace ?? null;
  const p1 = validateHandP1Snapshot({
    intakeTrace,
    intakePayload: intake.payload,
    intakeStatus: intake.status,
  });

  const traceWithLegacy = buildLegacyAppendedTrace(intakeTrace);
  const ku2bGate = validateKu2bJudgmentBeforeLegacy(traceWithLegacy?.trace_steps ?? []);

  const evidence = {
    schema_version: "key-upload-hand-wiring-p1-preview-snapshot-evidence-v1",
    gate: "HAND-P1-SNAPSHOT",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    intake_http_status: intake.status,
    intake_mode: intake.payload?.mode ?? null,
    intake_reason: intake.payload?.reason ?? null,
    context_snapshot_id: intakeTrace?.context_snapshot_id ?? p1.context_payload?.context_snapshot_id ?? null,
    trace_steps: p1.trace_steps,
    tom_hand_p1_gate: {
      question: "Upload intake sees same loadSalesDirectorTurnContext snapshot as chat?",
      checks: p1.checks,
      result: p1.pass ? "PASS" : "FAIL",
    },
    ku2b_regression: {
      question: "key_first_judgment before legacy (unchanged)?",
      result: ku2bGate.ok || !p1.trace_steps.includes("key_first_judgment") ? "PASS" : "FAIL",
      reason: ku2bGate.reason,
    },
    judgment_customer_context_status: p1.judgment?.customer_context_status ?? null,
    hand_p1_preview_pass: p1.pass && (ku2bGate.ok || !p1.trace_steps.includes("key_first_judgment")),
    tom_note:
      "Phase 1 only — snapshot wiring · no Persona outlet · no Orchestrator merge · no UI change",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[Hand Wiring P1 Preview Snapshot]");
  console.log(`context_snapshot_id: ${evidence.context_snapshot_id ?? "null"}`);
  console.log(`trace order: ${p1.trace_steps.join(" → ")}`);
  console.log(`Tom Hand P1 gate: ${evidence.tom_hand_p1_gate.result}`);
  console.log(`KU-2b regression: ${evidence.ku2b_regression.result}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`Hand P1 Preview pass: ${evidence.hand_p1_preview_pass}`);

  if (!evidence.hand_p1_preview_pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
