/**
 * Phase 28 — Offline unit test: policy count aligns with UnifiedCustomerState (8, not is_active filter).
 */
import assert from "node:assert/strict";
import {
  buildDirectFactualAnswer,
  extractCustomerSituation,
  resolveUnifiedPolicyView,
} from "../server/customerConversationalTone.js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";

const QUESTION = "나의 보험 총 건수는?";

const workingContext = {
  sourceSummary: {
    policy_count: 8,
    profile: { name: "김진우" },
    insurance: [
      { insurer: "메리츠화재", product: "상품A", is_active: true },
      { insurer: "삼성화재", product: "상품B", is_active: true },
      { insurer: "한화생명", product: "상품C", is_active: true },
      { insurer: "DB손해보험", product: "상품D", is_active: true },
      { insurer: "현대해상", product: "상품E", is_active: true },
      { insurer: "메리츠화재", product: "상품F", is_active: false },
      { insurer: "한화손해보험", product: "상품G", is_active: false },
      { insurer: "삼성화재", product: "상품H", is_active: false },
    ],
  },
  snapshot: { facts: [], profile: { display_name: "김진우" } },
};

const view = resolveUnifiedPolicyView(workingContext);
assert.equal(view.policyCount, 8, "unified policy view must be 8");
assert.equal(view.policyDescriptions.length, 8, "all maintained policies listed");

const situation = extractCustomerSituation(workingContext);
assert.equal(situation.policyCount, 8, "extractCustomerSituation must not drop to 5 via is_active");

const direct = buildDirectFactualAnswer(QUESTION, workingContext);
assert.match(direct, /총\s*8\s*건/, `direct answer must say 8건: ${direct}`);

const fast = buildFastConversationalResponse({
  question: QUESTION,
  memorySnapshot: workingContext.snapshot,
  sourceContext: null,
  sourceSummary: workingContext.sourceSummary,
  cachePayload: { cache_status: "fresh", background_refresh_types: [] },
});
assert.match(fast, /총\s*8\s*건/, `fast response must say 8건: ${fast}`);

console.log("Phase 28 policy count unit test passed.");
