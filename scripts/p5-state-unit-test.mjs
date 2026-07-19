/**
 * P5-STATE — unified customer state wiring unit tests (source-level).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildAssistantTurnMetadata,
  buildPersistableTurnTraceSummary,
  buildRecentSessionsFromRows,
  createLifeguardSessionId,
  isLifeguardHomeChatRow,
  mapSessionRowsToChatMessages,
  mergeRestoredSessionMessages,
  resolveActiveLifeguardSessionId,
  resolveActiveSessionGoalFromMessages,
  sanitizeMessagesForChatSnapshot,
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
      assert.match(sessions, /visualBlocks/);
      assert.match(chat, /persistLifeguardChatTurn/);
      assert.match(chat, /visualBlocks/);
      assert.match(chat, /mergeRestoredSessionMessages/);
      assert.match(chat, /threadRestoreReady/);
      assert.match(chat, /listLifeguardRecentSessions/);
      assert.match(chat, /loadLifeguardSessionMessages/);
      assert.match(chat, /createLifeguardSessionId/);
      assert.match(chat, /writeLifeguardChatSnapshot/);
      assert.match(chat, /readLifeguardChatSnapshot/);
      assert.match(chat, /oneKeyCoreTraceSummary/);
      assert.match(chat, /composeMode/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T7 visual_blocks — metadata persist + restore roundtrip", () => {
      const blocks = [
        {
          type: "premium_summary_table",
          title: "확인된 납입 요약",
          rows: [["등록 계약 수", "22건", "전체 등록 기준"]],
        },
      ];
      const gate = { accepted_count: 1, omitted_count: 0, omitted: [] };
      const metadata = buildAssistantTurnMetadata("s1", { visualBlocks: blocks, visualBlocksGate: gate });
      assert.equal(metadata.visual_blocks.length, 1);
      assert.equal(metadata.visual_blocks_gate.accepted_count, 1);

      const rows = [
        {
          id: "u1",
          role: "user",
          message: "내보험료 얼마야",
          metadata: { phase: LIFEGUARD_HOME_CHAT_PHASE, session_id: "s1", source: "lifeguard_home_chat" },
          createdAt: "2026-06-17T10:00:01.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          message: "등록된 계약은 22건입니다.",
          metadata,
          createdAt: "2026-06-17T10:00:02.000Z",
        },
      ];
      const restored = mapSessionRowsToChatMessages(rows, "s1");
      assert.equal(restored.length, 2);
      assert.equal(restored[1].visual_blocks?.length, 1);
      assert.equal(restored[1].visual_blocks_gate?.accepted_count, 1);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T8 visual_blocks — merge keeps in-memory blocks when restore omits", () => {
      const blocks = [{ type: "policy_count_summary", title: "계약 확인 요약", rows: [] }];
      const inMemory = [
        { role: "user", content: "내보험 분석해줘" },
        { role: "assistant", content: "등록된 계약은 22건입니다.", visual_blocks: blocks },
      ];
      const restored = [
        { role: "user", content: "내보험 분석해줘" },
        { role: "assistant", content: "등록된 계약은 22건입니다." },
      ];
      const merged = mergeRestoredSessionMessages(inMemory, restored);
      assert.equal(merged[1].visual_blocks?.length, 1);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T9 visual_blocks — merge appends in-flight tail not yet in restore", () => {
      const blocks = [{ type: "premium_summary_table", title: "확인된 납입 요약", rows: [] }];
      const inMemory = [
        { role: "user", content: "내보험료 얼마야" },
        { role: "assistant", content: "월 4만5천 원이 확인돼 있어요.", visual_blocks: blocks },
      ];
      const restored = [];
      const merged = mergeRestoredSessionMessages(inMemory, restored);
      assert.equal(merged.length, 2);
      assert.equal(merged[1].visual_blocks?.length, 1);
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

  if (
    await runCase("T10 trace summary — persistable fields only (no secrets)", () => {
      const summary = buildPersistableTurnTraceSummary({
        response_latency_ms: 12345,
        response_source: "one_key_core",
        one_key_core_trace: {
          steps: [
            { step: "interpret", at_ms: 12 },
            {
              step: "speak",
              at_ms: 30000,
              payload: {
                compose_mode: "key_master_question",
                key_speak_master: true,
                key_voice_trace: {
                  borrowed_senses_calls: 1,
                  s6_speak_calls: 1,
                  fallback_used: false,
                  gate_result: { ok: true },
                  hard_safety_repair_attempt: false,
                  latency_marks: {
                    borrowed_shadow_probe: { enter_ms: 100, exit_ms: 20100, duration_ms: 20000 },
                    s6_speak: {
                      enter_ms: 20500,
                      exit_ms: 35000,
                      duration_ms: 14500,
                      s6_speak_call_count: 1,
                    },
                    gate: { enter_ms: 35000, exit_ms: 35005, duration_ms: 5 },
                    finalize: { enter_ms: 36000, exit_ms: 36002, duration_ms: 2 },
                    seal: { enter_ms: 36001, exit_ms: 36002, duration_ms: 1 },
                    provider: {
                      provider_call_count: 3,
                      borrowed_provider_call_count: 2,
                      s6_provider_call_count: 1,
                      error_types: [],
                    },
                  },
                  borrowed_senses_shadow: {
                    final_answer_source: "claude_candidate",
                    public_research_evidence: {
                      status: "success",
                      used: true,
                      search_count: 1,
                      results: [{ title: "A" }, { title: "B" }],
                    },
                  },
                },
              },
            },
            { step: "persona", at_ms: 36010, payload: { ghost_path_reached: [] } },
          ],
        },
      });
      assert.equal(summary.compose_mode, "key_master_question");
      assert.equal(summary.response_latency_ms, 12345);
      assert.equal(summary.one_key_core_trace_summary.web_search_executed, true);
      assert.equal(summary.one_key_core_trace_summary.web_search_result_count, 2);
      assert.equal(summary.one_key_core_trace_summary.borrowed_executed, true);
      assert.equal(summary.one_key_core_trace_summary.ghost_path_reached_count, 0);
      assert.equal(summary.one_key_core_trace_summary.steps[0].at_ms, 12);
      assert.equal(summary.one_key_core_trace_summary.s6_speak_call_count, 1);
      assert.equal(
        summary.one_key_core_trace_summary.latency_marks.borrowed_shadow_probe.duration_ms,
        20000,
      );
      assert.equal(summary.one_key_core_trace_summary.latency_marks.s6_speak.s6_speak_call_count, 1);
      assert.equal(summary.one_key_core_trace_summary.latency_marks.provider.provider_call_count, 3);

      const meta = buildAssistantTurnMetadata("s1", {
        composeMode: summary.compose_mode,
        responseLatencyMs: summary.response_latency_ms,
        oneKeyCoreTraceSummary: summary.one_key_core_trace_summary,
      });
      assert.equal(meta.compose_mode, "key_master_question");
      assert.equal(meta.response_latency_ms, 12345);
      assert.equal(meta.one_key_core_trace_summary.web_search_result_count, 2);
      assert.equal(meta.one_key_core_trace_summary.latency_marks.s6_speak.duration_ms, 14500);
      assert.equal(Object.prototype.hasOwnProperty.call(meta, "one_key_core_trace"), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T11 session snapshot — resolve prefers snapshot; merge keeps seed", () => {
      const active = resolveActiveLifeguardSessionId({
        recentSessions: [{ id: "old" }],
        storedId: "old",
        snapshotSessionId: "inflight",
      });
      assert.equal(active, "inflight");

      const sanitized = sanitizeMessagesForChatSnapshot([
        { role: "user", content: "분당 맛집 추천해줘" },
        { role: "assistant", content: "thinking…", thinking: true },
        { role: "assistant", content: "어떤 분위기를 원하세요?" },
      ]);
      assert.equal(sanitized.length, 2);
      assert.equal(sanitized[1].content, "어떤 분위기를 원하세요?");

      const merged = mergeRestoredSessionMessages(sanitized, []);
      assert.equal(merged.length, 2);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T13 GO3 session_goal — metadata persist + completed beats active", () => {
      const meta = buildAssistantTurnMetadata("s-goal", {
        sessionGoal: {
          goal: "보험료 부담을 줄일 선택지 비교",
          status: "active",
          updated_at: "2026-07-19T12:00:00.000Z",
        },
      });
      assert.equal(meta.session_goal.status, "active");
      assert.equal(meta.session_goal.goal, "보험료 부담을 줄일 선택지 비교");

      const rows = [
        {
          id: "u1",
          role: "user",
          message: "보험료 줄이고 싶어요",
          metadata: {
            phase: LIFEGUARD_HOME_CHAT_PHASE,
            session_id: "s-goal",
            source: "lifeguard_home_chat",
          },
          createdAt: "2026-07-19T12:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          message: "선택지를 비교해 볼게요.",
          metadata: meta,
          createdAt: "2026-07-19T12:00:01.000Z",
        },
      ];
      const msgs = mapSessionRowsToChatMessages(rows, "s-goal");
      assert.equal(resolveActiveSessionGoalFromMessages(msgs)?.goal, "보험료 부담을 줄일 선택지 비교");

      const completedMeta = buildAssistantTurnMetadata("s-goal", {
        sessionGoal: {
          goal: null,
          status: "completed",
          updated_at: "2026-07-19T12:05:00.000Z",
        },
      });
      assert.equal(completedMeta.session_goal.status, "completed");
      assert.equal(completedMeta.session_goal.goal, null);
      const afterDone = [
        ...msgs,
        {
          role: "assistant",
          content: "오늘은 여기까지요.",
          session_goal: completedMeta.session_goal,
        },
      ];
      assert.equal(resolveActiveSessionGoalFromMessages(afterDone), null, "completed beats active");
      assert.equal(buildAssistantTurnMetadata("s-goal", {}).session_goal, undefined);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T12 latency marks — span + error sanitize (no secrets)", async () => {
      const {
        startSpan,
        sanitizeLatencyErrorType,
        buildPersistableLatencyMarks,
        countBorrowedProviderCalls,
      } = await import("../server/keyCore/keyLatencyMarks.js");
      const t0 = Date.now() - 5000;
      const span = startSpan(t0, t0 + 100);
      await new Promise((r) => setTimeout(r, 5));
      const done = span.end(t0 + 250);
      assert.equal(done.enter_ms, 100);
      assert.equal(done.exit_ms, 250);
      assert.equal(done.duration_ms, 150);

      assert.equal(sanitizeLatencyErrorType("CLAUDE_TIMEOUT"), "CLAUDE_TIMEOUT");
      assert.equal(sanitizeLatencyErrorType("CLAUDE_API_429"), "CLAUDE_API_429");
      assert.equal(sanitizeLatencyErrorType("sk-ant-secret-value-here"), "provider_error_other");

      assert.equal(
        countBorrowedProviderCalls({ provider_request_trace: [{}, {}], attempts: 9 }),
        2,
      );

      const marks = buildPersistableLatencyMarks({
        borrowed_shadow_probe: { enter_ms: 1, exit_ms: 2, duration_ms: 1 },
        s6_speak: { enter_ms: 3, exit_ms: 4, duration_ms: 1, s6_speak_call_count: 1 },
        gate: { enter_ms: 4, exit_ms: 5, duration_ms: 1 },
        finalize: { enter_ms: 5, exit_ms: 6, duration_ms: 1 },
        seal: { enter_ms: 5, exit_ms: 6, duration_ms: 1 },
        provider: {
          provider_call_count: 2,
          borrowed_provider_call_count: 1,
          s6_provider_call_count: 1,
          error_types: ["CLAUDE_TIMEOUT"],
        },
      });
      assert.equal(marks.borrowed_shadow_probe.duration_ms, 1);
      assert.equal(marks.provider.error_types[0], "CLAUDE_TIMEOUT");
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
