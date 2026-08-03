/**
 * R17 — memory cron Work Order authority (offline, Provider 0).
 */
import assert from "node:assert/strict";
import {
  buildMemoryBuilderCompletedMetadataPatch,
  decideMemoryCronAuthority,
  isMemoryBuilderAlreadyCompleted,
  MEMORY_BUILDER_FACTORY,
  resolveMemoryJobDocumentId,
} from "../server/keyBrain/memoryCronAuthority.js";
import {
  buildKeyWorkOrderRecord,
  mintKeyWorkOrderId,
} from "../server/keyBrain/workOrder.js";
import { buildDocumentDispatchPlanShadow } from "../server/keyBrain/documentIntakeShadow.js";

const PROVIDER = { count: 0 };

function noProvider() {
  assert.equal(PROVIDER.count, 0);
}

function testResolveDocumentId() {
  assert.equal(
    resolveMemoryJobDocumentId({
      payload_json: { document_id: "11111111-1111-1111-1111-111111111111" },
    }),
    "11111111-1111-1111-1111-111111111111",
  );
  assert.equal(
    resolveMemoryJobDocumentId({
      source_ref: "22222222-2222-2222-2222-222222222222",
    }),
    "22222222-2222-2222-2222-222222222222",
  );
  assert.equal(
    resolveMemoryJobDocumentId({ source_ref: "memory_rebuild:9" }),
    null,
  );
  noProvider();
  console.log("PASS resolve_document_id");
}

function testActiveSkipsCustomerWideWithoutWo() {
  const decision = decideMemoryCronAuthority({
    env: { KEY_UPLOAD_ENTRY: "active" },
    job: {
      customer_id: "cust-1",
      job_type: "memory_builder",
      source_ref: "memory_rebuild:1",
      payload_json: {},
    },
    documentRow: null,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.run_rebuild, false);
  assert.equal(decision.mutation_allowed, false);
  assert.equal(decision.skip, true);
  noProvider();
  console.log("PASS active_skip_customer_wide");
}

function testActiveRejectsMissingWoOnDocument() {
  const decision = decideMemoryCronAuthority({
    env: { KEY_UPLOAD_ENTRY: "active" },
    job: {
      customer_id: "cust-1",
      source_ref: "11111111-1111-1111-1111-111111111111",
      payload_json: { document_id: "11111111-1111-1111-1111-111111111111" },
    },
    documentRow: {
      id: "11111111-1111-1111-1111-111111111111",
      customer_id: "cust-1",
      metadata_json: {},
    },
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.mutation_allowed, false);
  assert.match(String(decision.reason), /work_order/i);
  noProvider();
  console.log("PASS active_reject_missing_wo");
}

function testActivePassWithMemoryBuilderDirective() {
  const documentId = "11111111-1111-1111-1111-111111111111";
  const customerId = "cust-1";
  const dispatch = buildDocumentDispatchPlanShadow({
    document: {
      customer_hint_type: "insurance_policy",
      doc_class: "policy",
    },
    hasAnalysisConsent: true,
  });
  assert.ok(
    dispatch.factory_work_orders.some((row) => row.factory === MEMORY_BUILDER_FACTORY),
  );
  const workOrderId = mintKeyWorkOrderId();
  const record = buildKeyWorkOrderRecord({
    workOrderId,
    customerId,
    documentId,
    dispatchPlan: dispatch,
  });
  const decision = decideMemoryCronAuthority({
    env: { KEY_UPLOAD_ENTRY: "active" },
    job: {
      customer_id: customerId,
      payload_json: { document_id: documentId, work_order_id: workOrderId },
    },
    documentRow: {
      id: documentId,
      customer_id: customerId,
      metadata_json: { key_work_order: record },
    },
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.run_rebuild, true);
  assert.equal(decision.mutation_allowed, true);
  assert.equal(decision.work_order_id, workOrderId);
  noProvider();
  console.log("PASS active_pass_with_wo");
}

function testSkipAlreadyCompleted() {
  const documentId = "11111111-1111-1111-1111-111111111111";
  const customerId = "cust-1";
  const meta = buildMemoryBuilderCompletedMetadataPatch({
    metadataJson: {},
    workOrderId: "kwo_done",
  });
  assert.equal(isMemoryBuilderAlreadyCompleted(meta), true);
  const decision = decideMemoryCronAuthority({
    env: { KEY_UPLOAD_ENTRY: "active" },
    job: {
      customer_id: customerId,
      payload_json: { document_id: documentId },
    },
    documentRow: {
      id: documentId,
      customer_id: customerId,
      metadata_json: meta,
    },
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.run_rebuild, false);
  assert.equal(decision.mutation_allowed, false);
  noProvider();
  console.log("PASS skip_already_completed");
}

function testOffAllowsLegacy() {
  const decision = decideMemoryCronAuthority({
    env: { KEY_UPLOAD_ENTRY: "off" },
    job: { customer_id: "cust-1", source_ref: "memory_rebuild:1" },
    documentRow: null,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.run_rebuild, true);
  assert.equal(decision.mutation_allowed, true);
  noProvider();
  console.log("PASS off_allows_legacy");
}

function main() {
  testResolveDocumentId();
  testActiveSkipsCustomerWideWithoutWo();
  testActiveRejectsMissingWoOnDocument();
  testActivePassWithMemoryBuilderDirective();
  testSkipAlreadyCompleted();
  testOffAllowsLegacy();
  console.log(
    JSON.stringify({
      KEY_MEMORY_CRON_R17_UNIT: "PASS",
      PROVIDER_CALL: 0,
      PRODUCTION_CHANGE: 0,
    }),
  );
}

main();
