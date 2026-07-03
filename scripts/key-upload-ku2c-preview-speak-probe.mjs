/**
 * KU-2c — Preview first-speak evidence (Tom gate: customer hears KEY first).
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
import { validateKu2cSpeakOrder, DOCUMENT_INTAKE_PERSONA_OUTLET } from "../server/keyBrain/documentFirstSpeak.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "key-upload-ku2c-preview-speak-evidence.json");

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
      upload_source: "ku2c_preview_speak_probe",
    }),
  });
  const payload = await res.json().catch(() => ({}));
  const sentence = payload?.customer_first_sentence ?? null;
  const trace = payload?.intake_trace ?? null;
  const speakOrder = validateKu2cSpeakOrder(trace?.trace_steps ?? []);
  const speakStep = (trace?.trace_steps ?? []).find((row) => row?.step === "key_first_speak");
  const personaOutlet =
    speakStep?.payload?.persona_outlet ?? trace?.persona_outlet ?? null;
  const personaOutletPass = personaOutlet === DOCUMENT_INTAKE_PERSONA_OUTLET;

  const evidence = {
    schema_version: "key-upload-ku2c-preview-speak-evidence-v1",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    intake_http_status: res.status,
    intake_mode: payload?.mode ?? null,
    customer_first_sentence: sentence,
    customer_speak_changed: payload?.customer_speak_changed ?? null,
    persona_outlet: personaOutlet,
    generation_mode: speakStep?.payload?.generation_mode ?? null,
    subject: payload?.subject ?? null,
    tom_preview_gate: {
      question: "업로드 직후 고객이 처음 듣는 문장이 KEY인가?",
      api_sentence_is_key:
        Boolean(sentence) && /KEY/.test(sentence) && payload?.subject === "KEY" ? "PASS" : "FAIL",
      speak_trace_order: speakOrder.ok ? "PASS" : "FAIL",
      persona_outlet: personaOutletPass ? "PASS" : "FAIL",
    },
    ku2c_preview_pass:
      Boolean(sentence) &&
      /KEY/.test(sentence) &&
      payload?.subject === "KEY" &&
      speakOrder.ok &&
      personaOutletPass,
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[KU-2c Preview Speak]");
  console.log(`customer_first_sentence: ${sentence ?? "(null)"}`);
  console.log(`Tom gate: ${evidence.tom_preview_gate.api_sentence_is_key}`);
  console.log(`Persona outlet: ${personaOutlet ?? "(null)"} — ${evidence.tom_preview_gate.persona_outlet}`);
  console.log(`Evidence: ${OUT}`);
  console.log(`KU-2c Preview pass: ${evidence.ku2c_preview_pass}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
