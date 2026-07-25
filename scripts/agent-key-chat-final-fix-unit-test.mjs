/**
 * Advisor KEY chat final fix gates — direction, SSE, session continuity.
 * Source-only + in-memory session helpers. No Preview/DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_HOME_SCOPE_GENERAL,
  agentKeyChatSessionStorageKey,
  clearAllAgentKeyChatSessions,
  clearAgentKeyChatSession,
  readAgentKeyChatSession,
  writeAgentKeyChatSession,
} from "../src/lib/agentKeyChatSession.js";
import { runAgentFreeKeyTurn } from "../server/agent/agentFreeKeyCore.js";
import {
  buildAgentFreeKeyPostBody,
  mapAgentFreeKeyErrorMessage,
} from "../src/lib/agentFreeKey.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  const ret = fn();
  if (ret && typeof ret.then === "function") {
    return ret.then(() => {
      passed += 1;
      console.log(`  ok ${name}`);
    });
  }
  passed += 1;
  console.log(`  ok ${name}`);
  return undefined;
}

console.log("agent-key-chat-final-fix-unit-test");

const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const api = readFileSync(join(ROOT, "api/agent-key-chat.js"), "utf8");
const freeHelper = readFileSync(join(ROOT, "src/lib/agentFreeKey.js"), "utf8");
const freeCore = readFileSync(join(ROOT, "server/agent/agentFreeKeyCore.js"), "utf8");
const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");

await test("CHAT_DIRECTION: user right / assistant left (shared renderer)", () => {
  assert.match(chat, /const isUser = msg\.role === "user"/);
  assert.match(chat, /justifyContent:\s*isUser \? "flex-end" : "flex-start"/);
  // Alignment uses role only — no speaker-name branch for justifyContent.
  assert.doesNotMatch(chat, /justifyContent:\s*[^\n]*displayName/);
});

await test("READ_POSITION: jump-to-latest button + no stick when scrolled away", () => {
  assert.match(chat, /최신 답변으로 ↓/);
  assert.match(chat, /jumpToLatestAnswer/);
  assert.match(chat, /shouldShowJumpToLatestAnswer/);
  assert.match(chat, /stickToBottomRef\.current/);
  assert.match(chat, /shouldAutoFollowChatScroll/);
});

await test("AGENT_STREAMING: API SSE + client stream + core streamHandlers", () => {
  assert.match(api, /text\/event-stream/);
  assert.match(api, /initHomeBrainFactSseResponse/);
  assert.match(api, /writeHomeBrainFactSseEvent\(res, "delta"/);
  assert.match(api, /writeHomeBrainFactSseEvent\(res, "done"/);
  assert.match(api, /streamHandlers/);
  assert.match(freeCore, /streamHandlers:\s*streamHandlers/);
  assert.match(freeHelper, /postAgentFreeKeyChatStream/);
  assert.match(freeHelper, /Accept:\s*"text\/event-stream"/);
  assert.match(freeHelper, /consumeHomeBrainFactSse/);
  assert.match(chat, /postAgentFreeKeyChatStream/);
  assert.match(chat, /onDelta:\s*\(chunk\)\s*=>/);
  assert.doesNotMatch(chat, /streamLive/);
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock);
  assert.doesNotMatch(agentBlock[0], /splitKeyAnswerMeaningUnits/);
  assert.doesNotMatch(agentBlock[0], /streamLive/);
});

await test("AGENT submit uses stream and never customer persist", () => {
  const agentBlock = chat.match(
    /if \(isAgentAudience\) \{[\s\S]*?return;\s*\}\s*\n\s*if \(chatAttachUploading\)/,
  );
  assert.ok(agentBlock, "agent submit block");
  assert.match(agentBlock[0], /postAgentFreeKeyChatStream/);
  assert.doesNotMatch(agentBlock[0], /persistLifeguardChatTurn/);
  assert.doesNotMatch(agentBlock[0], /fetchHomeBrainFactStream/);
  assert.doesNotMatch(agentBlock[0], /customer_conversations/);
});

await test("streamHandlers forwarded once to runKeyTurn", async () => {
  const calls = [];
  const handlers = { onDelta() {} };
  const result = await runAgentFreeKeyTurn({
    userSupabase: {},
    agentUserId: "agent-1",
    question: "암 진단비",
    history: [],
    assignmentId: null,
    adminSupabase: {},
    streamHandlers: handlers,
    runKeyTurn: async (args) => {
      calls.push(args);
      return { ok: true, customerText: "답" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].streamHandlers, handlers);
  assert.equal(calls[0].audience, "agent");
});

await test("SCOPE_ISOLATION + remount restore + logout clear", () => {
  const store = new Map();
  const storage = {
    get length() {
      return store.size;
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
  const agent = "agent-a";
  const general = AGENT_HOME_SCOPE_GENERAL;
  const customerA = "asg-a";
  const customerB = "asg-b";

  writeAgentKeyChatSession(
    agent,
    general,
    [
      { role: "user", content: "일반 Q" },
      { role: "assistant", content: "일반 A", thinking: false },
    ],
    { storage },
  );
  writeAgentKeyChatSession(
    agent,
    customerA,
    [
      { role: "user", content: "A Q" },
      { role: "assistant", content: "A A", thinking: false },
    ],
    { storage },
  );
  writeAgentKeyChatSession(
    agent,
    customerB,
    [{ role: "user", content: "B Q" }],
    { storage },
  );

  const g = readAgentKeyChatSession(agent, general, { storage });
  const a = readAgentKeyChatSession(agent, customerA, { storage });
  const b = readAgentKeyChatSession(agent, customerB, { storage });
  assert.equal(g.messages[0].content, "일반 Q");
  assert.equal(a.messages[0].content, "A Q");
  assert.equal(b.messages[0].content, "B Q");
  assert.notEqual(g.messages[0].content, a.messages[0].content);
  assert.notEqual(a.messages[0].content, b.messages[0].content);

  assert.match(
    agentKeyChatSessionStorageKey(agent, general),
    new RegExp(`${agent}:${general}`),
  );
  assert.doesNotMatch(agentKeyChatSessionStorageKey(agent, general), /localStorage/);

  clearAgentKeyChatSession(agent, customerA, { storage });
  assert.equal(readAgentKeyChatSession(agent, customerA, { storage }), null);
  assert.ok(readAgentKeyChatSession(agent, general, { storage }));

  const removed = clearAllAgentKeyChatSessions(agent, { storage });
  assert.ok(removed >= 2);
  assert.equal(readAgentKeyChatSession(agent, general, { storage }), null);
  assert.equal(readAgentKeyChatSession(agent, customerB, { storage }), null);
});

await test("LOGOUT clears agent sessions from App + LifeguardHomeChat", () => {
  assert.match(app, /clearAllAgentKeyChatSessions/);
  assert.match(chat, /clearAllAgentKeyChatSessions/);
  assert.match(chat, /readAgentKeyChatSession/);
  assert.match(chat, /writeAgentKeyChatSession/);
  assert.equal(chat.includes("customer_conversations"), false);
  assert.doesNotMatch(chat, /localStorage\.setItem\(\s*[`'"]lg_agent_key/);
});

await test("stream body flag + JSON path still available", () => {
  const body = buildAgentFreeKeyPostBody({
    question: "q",
    history: [],
    stream: true,
  });
  assert.equal(body.stream, true);
  assert.match(freeHelper, /export async function postAgentFreeKeyChat\(/);
  assert.equal(typeof mapAgentFreeKeyErrorMessage("FORBIDDEN_ROLE"), "string");
});

console.log(`agent-key-chat-final-fix-unit-test: PASS (${passed})`);
