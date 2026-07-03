/**
 * KU-2b — Preview trace evidence (Tom merge gate only).
 *
 * Usage:
 *   node scripts/key-upload-ku2b-preview-trace-probe.mjs [preview-url] [--document=<uuid>]
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
const OUT = join(FIX, "key-upload-ku2b-preview-trace-evidence.json");

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
    note: "KU-2b preview probe — client SSOT append simulation",
  };
  return {
    ...intakeTrace,
    legacy_pipeline_continued: continued,
    trace_steps: [...(intakeTrace.trace_steps ?? []), continued],
  };
}

async function main() {
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.local"));

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
      upload_source: "ku2b_preview_trace_probe",
    },
  });

  const intakeTrace = intake.payload?.intake_trace ?? null;
  const traceWithLegacy = buildLegacyAppendedTrace(intakeTrace);
  const gate = validateKu2bJudgmentBeforeLegacy(traceWithLegacy?.trace_steps ?? []);
  const steps = (traceWithLegacy?.trace_steps ?? []).map((row) => row.step);

  const evidence = {
    schema_version: "key-upload-ku2b-preview-trace-evidence-v1",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    intake_http_status: intake.status,
    intake_mode: intake.payload?.mode ?? null,
    key_first_judgment_present: Boolean(intake.payload?.key_first_judgment ?? intakeTrace?.key_first_judgment),
    trace_steps: steps,
    tom_merge_gate: {
      question: "key_first_judgment before legacy_pipeline_continued?",
      result: gate.ok ? "PASS" : "FAIL",
      reason: gate.reason,
    },
    ku2b_preview_pass: gate.ok && Boolean(intake.payload?.key_first_judgment ?? intakeTrace?.key_first_judgment),
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[KU-2b Preview Trace]");
  console.log(`key_first_judgment present: ${evidence.key_first_judgment_present}`);
  console.log(`trace order: ${steps.join(" → ")}`);
  console.log(`Tom merge gate: ${evidence.tom_merge_gate.result}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`KU-2b Preview pass: ${evidence.ku2b_preview_pass}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
