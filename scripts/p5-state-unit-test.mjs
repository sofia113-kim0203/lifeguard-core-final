/**
 * P5-STATE — unified customer state wiring unit tests (source-level).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildRecentSessionsFromRows,
  createLifeguardSessionId,
  isLifeguardHomeChatRow,
  mapSessionRowsToChatMessages,
  LIFEGUARD_HOME_CHAT_PHASE,
} from "../src/lib/lifeguardChatSessionCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("p5-state-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 session id — UUID-shaped id generated", () => {
      const id = createLifeguardSessionId();
      assert.match(id, /^[0-9a-f-]{36}$|session-/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 recent sessions — grouped by session_id with preview", () => {
      const rows = [
        {
          id: "1",
          role: "user",
          message: "보험료 너무 비싼가?",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s1", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T10:00:00.000Z",
        },
        {
          id: "2",
          role: "assistant",
          message: "답변",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s1", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T10:00:01.000Z",
        },
        {
          id: "3",
          role: "user",
          message: "두 번째 질문",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s2", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T11:00:00.000Z",
        },
      ];
      const sessions = buildRecentSessionsFromRows(rows);
      assert.equal(sessions.length, 2);
      assert.equal(sessions[0].id, "s2");
      assert.equal(sessions[1].preview, "보험료 너무 비싼가?");
      assert.equal(isLifeguardHomeChatRow(rows[0]), true);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 session restore — messages ordered for session_id", () => {
      const rows = [
        {
          id: "a",
          role: "assistant",
          message: "두",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s1", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T10:00:02.000Z",
        },
        {
          id: "b",
          role: "user",
          message: "하나",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s1", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T10:00:01.000Z",
        },
      ];
      const messages = mapSessionRowsToChatMessages(rows, "s1");
      assert.deepEqual(
        messages.map((m) => m.content),
        ["하나", "두"],
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 lifeguard chat — persists via customer_conversations session_id", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      const sessions = readFileSync(join(ROOT, "src/lib/lifeguardChatSessions.js"), "utf8");
      assert.match(sessions, /customer_conversations/);
      assert.match(sessions, /session_id/);
      assert.match(chat, /persistLifeguardChatTurn/);
      assert.match(chat, /listLifeguardRecentSessions/);
      assert.match(chat, /loadLifeguardSessionMessages/);
      assert.match(chat, /createLifeguardSessionId/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T5 insurance panel — unifiedState.policies with premium", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chat, /unifiedState\?\.policies/);
      assert.match(chat, /CustomerInsuranceList/);
      assert.match(chat, /insurer_name/);
      assert.match(chat, /monthly_premium/);
      assert.doesNotMatch(chat, /등록된 보험이 있어요\. 궁금한 점은/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T6 documents panel — listDocuments read-only retained", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chat, /listDocuments\(authUser/);
      assert.match(chat, /formatOcrStatus/);
      assert.match(chat, /formatAnalysisComplete/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
