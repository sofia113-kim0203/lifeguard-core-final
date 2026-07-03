/**
 * Hand Wiring Phase 3 — Preview Persona outlet evidence (Tom merge gate).
 *
 * Usage:
 *   node scripts/key-hand-wiring-p3-persona-outlet-preview-probe.mjs [preview-url] [--document=<uuid>]
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
import {
  DOCUMENT_INTAKE_PERSONA_OUTLET,
  validateKu2cSpeakOrder,
} from "../server/keyBrain/documentFirstSpeak.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "key-hand-wiring-p3-persona-outlet-preview-evidence.json");

function parseArgs(argv) {
  const previewBase = argv[2]?.startsWith("http") ? argv[2].trim() : "";
  const documentId = argv.find((a) => a.startsWith("--document="))?.slice("--document=".length) ?? null;
  return { previewBase, documentId };
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

async function main() {
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.local"));
  const { previewBase, documentId: cliDocumentId } = parseArgs(process.argv);
  const resolved = resolvePreviewProbeEnv({ previewBase });
  const bypass = resolveBypassSecret();
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

  if (!resolved.previewBase || !bypass) {
    console.error("BLOCKED — preview URL and bypass required");
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

  const res = await fetch(`${resolved.previewBase.replace(/\/$/, "")}/api/key-document-intake`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify({
      document_id: documentId ?? "00000000-0000-0000-0000-000000000000",
      upload_source: "hand_p3_persona_outlet_preview_probe",
    }),
  });
  const payload = await res.json().catch(() => ({}));
  const trace = payload?.intake_trace ?? null;
  const speakStep = (trace?.trace_steps ?? []).find((row) => row?.step === "key_first_speak");
  const personaOutlet =
    payload?.persona_outlet ??
    speakStep?.payload?.persona_outlet ??
    trace?.persona_outlet ??
    null;
  const generationMode = speakStep?.payload?.generation_mode ?? null;
  const staticDraft = speakStep?.payload?.static_draft ?? null;
  const speakOrder = validateKu2cSpeakOrder(trace?.trace_steps ?? []);

  const checks = {
    intake_http_ok: res.status === 200,
    intake_mode_active: payload?.mode === "active",
    customer_sentence_present: Boolean(payload?.customer_first_sentence),
    subject_is_key: payload?.subject === "KEY",
    persona_outlet_finalize: personaOutlet === DOCUMENT_INTAKE_PERSONA_OUTLET,
    generation_mode_persona: generationMode === "document_intake_persona_outlet",
    static_draft_on_trace: Boolean(staticDraft),
    speak_trace_order: speakOrder.ok,
    work_order_unchanged: Boolean(payload?.work_order_id),
  };

  const pass = Object.values(checks).every(Boolean);

  const evidence = {
    schema_version: "key-hand-wiring-p3-persona-outlet-preview-evidence-v1",
    gate: "HAND-P3-PERSONA-OUTLET",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    intake_http_status: res.status,
    intake_mode: payload?.mode ?? null,
    customer_first_sentence: payload?.customer_first_sentence ?? null,
    persona_outlet: personaOutlet,
    generation_mode: generationMode,
    static_draft: staticDraft,
    work_order_id: payload?.work_order_id ?? null,
    tom_hand_p3_gate: {
      question: "Upload 첫 문장이 static template가 아니라 Persona 출구를 통과했는가?",
      checks,
      result: pass ? "PASS" : "FAIL",
    },
    hand_p3_preview_pass: pass,
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Hand P3 Persona Outlet Preview]");
  console.log(`persona_outlet: ${personaOutlet ?? "(null)"}`);
  console.log(`generation_mode: ${generationMode ?? "(null)"}`);
  console.log(`Tom gate: ${evidence.tom_hand_p3_gate.result}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`Hand P3 Preview pass: ${pass}`);
  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
