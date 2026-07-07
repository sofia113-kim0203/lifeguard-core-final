/**
 * KEY Speech Slice 2 — turn type classification unit test (A-0 gate).
 */
import assert from "node:assert/strict";
import {
  SPEECH_TURN_TYPE,
  SPEECH_TURN_TYPE_TEST_SET,
  classifySpeechTurnType,
} from "../server/keyBrain/keySpeechTurnType.js";

function runCase(row) {
  const actual = classifySpeechTurnType(row.question);
  assert.equal(
    actual,
    row.expected,
    `[${row.id}] "${row.question}" expected ${row.expected}, got ${actual}`,
  );
}

let passed = 0;
for (const row of SPEECH_TURN_TYPE_TEST_SET) {
  runCase(row);
  passed += 1;
}

console.log(`key-speech-s2-turn-type-unit-test: ${passed}/${SPEECH_TURN_TYPE_TEST_SET.length} OK`);
