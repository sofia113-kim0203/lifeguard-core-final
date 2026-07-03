/**
 * Phase A — Preview upload first-speak + post-extract follow-up evidence.
 * Tom gate: first sentence, follow-up, forbidden-word 0.
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
import { validateDu1CustomerSpeech } from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-a-preview-speak-evidence.json");

function parseArgs(argv) {
  const previewBase = argv[2]?.startsWith("http") ? argv[2].trim() : "";
  const documentId = argv.find((a) => a.startsWith("--document="))?.slice("--document=".length) ?? null;
  return { previewBase, documentId };
}

async function resolveProbeDocumentId(admin, email) {
  const { data: userRow } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = userRow?.users?.find((u) => u.email === email);
  if (!user?.id) return null;
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data: readyDoc } = await admin
    .from("customer_documents")
    .select("id, ingest_status, metadata_json")
    .eq("customer_id", profile.id)
    .eq("ingest_status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readyDoc?.id) return readyDoc.id;

  const { data: anyDoc } = await admin
    .from("customer_documents")
    .select("id")
    .eq("customer_id", profile.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return anyDoc?.id ?? null;
}

function auditForbiddenSpeech(text = "") {
  const result = validateDu1CustomerSpeech(text);
  return {
    ok: result.ok,
    reason: result.reason ?? null,
    pattern: result.pattern ?? null,
  };
}

async function postJson(base, path, token, bypass, body) {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function main() {
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.local"));
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.preview.pulled"));
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
    cliDocumentId ?? (admin ? await resolveProbeDocumentId(admin, resolved.email) : null);

  const intake = await postJson(resolved.previewBase, "/api/key-document-intake", token, bypass, {
    document_id: documentId ?? "00000000-0000-0000-0000-000000000000",
    upload_source: "phase_a_preview_speak_probe",
  });

  const firstSentence = intake.payload?.customer_first_sentence ?? null;
  const firstAudit = auditForbiddenSpeech(firstSentence ?? "");

  let extract = null;
  let followUpSentence = null;
  let followUpAudit = { ok: true, reason: "skipped" };

  if (documentId) {
    extract = await postJson(
      resolved.previewBase,
      "/api/customer-document-policy-extract",
      token,
      bypass,
      { document_id: documentId, invoke_memory: true },
    );
    followUpSentence = extract.payload?.key_follow_up_sentence ?? null;
    followUpAudit = followUpSentence
      ? auditForbiddenSpeech(followUpSentence)
      : { ok: false, reason: "follow_up_missing" };
  }

  const forbiddenHits = [];
  if (!firstAudit.ok) forbiddenHits.push({ surface: "first_sentence", ...firstAudit });
  if (!followUpAudit.ok && followUpAudit.reason !== "skipped") {
    forbiddenHits.push({ surface: "follow_up_sentence", ...followUpAudit });
  }

  const evidence = {
    schema_version: "phase-a-preview-speak-evidence-v1",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    customer_first_sentence: firstSentence,
    key_follow_up_sentence: followUpSentence,
    forbidden_word_hits: forbiddenHits,
    forbidden_word_count: forbiddenHits.length,
    intake_http_status: intake.status,
    extract_http_status: extract?.status ?? null,
    extract_ok: extract?.payload?.ok ?? null,
    tom_preview_gate: {
      first_sentence_present: Boolean(firstSentence),
      follow_up_present: Boolean(followUpSentence),
      forbidden_word_zero: forbiddenHits.length === 0,
    },
    phase_a_preview_pass:
      Boolean(firstSentence) &&
      Boolean(followUpSentence) &&
      forbiddenHits.length === 0,
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase A Preview Speak]");
  console.log(`first_sentence: ${firstSentence ?? "(null)"}`);
  console.log(`follow_up: ${followUpSentence ?? "(null)"}`);
  console.log(`forbidden_word_count: ${forbiddenHits.length}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`Phase A Preview pass: ${evidence.phase_a_preview_pass}`);

  if (!evidence.phase_a_preview_pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
