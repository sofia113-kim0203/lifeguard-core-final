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

async function ensureAnalysisConsent(resolved) {
  const client = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await client.auth.signInWithPassword({
    email: resolved.email,
    password: resolved.password,
  });
  if (authError) return { client: null, error: authError.message };

  const { data: existing } = await client
    .from("customer_consents")
    .select("id")
    .eq("consent_type", "document_analysis")
    .eq("granted", true)
    .limit(1)
    .maybeSingle();
  if (!existing) {
    const { error: grantError } = await client.rpc("lifeguard_grant_document_analysis_consent", {
      p_consent_version: "2026-06-07-ko-doc-analysis",
    });
    if (grantError) return { client: null, error: grantError.message };
  }

  const { data: storageConsent } = await client
    .from("customer_consents")
    .select("id")
    .eq("consent_type", "document_storage")
    .eq("granted", true)
    .limit(1)
    .maybeSingle();
  if (!storageConsent) {
    const { data: profile } = await client
      .from("customer_profiles")
      .select("id")
      .eq("user_id", (await client.auth.getUser()).data.user?.id ?? "")
      .maybeSingle();
    if (profile?.id) {
      await client.from("customer_consents").insert({
        customer_id: profile.id,
        consent_type: "document_storage",
        consent_version: "2026-06-07-ko-doc-storage",
        granted: true,
        granted_at: new Date().toISOString(),
        source: "phase_a_preview_probe",
        purpose: "고객 문서 보관",
        required: true,
      });
    }
  }
  return { client, error: null };
}

async function resolveProbeDocumentIdViaUserJwt(resolved, userClient = null) {
  let client = userClient;
  let userId = null;

  if (!client) {
    client = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.signInWithPassword({
      email: resolved.email,
      password: resolved.password,
    });
    if (authError || !auth.user?.id) return null;
    userId = auth.user.id;
  } else {
    const { data: userData } = await client.auth.getUser();
    userId = userData.user?.id ?? null;
    if (!userId) return null;
  }

  const { data: profile } = await client
    .from("customer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data: completedDoc } = await client
    .from("customer_documents")
    .select("id")
    .eq("customer_id", profile.id)
    .eq("ingest_status", "ready")
    .filter("metadata_json->>policy_extraction_status", "eq", "completed")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (completedDoc?.id) return completedDoc.id;

  const { data: readyDoc } = await client
    .from("customer_documents")
    .select("id")
    .eq("customer_id", profile.id)
    .eq("ingest_status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readyDoc?.id) return readyDoc.id;

  const { data: anyDoc } = await client
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
  const bypass = resolveBypassSecret();
  const resolved = resolvePreviewProbeEnv({ previewBase });

  if (!resolved.previewBase || !bypass) {
    console.error("BLOCKED — preview URL and bypass required");
    process.exit(1);
  }

  const token = await mintPreviewProbeJwt(resolved);
  const consent = await ensureAnalysisConsent(resolved);
  if (consent.error) {
    console.error(`BLOCKED — analysis consent: ${consent.error}`);
    process.exit(1);
  }

  const documentId =
    cliDocumentId ?? (await resolveProbeDocumentIdViaUserJwt(resolved, consent.client));

  const intake = await postJson(resolved.previewBase, "/api/key-document-intake", token, bypass, {
    document_id: documentId ?? "00000000-0000-0000-0000-000000000000",
    upload_source: "phase_a_preview_speak_probe",
  });

  const firstSentence = intake.payload?.customer_first_sentence ?? null;
  const workOrderId = intake.payload?.work_order_id ?? null;
  const firstAudit = firstSentence
    ? auditForbiddenSpeech(firstSentence)
    : { ok: true, reason: "sentence_missing" };

  let extract = null;
  let followUpSentence = null;
  let followUpAudit = { ok: true, reason: "skipped" };

  if (documentId) {
    extract = await postJson(
      resolved.previewBase,
      "/api/customer-document-policy-extract",
      token,
      bypass,
      {
        document_id: documentId,
        invoke_memory: true,
        ...(workOrderId ? { work_order_id: workOrderId } : {}),
      },
    );
    followUpSentence = extract.payload?.key_follow_up_sentence ?? null;
    followUpAudit = followUpSentence
      ? auditForbiddenSpeech(followUpSentence)
      : { ok: false, reason: "follow_up_missing" };
  }

  const forbiddenHits = [];
  if (firstSentence && !firstAudit.ok) forbiddenHits.push({ surface: "first_sentence", ...firstAudit });
  if (followUpSentence && !followUpAudit.ok) {
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
    intake_reason: intake.payload?.reason ?? null,
    work_order_id: workOrderId,
    extract_http_status: extract?.status ?? null,
    extract_ok: extract?.payload?.ok ?? null,
    extract_reason: extract?.payload?.reason ?? null,
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
