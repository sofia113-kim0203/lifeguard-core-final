/**
 * FINAL SLICE — all-customer policy truth evidence (A–N + scenarios).
 * No customer-specific hardcoding of counts/filenames as product rules.
 */
import assert from "node:assert/strict";
import {
  wantsOwnedInsuranceVaultEvidence,
  isPolicyCountOrLedgerQuestion,
  isInsuranceVaultDocumentBoxRecheckQuestion,
} from "../src/lib/chatActiveAttachment.js";
import { buildMyInsuranceStatus } from "../src/lib/keyInsuranceScreenFacts.js";
import {
  buildPolicyCountAuthorityAddendum,
  buildSourceSeparatedTruthContext,
  buildTurnEvidencePackageMeta,
  buildVerifiedPolicyLedgerBrief,
  countActiveDistinctPolicies,
  extractCustomerReportedPolicyCount,
} from "../server/keyCore/keyPolicyTruthEvidence.js";
import {
  buildSystemPrompt,
  buildUserPayload,
  runClaudeFirstDirectQuestionTurn,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  KEY_RECORD_SIDECAR_END,
  KEY_RECORD_SIDECAR_START,
  normalizePolicyInventoryFacts,
} from "../server/keyCore/keyRecordSidecar.js";
import { persistPolicyInventoryFactsToPolicies } from "../server/documentPolicyUploadPersist.js";
import { resolveOwnedInsuranceVaultRecall } from "../server/keyCore/keyClaudeFullDocumentDirect.js";

function makeBlobFromBuffer(buf) {
  return {
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

function thenable(result) {
  return {
    then(resolve, reject) {
      Promise.resolve(result).then(resolve, reject);
    },
  };
}

function makeVaultSupabase({ documents = [], blobsById = {}, existingPolicies = [] } = {}) {
  let policies = [...existingPolicies];
  return {
    from(table) {
      if (table === "customer_documents") {
        let eqId = null;
        const chain = {
          select() {
            return chain;
          },
          eq(col, val) {
            if (col === "id") eqId = val;
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
          maybeSingle: async () => {
            const doc = documents.find((d) => String(d.id) === String(eqId)) ?? null;
            return { data: doc, error: null };
          },
          then(resolve, reject) {
            return thenable({ data: documents, error: null }).then(resolve, reject);
          },
        };
        return chain;
      }
      if (table === "profile_insurance_policies") {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          insert(row) {
            const id = `pol-${policies.length + 1}`;
            policies.push({ id, ...row });
            return {
              select() {
                return {
                  single: async () => ({ data: { id }, error: null }),
                };
              },
            };
          },
          update() {
            const upd = {
              eq() {
                return upd;
              },
              then(resolve, reject) {
                return thenable({ data: null, error: null }).then(resolve, reject);
              },
            };
            return upd;
          },
          then(resolve, reject) {
            return thenable({ data: policies, error: null }).then(resolve, reject);
          },
        };
        return chain;
      }
      const empty = {
        select() {
          return empty;
        },
        eq() {
          return empty;
        },
        is() {
          return empty;
        },
        order() {
          return empty;
        },
        limit() {
          return empty;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve, reject) {
          return thenable({ data: [], error: null }).then(resolve, reject);
        },
      };
      return empty;
    },
    storage: {
      from: () => ({
        download: async (path) => {
          const id = String(path ?? "").split("/").pop()?.replace(/\.[^.]+$/, "") || "";
          const byPath = blobsById[path] ?? blobsById[id] ?? null;
          if (!byPath) return { data: null, error: { message: "not_found" } };
          return { data: byPath, error: null };
        },
      }),
    },
    _policies: () => policies,
  };
}

function insuranceDoc(row) {
  return {
    customer_hint_type: "insurance_policy",
    doc_class: "policy_certificate",
    metadata_json: { category_key: "insurance_policy" },
    ...row,
  };
}

// Detectors
assert.equal(isPolicyCountOrLedgerQuestion("가입 건수가 몇 건이야?"), true);
assert.equal(isInsuranceVaultDocumentBoxRecheckQuestion("문서함 다시 봐줘"), true);
assert.equal(wantsOwnedInsuranceVaultEvidence("가입 건수 알려줘"), true);
assert.equal(wantsOwnedInsuranceVaultEvidence("문서함 다시 확인해줘"), true);
assert.equal(wantsOwnedInsuranceVaultEvidence("오늘 날씨 어때"), false);

// E/F — customer reported vs history
assert.equal(extractCustomerReportedPolicyCount("나는 12건이야"), 12);
assert.equal(extractCustomerReportedPolicyCount("파일상으로 7건"), 7);
{
  const addendum = buildPolicyCountAuthorityAddendum({
    ledgerBrief: { active_distinct_count: 2 },
    customerReportedCount: 12,
  });
  assert.match(addendum, /active_distinct_count|활성 distinct/);
  assert.match(addendum, /customer_reported/);
  assert.match(addendum, /이전 KEY/);
  const ctx = buildSourceSeparatedTruthContext({
    ledgerBrief: { active_distinct_count: 2 },
    customerReportedCount: 12,
    countQuestion: true,
  });
  assert.equal(ctx.HISTORY_COUNTS_NOT_AUTHORITY, true);
  assert.equal(ctx.CUSTOMER_REPORTED_FACTS.policy_count, 12);
  assert.equal(ctx.VERIFIED_POLICY_LEDGER.active_distinct_count, 2);
}

// H — distinct count via same helper as left rail
{
  const policies = [
    { id: "1", insurer_name: "A", product_name: "P1", is_active: true },
    { id: "2", insurer_name: "B", product_name: "P2", is_active: true },
    {
      id: "3",
      insurer_name: "C",
      product_name: "P3",
      is_active: false,
      coverage_summary: { retired_reason: "source_deleted" },
    },
  ];
  const counts = countActiveDistinctPolicies(policies);
  const left = buildMyInsuranceStatus(policies);
  assert.equal(counts.active_distinct_count, left.totalCount);
  assert.equal(counts.active_distinct_count, 2);
}

// G — inventory facts keep source ids/sha
{
  const facts = normalizePolicyInventoryFacts([
    {
      insurer: "A",
      product_name: "X",
      contract_date: "2020-01-01",
      monthly_premium: 1000,
      source_document_id: "doc-1",
      source_content_sha256: "abc123",
      source_page_or_image: "p1",
      verification_status: "document_read",
    },
  ]);
  assert.equal(facts[0].source_document_id, "doc-1");
  assert.equal(facts[0].source_content_sha256, "abc123");
}

// A/B/C — vault sha dedupe + same filename different sha kept
{
  const jpegA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
  const jpegB = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9]);
  const jpegC = Buffer.from(jpegA); // identical sha to A
  const docs = [
    insuranceDoc({
      id: "d1",
      customer_id: "c1",
      storage_path: "c1/d1.jpg",
      mime_type: "image/jpeg",
      original_filename: "page.jpg",
      deleted_at: null,
      created_at: "2026-01-01T00:00:00Z",
    }),
    insuranceDoc({
      id: "d2",
      customer_id: "c1",
      storage_path: "c1/d2.jpg",
      mime_type: "image/jpeg",
      original_filename: "page.jpg",
      deleted_at: null,
      created_at: "2026-01-02T00:00:00Z",
    }),
    insuranceDoc({
      id: "d3",
      customer_id: "c1",
      storage_path: "c1/d3.jpg",
      mime_type: "image/jpeg",
      original_filename: "copy.jpg",
      deleted_at: null,
      created_at: "2026-01-03T00:00:00Z",
    }),
  ];
  const sb = makeVaultSupabase({
    documents: docs,
    blobsById: {
      "c1/d1.jpg": makeBlobFromBuffer(jpegA),
      "c1/d2.jpg": makeBlobFromBuffer(jpegB),
      "c1/d3.jpg": makeBlobFromBuffer(jpegC),
    },
  });

  // listOwnedInsuranceOriginalDocuments may filter by category — stub verifyAndFetch instead
  const recall = await resolveOwnedInsuranceVaultRecall({
    supabase: sb,
    customerId: "c1",
    env: {},
    verifyAndFetch: async ({ documentId }) => {
      const doc = docs.find((d) => d.id === documentId);
      if (!doc) return { ok: false, reason: "missing" };
      const blob = sb.storage.from().download
        ? (await sb.storage.from().download(doc.storage_path)).data
        : null;
      if (!blob) return { ok: false, reason: "download_failed" };
      const buf = Buffer.from(await blob.arrayBuffer());
      const { createHash } = await import("node:crypto");
      const sha = createHash("sha256").update(buf).digest("hex");
      return {
        ok: true,
        pdfBase64: buf.toString("base64"),
        mediaType: "image/jpeg",
        fileSizeBytes: buf.length,
        content_sha256: sha,
        document: doc,
      };
    },
  });
  assert.equal(recall.mode, "attach");
  assert.equal(recall.attachments.length, 2, "A/B/C: unique SHA kept; identical SHA dropped; same name different SHA kept");
  const meta = buildTurnEvidencePackageMeta({
    evidence_scope: "owned_insurance_vault",
    vaultRecall: recall,
  });
  assert.equal(meta.attached_document_count, 2);
  assert.equal(meta.attached_sha256.length, 2);
}

// D — partial fail → partial_originals
{
  const meta = buildTurnEvidencePackageMeta({
    evidence_scope: "owned_insurance_vault",
    vaultRecall: {
      mode: "attach",
      attachments: [{ document_id: "d1", content_sha256: "aa" }],
      listing: [{ id: "d1" }, { id: "d2" }],
      failed: [{ document_id: "d2", reason: "pdf_download_failed" }],
    },
  });
  assert.equal(meta.partial_originals, true);
  const addendum = buildPolicyCountAuthorityAddendum({
    ledgerBrief: { active_distinct_count: 1 },
    evidenceMeta: meta,
  });
  assert.match(addendum, /전체 건수로 단정하지/);
}

// Prompt expert sentence + count authority language
{
  const prompt = buildSystemPrompt();
  assert.match(prompt, /최고 수준의 보험 설계 전문가처럼/);
  assert.match(prompt, /KEY라는 하나의 존재/);
  assert.match(prompt, /VERIFIED_POLICY_LEDGER/);
}

// Payload source separation
{
  const payload = buildUserPayload({
    question: "가입 건수?",
    chart: { schema: "verified_customer_chart_v1", policies: [] },
    contextPack: {},
    policyTruthContext: buildSourceSeparatedTruthContext({
      ledgerBrief: buildVerifiedPolicyLedgerBrief([
        { insurer_name: "A", product_name: "P", is_active: true },
      ]),
      countQuestion: true,
    }),
  });
  assert.equal(
    payload.current_context.policy_truth.HISTORY_COUNTS_NOT_AUTHORITY,
    true,
  );
  assert.equal(
    payload.current_context.policy_truth.VERIFIED_POLICY_LEDGER.active_distinct_count,
    1,
  );
}

// I — same original reprocess does not increase count (policy number match)
{
  const facts = normalizePolicyInventoryFacts([
    {
      insurer: "A생명",
      product_name: "상품1",
      contract_date: "2019-01-01",
      monthly_premium: 10000,
      policy_number: "PN-1",
      source_document_id: "doc-1",
      source_content_sha256: "sha1",
    },
  ]);
  const existing = [
    {
      id: "pol-1",
      insurer_name: "A생명",
      product_name: "상품1",
      monthly_premium: 10000,
      is_active: true,
      coverage_summary: { policy_number: "PN-1" },
    },
  ];
  let updateCount = 0;
  let insertCount = 0;
  const sb = {
    from(table) {
      if (table !== "profile_insurance_policies") {
        const empty = {
          select() {
            return empty;
          },
          eq() {
            return empty;
          },
          then(resolve, reject) {
            return thenable({ data: [], error: null }).then(resolve, reject);
          },
        };
        return empty;
      }
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        update() {
          updateCount += 1;
          const upd = {
            eq() {
              return upd;
            },
            then(resolve, reject) {
              return thenable({ data: null, error: null }).then(resolve, reject);
            },
          };
          return upd;
        },
        insert() {
          insertCount += 1;
          return {
            select() {
              return {
                single: async () => ({ data: { id: "new" }, error: null }),
              };
            },
          };
        },
        then(resolve, reject) {
          return thenable({ data: existing, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const first = await persistPolicyInventoryFactsToPolicies({
    supabase: sb,
    customerId: "c1",
    facts,
    ownedDocumentIds: ["doc-1"],
  });
  const second = await persistPolicyInventoryFactsToPolicies({
    supabase: sb,
    customerId: "c1",
    facts,
    ownedDocumentIds: ["doc-1"],
  });
  assert.equal(first.stored >= 1, true);
  assert.equal(insertCount, 0, "I: reprocess updates, does not insert new rows");
  assert.equal(second.attempted, true);
  assert.equal(updateCount >= 1, true);
}

// J/K/L/M/N — vault count question: ledger in payload, 1 Claude call, sidecar fail preserves answer
{
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  let claudeCalls = 0;
  let sawLedger = false;
  let sawHistoryBlock = false;
  let sawCountAddendum = false;
  const answer = [
    "현재 KEY 계약 장부에서 확인된 활성 계약은 2건입니다.",
    KEY_RECORD_SIDECAR_START,
    "{not-json",
    KEY_RECORD_SIDECAR_END,
  ].join("\n");
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "가입 건수가 몇 건이야?",
    history: [
      { role: "assistant", content: "이전에 12건이라고 말씀드렸습니다." },
      { role: "user", content: "다시 확인해줘" },
    ],
    loadedContext: {
      policies: [
        { id: "p1", insurer_name: "A", product_name: "1", is_active: true },
        { id: "p2", insurer_name: "B", product_name: "2", is_active: true },
      ],
      policy_count: 2,
    },
    customerId: "cust-count",
    userSupabase: makeVaultSupabase({
      documents: [
        insuranceDoc({
          id: "vd1",
          customer_id: "cust-count",
          storage_path: "cust-count/vd1.jpg",
          mime_type: "image/jpeg",
          original_filename: "v1.jpg",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00Z",
        }),
      ],
      blobsById: {
        "cust-count/vd1.jpg": makeBlobFromBuffer(jpeg),
      },
    }),
    env: {
      ANTHROPIC_API_KEY: "test-key",
      KEY_CLAUDE_FIRST_DIRECT: "1",
    },
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const body = JSON.parse(String(opts?.body ?? "{}"));
      const system = Array.isArray(body.system)
        ? body.system.map((s) => s?.text ?? "").join("\n")
        : String(body.system ?? "");
      sawCountAddendum = /POLICY_COUNT_AUTHORITY|active_distinct_count|확정 숫자/.test(system);
      const content = body?.messages?.[0]?.content;
      const texts = Array.isArray(content)
        ? content.filter((b) => b?.type === "text").map((b) => String(b.text ?? ""))
        : [];
      for (const t of texts) {
        try {
          const payload = JSON.parse(t);
          const truth = payload?.current_context?.policy_truth;
          if (truth?.VERIFIED_POLICY_LEDGER?.active_distinct_count === 2) sawLedger = true;
          if (truth?.HISTORY_COUNTS_NOT_AUTHORITY === true) sawHistoryBlock = true;
        } catch {
          /* not json */
        }
      }
      return {
        ok: true,
        async json() {
          return { content: [{ type: "text", text: answer }], stop_reason: "end_turn" };
        },
      };
    },
  });
  assert.equal(claudeCalls, 1, "M: Claude call once");
  assert.equal(
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.provider_calls,
    1,
  );
  assert.equal(
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.s6_speak_calls,
    0,
    "SECOND_CLAUDE: 0",
  );
  assert.equal(sawLedger, true, "J: ledger in Claude payload");
  assert.equal(sawHistoryBlock, true, "E: history counts not authority");
  assert.equal(sawCountAddendum, true, "4: count authority addendum");
  assert.match(String(result.customerText), /2건/);
  assert.equal(String(result.customerText).includes(KEY_RECORD_SIDECAR_START), false, "L: sidecar hidden");
  assert.equal(
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sealed_matches_claude,
    true,
    "N: seal matches Claude customer answer",
  );
  const evidence =
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.evidence_package;
  assert.ok(evidence, "1: evidence package on voice trace");
  assert.equal(
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.verified_policy_ledger
      ?.active_distinct_count,
    2,
  );
}

// Document-box recheck wants vault (not single mention shrink)
assert.equal(wantsOwnedInsuranceVaultEvidence("문서함에 있는 거 지금 다시 봐줘"), true);

// Jinwoo-shaped regression evidence (structure only — not a product hardcode)
{
  const policies = Array.from({ length: 12 }, (_, i) => ({
    id: `jw-${i + 1}`,
    insurer_name: `Insurer${i + 1}`,
    product_name: `Product${i + 1}`,
    is_active: true,
    monthly_premium: 1000 + i,
  }));
  const left = buildMyInsuranceStatus(policies).totalCount;
  const ledger = buildVerifiedPolicyLedgerBrief(policies).active_distinct_count;
  assert.equal(left, 12);
  assert.equal(ledger, 12);
  assert.equal(left, ledger, "JINWOO_REGRESSION structure: chat/left/ledger same count helper");
}

console.log("key-policy-truth-evidence-unit-test: PASS");
