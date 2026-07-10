/**
 * KEY Master 단독 생존 — Preview 실화면 probe (Tom 5질문).
 * No PASS declaration — evidence only.
 *
 * Integrity contract (not fixed-phrase / compose_mode-name veto):
 *   - response_source === one_key_core_s1
 *   - key_speak_master_trace === true
 *   - KEY original === final customerText
 *   - replace_count === 0
 *   - one customer output per turn
 *   - non-empty, complete sentence
 *
 * Usage:
 *   node scripts/key-master-survival-preview-probe.mjs [preview-url]
 *   node scripts/key-master-survival-preview-probe.mjs --self-test
 */
import assert from "node:assert/strict";
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
  { question: "보험료 부담" },
  { question: "안녕" },
  { question: "내 보험 괜찮아?" },
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
const REQUIRED_SOURCE = "one_key_core_s1";

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (existsSync(envPath)) loadPreviewProbeEnvFile(envPath);
}

export function extractDone(events = []) {
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

/** Non-empty answer that does not look mid-cut. */
export function isSentenceComplete(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t.length < 2) return false;
  if (/[,，、]\s*$/.test(t)) return false;
  if (/\.\.\.\s*$/.test(t) && t.length < 12) return false;
  // Obvious truncation markers
  if (/(?:입니다|습니다|세요|까요|게요|예요|이에요)\s*\.\.\.\s*$/.test(t)) return false;
  if (/[가-힣A-Za-z0-9]$/.test(t)) return true;
  if (/[.!?…)]$/.test(t)) return true;
  return t.length >= 8;
}

/** Customer-facing output count for the turn (replace events or single final answer). */
export function countCustomerOutputs({ replaceCount = 0, answerText = "" } = {}) {
  const replaces = Number(replaceCount) || 0;
  if (replaces > 0) return replaces;
  return String(answerText ?? "").trim() ? 1 : 0;
}

/**
 * Survival integrity judgment — compose_mode is diagnostic only (not a solo veto).
 * Known fake compose outlets remain integrity failures.
 */
export function judgeSurvivalIntegrity({
  keySpeakOriginal = "",
  answerText = "",
  responseSource = null,
  keySpeakMasterTrace = false,
  replaceCount = 0,
  composeMode = null,
  hulMarkerLeak = false,
} = {}) {
  const textEqual = String(keySpeakOriginal ?? "").trim() === String(answerText ?? "").trim();
  const sourceOk = String(responseSource ?? "") === REQUIRED_SOURCE;
  const forbiddenSource = FORBIDDEN_SOURCES.includes(String(responseSource ?? ""));
  const fakeCompose = FAKE_COMPOSE_MODES.includes(String(composeMode ?? ""));
  const sentenceComplete = isSentenceComplete(answerText);
  const outputCount = countCustomerOutputs({ replaceCount, answerText });
  const nonEmpty = Boolean(String(answerText ?? "").trim());

  const masterVoice =
    sourceOk &&
    keySpeakMasterTrace === true &&
    textEqual &&
    Number(replaceCount) === 0 &&
    nonEmpty &&
    sentenceComplete &&
    outputCount === 1 &&
    !fakeCompose &&
    !hulMarkerLeak &&
    !forbiddenSource;

  const rewriteDetected =
    !textEqual ||
    Number(replaceCount) > 0 ||
    !sourceOk ||
    keySpeakMasterTrace !== true ||
    outputCount !== 1 ||
    !nonEmpty ||
    !sentenceComplete ||
    fakeCompose ||
    hulMarkerLeak ||
    forbiddenSource;

  return {
    text_equal: textEqual,
    response_source: responseSource,
    key_speak_master_trace: keySpeakMasterTrace === true,
    compose_mode: composeMode ?? null,
    replace_count: Number(replaceCount) || 0,
    output_count: outputCount,
    sentence_complete: sentenceComplete,
    fake_key_source: forbiddenSource,
    fake_compose_mode: fakeCompose,
    hul_marker_leak: hulMarkerLeak === true,
    master_voice: masterVoice,
    rewrite_detected: rewriteDetected,
  };
}

function runSelfTest() {
  // Normal key_s6_voice_speak — must NOT be rewrite; master_voice true without fixed phrase
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal:
        "보험료 부담이 있으시다면, 지금 유지 중인 계약들의 납입 구조부터 차근히 보는 게 맞아요.",
      answerText:
        "보험료 부담이 있으시다면, 지금 유지 중인 계약들의 납입 구조부터 차근히 보는 게 맞아요.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, false);
    assert.equal(j.master_voice, true);
    assert.equal(j.replace_count, 0);
    assert.equal(j.output_count, 1);
    assert.equal(j.compose_mode, "key_s6_voice_speak");
  }

  // Greeting without "질문 잘 받았습니다" — still master_voice
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "안녕하세요, 반갑습니다. 오늘 어떤 게 궁금하신지 편하게 말씀해 주세요.",
      answerText: "안녕하세요, 반갑습니다. 오늘 어떤 게 궁금하신지 편하게 말씀해 주세요.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.master_voice, true);
    assert.equal(j.rewrite_detected, false);
  }

  // equality=false → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "원문 A",
      answerText: "변형 B",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.master_voice, false);
  }

  // replace_count=1 → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "같은 문장입니다.",
      answerText: "같은 문장입니다.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 1,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.output_count, 1);
    assert.equal(j.master_voice, false);
  }

  // two customer outputs via replace_count=2
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "최종입니다.",
      answerText: "최종입니다.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 2,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.output_count, 2);
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.master_voice, false);
  }

  // key_speak_master_trace=false → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "정상 문장입니다.",
      answerText: "정상 문장입니다.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: false,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.master_voice, false);
  }

  // legacy source → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "정상 문장입니다.",
      answerText: "정상 문장입니다.",
      responseSource: "sales_director_key",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.fake_key_source, true);
    assert.equal(j.master_voice, false);
  }

  // empty answer → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "",
      answerText: "",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.sentence_complete, false);
    assert.equal(j.master_voice, false);
  }

  // truncated sentence → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "보험료는,",
      answerText: "보험료는,",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "key_s6_voice_speak",
    });
    assert.equal(j.sentence_complete, false);
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.master_voice, false);
  }

  // fake compose outlet → rewrite
  {
    const j = judgeSurvivalIntegrity({
      keySpeakOriginal: "정상처럼 보이는 문장입니다.",
      answerText: "정상처럼 보이는 문장입니다.",
      responseSource: "one_key_core_s1",
      keySpeakMasterTrace: true,
      replaceCount: 0,
      composeMode: "generateHumanSalesDirectorResponse",
    });
    assert.equal(j.fake_compose_mode, true);
    assert.equal(j.rewrite_detected, true);
    assert.equal(j.master_voice, false);
  }

  console.log("KEY_MASTER_SURVIVAL_PROBE_SELF_TEST ok=true");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

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
    const composeMode = speakStep?.payload?.compose_mode ?? null;
    const keyMasterTrace = speakStep?.payload?.key_speak_master === true;
    const judged = judgeSurvivalIntegrity({
      keySpeakOriginal: extracted.keySpeakOriginal,
      answerText: extracted.answerText,
      responseSource: extracted.responseSource,
      keySpeakMasterTrace: keyMasterTrace,
      replaceCount: extracted.replaceCount,
      composeMode,
      hulMarkerLeak: hulLeak,
    });

    rows.push({
      question: probe.question,
      key_speak_original: extracted.keySpeakOriginal,
      final_customerText: extracted.answerText,
      key_text_equal_api: extracted.keyTextEqual,
      ...judged,
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
      sentence_complete_count: rows.filter((r) => r.sentence_complete).length,
      single_output_count: rows.filter((r) => r.output_count === 1).length,
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
    console.log(`compose_mode: ${row.compose_mode}`);
    console.log(`replace_count: ${row.replace_count}`);
    console.log(`output_count: ${row.output_count}`);
    console.log(`sentence_complete: ${row.sentence_complete ? "예" : "아니오"}`);
    console.log(`rewrite_detected: ${row.rewrite_detected ? "예" : "아니오"}`);
    console.log(`master_voice: ${row.master_voice ? "예" : "아니오"}`);
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
