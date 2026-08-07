/**
 * Targeted unit tests — S3 sidecar confirmed_source_facts writer (minimal patch).
 * No network / DB / Claude.
 */
import assert from "node:assert/strict";
import {
  applyConfirmedSourceFactsAttachProvenance,
  buildKeyRecordSidecarHint,
  normalizeKeyRecordSidecar,
  splitCustomerAnswerAndKeyRecord,
  stripKeyRecordFromStreamText,
  KEY_RECORD_SIDECAR_START,
  KEY_RECORD_SIDECAR_END,
} from "../server/keyCore/keyRecordSidecar.js";
import {
  normalizeKeyConfirmedSourceFacts,
  resolveKeyConfirmableFactsForPersist,
  selectKeyConfirmableSourceFacts,
} from "../server/documentPolicyUploadPersist.js";

const DOC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function planFor(...ids) {
  return {
    attachment_identities: ids.map((document_id, i) => ({
      original_index: i + 1,
      document_id,
      delivers_original_block: true,
    })),
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("hint_lists_confirmed_source_facts_separate_and_allows_empty", () => {
  const hint = buildKeyRecordSidecarHint({ documentIds: [DOC_A] });
  assert.match(hint, /"confirmed_source_facts"\s*:\s*\[\]/);
  assert.match(hint, /완전히 별도 필드/);
  assert.match(hint, /없으면 \[\]가 정상/);
  assert.doesNotMatch(hint, /빈 배열 금지/);
  assert.doesNotMatch(hint, /최소 insurer/);
});

test("customer_text_unaffected_by_sidecar_strip", () => {
  const body = `안녕하세요. 확인했습니다.\n${KEY_RECORD_SIDECAR_START}\n{"confirmed_source_facts":[{"fact_type":"insurer","literal_value":"한화","source_document_id":"${DOC_A}"}]}\n${KEY_RECORD_SIDECAR_END}`;
  assert.equal(stripKeyRecordFromStreamText(body).trim(), "안녕하세요. 확인했습니다.");
  const split = splitCustomerAnswerAndKeyRecord(body);
  assert.equal(split.customer_answer, "안녕하세요. 확인했습니다.");
  assert.equal(split.sidecar_ok, true);
});

test("1doc_confirmed_sidecar_reaches_structural_gate_accepted", () => {
  const raw = normalizeKeyRecordSidecar({
    confirmed_source_facts: [
      { fact_type: "insurer", literal_value: "한화손해보험", source_document_id: DOC_A },
      { fact_type: "product_name", literal_value: "간편건강보험" },
    ],
    policy_inventory_facts: [
      { insurer: "IGNORE", product_name: "INV", source_document_id: DOC_A },
    ],
  });
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: raw.confirmed_source_facts,
    attachmentIdentityPlan: planFor(DOC_A),
  });
  assert.equal(prov.facts.length, 2);
  assert.equal(prov.defaultSourceDocumentId, DOC_A);
  const normalized = normalizeKeyConfirmedSourceFacts(prov.facts, {
    source_document_id: prov.defaultSourceDocumentId,
  });
  assert.equal(normalized.length, 2);
  const gated = selectKeyConfirmableSourceFacts({
    facts: normalized,
    activeDocumentId: DOC_A,
    ownedActiveDocumentId: DOC_A,
  });
  assert.equal(gated.accepted.length, 2);
  assert.equal(gated.ownership_ok, true);
});

test("multi_doc_keeps_per_fact_document_id", () => {
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: [
      { fact_type: "insurer", literal_value: "A사", source_document_id: DOC_A },
      { fact_type: "insurer", literal_value: "B사", source_document_id: DOC_B },
    ],
    attachmentIdentityPlan: planFor(DOC_A, DOC_B),
  });
  assert.equal(prov.facts.length, 2);
  assert.equal(prov.defaultSourceDocumentId, null);
  assert.equal(prov.facts[0].source_document_id, DOC_A);
  assert.equal(prov.facts[1].source_document_id, DOC_B);
});

test("multi_doc_missing_or_mismatch_id_not_promoted", () => {
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: [
      { fact_type: "insurer", literal_value: "no-id" },
      { fact_type: "insurer", literal_value: "wrong", source_document_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      { fact_type: "product_name", literal_value: "ok", source_document_id: DOC_A },
    ],
    attachmentIdentityPlan: planFor(DOC_A, DOC_B),
  });
  assert.equal(prov.facts.length, 1);
  assert.equal(prov.facts[0].literal_value, "ok");
});

test("inventory_only_does_not_create_confirmed", () => {
  const raw = normalizeKeyRecordSidecar({
    policy_inventory_facts: [
      { insurer: "한화", product_name: "상품", source_document_id: DOC_A },
    ],
    coverage_facts: [{ coverage_name: "암", coverage_amount: 1000, source_document_id: DOC_A }],
  });
  assert.equal(raw.confirmed_source_facts.length, 0);
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: raw.confirmed_source_facts,
    attachmentIdentityPlan: planFor(DOC_A),
  });
  assert.equal(prov.facts.length, 0);
});

test("no_attachment_identity_plan_blocks_promotion", () => {
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: [
      { fact_type: "insurer", literal_value: "한화", source_document_id: DOC_A },
    ],
    attachmentIdentityPlan: null,
  });
  assert.equal(prov.facts.length, 0);
  assert.equal(prov.reason, "no_attachment_identity_plan");
});

test("broken_sidecar_keeps_empty_confirmed_path", () => {
  const split = splitCustomerAnswerAndKeyRecord(
    `답변입니다.\n${KEY_RECORD_SIDECAR_START}\n{not-json\n${KEY_RECORD_SIDECAR_END}`,
  );
  assert.equal(split.customer_answer, "답변입니다.");
  assert.equal(split.sidecar_ok, false);
  assert.equal(split.key_record, null);
});

test("resolve_gate_raw_empty_still_attempted_false", async () => {
  const resolved = await resolveKeyConfirmableFactsForPersist({
    supabase: null,
    customerId: "cust",
    activeDocumentId: DOC_A,
    facts: [],
  });
  assert.equal(resolved.accepted.length, 0);
  assert.equal(resolved.gate.attempted, false);
});

if (process.exitCode) {
  console.error("KEY_S3_SIDECAR_CONFIRMED_WRITER_UNIT=FAIL");
} else {
  console.log("KEY_S3_SIDECAR_CONFIRMED_WRITER_UNIT=PASS");
}
