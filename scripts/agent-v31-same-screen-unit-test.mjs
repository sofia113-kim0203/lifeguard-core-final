/**
 * Advisor KEY V3.1 same-screen gates — source only, no Preview/DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("agent-v31-same-screen-unit-test");

const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
const shell = readFileSync(join(ROOT, "src/components/CustomerLifeguardShell.jsx"), "utf8");
const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const left = readFileSync(join(ROOT, "src/components/KeyAgentLeftRail.jsx"), "utf8");
const right = readFileSync(join(ROOT, "src/components/KeyAgentRightRail.jsx"), "utf8");
const freeHelper = readFileSync(join(ROOT, "src/lib/agentFreeKey.js"), "utf8");

test("ROUTE /agent uses customer V3.1 shell with audience=agent", () => {
  assert.match(app, /userRole === APP_ROLES\.AGENT && normalizeAppPath\(appPath\) === "\/agent"/);
  assert.match(app, /audience="agent"/);
  assert.match(app, /CustomerLifeguardShell/);
  assert.doesNotMatch(app, /case \"agent\":\s*return <AgentDeskPanel/);
  assert.doesNotMatch(app, /import AgentDeskPanel/);
});

test("CUSTOMER_COMPONENT and AGENT_COMPONENT are the same LifeguardHomeChat", () => {
  assert.match(shell, /<LifeguardHomeChat layer1Only audience=\{audience\}/);
  assert.match(chat, /audience = \"customer\"/);
  assert.match(chat, /const isAgentAudience = audience === \"agent\"/);
  assert.match(chat, /import KeyAgentLeftRail/);
  assert.match(chat, /import KeyAgentRightRail/);
  assert.match(chat, /isAgentAudience \? \(\s*<KeyAgentLeftRail/);
  assert.match(chat, /isAgentAudience \? \(\s*<KeyAgentRightRail/);
});

test("AGENT_BADGE is center header only; scope lives in LEFT rail", () => {
  assert.match(chat, /className=\"lg-agent-key-badge\"/);
  assert.match(chat, /설계사 KEY/);
  assert.match(left, /설계사 메뉴/);
  assert.match(left, /일반 질문/);
  assert.match(left, /담당 고객/);
  assert.match(left, /lg-agent-scope-selector/);
  assert.match(left, /lg-agent-scope-listbox/);
  // Scope selector must not sit in the shell header path as the primary control.
  assert.doesNotMatch(
    chat,
    /lg-v31-shell-header[\s\S]*lg-agent-scope-selector/,
  );
});

test("RIGHT rail shows authorized materials + briefing", () => {
  assert.match(right, /권한 · 브리핑/);
  assert.match(right, /허용 자료 사용 가능/);
  assert.match(right, /상담 준비 브리핑 요청/);
  assert.match(chat, /createAgentKeyBriefingRequest/);
  assert.match(chat, /requestAgentBriefing/);
});

test("CUSTOMER_PATH_CHANGED: customer default path preserved", () => {
  assert.match(chat, /audience = \"customer\"/);
  assert.match(chat, /fetchHomeBrainFactStream/);
  assert.match(chat, /persistLifeguardChatTurn/);
  // Agent submit branch uses free KEY API and exits before customer home-brain stream.
  assert.match(
    chat,
    /if \(isAgentAudience\) \{[\s\S]*?postAgentFreeKeyChat\([\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.match(shell, /audience = \"customer\"/);
});

test("AGENT_API_PRESERVED: postAgentFreeKeyChat → /api/agent-key-chat", () => {
  assert.match(chat, /postAgentFreeKeyChat/);
  assert.match(freeHelper, /\/api\/agent-key-chat/);
  assert.equal(chat.includes("customer_conversations"), false);
  // Agent answers stay in local messages state — never call customer turn persist in agent branch.
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock, "agent submit block present");
  assert.doesNotMatch(agentBlock[0], /persistLifeguardChatTurn/);
  assert.doesNotMatch(agentBlock[0], /fetchHomeBrainFactStream/);
});

test("no separate AgentDeskPanel shell as /agent primary", () => {
  assert.doesNotMatch(app, /linear-gradient\(145deg, #0b1220[\s\S]{0,200}AgentDeskPanel/);
  assert.match(chat, /lg-final-shell/);
  assert.match(chat, /lg-v31-room/);
});

console.log(`agent-v31-same-screen-unit-test: PASS (${passed})`);
