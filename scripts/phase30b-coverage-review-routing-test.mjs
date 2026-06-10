/**
 * Phase 30-B — coverage_review_request routing + display filter verification.
 */
import assert from "node:assert/strict";
import {
  classifyConsultationIntent,
  resolvePipelineManifest,
  resolveSkippedStages,
} from "../server/intentGateLayer.js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";
/** Inline display filter test — avoids browser supabase import. */
function dedupeMessagesById(rows) {
  const byId = new Map();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function filterMessagesForDisplay(rows) {
  const deduped = dedupeMessagesById(rows);
  const resultJobIds = new Set(
    deduped
      .filter(
        (row) =>
          row?.metadata?.phase === "phase26-2a-result" &&
          row?.metadata?.analysis_job_id,
      )
      .map((row) => String(row.metadata.analysis_job_id)),
  );

  return deduped.filter((row) => {
    if (row?.metadata?.phase !== "phase26-2a-fast") return true;
    const jobId = row?.metadata?.analysis_job_id;
    if (!jobId) return true;
    return !resultJobIds.has(String(jobId));
  });
}

const ROUTING_CASES = [
  {
    question: "내보험 보장분석해줘",
    intent: "coverage_review_request",
    manifest: ["coverage_gap", "result_claude"],
    fastIncludes: "현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다",
  },
  {
    question: "보장분석해줘",
    intent: "coverage_review_request",
    manifest: ["coverage_gap", "result_claude"],
    fastIncludes: "현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다",
  },
  {
    question: "보장 상태 확인해줘",
    intent: "coverage_review_request",
    manifest: ["coverage_gap", "result_claude"],
    fastIncludes: "현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다",
  },
  {
    question: "운전자보험 있나요?",
    intent: "factual_lookup",
    manifest: ["result_claude"],
    fastIncludes: null,
  },
  {
    question: "청구 가능할까요?",
    intent: "claim_eligibility_check",
    manifest: ["result_claude"],
    fastIncludes: "약관과 서류 확인이 필요합니다",
  },
  {
    question: "뭘 가입해야 해?",
    intent: "recommendation_request",
    manifest: ["coverage_gap", "recommendation", "result_claude"],
    fastIncludes: null,
  },
];

const routingResults = [];

for (const testCase of ROUTING_CASES) {
  const classification = classifyConsultationIntent(testCase.question);
  const manifest = resolvePipelineManifest(classification.intent);
  const skipped = resolveSkippedStages(manifest);

  assert.equal(
    classification.intent,
    testCase.intent,
    `${testCase.question} intent mismatch: ${classification.intent}`,
  );
  assert.notEqual(
    classification.intent,
    "general_consultation",
    `${testCase.question} must not fall back to general_consultation`,
  );
  assert.deepEqual(manifest, testCase.manifest, `${testCase.question} manifest mismatch`);

  if (testCase.intent === "factual_lookup") {
    assert.ok(skipped.includes("coverage_gap"), `${testCase.question} should skip coverage_gap`);
  }
  if (testCase.intent === "claim_eligibility_check") {
    assert.ok(skipped.includes("coverage_gap"), `${testCase.question} should skip coverage_gap`);
  }

  const fastResponse = buildFastConversationalResponse({
    question: testCase.question,
    memorySnapshot: { facts: [], fact_count: 0 },
    cachePayload: null,
    sourceContext: { has_policies: true, policies: [{ insurer_name: "한화", product_name: "실손보험" }] },
    sourceSummary: {
      policy_count: 1,
      insurance: [{ insurer_name: "한화", product_name: "실손보험" }],
    },
    intentGate: {
      intent: classification.intent,
      result_mode:
        classification.intent === "factual_lookup"
          ? "light"
          : classification.intent === "claim_eligibility_check"
            ? "claim_light"
            : classification.intent === "coverage_review_request"
              ? "coverage_review_light"
              : "standard",
    },
  });

  if (testCase.fastIncludes) {
    assert.ok(
      fastResponse.includes(testCase.fastIncludes),
      `${testCase.question} fast response missing phrase: ${fastResponse}`,
    );
  }

  routingResults.push({
    question: testCase.question,
    intent: classification.intent,
    manifest,
    fast_preview: fastResponse.slice(0, 160),
  });
}

assert.equal(classifyConsultationIntent("암보험 부족해?").intent, "coverage_gap_check");

const jobId = "job-test-123";
const rows = dedupeMessagesById([
  {
    id: "user-1",
    role: "user",
    message: "보장분석해줘",
    metadata: { phase: "phase26-2a" },
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "fast-1",
    role: "assistant",
    message: "먼저 안내드립니다.",
    metadata: { phase: "phase26-2a-fast", analysis_job_id: jobId },
    createdAt: "2026-01-01T00:00:01Z",
  },
  {
    id: "result-1",
    role: "assistant",
    message: "보장 상태를 정리해 드리겠습니다.",
    metadata: { phase: "phase26-2a-result", analysis_job_id: jobId },
    createdAt: "2026-01-01T00:00:02Z",
  },
]);

const displayed = filterMessagesForDisplay(rows);
assert.equal(displayed.length, 2, "fast should be hidden when result exists");
assert.ok(
  displayed.some((row) => row.metadata?.phase === "phase26-2a-result"),
  "result row must remain visible",
);
assert.ok(
  !displayed.some((row) => row.metadata?.phase === "phase26-2a-fast"),
  "fast row must be hidden",
);

const fastOnly = filterMessagesForDisplay(rows.filter((row) => row.id !== "result-1"));
assert.equal(fastOnly.length, 2, "fast remains visible when result is absent");

console.log(
  JSON.stringify(
    {
      phase: "30b-coverage-review-routing",
      pass: true,
      routing_results: routingResults,
      display_filter: {
        with_result_count: displayed.length,
        fast_only_count: fastOnly.length,
      },
    },
    null,
    2,
  ),
);
