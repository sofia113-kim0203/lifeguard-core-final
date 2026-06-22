/**
 * P6-1 — CustomerContextSnapshot + observability unit tests (mock JWT path).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildCustomerContextBundle } from "../server/buildCustomerContextBundle.js";
import { buildMergedRecentConversationSummary } from "../server/customerConversationHistory.js";
import {
  buildLoadedContextFromSnapshot,
  buildReconciliationWarning,
  loadCustomerContextSnapshot,
} from "../server/customerContextSnapshot.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { loadUnifiedCustomerState } from "../server/unifiedCustomerState.js";

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
        _count: null,
        _isFilter: null,
        select(_columns, options = {}) {
          chain._head = options.head === true;
          chain._count = options.count ?? null;
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
  console.log("p6-1-customer-context-snapshot-unit-test");
  let passed = 0;
  let failed = 0;

  const record = async (ok) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  await record(
    await runCase("P6-1A snapshot — no phase filter on conversations", async () => {
      const conversationalRow = {
        id: "conv-1",
        role: "user",
        message: "분당 이야기 했었잖아",
        metadata_json: { phase: "phase26-2a-fast", source: "conversational_background_analysis" },
        created_at: "2026-06-01T10:00:00.000Z",
      };
      const supabase = buildJwtPathMockSupabase({ conversationRows: [conversationalRow] });
      const snapshot = await loadCustomerContextSnapshot(supabase, "cust-jwt");
      assert.equal(snapshot.conversations.phase_filter_applied, false);
      assert.equal(snapshot.flags.has_recent_conversation, true);
      assert.match(snapshot.conversations.source.join(","), /db/);
    }),
  );

  await record(
    await runCase("P6-1B loaded_context contract shape", async () => {
      const supabase = buildJwtPathMockSupabase();
      const snapshot = await loadCustomerContextSnapshot(supabase, "cust-jwt", {
        requestHistory: [{ role: "user", content: "오늘 너무 피곤하네" }],
      });
      const loaded = buildLoadedContextFromSnapshot(snapshot);
      assert.equal(loaded.policies, "present");
      assert.equal(loaded.documents, "present");
      assert.equal(loaded.memory, "present");
      assert.equal(loaded.conversations.phase_filter_applied, false);
      assert.match(loaded.conversations.source.join(","), /request_history/);
      assert.ok(snapshot.context_snapshot_id);
    }),
  );

  await record(
    await runCase("P6-1C reconciliation — sidebar vs snapshot existence match", async () => {
      const supabase = buildJwtPathMockSupabase();
      const [unified, snapshot] = await Promise.all([
        loadUnifiedCustomerState(supabase, "cust-jwt"),
        loadCustomerContextSnapshot(supabase, "cust-jwt"),
      ]);
      const warning = buildReconciliationWarning(unified, snapshot);
      assert.equal(warning, null);
    }),
  );

  await record(
    await runCase("P6-1D home-brain — observability fields on every turn", async () => {
      const supabase = buildJwtPathMockSupabase({ policies: [], documents: [], documentCount: 0 });
      const result = await handleHomeBrainFactRequest({
        question: "안녕",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => ({ ok: false, text: "fallback" }),
      });
      assert.equal(result.ok, true);
      assert.ok(result.loaded_context);
      assert.equal(result.loaded_context.conversations.phase_filter_applied, false);
      assert.ok(result.selected_route);
      assert.ok(Array.isArray(result.factory_called));
      assert.ok(result.guard_result);
      assert.ok(result.context_snapshot_id);
      assert.equal(result.loaded_context.policies, "empty");
    }),
  );

  await record(
    await runCase("P6-1E client mapper preserves observability fields", () => {
      const source = readFileSync(join(ROOT, "src/lib/customerHomeBrainFact.js"), "utf8");
      assert.match(source, /loadedContext: payload\.loaded_context/);
      assert.match(source, /selectedRoute: payload\.selected_route/);
      assert.match(source, /guardResult: payload\.guard_result/);
      assert.match(source, /contextSnapshotId: payload\.context_snapshot_id/);
    }),
  );

  await record(
    await runCase("P6-1F history merge — turn excerpt not insurance topic taxonomy", () => {
      const summary = buildMergedRecentConversationSummary([], [
        { role: "user", content: "분당에서 가족이랑 갈 만한 곳" },
      ]);
      assert.equal(summary.hasHistory, true);
      assert.match(summary.latestUserMessageExcerpt, /분당/);
      assert.equal("topics" in summary, false);
    }),
  );

  await record(
    await runCase("P6-1G bundle loader delegates to snapshot", async () => {
      const supabase = buildJwtPathMockSupabase();
      const bundle = await buildCustomerContextBundle(supabase, "cust-jwt");
      assert.equal(bundle.policies.length, 1);
      assert.ok(bundle.recentConversation);
    }),
  );

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
