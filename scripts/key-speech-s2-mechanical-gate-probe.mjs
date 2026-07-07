/**
 * KEY Speech Slice 2 — mechanical gate probe (A-0 + A-1 speak patterns).
 * Local-runtime only · no PASS declaration.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  SPEECH_TURN_TYPE,
  SPEECH_TURN_TYPE_TEST_SET,
  classifySpeechTurnType,
  scanSpeechForbiddenPatterns,
} from "../server/keyBrain/keySpeechTurnType.js";
import { buildQuestionCustomerFirstSentence } from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/key-speech-s2-mechanical-gate-evidence.json");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function minimalContextSnapshot() {
  return {
    bundle: {
      policies: [],
      memoryFacts: [],
      recentConversation: { hasHistory: false, latestUserMessages: [], latestUserMessageExcerpt: null },
    },
    flags: {},
  };
}

function minimalLoadedContext() {
  return {
    profile: "empty",
    policies: "empty",
    documents: "empty",
    memory: "empty",
    conversations: { status: "empty", source: [], phase_filter_applied: false },
    consents: "empty",
    flags: {},
  };
}

function minimalJudgment() {
  return buildKeyFirstJudgment({
    contextSnapshot: minimalContextSnapshot(),
    loadedContext: minimalLoadedContext(),
  });
}

loadEnvFile(join(ROOT, ".env.local"));
loadEnvFile(join(ROOT, ".env"));

const contextSnapshot = minimalContextSnapshot();
const loadedContext = minimalLoadedContext();
const judgment = minimalJudgment();

const classificationRows = SPEECH_TURN_TYPE_TEST_SET.map((row) => {
  const actual = classifySpeechTurnType(row.question);
  return {
    id: row.id,
    question: row.question,
    expected: row.expected,
    actual,
    pass: actual === row.expected,
  };
});

const classificationPass = classificationRows.every((row) => row.pass);
assert.equal(classificationPass, true, "A-0 turn type classification must be 100%");

const speakRows = [];
const answerTexts = new Map();

for (const row of SPEECH_TURN_TYPE_TEST_SET) {
  const turnType = classifySpeechTurnType(row.question);
  const consultationIntent =
    /추천/.test(row.question) && !/맛집/.test(row.question)
      ? { intent: "recommendation_request" }
      : /괜찮|부족|암/.test(row.question)
        ? { intent: "coverage_gap_check" }
        : { intent: "general_consultation" };
  const text = buildQuestionCustomerFirstSentence(judgment, {
    question: row.question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
  });
  const forbiddenHits = scanSpeechForbiddenPatterns(text ?? "", { turnType });
  speakRows.push({
    id: row.id,
    question: row.question,
    turn_type: turnType,
    answer_preview: String(text ?? "").slice(0, 240),
    forbidden_hits: forbiddenHits,
    pass: Boolean(text) && forbiddenHits.length === 0,
  });
  if (text) answerTexts.set(row.question, text);
}

const contrastPairs = [
  ["보험료 부담돼", "보험료 얼마야"],
  ["추천해줘", "추천해줘야 하나 싶어서요"],
  ["내 보험 괜찮아?", "암보험 부족해?"],
  ["지난번 얘기 이어서 봐줘", "아까 말한 거 다시 알려줘"],
];

const contrastRows = contrastPairs.map(([a, b]) => {
  const textA = answerTexts.get(a) ?? "";
  const textB = answerTexts.get(b) ?? "";
  return {
    pair: [a, b],
    same_answer: textA.length > 0 && textA === textB,
    pass: textA.length > 0 && textB.length > 0 && textA !== textB,
  };
});

const forbiddenPass = speakRows.every((row) => row.pass);
const contrastPass = contrastRows.every((row) => row.pass);

const evidence = {
  schema_version: "key-speech-s2-mechanical-gate-evidence-v1",
  slice: "KEY_GROWTH_S2",
  mode: "local_runtime · no PASS",
  observed_at: new Date().toISOString(),
  a0_turn_type: {
    pass: classificationPass,
    total: classificationRows.length,
    rows: classificationRows,
  },
  a1_forbidden_patterns: {
    pass: forbiddenPass,
    rows: speakRows,
  },
  boundary_contrast: {
    pass: contrastPass,
    rows: contrastRows,
  },
  mechanical_pass: classificationPass && forbiddenPass && contrastPass,
};

mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(
  `key-speech-s2-mechanical-gate-probe: mechanical_pass=${evidence.mechanical_pass} · written ${OUT}`,
);

assert.equal(evidence.mechanical_pass, true, "mechanical gate must pass locally");
