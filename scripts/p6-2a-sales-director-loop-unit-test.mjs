/**
 * P6-2A — Sales Director Loop skeleton unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SALES_DIRECTOR_MODES, decideSalesDirectorMode } from "../server/salesDirectorLoop.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { matchP5BrainPilotQuestion } from "../server/p5BrainPilotQuestions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손",
    monthly_premium: 116568,
    policy_type: "health",
  },
];

function buildJwtPathMockSupabase({
  policies = mockPolicies,
  documents = [{ id: "doc-1", original_filename: "보장내역서.pdf", ingest_status: "ready" }],
  documentCount = 1,
  conversationRows = [],
  memoryFacts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료" }],
  consents = [{ id: "c1", consent_type: "terms_of_service", granted: true }],
} = {}) {
  return {
    from(table) {
      const chain = {
        _head: false,
        select(_columns, options = {}) {
          chain._head = options.head === true;
          return chain;
        },
        eq() {
          return chain;
        },
        is(column, value) {
          chain._isFilter = { column, value };
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return {
              data: { id: "cust-jwt", display_name: "QA", memory_version: 1 },
              error: null,
            };
          }
          if (table === "profile_health") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: policies, error: null };
          }
          if (table === "customer_memory_facts") {
            const facts = memoryFacts.filter((fact) => {
              if (chain._isFilter?.column === "superseded_at") {
                return fact.superseded_at == null;
              }
              return true;
            });
            if (chain._head) {
              payload = { data: null, error: null, count: facts.length };
            } else {
              payload = { data: facts, error: null, count: facts.length };
            }
          }
          if (table === "customer_documents") {
            payload = { data: documents, error: null, count: documentCount };
          }
          if (table === "customer_conversations") {
            payload = { data: conversationRows, error: null };
          }
          if (table === "customer_consents") {
            payload = { data: consents, error: null };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

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
  console.log("p6-2a-sales-director-loop-unit-test");
  let passed = 0;
  let failed = 0;
  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  await record(
    await runCase("S1 mode mapping — pilot/chat/defer/gap", () => {
      assert.equal(
        decideSalesDirectorMode({ question: "보험료 너무 비싼가?" }).mode,
        SALES_DIRECTOR_MODES.PILOT,
      );
      assert.equal(decideSalesDirectorMode({ question: "안녕" }).mode, SALES_DIRECTOR_MODES.CHAT);
      assert.equal(
        decideSalesDirectorMode({ question: "내 보험료 얼마야?" }).mode,
        SALES_DIRECTOR_MODES.DEFER,
      );
    }),
  );

  await record(
    await runCase("S2 home-brain — sales_director_loop observability on pilot", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "보험료 너무 비싼가?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.sales_director_loop, true);
      assert.equal(result.selected_route, SALES_DIRECTOR_MODES.PILOT);
      assert.equal(result.response_source, "sales_director_pilot_compose");
      assert.equal(result.loaded_context.conversations.phase_filter_applied, false);
      assert.ok(result.sales_director_trace?.truth_gate?.claims_validation === null);
    }),
  );

  await record(
    await runCase("S3 casual hello — sales_director_chat_mode", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "안녕",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => ({ ok: true, text: "안녕하세요.", response_source: "lifeguard_claude" }),
      });
      assert.equal(result.selected_route, SALES_DIRECTOR_MODES.CHAT);
      assert.match(result.response_source, /^sales_director_chat_/);
      assert.equal(result.sales_director_loop, true);
    }),
  );

  await record(
    await runCase("S4 defer path — snapshot-backed factsUsed when policies present", async () => {
      const supabase = buildJwtPathMockSupabase();
      const result = await handleHomeBrainFactRequest({
        question: "내 보험료 얼마야?",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.selected_route, SALES_DIRECTOR_MODES.DEFER);
      assert.equal(result.response_source, "sales_director_guarded_hold");
      assert.equal(result.loaded_context.policies, "present");
      assert.ok(result.factsUsed.totalCount > 0);
    }),
  );

  await record(
    await runCase("S5 wiring — homeBrainFactCore uses runSalesDirectorLoopTurn", () => {
      const source = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");
      assert.match(source, /runSalesDirectorLoopTurn/);
      assert.match(source, /sales_director_loop: true/);
      assert.doesNotMatch(source, /runHomeAgentTomTurn\(/);
    }),
  );

  await record(
    await runCase("S6 P5 pilot regex still present", () => {
      assert.ok(matchP5BrainPilotQuestion("보험료 너무 비싼가?"));
      const tom = readFileSync(join(ROOT, "server/homeAgentTom.js"), "utf8");
      assert.match(tom, /matchP5BrainPilotQuestion/);
    }),
  );

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
