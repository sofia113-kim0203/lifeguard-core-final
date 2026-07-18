/**
 * ONE KEY Core S02-1 — document event hand unit tests (local only · no PASS).
 */
import assert from "node:assert/strict";
import {
  isOneKeyCoreDocumentEnabled,
  ONE_KEY_CORE_RESPONSE_SOURCE,
  resolveOneKeyCoreDocumentEnv,
} from "../server/keyCore/oneKeyCoreFlags.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";
import { ONE_KEY_CORE_DOCUMENT_STEPS } from "../server/keyCore/oneKeyCoreDocument.js";
import { KEY_UPLOAD_ENTRY_MODES } from "../server/keyBrain/uploadEntryFlags.js";

const CUSTOMER_ID = "cust-one-key-core-doc-s021";
const DOCUMENT = {
  id: "doc-s021-1",
  customer_id: CUSTOMER_ID,
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  doc_class: null,
  customer_hint_type: "insurance_policy",
  mime_type: "application/pdf",
  metadata_json: {},
  created_at: new Date().toISOString(),
};

function buildMockSupabase({ customerId = CUSTOMER_ID, persistOk = true } = {}) {
  const metadata = { ...(DOCUMENT.metadata_json ?? {}) };
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data: table === "customer_profiles" ? { id: customerId, display_name: "S021QA" } : null,
          error: null,
        }),
        update(payload) {
          if (table === "customer_documents" && payload?.metadata_json) {
            Object.assign(metadata, payload.metadata_json);
          }
          const updateChain = {
            eq() {
              return updateChain;
            },
            then(onFulfilled, onRejected) {
              if (table === "customer_documents" && !persistOk) {
                return Promise.resolve({ data: null, error: { message: "persist_failed" } }).then(
                  onFulfilled,
                  onRejected,
                );
              }
              return Promise.resolve({ data: [{ id: DOCUMENT.id }], error: null }).then(onFulfilled, onRejected);
            },
          };
          return updateChain;
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") payload = { data: [], error: null };
          if (table === "customer_memory_facts") payload = { data: [], error: null, count: 0 };
          if (table === "analysis_jobs") payload = { data: [], error: null };
          if (table === "customer_consents") payload = { data: [{ id: "consent-1" }], error: null };
          if (table === "customer_documents" && !persistOk) {
            payload = { data: null, error: { message: "persist_failed" } };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function buildEnv() {
  return {
    ...resolveOneKeyCoreDocumentEnv(process.env),
    ONE_KEY_CORE_DOCUMENT: "1",
    KEY_UPLOAD_ENTRY: "active",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    ANTHROPIC_API_KEY: "mock-key",
  };
}

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

await runCase("S02-1-1 document flag gate", () => {
  assert.equal(isOneKeyCoreDocumentEnabled({ ONE_KEY_CORE_DOCUMENT: "1" }), true);
  assert.equal(isOneKeyCoreDocumentEnabled({ ONE_KEY_CORE_DOCUMENT: "0" }), false);
});

await runCase("S02-1-2 runOneKeyCoreTurn document 8-step trace", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "document",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    document: DOCUMENT,
    hasAnalysisConsent: true,
    uploadEntryMode: KEY_UPLOAD_ENTRY_MODES.ACTIVE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.DOCUMENT);
  assert.equal(result.event, "document");
  assert.ok(result.traceComplete);
  const steps = (result.oneKeyCoreTrace?.steps ?? []).map((row) => row.step);
  for (const step of ONE_KEY_CORE_DOCUMENT_STEPS) {
    assert.ok(steps.includes(step), `missing step ${step}`);
  }
  // Document intake no longer emits customer acknowledgment; Claude-first answers on question turn.
  assert.equal(result.customerFirstSentence, null);
  assert.ok(result.workOrderId);
  assert.equal(result.intakeTrace.response_source, ONE_KEY_CORE_RESPONSE_SOURCE.DOCUMENT);
  assert.equal(result.intakeTrace.one_key_core_event, "document");
  assert.equal(result.intakeTrace.customer_first_sentence, result.customerFirstSentence);
  assert.equal(result.intakeTrace.key_first_judgment?.document_id, DOCUMENT.id);
  assert.equal(result.oneKeyCoreTrace.steps.find((r) => r.step === "evidence")?.payload?.factory_explain_invoked, false);
});

await runCase("S02-1-3 intake contract fields preserved", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "document",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    document: DOCUMENT,
    hasAnalysisConsent: true,
    uploadEntryMode: KEY_UPLOAD_ENTRY_MODES.ACTIVE,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  const trace = result.intakeTrace;
  assert.ok(Array.isArray(trace.trace_steps));
  assert.ok(trace.trace_steps.some((row) => row.step === "key_first_judgment"));
  assert.ok(trace.trace_steps.some((row) => row.step === "work_order_issued"));
  assert.ok(trace.dispatch_plan);
  assert.equal(result.customerFirstSentence, null);
  assert.equal(result.personaMeta?.generation_mode, "suppressed_document_intake_speak");
});

await runCase("S02-1-4 shadow mode — no work order mint", async () => {
  const env = buildEnv();
  const result = await runOneKeyCoreTurn({
    event: "document",
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    document: DOCUMENT,
    hasAnalysisConsent: true,
    uploadEntryMode: KEY_UPLOAD_ENTRY_MODES.SHADOW,
    env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.workOrderId, null);
  assert.equal(result.oneKeyCoreTrace.steps.find((r) => r.step === "work_order")?.payload?.shadow_only, true);
});

console.log(`\nONE KEY Core S02-1: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
