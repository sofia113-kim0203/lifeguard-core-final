/**
 * V3.1 photo-exact FINAL_UI tokens + single-header product face contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINAL_UI,
  FINAL_UI_ROOM_CSS,
  FINAL_UI_SCROLLBAR_CSS,
} from "../src/lib/customerUiFinalTokens.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const EXPECTED = {
  bg0: "#EEF3F8",
  bg1: "#F7F4EF",
  surface: "#FFFFFF",
  line: "#E4E9F0",
  text: "#152238",
  muted: "#5F6B7C",
  navy: "#12325F",
  teal: "#0F8A7A",
  coral: "#E86A4A",
  amber: "#D97706",
  sky: "#3B82C4",
};

for (const [k, v] of Object.entries(EXPECTED)) {
  assert.equal(FINAL_UI[k], v, `FINAL_UI.${k}`);
}

assert.equal(FINAL_UI.leftColPx, 268);
assert.equal(FINAL_UI.centerColPx, 840);
assert.equal(FINAL_UI.rightColPx, 308);
assert.equal(FINAL_UI.gutterPx, 10);
assert.equal(FINAL_UI.bodyGapPx, 8);
assert.equal(FINAL_UI.heroPadPx, 10);
assert.equal(FINAL_UI.headerPx, 90);
assert.equal(FINAL_UI.heroY, 87);
assert.equal(FINAL_UI.actionY, 295);
assert.equal(FINAL_UI.actionW, 756);
assert.equal(FINAL_UI.actionH, 185);
assert.equal(FINAL_UI.tabsY, 781);
assert.equal(FINAL_UI.tabsW, 420);
assert.equal(FINAL_UI.composerY, 851);
assert.equal(FINAL_UI.composerW, 840);
assert.equal(FINAL_UI.composerH, 38);
assert.equal(FINAL_UI.shellRadius, 22);
assert.equal(FINAL_UI.logoSize, 24);
assert.equal(FINAL_UI.headerLeftSize, 14);
assert.equal(FINAL_UI.heroTitleSize, 17);
assert.equal(FINAL_UI.actionTitleSize, 20);
assert.equal(FINAL_UI.actionTitleWeight, 600);
assert.equal(FINAL_UI.leftValueSize, 14);
assert.equal(FINAL_UI.rightValueSize, 16);
assert.equal(FINAL_UI.composerSize, 15);
assert.equal(FINAL_UI.tabSize, 13);
assert.equal(
  FINAL_UI.sans,
  '"Manrope", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
);
assert.equal(FINAL_UI.gothic, '"Fraunces", Georgia, "Times New Roman", serif');
assert.match(FINAL_UI.heroGradient, /#12325F/i);
assert.match(FINAL_UI.heroGradient, /#0F8A7A/i);

assert.match(FINAL_UI_SCROLLBAR_CSS, /scrollbar-width:\s*none/i);
assert.match(FINAL_UI_ROOM_CSS, /radial-gradient/);
assert.match(FINAL_UI_ROOM_CSS, /lg-v31-rail/);
assert.match(FINAL_UI_ROOM_CSS, /lg-v31-center/);

const home = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
assert.match(home, /customerUiFinalTokens/);
assert.match(home, /lg-final-shell/);
assert.match(home, /FINAL_UI_ROOM_CSS/);
assert.match(home, /KeyNowActionCard/);
assert.match(home, /lg-v31-shell-header/);
assert.match(home, /lg-v31-center-brand-mark/);
assert.match(home, /fontFamily:\s*LG\.serif/);
assert.doesNotMatch(home, /className="lg-v31-center-brand"/);
assert.doesNotMatch(home, /#7064CC|#6C55E6/i);
assert.doesNotMatch(home, /FINAL_UI\.purple/);
/** Action after messages when hydrated — empty slot only when messages.length === 0 */
assert.match(home, /messages\.length === 0[\s\S]*lg-v31-action-slot/);
assert.match(home, /messages\.length > 0[\s\S]*lg-v31-action-slot/);

const right = readFileSync(join(ROOT, "src/components/KeyCustomerRightRail.jsx"), "utf8");
assert.match(right, /돈의 흐름/);
assert.match(right, /지급·거절 결과/);
assert.doesNotMatch(right, /내 보험 요약/);
assert.doesNotMatch(right, /#7064CC|purple/i);
/** Title strip moved to unified shell header — rail keeps aria-label only */
assert.doesNotMatch(right, /fontWeight:\s*800[\s\S]{0,80}KEY가 계속 관리하는 것/);
assert.match(right, /aria-label="KEY가 계속 관리하는 것"/);

const left = readFileSync(join(ROOT, "src/components/KeyCustomerLeftRail.jsx"), "utf8");
assert.match(left, /heroGradient|KEY가 곁에서 보는 것/);
assert.match(left, /보장 공백/);
assert.match(left, /heroPadPx/);
assert.doesNotMatch(left, />LIFEGUARD</);

const action = readFileSync(join(ROOT, "src/components/KeyNowActionCard.jsx"), "utf8");
assert.match(action, /지금 하시면 돼요/);
assert.match(action, /다음 행동 · 확인 전/);
assert.match(action, /이 자리에 제시/);
assert.match(action, /actionTitleSize/);
assert.match(action, /fontFamily:\s*C\.gothic/);

assert.match(left, /heroTitleSize/);
assert.match(left, /fontFamily:\s*C\.gothic/);
assert.match(home, /tabSize/);
assert.match(home, /composerSize/);

const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
assert.match(indexHtml, /Playfair\+Display|Playfair Display/i);

console.log("customer-ui-final-tokens-unit-test: PASS");
