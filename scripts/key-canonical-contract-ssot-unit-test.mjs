/**
 * P0 — Canonical Contract SSOT unit tests (GO §10).
 */
import assert from "node:assert/strict";
import {
  buildMyInsuranceStatus,
  projectCanonicalContracts,
  buildContractIdentityKey,
  buildSourceFactKey,
} from "../src/lib/keyInsuranceScreenFacts.js";
import {
  buildVerifiedPolicyLedgerBrief,
  countActiveDistinctPolicies,
  buildPolicyCountAuthorityAddendum,
} from "../server/keyCore/keyPolicyTruthEvidence.js";
import { buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { wantsOwnedInsuranceVaultEvidence } from "../src/lib/chatActiveAttachment.js";
import { resolveOwnedInsuranceVaultRecall } from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import { buildUserPayloadCapture } from "../server/keyCore/keyQaTurnRecorder.js";
import { persistPolicyInventoryFactsToPolicies } from "../server/documentPolicyUploadPersist.js";

function pnPolicy(id, pn, extra = {}) {
  return {
    id,
    insurer_name: extra.insurer_name ?? "A생명",
    product_name: extra.product_name ?? "상품X",
    monthly_premium: extra.monthly_premium ?? 10000,
    is_active: true,
    coverage_summary: {
      policy_number: pn,
      source_document_id: extra.source_document_id ?? `doc-${id}`,
      ...(extra.source_content_sha256
        ? { source_content_sha256: extra.source_content_sha256 }
        : {}),
      ...(extra.source_page_or_image
        ? { source_page_or_image: extra.source_page_or_image }
        : {}),
      ...(extra.contractor_name ? { contractor_name: extra.contractor_name } : {}),
      ...(extra.insured_name ? { insured_name: extra.insured_name } : {}),
    },
  };
}

// 1. Same source_document_id same fact twice → confirmed +0 (dedupe by identity)
{
  const rows = [
    pnPolicy("a", "PN-100", { source_document_id: "doc-1" }),
    pnPolicy("b", "PN-100", { source_document_id: "doc-1" }),
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 1);
  assert.equal(p.active_distinct_count, 1);
  assert.equal(p.raw_source_row_count, 2);
}

// 2. Same SHA, different document_id, same strong contract → confirmed 1
{
  const sha = "a".repeat(64);
  const rows = [
    pnPolicy("a", "PN-200", { source_document_id: "doc-a", source_content_sha256: sha }),
    pnPolicy("b", "PN-200", { source_document_id: "doc-b", source_content_sha256: sha }),
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 1);
}

// 3. Same insurer/product/premium, different policy_number → confirmed 2
{
  const rows = [
    pnPolicy("a", "PN-AAA-001", {
      insurer_name: "KB",
      product_name: "자녀",
      monthly_premium: 42860,
    }),
    pnPolicy("b", "PN-BBB-002", {
      insurer_name: "KB",
      product_name: "자녀",
      monthly_premium: 42860,
    }),
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 2);
}

// 4. Same insurer/product/premium, no PN/SHA/locator → not merged to 1; review candidates
{
  const rows = [
    {
      id: "w1",
      insurer_name: "KB",
      product_name: "자녀",
      monthly_premium: 42860,
      is_active: true,
      coverage_summary: { source_document_id: "d1" },
    },
    {
      id: "w2",
      insurer_name: "KB",
      product_name: "자녀",
      monthly_premium: 42860,
      is_active: true,
      coverage_summary: { source_document_id: "d2" },
    },
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 0);
  assert.equal(p.review_candidates.length, 2);
  assert.equal(buildMyInsuranceStatus(rows).totalCount, 0);
}

// 5. One original, multiple contracts via locator/fingerprint
{
  const sha = "b".repeat(64);
  const rows = [
    {
      id: "c1",
      insurer_name: "A",
      product_name: "P1",
      monthly_premium: 1000,
      is_active: true,
      coverage_summary: {
        source_content_sha256: sha,
        source_page_or_image: "p1",
        source_document_id: "doc-m",
        effective_from: "2020-01-01",
      },
    },
    {
      id: "c2",
      insurer_name: "A",
      product_name: "P2",
      monthly_premium: 2000,
      is_active: true,
      coverage_summary: {
        source_content_sha256: sha,
        source_page_or_image: "p2",
        source_document_id: "doc-m",
        effective_from: "2021-01-01",
      },
    },
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 2);
  assert.ok(buildContractIdentityKey(rows[0]));
  assert.ok(buildContractIdentityKey(rows[1]));
  assert.notEqual(buildContractIdentityKey(rows[0]), buildContractIdentityKey(rows[1]));
}

// 6. 3 docs × 4 contracts → confirmed 12 (no customer/product hardcode)
{
  const rows = [];
  for (let d = 0; d < 3; d += 1) {
    for (let c = 0; c < 4; c += 1) {
      rows.push(
        pnPolicy(`d${d}-c${c}`, `PN-${d}-${c}`, {
          insurer_name: `Insurer${d}`,
          product_name: `Product${c}`,
          source_document_id: `doc-${d}`,
          monthly_premium: 1000 + d * 10 + c,
        }),
      );
    }
  }
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 12);
  assert.equal(buildMyInsuranceStatus(rows).totalCount, 12);
  assert.equal(buildVerifiedPolicyLedgerBrief(rows).contracts.length, 12);
  assert.equal(buildVerifiedCustomerChart({ policies: rows }).contracts.length, 12);
}

// 7. Ownership mismatch → personal confirmed excluded
{
  const rows = [
    pnPolicy("ok", "PN-OK"),
    pnPolicy("bad", "PN-BAD", { contractor_name: "홍길동", insured_name: "홍길동" }),
  ];
  const p = projectCanonicalContracts(rows);
  assert.equal(p.confirmed_contracts.length, 1);
  assert.equal(p.ownership_exclusions, 1);
  assert.ok(p.review_candidates.some((r) => r.id === "bad"));
}

// Consumer path coherence
{
  const rows = [
    pnPolicy("1", "PN-1"),
    pnPolicy("2", "PN-2"),
    {
      id: "weak",
      insurer_name: "Z",
      product_name: "Z",
      monthly_premium: 1,
      is_active: true,
      coverage_summary: { source_document_id: "dw" },
    },
  ];
  const projection = projectCanonicalContracts(rows);
  const status = buildMyInsuranceStatus(rows);
  const ledger = buildVerifiedPolicyLedgerBrief(rows);
  const chart = buildVerifiedCustomerChart({ policies: rows });
  const counts = countActiveDistinctPolicies(rows);
  const addendum = buildPolicyCountAuthorityAddendum({ ledgerBrief: ledger });
  assert.equal(projection.confirmed_contracts.length, 2);
  assert.equal(projection.active_distinct_count, 2);
  assert.equal(status.totalCount, 2);
  assert.equal(status.active_distinct_count, 2);
  assert.equal(ledger.contracts.length, 2);
  assert.equal(ledger.active_distinct_count, 2);
  assert.equal(chart.contracts.length, 2);
  assert.equal(chart.policy_count.value, 2);
  assert.equal(counts.active_distinct_count, 2);
  assert.match(addendum, /confirmed_n|active_distinct_count/);
  assert.equal(projection.raw_source_row_count, 3);
  // Raw 40 rows must not become customer contract list length
  const raw40 = Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`,
    insurer_name: "Same",
    product_name: "Same",
    monthly_premium: 1000,
    is_active: true,
    coverage_summary: { source_document_id: `doc-${i}` },
  }));
  assert.equal(buildMyInsuranceStatus(raw40).totalCount, 0);
  assert.equal(buildVerifiedPolicyLedgerBrief(raw40).contracts.length, 0);
  assert.equal(buildVerifiedCustomerChart({ policies: raw40 }).contracts.length, 0);
  assert.equal(projectCanonicalContracts(raw40).review_candidate_count, 40);
}

// Persistence: same strong fact twice → insert once; weak → skipped_weak_merge
{
  const facts = [
    {
      insurer: "A생명",
      product_name: "상품1",
      contract_date: "2019-01-01",
      maturity_date: "2099-01-01",
      monthly_premium: 10000,
      policy_number: "PN-IDEMP-1",
      source_document_id: "doc-1",
      source_content_sha256: "c".repeat(64),
      source_page_or_image: "1",
    },
  ];
  let inserts = 0;
  let updates = 0;
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
          updates += 1;
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
  const first = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts,
    ownedDocumentIds: ["doc-1"],
  });
  const second = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts,
    ownedDocumentIds: ["doc-1"],
  });
  assert.equal(first.stored, 1);
  assert.equal(inserts, 1);
  assert.equal(rows.length, 1);
  assert.equal(second.stored, 1);
  assert.equal(inserts, 1, "repeat persist insert 0");
  assert.equal(updates >= 1, true);
  assert.ok(rows[0].source_fact_key || rows[0].coverage_summary?.source_fact_key);
  assert.ok(rows[0].contract_identity_key || rows[0].coverage_summary?.contract_identity_key);

  const weak = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts: [
      {
        insurer: "Weak",
        product_name: "Only",
        monthly_premium: 1,
        source_document_id: "doc-w",
      },
    ],
    ownedDocumentIds: ["doc-w"],
  });
  assert.equal(weak.skipped_weak_merge >= 1, true);
  assert.equal(rows.length, 1, "weak fact does not insert confirmed row");
}

// Vault gate + CAP selects max N (not zero)
{
  assert.equal(wantsOwnedInsuranceVaultEvidence("내 보험 전체를 분석해줘"), true);
  assert.equal(wantsOwnedInsuranceVaultEvidence("가입한 보험 전체 분석"), true);
  assert.equal(wantsOwnedInsuranceVaultEvidence("내가 가입한 보험 뭐야"), true);
  assert.equal(wantsOwnedInsuranceVaultEvidence("내 보험 건수"), true);
  assert.equal(wantsOwnedInsuranceVaultEvidence("오늘 날씨 어때"), false);
  assert.equal(wantsOwnedInsuranceVaultEvidence("맛집 추천해줘"), false);

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  const docs = Array.from({ length: 8 }, (_, i) => ({
    id: `vd${i}`,
    customer_id: "c1",
    storage_path: `c1/vd${i}.jpg`,
    mime_type: "image/jpeg",
    original_filename: `v${i}.jpg`,
    deleted_at: null,
    created_at: `2026-01-0${(i % 9) + 1}T00:00:00Z`,
    doc_class: "policy_certificate",
    customer_hint_type: "insurance_policy",
    metadata_json: { category_key: "insurance_policy" },
  }));
  const recall = await resolveOwnedInsuranceVaultRecall({
    supabase: {
      from() {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          is() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          then(resolve, reject) {
            return Promise.resolve({ data: docs, error: null }).then(resolve, reject);
          },
        };
        return api;
      },
      storage: {
        from() {
          return {
            download: async () => ({
              data: {
                arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
              },
              error: null,
            }),
          };
        },
      },
    },
    customerId: "c1",
    env: {},
    maxUniqueAttach: 6,
    verifyAndFetch: async ({ documentId }) => {
      const { createHash } = await import("node:crypto");
      // Unique SHA per document so cap is about count, not dedupe.
      const buf = Buffer.concat([jpeg, Buffer.from(String(documentId))]);
      const sha = createHash("sha256").update(buf).digest("hex");
      return {
        ok: true,
        pdfBase64: buf.toString("base64"),
        mediaType: "image/jpeg",
        fileSizeBytes: buf.length,
        content_sha256: sha,
        document: docs.find((d) => d.id === documentId),
      };
    },
  });
  assert.notEqual(recall.attachments?.length, 0, "CAP must not wipe to 0");
  assert.equal(recall.attachments.length, 6);
  assert.ok(
    recall.mode === "partial_attach" || recall.mode === "attach",
    `expected attach/partial, got ${recall.mode}`,
  );
  assert.ok(
    recall.reason === "unique_attach_cap_partial" ||
      recall.excluded?.length >= 0 ||
      recall.mode === "attach",
  );
}

// Recorder nested policy_truth
{
  const nested = buildUserPayloadCapture({
    question: "건수?",
    userPayload: {
      current_context: {
        policy_truth: {
          VERIFIED_POLICY_LEDGER: { active_distinct_count: 2, contracts: [{}, {}] },
        },
      },
      policy_truth: null,
    },
  });
  assert.equal(nested.policy_truth?.VERIFIED_POLICY_LEDGER?.active_distinct_count, 2);
  const legacy = buildUserPayloadCapture({
    question: "건수?",
    userPayload: { policy_truth: { COUNT_QUESTION: true } },
  });
  assert.equal(legacy.policy_truth?.COUNT_QUESTION, true);
}

assert.ok(buildSourceFactKey(pnPolicy("x", "PN-Z")));
console.log("key-canonical-contract-ssot-unit-test: PASS");
