/**
 * Preview Hand proof: same KB contract → exact SHA → PDF open.
 * Production is not called. No leftover GET. No PDF text in the report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
loadPreviewProbeEnvFile(path.join(ROOT, ".env.local"));
loadPreviewProbeEnvFile("C:\\Users\\sofia\\lifeguard-data\\lifeguard-step0-candidate\\.env.local");

const EXPECTED_SHA = "ef7e8140af7e3c2a0116cb6b5832c3d25794184d4c46cd84c66898fa9db34487";
const CONTRACT = {
  insurer: "KB손해보험",
  product_name: "무배당 KB 슬기로운 간편건강보험(21.06)",
  date: "20210810",
  product_code: "23326",
  document_kind: "보험약관",
  official_distinguisher: "일반심사형",
};

const previewBase = String(process.argv[2] || process.env.PREVIEW_BASE || "").replace(/\/$/, "");
if (!previewBase) {
  console.log(JSON.stringify({ KEY_KB_HAND_PREVIEW: "BLOCKER", reason: "NO_PREVIEW_URL" }, null, 2));
  process.exit(2);
}
if (/vercel\.app$/i.test(previewBase) === false && !previewBase.includes("lifeguard-core-final")) {
  console.log(JSON.stringify({ KEY_KB_HAND_PREVIEW: "BLOCKER", reason: "NOT_PREVIEW_HOST" }, null, 2));
  process.exit(2);
}

const probeEnv = resolvePreviewProbeEnv({ previewBase });
const token = await mintPreviewProbeJwt(probeEnv);
const bypass = resolveBypassSecret();

async function postProof(body) {
  const res = await fetch(`${previewBase}/api/key-official-original-proof`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

const exact = await postProof(CONTRACT);
const withoutNote = await postProof({ ...CONTRACT, official_distinguisher: "" });
const exactPass =
  exact.http === 200 &&
  exact.json?.ok === true &&
  exact.json?.sha === EXPECTED_SHA &&
  Number(exact.json?.pdf_bytes) > 0;
const ambiguousPass =
  withoutNote.http === 200 &&
  withoutNote.json?.ok === false &&
  /AMBIGUOUS|MULTI_RELATION|insufficient/i.test(String(withoutNote.json?.reason || withoutNote.json?.status || ""));

const report = {
  KEY_KB_HAND_PREVIEW: exactPass && ambiguousPass ? "PASS" : "BLOCKER",
  preview_base: previewBase,
  production_promote: false,
  exact: {
    http: exact.http,
    ok: exact.json?.ok === true,
    sha: exact.json?.sha || null,
    sha_match: exact.json?.sha === EXPECTED_SHA,
    pdf_bytes: exact.json?.pdf_bytes || 0,
    original_opened: exact.json?.original_opened === true,
    reason: exact.json?.reason || null,
  },
  without_distinguisher: {
    http: withoutNote.http,
    ok: withoutNote.json?.ok === true,
    status: withoutNote.json?.status || null,
    reason: withoutNote.json?.reason || null,
  },
};
const out = path.join(
  "C:\\Users\\sofia\\lifeguard-data\\terms-raw-library\\library-staging\\missions\\LIBRARY-RESIDUAL-FINAL-20260911\\WORK\\KB-HAND-PREVIEW",
  "PROOF.json",
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.KEY_KB_HAND_PREVIEW !== "PASS") process.exit(2);
