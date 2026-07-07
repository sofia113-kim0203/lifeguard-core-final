/**
 * KEY Master 단독 생존 — Preview 실화면 probe (Tom 5질문).
 * No PASS declaration — evidence only.
 *
 * Usage:
 *   node scripts/key-master-survival-preview-probe.mjs [preview-url]
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  probePreviewSse,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/key-master-survival-preview-evidence.json");

const PROBES = [
  { question: "보험료 부담", expectMaster: /질문 잘 받았습니다/ },
  { question: "안녕", expectMaster: /반갑습니다/ },
  { question: "내 보험 괜찮아?", expectMaster: /질문 잘 받았습니다/ },
];

const HUL_MARKERS = [/말씀 주신 걸 기준으로/, /함께 보면서 정리해 드릴게요/];
const FAKE_COMPOSE_MODES = ["buildKeyStructuredResponse", "generateHumanSalesDirectorResponse"];
const FORBIDDEN_SOURCES = [
  "sales_director_key",
  "sales_director_loop",
  "conversation_brain",
  "advisor",
  "tom_gap",
];

function isKeyMasterComposeMode(mode = "") {
  const value = String(mode ?? "");
  return value.startsWith("key_master");
}

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (existsSync(envPath)) loadPreviewProbeEnvFile(envPath);
}

function extractDone(events = []) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => String(e.data?.text ?? ""));
  const deltas = events.filter((e) => e.type === "delta").map((e) => String(e.data?.text ?? ""));
  const streamed = replaces.at(-1) || deltas.join("");
  const answerText = String(done.answerText ?? streamed ?? "").trim();
  return {
    answerText,
    keySpeakOriginal: String(done.key_speak_original ?? done.answerText ?? streamed ?? "").trim(),
    responseSource: done.response_source ?? null,
    keyTextEqual: done.key_text_equal === true,
    replaceCount: replaces.length,
    trace: done.one_key_core_trace ?? done.sales_director_trace?.one_key_core_trace ?? null,
  };
}

async function main() {
  loadEnv();
  const previewBase = process.argv[2] ?? process.env.PREVIEW_BASE ?? "";
  const resolved = resolvePreviewProbeEnv({ previewBase });
  const token = await mintPreviewProbeJwt(resolved);

  const rows = [];
  for (const probe of PROBES) {
    const result = await probePreviewSse({
      previewBase: resolved.previewBase,
      bypassSecret: resolved.bypass,
      token,
      question: probe.question,
    });
    if (!result.probe_ok) {
      console.error(`BLOCKED — preview probe failed for "${probe.question}": ${result.probe_error}`);
      process.exit(2);
    }
    const events = result.events ?? [];
    const extracted = extractDone(events);
    const speakStep = extracted.trace?.steps?.find((row) => row.step === "speak");
    const hulLeak = HUL_MARKERS.some((re) => re.test(extracted.answerText));
    const forbiddenSource = FORBIDDEN_SOURCES.includes(String(extracted.responseSource ?? ""));
    const fakeCompose = FAKE_COMPOSE_MODES.includes(String(speakStep?.payload?.compose_mode ?? ""));
    const masterVoice = probe.expectMaster.test(extracted.answerText);
    const keyMasterTrace = speakStep?.payload?.key_speak_master === true;
    const keyMasterCompose = isKeyMasterComposeMode(speakStep?.payload?.compose_mode);

    rows.push({
      question: probe.question,
      key_speak_original: extracted.keySpeakOriginal,
      final_customerText: extracted.answerText,
      text_equal: extracted.keySpeakOriginal === extracted.answerText,
      response_source: extracted.responseSource,
      key_text_equal_api: extracted.keyTextEqual,
      key_speak_master_trace: keyMasterTrace,
      compose_mode: speakStep?.payload?.compose_mode ?? null,
      replace_count: extracted.replaceCount,
      fake_key_source: forbiddenSource,
      fake_compose_mode: fakeCompose,
      hul_marker_leak: hulLeak,
      master_voice: masterVoice,
      rewrite_detected:
        extracted.replaceCount > 0 ||
        extracted.keySpeakOriginal !== extracted.answerText ||
        forbiddenSource ||
        hulLeak ||
        fakeCompose ||
        !keyMasterTrace ||
        !keyMasterCompose,
    });
  }

  const evidence = {
    schema_version: "key-master-survival-preview-v1",
    preview_base: resolved.previewBase,
    probed_at: new Date().toISOString(),
    probes: rows,
    summary: {
      probe_count: rows.length,
      key_master_voice_count: rows.filter((r) => r.master_voice).length,
      key_speak_master_trace_count: rows.filter((r) => r.key_speak_master_trace).length,
      text_equal_count: rows.filter((r) => r.text_equal).length,
      fake_key_source_count: rows.filter((r) => r.fake_key_source).length,
      fake_compose_mode_count: rows.filter((r) => r.fake_compose_mode).length,
      rewrite_count: rows.filter((r) => r.rewrite_detected).length,
    },
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  for (const row of rows) {
    console.log(`질문: ${row.question}`);
    console.log(`KEY 원문: ${row.key_speak_original}`);
    console.log(`최종 customerText: ${row.final_customerText}`);
    console.log(`동일 여부: ${row.text_equal ? "예" : "아니오"}`);
    console.log(`response_source: ${row.response_source}`);
    console.log(`key_speak_master: ${row.key_speak_master_trace ? "예" : "아니오"}`);
    console.log(`rewrite_detected: ${row.rewrite_detected ? "예" : "아니오"}`);
    console.log("---");
  }

  console.log(`evidence: ${OUT}`);
  if (evidence.summary.rewrite_count > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
