/**
 * Mobile UI minimal redesign — local unit (no Preview/LIVE).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldShowKeyNowActionCard } from "../src/lib/keyNowActionCardVisibility.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

{
  const tokens = read("src/lib/customerUiFinalTokens.js");
  assert.match(tokens, /touchMinPx:\s*44/);
  assert.match(tokens, /contentRailInsetMobilePx:\s*12/);
  assert.match(tokens, /max-width:\s*1023px/);
  assert.match(tokens, /safe-area-inset-bottom/);
  assert.match(tokens, /overflow-x:\s*hidden/);
  assert.match(tokens, /lg-md-table-wrap/);
  console.log("PASS tokens · mobile touch/inset/CSS");
}

{
  const card = read("src/components/KeyNowActionCard.jsx");
  const vis = read("src/lib/keyNowActionCardVisibility.js");
  assert.match(vis, /export function shouldShowKeyNowActionCard/);
  assert.match(card, /export \{ shouldShowKeyNowActionCard \}/);
  assert.match(card, /if \(!shouldShowKeyNowActionCard\(action\)\) return null/);
  assert.equal(shouldShowKeyNowActionCard(null), false);
  assert.equal(
    shouldShowKeyNowActionCard({
      pending: true,
      title: "다음 행동 · 확인 전",
      ctaLabel: "준비가 되면 알려주기",
    }),
    false,
  );
  assert.equal(
    shouldShowKeyNowActionCard({
      pending: false,
      title: "남은 서류를 준비해 주세요",
      ctaLabel: "서류 준비됐으면 알려주기",
    }),
    true,
  );
  console.log("PASS shouldShowKeyNowActionCard");
}

{
  const chat = read("src/components/LifeguardHomeChat.jsx");
  assert.match(chat, /isNarrowShell/);
  assert.match(chat, /showMovedHeaderControls:\s*isNarrowShell/);
  assert.match(chat, /showNowActionCard/);
  assert.match(chat, /shouldShowKeyNowActionCard/);
  assert.match(chat, /touchMinPx/);
  assert.match(chat, /!isNarrowShell\s*\?/);
  assert.match(chat, /isMidRoom && !isWideRoom/);
  assert.match(chat, /contentRailInsetMobilePx/);
  assert.match(chat, /env\(safe-area-inset-bottom/);
  // Desktop scope controls remain in source for mid/wide.
  assert.match(chat, /lg-v31-header-scope/);
  assert.match(chat, /개인\+법인 함께/);
  console.log("PASS LifeguardHomeChat narrow chrome locks");
}

{
  const md = read("src/lib/lifeguardChatMarkdown.jsx");
  assert.match(md, /lg-md-table-wrap/);
  assert.match(md, /maxWidth:\s*"100%"/);
  assert.match(md, /WebkitOverflowScrolling/);
  assert.match(md, /does not change server seal/);
  console.log("PASS markdown table mobile wrap (display only)");
}

{
  const onePath = read("server/keyCore/keyOnePathClaudeFirst.js");
  assert.match(onePath, /\[KEY_HUMAN_VOICE\]/);
  assert.match(onePath, /ONE_PATH_CLAUDE_FIRST/);
  const waitAck = read("server/keyWaitAck.js");
  assert.match(waitAck, /KEY_WAIT_ACK_GREETING/);
  // Confirm ONE_PATH file not in this redesign touch set via git would be external —
  // here: human-voice contract still present (unchanged content check).
  assert.match(onePath, /상담원식 상투어/);
  console.log("PASS ONE_PATH / HUMAN VOICE / wait-ack present (not redesigned)");
}

console.log(
  JSON.stringify({
    MOBILE_UI_MINIMAL_REDESIGN_UNIT: "PASS",
    TOUCH_MIN_PX: 44,
    PRODUCTION: 0,
  }),
);
