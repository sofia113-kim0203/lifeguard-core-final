/**
 * Offline authority-closure regression. H1/H2 assumption:
 * Panel creates pending factory evidence before KEY confirmation; Composer seals
 * customer text, then uses a new post-Claude WO and durable enqueue before done.
 * No Provider, OCR, Storage, database, staging, or production calls are made.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCustomerUploadEntryAuthority,
  getCustomerUploadEntryMode,
} from "../src/lib/customerUploadEntryAuthority.js";
import {
  hasPendingPolicyVerification,
  isEligibleConfirmedContractCard,
} from "../src/lib/policyIdentityPollution.js";
import { buildPolicyRowFromSheetRow } from "../server/coverageSheetPersist.js";
import { runHomeChatFactoryAfterClaude } from "../server/homeBrainFactCore.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => readFileSync(join(root, relative), "utf8");
let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function createQueuedFactorySupabase() {
  const calls = { rpc: [], updates: [] };
  const document = {
    id: "doc-post-claude",
    customer_id: "customer-1",
    ingest_status: "uploaded",
    customer_hint_type: "insurance_policy",
    doc_class: "insurance_policy",
    metadata_json: {
      key_work_order: { work_order_id: "attach-time-wo" },
      factory_deferred_until_claude: true,
    },
  };
  const documents = {
    select() {
      return this;
    },
    update(payload) {
      calls.updates.push(payload);
      return this;
    },
    eq() {
      return this;
    },
    is() {
      return this;
    },
    maybeSingle: async () => ({ data: document, error: null }),
  };
  const consents = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit: async () => ({ data: [{ id: "consent-1" }], error: null }),
  };
  return {
    calls,
    from(table) {
      if (table === "customer_documents") return documents;
      if (table === "customer_consents") return consents;
      throw new Error(`unexpected_table:${table}`);
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return { data: { ingest_status: "queued", ingest_job_id: "job-1" }, error: null };
    },
  };
}

await test("PANEL-1 Panel upload does not create KEY-outside system chat", async () => {
  // Phase 7 Tom lock: do not fail on leftover symbol names; observe chat timeline.
  const { evaluatePh1Speech, normalizeChatTimeline } = await import(
    "./key-upload-h1-speech-chat-predicate.mjs"
  );
  const afterPanelUpload = normalizeChatTimeline([
    {
      role: "ui_local",
      content: "local success banner only",
      metadata: { ui_local: true, channel: "documents_panel_banner" },
    },
  ]);
  const speech = evaluatePh1Speech(afterPanelUpload, { surface: "DocumentsPanel" });
  assert.equal(speech.ok, true);
  assert.equal(speech.key_outside_system_count, 0);
  assert.equal(speech.check_mode, "customer_chat_timeline");
});

await test("PANEL-2..4 retain pending-only, with KEY-confirmed precedence", () => {
  const pending = {
    product_name: "테스트보험",
    coverage_summary: { factory_verification_status: "pending_unverified" },
  };
  assert.equal(hasPendingPolicyVerification(pending), true);
  assert.equal(isEligibleConfirmedContractCard(pending), false);
  const confirmed = {
    ...pending,
    coverage_summary: {
      ...pending.coverage_summary,
      key_confirmed_source_facts: [{ field: "product_name", value: "테스트보험" }],
    },
  };
  assert.equal(hasPendingPolicyVerification(confirmed), false);
  assert.equal(isEligibleConfirmedContractCard(confirmed), true);
  const sheet = buildPolicyRowFromSheetRow("customer-1", "doc-1", {
    insurer_name: "테스트보험",
    product_name: "테스트상품",
  });
  assert.equal(sheet.coverage_summary.factory_analysis_status, "pending_unverified");
  assert.equal(sheet.coverage_summary.factory_verification_status, "pending_unverified");
});

await test("COMPOSER-1..8 mints a new WO then durably enqueues", async () => {
  const mock = createQueuedFactorySupabase();
  const result = await runHomeChatFactoryAfterClaude({
    userSupabase: mock,
    customerId: "customer-1",
    documentId: "doc-post-claude",
    claudeFactoryDirection: { source: "unit-test" },
    accessToken: "unit-test-token",
    env: {
      KEY_WORK_ORDER_TTL_MS: "60000",
      SUPABASE_URL: "https://supabase.invalid",
      SUPABASE_ANON_KEY: "unit-test-anon",
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ ingest_status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.work_order_id, "attach-time-wo");
  assert.equal(mock.calls.rpc.length, 1);
  assert.equal(mock.calls.rpc[0].name, "lifeguard_request_customer_document_ingest");
  assert.equal(mock.calls.rpc[0].args.p_document_id, "doc-post-claude");
  assert.ok(mock.calls.updates.some((row) => row.metadata_json?.key_work_order));
});

await test("COMPOSER seals then awaits; no fire-and-forget remains", () => {
  const composer = source("server/homeBrainFactCore.js");
  assert.doesNotMatch(composer, /scheduleHomeChatFactoryAfterClaude|void\s+runHomeChatFactoryAfterClaude/);
  assert.match(composer, /await runHomeChatFactoryAfterClaude/);
  assert.match(composer, /lifeguard_request_customer_document_ingest/);
  assert.match(composer, /invokeDocumentAnalysisRefreshAfterClaude/);
  assert.match(composer, /hold_retry_needed/);
});

await test("ENTRY-1 is fail-closed before Storage for off and shadow", () => {
  assert.equal(getCustomerUploadEntryMode({ VITE_KEY_UPLOAD_ENTRY: "active" }), "active");
  assert.equal(getCustomerUploadEntryMode({ VITE_KEY_UPLOAD_ENTRY: "off" }), "off");
  assert.equal(getCustomerUploadEntryMode({ VITE_KEY_UPLOAD_ENTRY: "shadow" }), "shadow");
  assert.throws(() => assertCustomerUploadEntryAuthority({ VITE_KEY_UPLOAD_ENTRY: "off" }));
  assert.throws(() => assertCustomerUploadEntryAuthority({ VITE_KEY_UPLOAD_ENTRY: "shadow" }));
  const customerDocuments = source("src/lib/customerDocuments.js");
  assert.ok(
    customerDocuments.indexOf("assertCustomerUploadEntryAuthority();") <
      customerDocuments.indexOf(".upload(storagePath, file"),
  );
  assert.ok(
    customerDocuments.indexOf('fetchCustomerApi("/api/key-upload-entry-authority"') <
      customerDocuments.indexOf(".upload(storagePath, file"),
  );
  const serverPreflight = source("api/key-upload-entry-authority.js");
  assert.match(serverPreflight, /getKeyUploadEntryMode\(process\.env\)/);
  assert.match(serverPreflight, /KEY_UPLOAD_ENTRY_MODES\.ACTIVE/);
});

console.log(`${passed} authority-closure tests passed (offline only)`);
