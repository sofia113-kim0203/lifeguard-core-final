/**
 * PR-M1 — Memory observability unit tests (no network / DB).
 */
import assert from "node:assert/strict";
import {
  assessMemoryBuilderInvoke,
  assessMemorySyncNeed,
  resolveMemoryDisplayStatus,
} from "../server/memoryObservability.js";

assert.deepEqual(assessMemoryBuilderInvoke({ status: 200, body: { facts_changed: 2 } }), {
  ok: true,
  status: 200,
  body: { facts_changed: 2 },
  error: null,
});

assert.deepEqual(assessMemoryBuilderInvoke({ status: 403, body: { error: "service_role_required" } }), {
  ok: false,
  status: 403,
  body: { error: "service_role_required" },
  error: "service_role_required",
});

assert.deepEqual(assessMemoryBuilderInvoke({ status: 200, body: { error: "customer_not_found" } }), {
  ok: false,
  status: 200,
  body: { error: "customer_not_found" },
  error: "customer_not_found",
});

const emptyMemoryAssessment = assessMemorySyncNeed(
  { has_profile: true, has_health: false, has_policies: true },
  { facts: [], fact_count: 0 },
);
assert.equal(emptyMemoryAssessment.needed, true);
assert.equal(emptyMemoryAssessment.reason, "memory_empty_but_source_exists");
assert.equal(
  resolveMemoryDisplayStatus({ syncAssessment: emptyMemoryAssessment }),
  "degraded",
);

assert.equal(
  resolveMemoryDisplayStatus({
    rebuildError: { code: "memory_builder_invoke_failed", partial: false },
  }),
  "failed",
);

assert.equal(
  resolveMemoryDisplayStatus({
    rebuildError: { code: "memory_builder_partial_failure", partial: true },
  }),
  "degraded",
);

assert.equal(
  resolveMemoryDisplayStatus({
    rebuildSucceeded: true,
    syncAssessment: emptyMemoryAssessment,
  }),
  "ready",
);

console.log(JSON.stringify({ ok: true, phase: "pr-m1-memory-observability-unit" }, null, 2));
