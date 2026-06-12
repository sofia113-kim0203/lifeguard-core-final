/**
 * Unit tests for claudeHealthCore (mocked fetch, no real API key output).
 */
import assert from "node:assert/strict";
import { handleClaudeHealthCheck } from "../server/claudeHealthCore.js";

async function testMissingKey() {
  const result = await handleClaudeHealthCheck({
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ANTHROPIC_API_KEY_MISSING");
}

async function testSuccess() {
  const result = await handleClaudeHealthCheck({
    env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "claude-sonnet-4-6" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === "request-id" ? "req_test_123" : null) },
      text: async () =>
        JSON.stringify({
          id: "msg_test",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "CLAUDE_OK" }],
        }),
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "claude");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.request_id, "req_test_123");
  assert.match(result.response_text_preview, /CLAUDE_OK/);
}

async function testApiError() {
  const result = await handleClaudeHealthCheck({
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error_type, "authentication_error");
  assert.match(result.error_body_preview, /invalid x-api-key/);
}

await testMissingKey();
await testSuccess();
await testApiError();
console.log("claude-health-unit-test: PASS");
