/**
 * Unit tests for openaiHealthCore (mocked fetch, no API key output).
 */
import assert from "node:assert/strict";
import { EMBEDDING_DIMENSIONS } from "../server/documentRagContext.js";
import { handleOpenAiHealthCheck } from "../server/openaiHealthCore.js";

function mockEmbeddingVector() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index + 1) * 0.001);
}

async function testMissingKey() {
  const result = await handleOpenAiHealthCheck({
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "OPENAI_API_KEY_MISSING");
}

async function testSuccess() {
  const result = await handleOpenAiHealthCheck({
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.model, "text-embedding-3-small");
      assert.equal(body.input, "OPENAI_OK");
      assert.equal(body.dimensions, EMBEDDING_DIMENSIONS);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: "text-embedding-3-small",
            data: [{ embedding: mockEmbeddingVector(), index: 0 }],
          }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "openai");
  assert.equal(result.model, "text-embedding-3-small");
  assert.equal(result.embedding_dimensions, EMBEDDING_DIMENSIONS);
  assert.ok(result.latency_ms >= 0);
}

async function testApiError() {
  const result = await handleOpenAiHealthCheck({
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({
          error: {
            message: "You exceeded your current quota, please check your plan and billing details.",
            type: "insufficient_quota",
            code: "insufficient_quota",
          },
        }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.reason, "OPENAI_API_ERROR");
  assert.equal(result.error_type, "insufficient_quota");
  assert.match(result.error_body_preview, /quota/i);
}

async function testInvalidDimensions() {
  const result = await handleOpenAiHealthCheck({
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ embedding: [0.1, 0.2], index: 0 }],
        }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "OPENAI_INVALID_EMBEDDING");
}

await testMissingKey();
await testSuccess();
await testApiError();
await testInvalidDimensions();
console.log("openai-health-unit-test: PASS");
