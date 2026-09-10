/**
 * Preview KEY AWS official-evidence door.
 * Customer question → same Claude → request_key_fact → AWS range → customer answer.
 * No Production. No uploader keys. No official text dump in the report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  probePreviewSse,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { TERMS_PROOF_SHA } from "../server/keyCore/keyTermsLibrary.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = path.join(ROOT, ".env.local");
const STEP0_ENV = "C:\\Users\\sofia\\lifeguard-data\\lifeguard-step0-candidate\\.env.local";
loadPreviewProbeEnvFile(STEP0_ENV);
loadPreviewProbeEnvFile(ENV_LOCAL);

const previewBase = String(process.argv[2] || process.env.PREVIEW_BASE || "").replace(/\/$/, "");
const QUESTION =
  "내 삼성화재 무배당 삼성화재 건강보험 마이핏1640 약관 제15조 내용이 뭐야? 공식 약관 원문 기준으로만 짧게 말해줘.";

function extractAnswer(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  return {
    answerText: String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim(),
    done,
  };
}

function scanOfficialDoor(done) {
  const raw = JSON.stringify(done || {});
  return {
    official_slot: /official_evidence/.test(raw),
    aws_source: /"original_source":"aws"/.test(raw),
    proof_sha: raw.includes(TERMS_PROOF_SHA),
    range_too_large: /RANGE_TOO_LARGE/.test(raw),
    evidence_unavailable: /EVIDENCE_UNAVAILABLE/.test(raw),
  };
}

if (!previewBase) {
  console.log(JSON.stringify({ KEY_PREVIEW_AWS_E2E: "BLOCKER", reason: "NO_PREVIEW_URL" }, null, 2));
  process.exit(2);
}

const probeEnv = resolvePreviewProbeEnv({ previewBase });
const token = await mintPreviewProbeJwt(probeEnv);
const probed = await probePreviewSse({
  previewBase,
  question: QUESTION,
  token,
});
if (!probed.probe_ok) {
  console.log(
    JSON.stringify(
      {
        KEY_PREVIEW_AWS_E2E: "BLOCKER",
        CUSTOMER_VISIBLE_ANSWER: "BLOCKER",
        reason: probed.probe_error || "PREVIEW_PROBE_FAIL",
        http_status: probed.http_status || null,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const { answerText, done } = extractAnswer(probed.events || []);
const door = scanOfficialDoor(done);
const leak = /lookupProduct|DIRECT_FIND|keyOfficial|TERMS_LIBRARY|master\/v1\/pdfs/i.test(answerText);
const tooLong = answerText.length > 4000;
const mentionsArticle = /제\s*15\s*조/.test(answerText);
const customerPass = Boolean(answerText) && !leak && !tooLong;
const e2ePass = customerPass && (door.official_slot || door.aws_source || mentionsArticle);

const report = {
  KEY_PREVIEW_AWS_E2E: e2ePass ? "PASS" : "BLOCKER",
  CUSTOMER_VISIBLE_ANSWER: customerPass && mentionsArticle ? "PASS" : "BLOCKER",
  original_source_aws: door.aws_source,
  official_slot_seen: door.official_slot,
  proof_sha_seen: door.proof_sha,
  mentions_article: mentionsArticle,
  answer_chars: answerText.length,
  full_pdf_dump: tooLong,
  engine_leak: leak,
  evidence_unavailable: door.evidence_unavailable,
  range_too_large: door.range_too_large,
  response_source: done.response_source || null,
};
console.log(JSON.stringify(report, null, 2));
if (!e2ePass || report.CUSTOMER_VISIBLE_ANSWER !== "PASS") process.exitCode = 2;
