/**
 * GO: policy ledger active-only read + OCR polluted identity persist skip.
 */
import assert from "node:assert/strict";
import {
  filterCurrentActivePolicies,
  isRetiredPolicyRow,
  projectCanonicalContracts,
} from "../src/lib/keyInsuranceScreenFacts.js";
import {
  buildVerifiedPolicyLedgerBrief,
  countActiveDistinctPolicies,
} from "../server/keyCore/keyPolicyTruthEvidence.js";
import { buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { extractPoliciesFromContext } from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  findExistingPolicyRowForInventoryFact,
  hasInvalidPolicyIdentityFields,
  isPollutedPolicyIdentityField,
  persistPolicyInventoryFactsToPolicies,
} from "../server/documentPolicyUploadPersist.js";
import {
  buildContractIdentityKey,
  buildSourceFactKey,
} from "../src/lib/keyInsuranceScreenFacts.js";

function pnPolicy(id, { pn, insurer, product, is_active = true, deleted_at = null, extra = {} } = {}) {
  return {
    id,
    insurer_name: insurer ?? "한화생명",
    product_name: product ?? "건강보험",
    monthly_premium: 10000,
    is_active,
    deleted_at,
    coverage_summary: {
      policy_number: pn ?? null,
      source_document_id: extra.source_document_id ?? `doc-${id}`,
      ...(extra.source_content_sha256
        ? { source_content_sha256: extra.source_content_sha256 }
        : {}),
    },
    ...extra,
  };
}

console.log("key-policy-ledger-active-only-unit-test");

// 1–3) active 3 + retired 23 → current count 3; retired excluded; rows not deleted
{
  const active = [
    pnPolicy("a1", { pn: "PN-A1", product: "간편가입 The H 건강보험" }),
    pnPolicy("a2", { pn: "QA-PROD-20260728001", product: "QA종합보장A", insurer: "한화생명" }),
    pnPolicy("a3", {
      pn: "SHA-ROW",
      product: "간편가입 The H 건강보험",
      extra: { source_content_sha256: "a".repeat(64) },
    }),
  ];
  const retired = Array.from({ length: 23 }, (_, i) =>
    pnPolicy(`r${i}`, {
      pn: null,
      is_active: false,
      deleted_at: `2026-07-27T22:00:${String(i).padStart(2, "0")}.000Z`,
      product: "건강보험",
    }),
  );
  const all = [...active, ...retired];
  assert.equal(all.length, 26, "fixture retains all rows including retired");
  assert.equal(retired.every((r) => r.is_active === false), true);
  assert.equal(retired.every((r) => isRetiredPolicyRow(r)), true);

  const current = filterCurrentActivePolicies(all);
  assert.equal(current.length, 3);
  assert.equal(current.every((p) => p.is_active !== false), true);
  assert.equal(
    current.some((p) => String(p.id).startsWith("r")),
    false,
    "retired ids not in current list",
  );

  const projection = projectCanonicalContracts(all);
  assert.equal(projection.active_distinct_count, 3);
  // raw_source_row_count is post-retired-filter active row count (not deleted-history size).
  assert.equal(projection.raw_source_row_count, 3);

  const brief = buildVerifiedPolicyLedgerBrief(all);
  assert.equal(brief.active_distinct_count, 3);
  assert.equal(brief.confirmed_contracts.length, 3);
  assert.equal(
    brief.confirmed_contracts.some((c) => String(c.insurer ?? "").startsWith("retired")),
    false,
  );

  const chart = buildVerifiedCustomerChart({ policies: all, policy_count: all.length });
  assert.equal(chart.policy_count?.value, 3);
  assert.equal(chart.contracts.length, 3);
  assert.equal(chart.active_distinct_count, 3);

  const extracted = extractPoliciesFromContext({ loadedContext: { policies: all } });
  assert.equal(extracted.policies.length, 3);
  assert.equal(extracted.policy_count, 3);

  // Retired rows remain in the input array (no delete).
  assert.equal(all.filter((p) => p.is_active === false).length, 23);
  assert.equal(countActiveDistinctPolicies(all).active_distinct_count, 3);
}

// 4) Normal Korean insurer/product names persist
{
  const facts = [
    {
      insurer: "한화생명",
      product_name: "간편가입 The H 건강보험",
      contract_date: "2026-07-28",
      monthly_premium: 123450,
      policy_number: "QA-PROD-20260728001",
      source_document_id: "doc-clean",
      source_content_sha256: "b".repeat(64),
      source_page_or_image: "1",
    },
  ];
  let inserts = 0;
  const rows = [];
  const supabase = {
    from() {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        update(payload) {
          if (rows[0]) Object.assign(rows[0], payload);
          return api;
        },
        insert(payload) {
          inserts += 1;
          const id = `pol-${inserts}`;
          rows.push({ id, ...payload });
          return {
            select() {
              return {
                single: async () => ({ data: { id }, error: null }),
              };
            },
          };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: [...rows], error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  assert.equal(hasInvalidPolicyIdentityFields(facts[0]), false);
  const res = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts,
    ownedDocumentIds: ["doc-clean"],
  });
  assert.equal(res.stored, 1);
  assert.equal(inserts, 1);
  assert.equal(rows[0].insurer_name, "한화생명");
  assert.equal(rows[0].product_name, "간편가입 The H 건강보험");
  assert.equal(res.skipped_invalid_identity ?? 0, 0);
}

// 5) OCR long body in insurer/product is not stored
{
  const ocrDump =
    "한화생명 상품명 간편가입 The H 건강보험 QA TEST 계약번호 QA-PROD-200260728-001 계약자 김테스트 피보험자 김테스트 계약일 2026-07-28 보험기간 2026-07-28 ~ 2099-12-31 월보험료 123,450원 일반암진단금 50,000,000원 본 문서는 LIFEGUARD Production QA 목적으로 합성한 원본입니다.";
  assert.equal(isPollutedPolicyIdentityField(ocrDump), true);
  assert.equal(
    isPollutedPolicyIdentityField("여러 줄\nOCR 본문이\n보험사 칸에 들어간 경우"),
    true,
  );
  assert.equal(isPollutedPolicyIdentityField('{"insurer":"한화생명","product":"x"}'), true);
  assert.equal(isPollutedPolicyIdentityField("| a | b | c |\n|---|---|---|"), true);
  assert.equal(isPollutedPolicyIdentityField("한화생명"), false);
  assert.equal(isPollutedPolicyIdentityField("간편가입 The H 건강보험"), false);

  const facts = [
    {
      insurer: ocrDump,
      product_name: ocrDump.slice(10),
      contract_date: "2026-07-28",
      monthly_premium: 123450,
      policy_number: "QA-PROD-200260728001",
      source_document_id: "doc-dirty",
      source_content_sha256: "c".repeat(64),
      source_page_or_image: "1",
    },
  ];
  assert.equal(hasInvalidPolicyIdentityFields(facts[0]), true);

  let inserts = 0;
  const rows = [];
  const supabase = {
    from() {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        update() {
          return api;
        },
        insert() {
          inserts += 1;
          return {
            select() {
              return {
                single: async () => ({ data: { id: "should-not" }, error: null }),
              };
            },
          };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: [...rows], error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  const res = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts,
    ownedDocumentIds: ["doc-dirty"],
  });
  assert.equal(res.stored, 0);
  assert.equal(inserts, 0);
  assert.equal(res.skipped_invalid_identity, 1);
  assert.equal(res.skips?.[0]?.reason, "invalid_policy_identity_fields");
  assert.equal(rows.length, 0);
}

// 6) Existing 6-stage inventory match cascade still works
{
  const baseFact = {
    insurer: "삼성생명",
    product_name: "실손의료비보험",
    contract_date: "2019-01-01",
    maturity_date: "2099-01-01",
    monthly_premium: 45000,
    policy_number: "PN-STAGE-6",
    source_document_id: "doc-s6",
    source_content_sha256: "d".repeat(64),
    source_page_or_image: "block_index=1",
  };
  const shape = {
    insurer_name: baseFact.insurer,
    product_name: baseFact.product_name,
    monthly_premium: baseFact.monthly_premium,
    effective_from: baseFact.contract_date,
    policy_number: baseFact.policy_number,
    source_content_sha256: baseFact.source_content_sha256,
    coverage_summary: {
      policy_number: baseFact.policy_number,
      source_document_id: baseFact.source_document_id,
      source_content_sha256: baseFact.source_content_sha256,
      source_page_or_image: baseFact.source_page_or_image,
      maturity_date: baseFact.maturity_date,
      effective_from: baseFact.contract_date,
    },
  };
  const source_fact_key = buildSourceFactKey(shape);
  const contract_identity_key = buildContractIdentityKey(shape);
  assert.ok(source_fact_key);
  assert.ok(contract_identity_key);

  // stage 1: source_fact_key
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [{ id: "1", source_fact_key, coverage_summary: {} }],
      baseFact,
      { source_fact_key, contract_identity_key },
    );
    assert.equal(hit.mode, "update_by_key");
    assert.equal(hit.row.id, "1");
  }
  // stage 2: contract_identity_key
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [{ id: "2", contract_identity_key, coverage_summary: {} }],
      baseFact,
      { source_fact_key: "other", contract_identity_key },
    );
    assert.equal(hit.mode, "update_by_key");
    assert.equal(hit.row.id, "2");
  }
  // stage 3: policy_number
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [
        {
          id: "3",
          coverage_summary: { policy_number: baseFact.policy_number },
        },
      ],
      baseFact,
      { source_fact_key: "", contract_identity_key: "" },
    );
    assert.equal(hit.mode, "update");
    assert.equal(hit.row.id, "3");
  }
  // stage 4: strong fingerprint (insurer+product+date+premium+maturity)
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [
        {
          id: "4",
          insurer_name: baseFact.insurer,
          product_name: baseFact.product_name,
          monthly_premium: baseFact.monthly_premium,
          effective_from: baseFact.contract_date,
          coverage_summary: { maturity_date: baseFact.maturity_date },
        },
      ],
      { ...baseFact, policy_number: null },
      { source_fact_key: "", contract_identity_key: "" },
    );
    assert.equal(hit.mode, "update");
    assert.equal(hit.row.id, "4");
  }
  // stage 5: same document + insurer/product/premium
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [
        {
          id: "5",
          insurer_name: baseFact.insurer,
          product_name: baseFact.product_name,
          monthly_premium: baseFact.monthly_premium,
          coverage_summary: { source_document_id: baseFact.source_document_id },
        },
      ],
      { ...baseFact, policy_number: null, contract_date: null, maturity_date: null },
      { source_fact_key: "", contract_identity_key: "" },
    );
    assert.equal(hit.mode, "update");
    assert.equal(hit.row.id, "5");
  }
  // stage 6: content-sha + locator + insurer/product
  {
    const hit = findExistingPolicyRowForInventoryFact(
      [
        {
          id: "6",
          insurer_name: baseFact.insurer,
          product_name: baseFact.product_name,
          source_content_sha256: baseFact.source_content_sha256,
          coverage_summary: {
            source_page_or_image: baseFact.source_page_or_image,
            source_content_sha256: baseFact.source_content_sha256,
          },
        },
      ],
      {
        ...baseFact,
        policy_number: null,
        contract_date: null,
        maturity_date: null,
        monthly_premium: null,
        source_document_id: "other-doc",
      },
      { source_fact_key: "", contract_identity_key: "" },
    );
    assert.equal(hit.mode, "update");
    assert.equal(hit.row.id, "6");
  }
}

console.log("PASS");
