/**
 * Verify insurance fact questions use full policy/memory data (김진우 production customer).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";
import { buildDirectFactualAnswer } from "../server/customerConversationalTone.js";
import { ensureCustomerMemoryContext } from "../server/customerMemoryContextSync.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const CUSTOMER_ID = "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const memoryContext = await ensureCustomerMemoryContext({ supabase, customerId: CUSTOMER_ID });
const workingContext = {
  snapshot: memoryContext.snapshot,
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
};

const countAnswer = buildDirectFactualAnswer("나의 보험 총 건수는?", workingContext);
const insurerAnswer = buildDirectFactualAnswer("내가 가입한 보험사는?", workingContext);
const listAnswer = buildDirectFactualAnswer("내가 가입한 보험은?", workingContext);
const fastCount = buildFastConversationalResponse({
  question: "나의 보험 총 건수는?",
  memorySnapshot: memoryContext.snapshot,
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
  cachePayload: { cache_status: "missing" },
});

console.log("COUNT:", countAnswer);
console.log("INSURER:", insurerAnswer);
console.log("LIST:", listAnswer?.slice(0, 300));
console.log("FAST:", fastCount?.slice(0, 200));

assert.match(countAnswer, /총 8건/, "policy count must be 8");
assert.match(insurerAnswer, /삼성화재/, "must include 삼성화재");
assert.match(insurerAnswer, /한화생명/, "must include 한화생명");
assert.match(insurerAnswer, /DB손해보험/, "must include DB손해보험");
assert.match(insurerAnswer, /메리츠화재/, "must include 메리츠화재");
assert.match(listAnswer, /메리츠화재/, "policy list must include 메리츠화재");
assert.match(fastCount, /총 8건/, "fast response must say 8");

assert.equal(memoryContext.sourceSummary.insurance.length, 8, "sourceSummary must include all policies");

console.log("\nALL ASSERTIONS PASSED");
