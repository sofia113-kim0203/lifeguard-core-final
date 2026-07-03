/**
 * KU-2a — KEY Work Order gate + authority forgery unit tests (no network).
 */
import assert from "node:assert/strict";
import { isKeyUploadEntryActiveEnabled } from "../server/keyBrain/uploadEntryFlags.js";
import {
  buildKeyWorkOrderRecord,
  gateFactoryWithKeyWorkOrder,
  isKeyWorkOrderExpired,
  mintKeyWorkOrderId,
  validateKeyWorkOrder,
  WORK_ORDER_ALREADY_USED_REASON,
  WORK_ORDER_EXPIRED_REASON,
  WORK_ORDER_FORGERY_REASON,
  WORK_ORDER_REJECT_REASON,
} from "../server/keyBrain/workOrder.js";

const CUSTOMER_ID = "cust-ku2a";
const DOCUMENT_ID = "doc-ku2a";
const OTHER_DOCUMENT_ID = "doc-other";

function sampleMetadata(workOrderId, overrides = {}) {
  return {
    key_work_order: {
      ...buildKeyWorkOrderRecord({
        workOrderId,
        customerId: CUSTOMER_ID,
        documentId: DOCUMENT_ID,
        dispatchPlan: {
          factory_work_orders: [
            { factory: "document_ocr", ordered_by: "KEY" },
            { factory: "policy_extract", ordered_by: "KEY" },
          ],
        },
      }),
      ...overrides,
    },
  };
}

function testMintAndValidateOk() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ordered_by, "KEY");
}

function testMissingWorkOrderRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId: null,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_REJECT_REASON);
}

function testForgedWorkOrderIdRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId: "kwo_forged",
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_FORGERY_REASON);
}

function testCrossDocumentReuseRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: OTHER_DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_FORGERY_REASON);
}

function testNonKeyOrderedByRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId, { ordered_by: "upload_pipeline" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_FORGERY_REASON);
}

function testExpiredWorkOrderRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const record = buildKeyWorkOrderRecord({
    workOrderId,
    customerId: CUSTOMER_ID,
    documentId: DOCUMENT_ID,
    issuedAt: new Date("2020-01-01T00:00:00.000Z"),
    ttlMs: 1000,
  });
  assert.equal(isKeyWorkOrderExpired(record, Date.parse("2020-01-01T00:00:10.000Z")), true);
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: { key_work_order: record },
    now: Date.parse("2020-01-01T00:00:10.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_EXPIRED_REASON);
}

function testFactoryReuseRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId, { used_by: ["document_ocr"] }),
    factory: "document_ocr",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, WORK_ORDER_ALREADY_USED_REASON);
}

function testGateOffAllowsMissingWorkOrder() {
  const gate = gateFactoryWithKeyWorkOrder({
    activeGateEnabled: false,
    workOrderId: null,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: {},
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.gate, "off");
}

function testGateActiveRejectsMissingWorkOrder() {
  const gate = gateFactoryWithKeyWorkOrder({
    activeGateEnabled: true,
    workOrderId: null,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: {},
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, WORK_ORDER_REJECT_REASON);
}

function testGateActivePassesWithKeyWorkOrder() {
  const workOrderId = mintKeyWorkOrderId();
  const gate = gateFactoryWithKeyWorkOrder({
    activeGateEnabled: true,
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: sampleMetadata(workOrderId),
    factory: "policy_extract",
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.ordered_by, "KEY");
}

function testActiveFlag() {
  assert.equal(isKeyUploadEntryActiveEnabled({ KEY_UPLOAD_ENTRY: "active" }), true);
  assert.equal(isKeyUploadEntryActiveEnabled({ KEY_UPLOAD_ENTRY: "shadow" }), false);
}

function testUnauthorizedFactoryRejected() {
  const workOrderId = mintKeyWorkOrderId();
  const metadata = sampleMetadata(workOrderId);
  const result = validateKeyWorkOrder({
    workOrderId,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
    metadataJson: metadata,
    factory: "unknown_factory",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "work_order_scope_mismatch");
}

function testDirectivesPresent() {
  const workOrderId = mintKeyWorkOrderId();
  const record = buildKeyWorkOrderRecord({
    workOrderId,
    customerId: CUSTOMER_ID,
    documentId: DOCUMENT_ID,
    dispatchPlan: {
      factory_work_orders: [
        {
          factory: "document_ocr",
          scope: "metadata_first",
          reason: "first_orientation",
          limit: "page1",
        },
      ],
    },
  });
  assert.equal(record.directives.length, 1);
  assert.equal(record.directives[0].scope, "metadata_first");
  assert.equal(record.directives[0].reason, "first_orientation");
}

const tests = [
  testMintAndValidateOk,
  testMissingWorkOrderRejected,
  testForgedWorkOrderIdRejected,
  testCrossDocumentReuseRejected,
  testNonKeyOrderedByRejected,
  testExpiredWorkOrderRejected,
  testFactoryReuseRejected,
  testUnauthorizedFactoryRejected,
  testDirectivesPresent,
  testGateOffAllowsMissingWorkOrder,
  testGateActiveRejectsMissingWorkOrder,
  testGateActivePassesWithKeyWorkOrder,
  testActiveFlag,
];

for (const test of tests) test();
console.log(`KU-2a KEY Work Order gate: ${tests.length} tests passed`);
