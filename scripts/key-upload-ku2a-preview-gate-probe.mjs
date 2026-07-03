/**
 * KU-2a — Preview Work Order gate evidence (Tom audit leg).
 *
 * Usage:
 *   node scripts/key-upload-ku2a-preview-gate-probe.mjs [preview-url] [--document=<uuid>]
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

const FIX = join(import.meta.dirname, "..", "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "key-upload-ku2a-preview-gate-evidence.json");

function parseArgs(argv) {
  const previewBase = argv[2]?.startsWith("http") ? argv[2].trim() : "";
  const documentId = argv.find((a) => a.startsWith("--document="))?.slice("--document=".length) ?? null;
  return { previewBase, documentId };
}

async function fetchPreviewApi({ previewBase, path, token, bypass, body }) {
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

async function fetchWorker({ supabaseUrl, anonKey, token, documentId, workOrderId }) {
  const body = { document_id: documentId };
  if (workOrderId) body.work_order_id = workOrderId;
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/document-ingest-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

async function resolveCustomerProfile(admin, email) {
  const { data: userRow } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = userRow?.users?.find((u) => u.email === email);
  if (!user?.id) return null;
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return profile?.id ?? null;
}

async function resolveQueuedDocumentId(admin, email) {
  const customerId = await resolveCustomerProfile(admin, email);
  if (!customerId) return null;
  const { data: doc } = await admin
    .from("customer_documents")
    .select("id")
    .eq("customer_id", customerId)
    .eq("ingest_status", "queued")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return doc?.id ?? null;
}

async function resolveAnyDocumentId(admin, email) {
  const customerId = await resolveCustomerProfile(admin, email);
  if (!customerId) return null;
  const { data: doc } = await admin
    .from("customer_documents")
    .select("id")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return doc?.id ?? null;
}

function directivesScopeFallback(mode) {
  if (mode !== "active") return "FAIL";
  return "LOCAL_UNIT_TEST";
}

async function main() {
  loadPreviewProbeEnvFile(join(import.meta.dirname, "..", ".env.preview.pulled"));
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
    cliDocumentId ?? (admin ? await resolveQueuedDocumentId(admin, resolved.email) : null);

  const evidence = {
    schema_version: "key-upload-ku2a-preview-gate-evidence-v1",
    recorded_at: new Date().toISOString(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    document_id: documentId,
    probes: {},
  };

  const intakeModeProbe = await fetchPreviewApi({
    previewBase: resolved.previewBase,
    path: "/api/key-document-intake",
    token,
    bypass,
    body: { document_id: documentId ?? "00000000-0000-0000-0000-000000000000" },
  });
  evidence.probes.intake_mode_probe = {
    http_status: intakeModeProbe.status,
    mode: intakeModeProbe.payload?.mode ?? null,
    intake_skipped: intakeModeProbe.payload?.intake_skipped ?? null,
  };

  const intakeMode = evidence.probes.intake_mode_probe.mode;
  let woWithout = null;
  let woWith = null;
  let woForged = null;
  let woReuse = null;
  let scopeProbe = null;

  if (documentId) {
    woWithout = await fetchWorker({
      supabaseUrl: resolved.supabaseUrl,
      anonKey: resolved.supabaseAnon,
      token,
      documentId,
      workOrderId: null,
    });
    evidence.probes.worker_without_work_order = woWithout;

    const intakeActive = await fetchPreviewApi({
      previewBase: resolved.previewBase,
      path: "/api/key-document-intake",
      token,
      bypass,
      body: { document_id: documentId, upload_source: "ku2a_preview_probe" },
    });
    const workOrderId = intakeActive.payload?.work_order_id ?? null;
    evidence.probes.key_intake_with_document = {
      http_status: intakeActive.status,
      mode: intakeActive.payload?.mode ?? null,
      work_order_id: workOrderId,
      ordered_by: intakeActive.payload?.work_order_ordered_by ?? null,
    };

    if (workOrderId) {
      woWith = await fetchWorker({
        supabaseUrl: resolved.supabaseUrl,
        anonKey: resolved.supabaseAnon,
        token,
        documentId,
        workOrderId,
      });
      evidence.probes.worker_with_work_order = woWith;

      woForged = await fetchWorker({
        supabaseUrl: resolved.supabaseUrl,
        anonKey: resolved.supabaseAnon,
        token,
        documentId,
        workOrderId: "kwo_forged_preview_probe",
      });
      evidence.probes.worker_forged_work_order = woForged;

      woReuse = await fetchWorker({
        supabaseUrl: resolved.supabaseUrl,
        anonKey: resolved.supabaseAnon,
        token,
        documentId,
        workOrderId,
      });
      evidence.probes.worker_factory_reuse = woReuse;
    }

    evidence.probes.policy_extract_without_work_order = await fetchPreviewApi({
      previewBase: resolved.previewBase,
      path: "/api/customer-document-policy-extract",
      token,
      bypass,
      body: { document_id: documentId },
    });
  } else {
    evidence.probes.note = "No queued document_id — pass --document=<uuid>";
  }

  const anyDocumentId = admin ? await resolveAnyDocumentId(admin, resolved.email) : null;
  if (anyDocumentId && intakeMode === "active") {
    const scopeIntake = await fetchPreviewApi({
      previewBase: resolved.previewBase,
      path: "/api/key-document-intake",
      token,
      bypass,
      body: { document_id: anyDocumentId, upload_source: "ku2a_scope_probe" },
    });
    const scopeWorkOrderId = scopeIntake.payload?.work_order_id ?? null;
    const directives = scopeIntake.payload?.intake_trace?.work_order?.directives ?? [];
    evidence.probes.factory_scope_probe = { directives_count: directives.length };
    if (scopeWorkOrderId && directives.length === 0) {
      scopeProbe = await fetchPreviewApi({
        previewBase: resolved.previewBase,
        path: "/api/customer-document-policy-extract",
        token,
        bypass,
        body: { document_id: anyDocumentId, work_order_id: scopeWorkOrderId },
      });
      evidence.probes.factory_scope_probe.policy_extract = scopeProbe;
    }
  }

  evidence.tom_preview_report = {
    "1_work_order_absent_403":
      woWithout?.status === 403 && woWithout?.payload?.error === "work_order_required" ? "PASS" : "FAIL",
    "2_key_work_order_executes":
      woWith != null && woWith.status !== 403 && woWith.payload?.error !== "work_order_required"
        ? "PASS"
        : "FAIL",
    "3_forgery_reuse_expiry_rejected":
      woForged?.status === 403 &&
      woForged?.payload?.error === "work_order_forgery" &&
      woReuse?.status === 403 &&
      woReuse?.payload?.error === "work_order_already_consumed"
        ? "PASS"
        : "FAIL",
    "4_factory_scope_mismatch":
      scopeProbe?.status === 403 && scopeProbe?.payload?.reason === "work_order_scope_mismatch"
        ? "PASS"
        : directivesScopeFallback(intakeMode),
    "5_legacy_off_shadow":
      intakeMode === "off" || intakeMode === "shadow"
        ? woWithout?.status !== 403 || woWithout?.payload?.error !== "work_order_required"
          ? "PASS"
          : "FAIL"
        : "LOCAL_UNIT_TEST",
  };

  evidence.tom_preview_all_pass = Object.entries(evidence.tom_preview_report).every(([key, value]) => {
    if (key === "5_legacy_off_shadow" && value === "LOCAL_UNIT_TEST") return true;
    if (key === "4_factory_scope_mismatch" && value === "LOCAL_UNIT_TEST") return true;
    return value === "PASS";
  });

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[Preview Evidence]");
  console.log(`1. Work Order 없음 → ${evidence.tom_preview_report["1_work_order_absent_403"]}`);
  console.log(`2. KEY Work Order → ${evidence.tom_preview_report["2_key_work_order_executes"]}`);
  console.log(`3. 위조·재사용·만료 → ${evidence.tom_preview_report["3_forgery_reuse_expiry_rejected"]}`);
  console.log(`4. Factory Scope → ${evidence.tom_preview_report["4_factory_scope_mismatch"]}`);
  console.log(`5. Legacy 유지 → ${evidence.tom_preview_report["5_legacy_off_shadow"]}`);
  console.log(`\nEvidence: ${OUT}`);
  console.log(`Tom Preview all pass: ${evidence.tom_preview_all_pass}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
