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
  persistKeyConfirmedSourceFactsToPolicies,
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
    updates[0].coverage_summary.policyholder === "OCR값",
    "OCR field left as auxiliary — no auto-merge overwrite of OCR by KEY persist path into scalar",
  );
}

console.log("PASS");
