/**
 * P0 — dedupeMessagesById + loadMessages display path smoke test.
 */
import assert from "node:assert/strict";
import {
  dedupeMessagesById,
  filterMessagesForDisplay,
} from "../src/lib/conversationMessageUtils.js";

function normalizeConversationMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    role: row.role,
    message: row.message,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

const productionLikeRows = [
  {
    id: "user-1",
    customer_id: "cust-1",
    role: "user",
    message: "하이",
    metadata_json: { source: "customer_dashboard", phase: "casual-chat", intent: "casual_chat" },
    created_at: "2026-06-12T10:00:00.000Z",
  },
  {
    id: "assistant-1",
    customer_id: "cust-1",
    role: "assistant",
    message: "안녕하세요! 편하게 말씀해 주세요.",
    metadata_json: { source: "casual_claude", intent: "casual_chat", phase: "casual-chat" },
    created_at: "2026-06-12T10:00:01.000Z",
  },
  {
    id: "user-1",
    customer_id: "cust-1",
    role: "user",
    message: "하이",
    metadata_json: { source: "customer_dashboard", phase: "casual-chat", intent: "casual_chat" },
    created_at: "2026-06-12T10:00:00.000Z",
  },
  null,
  undefined,
  {
    customer_id: "cust-1",
    role: "system",
    message: "문서가 업로드되었습니다.",
    metadata_json: { phase: "phase28-1b" },
    created_at: "2026-06-12T09:59:00.000Z",
  },
].map((row) => (row ? normalizeConversationMessage(row) : row));

const deduped = dedupeMessagesById(productionLikeRows);
assert.equal(deduped.length, 3, "duplicate id removed, id-less row kept");
assert.equal(deduped.filter((row) => row.role === "user").length, 1);

const displayed = filterMessagesForDisplay(deduped);
assert.equal(displayed.length, 3);
assert.ok(displayed.some((row) => row.metadata?.source === "casual_claude"));

const merged = filterMessagesForDisplay(
  dedupeMessagesById([
    ...deduped,
    {
      id: "temp-fast-1",
      customerId: "cust-1",
      role: "assistant",
      message: "optimistic",
      metadata: { phase: "phase26-2a-fast", optimistic: true },
      createdAt: "2026-06-12T10:00:02.000Z",
    },
  ]),
);
assert.ok(merged.length >= 3);

console.log("dedupe-messages-load-test: PASS");
