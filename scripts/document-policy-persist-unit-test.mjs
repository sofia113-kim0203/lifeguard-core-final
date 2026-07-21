/**
 * Unit tests for multi-policy upload_extract persistence planning (no Supabase).
 */
import { extractPoliciesFromOcrText } from "../server/documentPolicyExtractor.js";
import {
  buildCoverageSummaryFromCandidate,
  buildUploadExtractKey,
  planRetiredPolicyIds,
  resolveExistingPolicyForCandidate,
  normalizeKeyConfirmedSourceFacts,
  mergeKeyConfirmedSourceFacts,
  assertOwnedActiveSourceDocument,
  selectKeyConfirmableSourceFacts,
  resolveKeyConfirmableFactsForPersist,
  buildKeyConfirmedFactGateTrace,
  persistKeyConfirmedSourceFactsToPolicies,
  buildPolicyFieldsFromKeyConfirmedFacts,
} from "../server/documentPolicyUploadPersist.js";
import { mergeCoverageSummary } from "../server/coverageRiderPopulation.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const documentId = "doc-1111-2222-3333-4444";

const multiPolicySample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원

한화생명
상품명: 종신보험
월보험료 120,000원

현대해상
상품명: 운전자보험
월보험료 18,500원
`;

console.log("document-policy-persist-unit-test");

const multi = extractPoliciesFromOcrText(multiPolicySample);
assert(multi.policy_count === 3, `expected 3 candidates, got ${multi.policy_count}`);

const keys = multi.policies.map((candidate) => buildUploadExtractKey(documentId, candidate.fields));
assert(new Set(keys).size === 3, "upload_extract_key values must be unique per policy");

const samsung = multi.policies.find((policy) => policy.fields.insurer_name === "삼성생명");
const summary = buildCoverageSummaryFromCandidate(documentId, samsung);
assert(Array.isArray(summary.riders), "coverage_summary.riders must be an array");
assert(summary.riders.length >= 1, "samsung policy should include riders[]");
assert(summary.upload_extract_key, "coverage_summary.upload_extract_key required");
assert(summary.source_document_id === documentId, "source_document_id mismatch");

const existingRows = [
  {
    id: "legacy-policy-1",
    is_active: true,
    coverage_summary: {
      source_document_id: documentId,
      upload_extract_key: keys[0],
    },
  },
  {
    id: "stale-policy-2",
    is_active: true,
    coverage_summary: {
      source_document_id: documentId,
      upload_extract_key: `${documentId}|old|product||99999`,
    },
  },
];

const resolved = resolveExistingPolicyForCandidate(existingRows, documentId, samsung, 3);
assert(resolved.row?.id === "legacy-policy-1", "existing key should resolve to update target");

const retireIds = planRetiredPolicyIds(existingRows, documentId, keys);
assert(retireIds.includes("stale-policy-2"), "stale upload_extract row should be retired");
assert(!retireIds.includes("legacy-policy-1"), "active key row must not be retired");

const sameKeyA = buildUploadExtractKey(documentId, samsung.fields);
const sameKeyB = buildUploadExtractKey(documentId, samsung.fields);
assert(sameKeyA === sameKeyB, "re-extract must produce identical upload_extract_key");

{
  const normalized = normalizeKeyConfirmedSourceFacts(
    [
      {
        fact_type: "policyholder",
        literal_value: "홍길동",
        source_document_id: documentId,
        source_locator: { page: 1, source_text: "계약자 홍길동" },
      },
      {
        fact_type: "insurance_period",
        literal_value: "9999세",
        source_document_id: documentId,
      },
      {
        fact_type: "priority",
        literal_value: "보험료 부담을 늘리지 않고",
        source_document_id: documentId,
      },
      {
        fact_type: "coverage_amount",
        literal_value: "1억",
        source_document_id: documentId,
      },
      {
        fact_type: "coverage_amount",
        literal_value: "1억",
        source_document_id: documentId,
      },
    ],
    { confirmed_at: "2026-07-15T00:00:00.000Z" },
  );
  assert(normalized.length === 3, `expected 3 valid facts, got ${normalized.length}`);
  assert(
    normalized.every((f) => f.fact_type !== "priority"),
    "conversation priority must not become contract fact",
  );
  assert(
    normalized.some((f) => f.literal_value === "9999세"),
    "9999세 literal must be preserved",
  );
  assert(
    !normalized.some((f) => String(f.literal_value).includes("종신")),
    "must not invent 종신 from 9999세",
  );

  const merged = mergeKeyConfirmedSourceFacts(normalized, normalized);
  assert(merged.length === 3, "dedupe must prevent infinite duplicate store");

  const withKey = {
    ...summary,
    key_confirmed_source_facts: normalized,
  };
  const ocrMerged = mergeCoverageSummary(
    withKey,
    {
      source_document_id: documentId,
      policyholder: "OCR덮어쓰기",
      extracted_at: "2026-07-15T01:00:00.000Z",
    },
    {},
    {},
  );
  assert(
    Array.isArray(ocrMerged.key_confirmed_source_facts) &&
      ocrMerged.key_confirmed_source_facts.length === 3,
    "OCR merge must not wipe KEY confirmed facts",
  );
  assert(ocrMerged.policyholder === "OCR덮어쓰기", "OCR may update its own fields");
}

{
  const updates = [];
  const supabase = {
    from(table) {
      assert(table === "profile_insurance_policies", "policies table only");
      let mode = "select";
      let updatePayload = null;
      const api = {
        select() {
          mode = "select";
          return api;
        },
        update(payload) {
          mode = "update";
          updatePayload = payload;
          return api;
        },
        eq() {
          return api;
        },
        then(resolve, reject) {
          try {
            if (mode === "select") {
              resolve({
                data: [
                  {
                    id: "pol-1",
                    is_active: true,
                    coverage_summary: {
                      source_document_id: documentId,
                      policyholder: "OCR값",
                    },
                  },
                ],
                error: null,
              });
              return;
            }
            updates.push(updatePayload);
            resolve({ data: null, error: null });
          } catch (err) {
            reject(err);
          }
        },
      };
      return api;
    },
  };

  const result = await persistKeyConfirmedSourceFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts: [
      {
        fact_type: "policyholder",
        literal_value: "KEY확인계약자",
        source_document_id: documentId,
        source_locator: { page: 2 },
      },
    ],
  });
  assert(result.ok === true, "persist should succeed");
  assert(updates.length === 1, "one policy update");
  assert(
    updates[0].coverage_summary.key_confirmed_source_facts[0].literal_value ===
      "KEY확인계약자",
    "KEY fact stored with provenance",
  );
  assert(
    updates[0].coverage_summary.policyholder === "OCR값" ||
      updates[0].coverage_summary.policyholder === "KEY확인계약자",
    "policyholder may stay OCR or refresh from KEY fact",
  );
}

{
  const { persistKeyConfirmedSourceFactsToPolicies, buildPolicyFieldsFromKeyConfirmedFacts } =
    await import("../server/documentPolicyUploadPersist.js");

  const fields = buildPolicyFieldsFromKeyConfirmedFacts(
    "doc-new",
    [
      {
        fact_type: "insurer_name",
        literal_value: "KB손해보험",
        source_document_id: "doc-new",
      },
      {
        fact_type: "product_name",
        literal_value: "슬기로운간편실속",
        source_document_id: "doc-new",
      },
      {
        fact_type: "monthly_premium",
        literal_value: "월 86,000원",
        source_document_id: "doc-new",
      },
      {
        fact_type: "insured",
        literal_value: "문서피보험자",
        source_document_id: "doc-new",
      },
    ],
    null,
  );
  assert(fields.insurer_name === "KB손해보험", "insurer from facts");
  assert(fields.product_name === "슬기로운간편실속", "product from facts");
  assert(fields.monthly_premium === 86000, "premium parsed");
  assert(fields.coverage_summary.parties.insured === "문서피보험자", "insured is document party");
  assert(
    fields.coverage_summary.key_confirmed_subject_scope ===
      "document_contract_not_customer_profile",
    "subject scope separated from customer profile",
  );
  // DB CHECK allows signup|upload_extract|manual|import only — not key_confirmed_source_facts.
  assert(fields.source === "manual", "insert source must satisfy DB CHECK");

  const inserts = [];
  const supabase = {
    from(table) {
      assert(table === "profile_insurance_policies", "policies table only");
      let mode = "select";
      let insertPayload = null;
      const api = {
        select() {
          if (mode !== "insert") mode = "select";
          return api;
        },
        insert(payload) {
          mode = "insert";
          insertPayload = payload;
          inserts.push({ table, payload });
          return api;
        },
        update() {
          mode = "update";
          return api;
        },
        eq() {
          return api;
        },
        single() {
          return Promise.resolve({ data: { id: "pol-created" }, error: null });
        },
        then(resolve, reject) {
          try {
            if (mode === "select") {
              resolve({ data: [], error: null });
              return;
            }
            if (mode === "insert") {
              resolve({ data: { id: "pol-created" }, error: null });
              return;
            }
            resolve({ data: null, error: null });
          } catch (err) {
            reject(err);
          }
        },
      };
      return api;
    },
  };

  const created = await persistKeyConfirmedSourceFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts: [
      {
        fact_type: "insurer_name",
        literal_value: "KB손해보험",
        source_document_id: "doc-new",
      },
      {
        fact_type: "insured",
        literal_value: "문서피보험자",
        source_document_id: "doc-new",
      },
    ],
  });
  assert(created.ok === true, "create-on-missing-row should succeed");
  assert(created.created_policy_ids?.includes("pol-created"), "created policy id recorded");
  assert(inserts.length === 1, "one policy insert");
  assert(inserts[0].payload.source === "manual", "created row source satisfies DB CHECK");
  assert(inserts[0].payload.coverage_summary.source_document_id === "doc-new", "linked to document");
  assert(
    inserts[0].payload.coverage_summary.parties.subject_scope === "document_contract",
    "insured stays document-scoped",
  );
}

{
  const {
    resolveStableClaimCaseKey,
    normalizeKeyClaimCaseUpdates,
    mergeKeyActiveClaimCases,
    persistKeyActiveClaimCases,
    KEY_ACTIVE_CLAIM_CASES_FACT_PATH,
  } = await import("../server/documentPolicyUploadPersist.js");

  assert(
    resolveStableClaimCaseKey({
      medical_event: { source_document_id: "doc-a", surgery_date: "2026-07-12" },
    }) === "doc:doc-a:date:2026-07-12",
    "stable key from document + event date",
  );
  assert(
    resolveStableClaimCaseKey({
      medical_event: { event_date: "2026-07-12", event_kind: "surgery" },
    }) === "date:2026-07-12:kind:surgery",
    "stable key from date + kind",
  );
  assert(
    resolveStableClaimCaseKey({ medical_event: { diagnosis_name: "의증" } }) == null,
    "unstable key must HOLD (no random UUID)",
  );

  const normalized = normalizeKeyClaimCaseUpdates(
    [
      {
        claim_case_key: "date:2026-07-12:kind:surgery",
        medical_event: {
          surgery_name: "슬관절 수술",
          surgery_date: "2026-07-12",
          event_kind: "surgery",
          diagnosis_certainty: "confirmed",
        },
        related_policies: ["실손의료비보험"],
        related_coverages: ["실손", "수술비"],
        assessment: {
          code: "claim_warranted",
          rationale: "확인된 수술일과 실손·수술비 담보",
        },
        required_documents: ["진단서", "영수증", "수술기록"],
        available_documents: ["진단서"],
        missing_documents: ["영수증", "수술기록"],
        status: "preparing",
        next_action: "영수증과 수술기록을 준비",
        evidence: [],
      },
      {
        medical_event: { diagnosis_name: "미확인" },
        status: "submitted_by_customer",
      },
    ],
    { updated_at: "2026-07-15T00:00:00.000Z" },
  );
  assert(normalized.length === 1, "unstable rows dropped");
  assert(normalized[0].status === "preparing", "initial preparing status");
  assert(
    normalized[0].available_documents.includes("진단서"),
    "available docs preserved",
  );

  const withSource = normalizeKeyClaimCaseUpdates([
    {
      claim_case_key: "customer_statement:kind:surgery",
      status: "identified",
      source: "customer_statement",
      source_message_id: "utterance:abc123",
      source_document_ids: ["doc-1"],
      medical_event: { event_kind: "surgery" },
      evidence: ["source:customer_statement"],
    },
  ]);
  assert(withSource.length === 1, "customer_statement source row kept");
  assert(withSource[0].source === "customer_statement", "source preserved");
  assert(
    withSource[0].source_message_id === "utterance:abc123",
    "source_message_id preserved",
  );
  assert(
    withSource[0].source_document_ids.includes("doc-1"),
    "source_document_ids preserved",
  );

  const blocked = normalizeKeyClaimCaseUpdates([
    {
      claim_case_key: "date:2026-07-01:kind:fracture",
      status: "under_review",
      evidence: [],
      medical_event: { event_date: "2026-07-01", event_kind: "fracture" },
    },
  ]);
  assert(blocked[0].status === "preparing", "no evidence → do not advance to under_review");

  const noAdvance = mergeKeyActiveClaimCases(normalized, [
    {
      claim_case_key: "date:2026-07-12:kind:surgery",
      status: "submitted_by_customer",
      evidence: [],
    },
  ]);
  assert(
    noAdvance[0].status === "preparing",
    "speculation must not advance to submitted_by_customer",
  );

  const paid = mergeKeyActiveClaimCases(normalized, [
    {
      claim_case_key: "date:2026-07-12:kind:surgery",
      status: "paid",
      evidence: ["customer_confirmed_payment"],
    },
  ]);
  assert(paid[0].status === "paid", "paid allowed only with evidence");

  const merged = mergeKeyActiveClaimCases(normalized, [
    {
      claim_case_key: "date:2026-07-12:kind:surgery",
      available_documents: ["진단서", "영수증"],
      missing_documents: ["수술기록"],
      status: "preparing",
    },
  ]);
  assert(merged.length === 1, "same claim_case_key must not duplicate");
  assert(
    merged[0].available_documents.includes("영수증"),
    "available docs accumulate across turns",
  );

  const healthWrites = [];
  const supabase = {
    from(table) {
      assert(table === "profile_health", "claim cases use existing profile_health only");
      let mode = "select";
      let payload = null;
      const api = {
        select() {
          mode = "select";
          return api;
        },
        update(p) {
          mode = "update";
          payload = p;
          return api;
        },
        insert(p) {
          mode = "insert";
          payload = p;
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              customer_id: "cust-claim",
              details_json: {
                [KEY_ACTIVE_CLAIM_CASES_FACT_PATH]: [
                  {
                    claim_case_key: "date:2026-07-12:kind:surgery",
                    status: "identified",
                    available_documents: [],
                    missing_documents: ["진단서"],
                    evidence: [],
                    medical_event: {
                      surgery_date: "2026-07-12",
                      event_kind: "surgery",
                    },
                  },
                ],
              },
            },
            error: null,
          });
        },
        then(resolve, reject) {
          try {
            if (mode === "update" || mode === "insert") {
              healthWrites.push({ mode, payload });
              resolve({ data: null, error: null });
              return;
            }
            resolve({ data: null, error: null });
          } catch (err) {
            reject(err);
          }
        },
      };
      return api;
    },
  };

  const persist = await persistKeyActiveClaimCases({
    supabase,
    customerId: "cust-claim",
    claimCaseUpdates: [
      {
        claim_case_key: "date:2026-07-12:kind:surgery",
        available_documents: ["진단서"],
        missing_documents: ["영수증"],
        status: "preparing",
        assessment: { code: "claim_possible" },
      },
    ],
  });
  assert(persist.ok === true, "claim case persist should succeed");
  assert(healthWrites.length === 1, "one profile_health write");
  const stored =
    healthWrites[0].payload.details_json[KEY_ACTIVE_CLAIM_CASES_FACT_PATH];
  assert(stored.length === 1, "no duplicate claim cases on persist");
  assert(stored[0].available_documents.includes("진단서"), "docs merged into card");
  assert(stored[0].status === "preparing", "status truthfulness retained");
}

{
  const {
    claimCaseReferencesSourceDocument,
    filterKeyActiveClaimCasesExcludingSourceDocument,
    removeKeyActiveClaimCasesForSourceDocument,
    KEY_ACTIVE_CLAIM_CASES_FACT_PATH,
  } = await import("../server/documentPolicyUploadPersist.js");

  assert(
    claimCaseReferencesSourceDocument(
      { medical_event: { source_document_id: "doc-wrong" } },
      "doc-wrong",
    ) === true,
    "medical source_document_id ties claim to upload",
  );
  assert(
    claimCaseReferencesSourceDocument(
      { claim_case_key: "doc:doc-wrong:date:2026-07-12" },
      "doc-wrong",
    ) === true,
    "stable doc: key ties claim to upload",
  );
  assert(
    claimCaseReferencesSourceDocument(
      { claim_case_key: "date:2026-07-12:kind:surgery" },
      "doc-wrong",
    ) === false,
    "date/kind key without document must not be wiped on unrelated delete",
  );

  const kept = filterKeyActiveClaimCasesExcludingSourceDocument(
    [
      {
        claim_case_key: "doc:doc-wrong:date:2026-07-12",
        medical_event: { source_document_id: "doc-wrong", event_date: "2026-07-12" },
        status: "preparing",
      },
      {
        claim_case_key: "date:2026-01-01:kind:checkup",
        medical_event: { event_date: "2026-01-01", event_kind: "checkup" },
        status: "identified",
      },
    ],
    "doc-wrong",
  );
  assert(kept.length === 1, "only document-sourced claim removed");
  assert(kept[0].claim_case_key === "date:2026-01-01:kind:checkup", "other claim kept");

  const healthWrites = [];
  const supabase = {
    from(table) {
      assert(table === "profile_health", "claim scrub uses profile_health");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: {
            customer_id: "cust-scrub",
            details_json: {
              [KEY_ACTIVE_CLAIM_CASES_FACT_PATH]: [
                {
                  claim_case_key: "doc:doc-wrong:date:2026-07-12",
                  medical_event: { source_document_id: "doc-wrong", event_date: "2026-07-12" },
                  status: "preparing",
                },
              ],
            },
          },
          error: null,
        }),
        update(payload) {
          healthWrites.push(payload);
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };
  const scrub = await removeKeyActiveClaimCasesForSourceDocument({
    supabase,
    customerId: "cust-scrub",
    documentId: "doc-wrong",
  });
  assert(scrub.ok === true && scrub.removed === 1, "scrub removes document-sourced claim");
  assert(healthWrites.length === 1, "one health write on scrub");
  assert(
    healthWrites[0].details_json[KEY_ACTIVE_CLAIM_CASES_FACT_PATH].length === 0,
    "card JSON no longer holds deleted-doc claim",
  );

  const scrubAgain = await removeKeyActiveClaimCasesForSourceDocument({
    supabase,
    customerId: "cust-scrub",
    documentId: "doc-wrong",
  });
  assert(scrubAgain.ok === true, "scrub is idempotent on second call");

}

// --- GO1 보정: KEY confirm gate ---
{
  let ownershipQueries = 0;
  const trackingSupabase = (maybeSingleResult) => ({
    from(table) {
      assert(table === "customer_documents", "ownership checks documents only");
      ownershipQueries += 1;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        is() {
          return q;
        },
        maybeSingle: async () => maybeSingleResult,
      };
      return q;
    },
  });

  // A: rawFacts=[] → ownership query 0
  ownershipQueries = 0;
  const emptyResolved = await resolveKeyConfirmableFactsForPersist({
    supabase: trackingSupabase({ data: { id: documentId }, error: null }),
    customerId: "cust-gate",
    activeDocumentId: documentId,
    facts: [],
  });
  assert(emptyResolved.accepted.length === 0, "A: empty raw → accepted 0");
  assert(emptyResolved.gate.ownership_query_count === 0, "A: ownership_query_count 0");
  assert(ownershipQueries === 0, "A: assertOwnedActiveSourceDocument call 0");

  // B: missing source_document_id
  const missingSrc = selectKeyConfirmableSourceFacts({
    facts: [
      {
        fact_type: "insurer_name",
        literal_value: "삼성화재",
        confirmation_source: "claude_guess",
      },
    ],
    activeDocumentId: documentId,
    ownedActiveDocumentId: documentId,
    ownershipFailed: false,
  });
  assert(missingSrc.accepted.length === 0, "B: missing source → accepted 0");
  assert(
    missingSrc.rejected.some((r) => r.reason === "missing_source_document_id"),
    "B: missing_source_document_id",
  );
  assert(
    !JSON.stringify(missingSrc.rejected).includes(documentId),
    "B: reject payload must not embed document_id",
  );

  // C: invalid fact shape
  const invalidShape = selectKeyConfirmableSourceFacts({
    facts: [null, "x", 1, ["arr"]],
    activeDocumentId: documentId,
    ownedActiveDocumentId: documentId,
    ownershipFailed: false,
  });
  assert(invalidShape.accepted.length === 0, "C: invalid → accepted 0");
  assert(
    invalidShape.rejected.length === 4 &&
      invalidShape.rejected.every((r) => r.reason === "invalid_fact_shape"),
    "C: invalid_fact_shape for every non-object",
  );

  // D: duplicate_fact
  const dup = selectKeyConfirmableSourceFacts({
    facts: [
      {
        fact_type: "product_name",
        literal_value: "실손",
        source_document_id: documentId,
      },
      {
        fact_type: "product_name",
        literal_value: "실손",
        source_document_id: documentId,
      },
    ],
    activeDocumentId: documentId,
    ownedActiveDocumentId: documentId,
    ownershipFailed: false,
  });
  assert(dup.accepted.length === 1, "D: one accepted");
  assert(
    dup.rejected.some((r) => r.reason === "duplicate_fact"),
    "D: duplicate_fact",
  );

  // E: DB error → ownership_lookup_error
  ownershipQueries = 0;
  const lookupErr = await assertOwnedActiveSourceDocument({
    supabase: trackingSupabase({ data: null, error: { message: "db_down" } }),
    customerId: "cust-gate",
    documentId,
  });
  assert(lookupErr.ok === false && lookupErr.reason === "ownership_lookup_error", "E");
  const lookupResolved = await resolveKeyConfirmableFactsForPersist({
    supabase: trackingSupabase({ data: null, error: { message: "db_down" } }),
    customerId: "cust-gate",
    activeDocumentId: documentId,
    facts: [
      {
        fact_type: "insurer_name",
        literal_value: "삼성화재",
        source_document_id: documentId,
      },
    ],
  });
  assert(lookupResolved.accepted.length === 0, "E: persist 0");
  assert(
    lookupResolved.gate.ownership_reason === "ownership_lookup_error",
    "E: gate ownership_reason",
  );
  assert(
    lookupResolved.gate.rejected_reason_counts.ownership_lookup_error === 1,
    "E: rejected count",
  );

  // F: row 없음 → ownership_or_deleted
  const notOwned = await assertOwnedActiveSourceDocument({
    supabase: trackingSupabase({ data: null, error: null }),
    customerId: "cust-gate",
    documentId,
  });
  assert(notOwned.ok === false && notOwned.reason === "ownership_or_deleted", "F");
  const deletedResolved = await resolveKeyConfirmableFactsForPersist({
    supabase: trackingSupabase({ data: null, error: null }),
    customerId: "cust-gate",
    activeDocumentId: documentId,
    facts: [
      {
        fact_type: "insurer_name",
        literal_value: "삼성화재",
        source_document_id: documentId,
      },
    ],
  });
  assert(deletedResolved.accepted.length === 0, "F: persist 0");
  assert(
    deletedResolved.gate.rejected_reason_counts.ownership_or_deleted === 1,
    "F: ownership_or_deleted count",
  );

  // G: trace must not include real document_id string
  ownershipQueries = 0;
  const okResolved = await resolveKeyConfirmableFactsForPersist({
    supabase: trackingSupabase({ data: { id: documentId }, error: null }),
    customerId: "cust-gate",
    activeDocumentId: documentId,
    facts: [
      {
        fact_type: "insurer_name",
        literal_value: "삼성화재",
        source_document_id: documentId,
        confirmation_source: "claude_guess",
      },
      {
        fact_type: "product_name",
        literal_value: "실손",
        source_document_id: "doc-other-id",
      },
      {
        fact_type: "priority",
        literal_value: "추측",
        source_document_id: documentId,
      },
    ],
  });
  const gateJson = JSON.stringify(okResolved.gate);
  assert(!gateJson.includes(documentId), "G: no documentId in gate trace");
  assert(!gateJson.includes("doc-other-id"), "G: no foreign doc id in gate trace");
  assert(!gateJson.includes("삼성화재"), "G: no literal in gate trace");
  assert(okResolved.gate.active_document_present === true, "G: present flag");
  assert(okResolved.gate.ownership_ok === true, "G: ownership_ok");
  assert(okResolved.gate.accepted_count === 1, "G: accepted_count");
  assert(
    okResolved.gate.rejected_reason_counts.source_document_mismatch === 1,
    "G: mismatch count",
  );
  assert(
    okResolved.gate.rejected_reason_counts.unsupported_fact_type === 1,
    "G: unsupported count",
  );
  assert(!("active_document_id" in okResolved.gate), "G: no active_document_id field");
  assert(!("rejected" in okResolved.gate), "G: no rejected array in trace");

  // I: server confirmation_source only on accepted
  assert(okResolved.accepted.length === 1, "I: one accepted");
  assert(
    okResolved.accepted[0].confirmation_source === "key_claude_original_document",
    "I: KEY stamps confirmation_source",
  );
  assert(
    okResolved.accepted.every((f) => f.confirmation_source === "key_claude_original_document"),
    "I: all accepted stamped",
  );

  const partyFields = buildPolicyFieldsFromKeyConfirmedFacts(
    documentId,
    okResolved.accepted,
    null,
  );
  assert(
    partyFields.coverage_summary?.key_confirmed_subject_scope ===
      "document_contract_not_customer_profile",
    "parties stay document_contract scope",
  );

  const traceOnly = buildKeyConfirmedFactGateTrace({
    attempted: true,
    accepted: okResolved.accepted,
    rejected: [
      { reason: "source_document_mismatch", fact_type: "product_name" },
      { reason: "unsupported_fact_type", fact_type: "priority" },
    ],
    ownership_ok: true,
    ownership_query_count: 1,
    active_document_present: true,
  });
  assert(!JSON.stringify(traceOnly).includes(documentId), "trace builder strips ids");
}

console.log("PASS");
