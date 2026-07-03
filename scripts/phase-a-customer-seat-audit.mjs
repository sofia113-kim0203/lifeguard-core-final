/**
 * Phase A — 고객 좌석 최종 감사 Evidence (Observation only).
 * Jerry does NOT declare Phase A complete. Tom/진woo seat signoff required.
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
const OUT = join(FIX, "phase-a-customer-seat-audit-evidence.json");

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

  for (const query of [
    () =>
      client
        .from("customer_documents")
        .select("id")
        .eq("customer_id", profile.id)
        .eq("ingest_status", "ready")
        .filter("metadata_json->>policy_extraction_status", "eq", "completed")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    () =>
      client
        .from("customer_documents")
        .select("id")
        .eq("customer_id", profile.id)
        .eq("ingest_status", "ready")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    () =>
      client
        .from("customer_documents")
        .select("id")
        .eq("customer_id", profile.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
  ]) {
    const { data: doc } = await query();
    if (doc?.id) return doc.id;
  }
  return null;
}

function auditForbiddenSpeech(text = "") {
  const result = validateDu1CustomerSpeech(text);
  return { ok: result.ok, reason: result.reason ?? null, pattern: result.pattern ?? null };
}

function buildCustomerSeatSuccessMessage(firstSentence, followUpSentence) {
  if (firstSentence && followUpSentence) return `${firstSentence}\n\n${followUpSentence}`;
  return firstSentence ?? followUpSentence ?? null;
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
    upload_source: "phase_a_customer_seat_audit",
  });

  const firstSentence = intake.payload?.customer_first_sentence ?? null;
  const workOrderId = intake.payload?.work_order_id ?? null;
  const du1Fusion = intake.payload?.intake_trace?.du1_fusion ?? null;

  let followUpSentence = null;
  let extract = null;

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
  }

  const customerSeatMessage = buildCustomerSeatSuccessMessage(firstSentence, followUpSentence);
  const seatSpeechAudit = customerSeatMessage
    ? auditForbiddenSpeech(customerSeatMessage)
    : { ok: false, reason: "customer_seat_message_missing" };

  const evidence = {
    schema_version: "phase-a-customer-seat-audit-evidence-v1",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    customer_seat_success_message: customerSeatMessage,
    customer_seat_first_explanation: firstSentence,
    customer_seat_follow_up: followUpSentence,
    forbidden_word_count: seatSpeechAudit.ok ? 0 : 1,
    forbidden_word_hits: seatSpeechAudit.ok ? [] : [{ surface: "customer_seat", ...seatSpeechAudit }],
    du1_fusion: du1Fusion,
    extract_http_status: extract?.status ?? null,
    extract_ok: extract?.payload?.ok ?? null,
    jerry_pass_declaration: "none",
    tom_seat_audit_status: "pending",
    phase_a_completion_status: "awaiting_customer_seat_final_audit",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase A Customer Seat Audit — observation only]");
  console.log(`customer_seat_message: ${customerSeatMessage ? "present" : "(missing)"}`);
  console.log(`forbidden_word_count: ${evidence.forbidden_word_count}`);
  console.log(`Evidence: ${OUT}`);
  console.log("Tom/진woo seat signoff: pending — Jerry does not declare Phase A complete");

  if (!customerSeatMessage || !seatSpeechAudit.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
