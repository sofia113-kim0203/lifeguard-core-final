/**
 * U2-C1-EMPTY-TABLE-GUARD — structural strip only.
 */
import assert from "node:assert/strict";
import {
  applyEmptyCoverageTableGuard,
  stripEmptyCoverageTableBlocks,
} from "../src/lib/keyEmptyCoverageTableGuard.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";
import { prepareAssistantChatText } from "../src/lib/lifeguardChatMarkdownCore.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const C1_SYMPTOM = `원본에서 확인된 담보만 보면 이렇게 돼 있어요:

담보	가입금액

솔직히 말하면, 이 계약 하나만 놓고 "괜찮다 / 안 괜찮다"를 말하기가 좀 어려워요.

이전에 올려주셨던 다른 계약들도 있는데, 그것들까지 같이 보면서 정리해드릴 수 있어요.`;

test("U2-T1 C1 symptom: empty TSV + pointing intro removed; judgment kept", () => {
  const r = stripEmptyCoverageTableBlocks(C1_SYMPTOM);
  assert.equal(r.removed, true);
  assert.equal(r.removed_pointing_intro, true);
  assert.equal(/담보\s*\t\s*가입금액/.test(r.text), false);
  assert.equal(/확인된\s*담보만\s*보면/.test(r.text), false);
  assert.match(r.text, /솔직히 말하면/);
  assert.match(r.text, /다른 계약들/);
});

test("U2-T2 table with rows unchanged", () => {
  const withRows = `원본에서 확인된 담보만 보면 이렇게 돼 있어요:

담보	가입금액
상해수술비	100만원
질병수술비	30만원

솔직히 말하면 이어서 볼게요.`;
  const r = stripEmptyCoverageTableBlocks(withRows);
  assert.equal(r.removed, false);
  assert.equal(r.text, withRows);
  assert.match(r.text, /상해수술비/);
});

test("U2-T3 confirmed-coverage prose without table unchanged", () => {
  const prose =
    "원본에서 확인된 담보는 수술비 중심이에요. 괜찮다/안 괜찮다를 단정하긴 어려워요.";
  assert.equal(applyEmptyCoverageTableGuard(prose), prose);
});

test("U2-T4 empty markdown pipe table removed", () => {
  const md = `담보 목록입니다.

| 담보 | 가입금액 |
|---|---|

이어서 판단할게요.`;
  const r = stripEmptyCoverageTableBlocks(md);
  assert.equal(r.removed, true);
  assert.equal(/가입금액/.test(r.text), false);
  assert.match(r.text, /이어서 판단/);
});

test("U2-T5 seal + display prepare apply same guard", () => {
  const sealed = sealKeyCustomerText(C1_SYMPTOM);
  assert.equal(/담보\s*\t\s*가입금액/.test(sealed.key_speak_original), false);
  assert.equal(/확인된\s*담보만\s*보면/.test(sealed.key_speak_original), false);
  const display = prepareAssistantChatText(C1_SYMPTOM);
  assert.equal(/담보\s*\t\s*가입금액/.test(display), false);
  assert.equal(/확인된\s*담보만\s*보면/.test(display), false);
});

if (process.exitCode) {
  console.error("U2 empty coverage table guard unit tests FAILED");
  process.exit(1);
}
console.log("U2 empty coverage table guard unit tests PASSED");
