/**
 * Hand Wiring Phase 2 — Preview KEY Runtime evidence (Tom merge gate).
 *
 * Usage:
 *   node scripts/key-hand-wiring-p2-key-runtime-preview-probe.mjs [preview-url] [--document=<uuid>]
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

const KEY_RUNTIME_SSOT = "runSalesDirectorKeyTurn";

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "key-hand-wiring-p2-key-runtime-preview-evidence.json");

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

function extractRuntimePayload(intakeTrace) {
  const steps = intakeTrace?.trace_steps ?? [];
  const runtimeStep = steps.find((row) => row.step === "key_runtime_entered");
  return runtimeStep?.payload ?? intakeTrace?.key_runtime_entered ?? null;
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
      upload_source: "hand_p2_key_runtime_preview_probe",
    },
  });

  const intakeTrace = intake.payload?.intake_trace ?? null;
  const steps = (intakeTrace?.trace_steps ?? []).map((row) => row.step);
  const runtimePayload = extractRuntimePayload(intakeTrace);
  const contextIdx = steps.indexOf("key_context_loaded");
  const runtimeIdx = steps.indexOf("key_runtime_entered");
  const judgmentIdx = steps.indexOf("key_first_judgment");

  const ku2bGate = validateKu2bJudgmentBeforeLegacy([
    ...(intakeTrace?.trace_steps ?? []),
    { step: "legacy_pipeline_continued" },
  ]);

  const checks = {
    intake_http_ok: intake.status === 200 && intake.payload?.ok !== false,
    intake_mode_active: intake.payload?.mode === "active",
    key_runtime_entered_present: runtimeIdx >= 0,
    primitive_is_ssot: runtimePayload?.primitive === KEY_RUNTIME_SSOT,
    key_entry_document_intake: runtimePayload?.key_entry === "document_intake",
    order_after_context: contextIdx >= 0 && runtimeIdx > contextIdx,
    order_before_judgment: judgmentIdx === -1 || runtimeIdx < judgmentIdx,
    p1_context_snapshot_id: Boolean(intakeTrace?.context_snapshot_id),
    ku2b_regression: ku2bGate.ok || judgmentIdx === -1,
  };

  const pass = Object.values(checks).every(Boolean);

  const evidence = {
    schema_version: "key-hand-wiring-p2-key-runtime-preview-evidence-v1",
    gate: "HAND-P2-KEY-RUNTIME",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    intake_http_status: intake.status,
    intake_mode: intake.payload?.mode ?? null,
    trace_steps: steps,
    key_runtime_entered: runtimePayload,
    tom_hand_p2_gate: {
      question: "Upload trace has key_runtime_entered: runSalesDirectorKeyTurn?",
      checks,
      result: pass ? "PASS" : "FAIL",
    },
    hand_p2_preview_pass: pass,
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[Hand Wiring P2 KEY Runtime Preview]");
  console.log(`key_runtime_entered.primitive: ${runtimePayload?.primitive ?? "null"}`);
  console.log(`trace order: ${steps.join(" → ")}`);
  console.log(`Tom Hand P2 gate: ${evidence.tom_hand_p2_gate.result}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`Hand P2 Preview pass: ${pass}`);

  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
