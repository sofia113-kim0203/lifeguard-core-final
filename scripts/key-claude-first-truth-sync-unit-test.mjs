/**
 * GO regression — Claude freedom + KEY responsibility reconnect (A–E).
 */
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  wantsClaudeFirstVisualBlocks,
  buildClaudeFirstAnswerTools,
  runClaudeFirstDirectQuestionTurn,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  splitCustomerAnswerAndKeyRecord,
  stripKeyRecordFromStreamText,
  isProgressOnlyCustomerAnswer,
  normalizePolicyInventoryFacts,
  KEY_RECORD_SIDECAR_START,
  KEY_RECORD_SIDECAR_END,
} from "../server/keyCore/keyRecordSidecar.js";
import {
  readJpegExifOrientation,
  normalizeImageOrientationForClaude,
} from "../server/keyCore/keyImageOrientation.js";
import { persistPolicyInventoryFactsToPolicies } from "../server/documentPolicyUploadPersist.js";

function makeBlobFromBuffer(buf) {
  return {
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

function makeAttachSupabase({ document = null, blob = null } = {}) {
  return {
    from(table) {
      if (table === "customer_documents") {
        return {
          select() {
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
      }
      if (table === "profile_insurance_policies") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          insert() {
            return {
              select() {
                return {
                  single: async () => ({ data: { id: "pol-new" }, error: null }),
                };
              },
            };
          },
          update() {
            return this;
          },
          then(resolve) {
            resolve({ data: [], error: null });
          },
        };
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve) {
          resolve({ data: [], error: null });
        },
      };
    },
    storage: {
      from: () => ({
        download: async () => ({ data: blob, error: null }),
      }),
    },
  };
}

// A1/A2/B1/D1/D4 — chart with image original; no record_*; web_search; visual sidecar
{
  let sawChart = false;
  let toolNames = [];
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  const answer = [
    "원본과 차트를 함께 보면 기존 1건과 원본 계약이 있습니다.",
    KEY_RECORD_SIDECAR_START,
    JSON.stringify({
      policy_inventory_facts: [
        {
          insurer: "한화생명",
          product_name: "암보험",
          monthly_premium: 20000,
          contract_date: "2020-01-01",
          maturity_date: "2080-01-01",
          source_document_id: "doc-a1",
          verification_status: "document_read",
        },
      ],
      visual_blocks: [
        {
          type: "policy_count_summary",
          title: "계약 요약",
          rows: [["확인", "1"]],
        },
      ],
    }),
    KEY_RECORD_SIDECAR_END,
  ].join("\n");
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 사진 보험 분석해줘",
    history: [{ role: "user", content: "안녕" }],
    loadedContext: {
      policies: [
        {
          id: "p1",
          insurer_name: "삼성생명",
          product_name: "종신",
          monthly_premium: 30000,
          is_active: true,
        },
      ],
      policy_count: 1,
    },
    customerId: "cust-a1",
    attachedDocumentId: "doc-a1",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-a1",
        customer_id: "cust-a1",
        storage_path: "cust-a1/doc-a1.jpg",
        mime_type: "image/jpeg",
        original_filename: "a.jpg",
        deleted_at: null,
      },
      blob: makeBlobFromBuffer(jpeg),
    }),
    env: {
      ANTHROPIC_API_KEY: "test-key",
      KEY_CLAUDE_FIRST_DIRECT: "1",
    },
    fetchImpl: async (_url, opts) => {
      const body = JSON.parse(String(opts?.body ?? "{}"));
      toolNames = (body.tools ?? []).map((t) => t?.name).filter(Boolean);
      const content = body?.messages?.[0]?.content;
      const texts = Array.isArray(content)
        ? content.filter((b) => b?.type === "text").map((b) => String(b.text ?? ""))
        : [];
      const joined = texts.join("\n");
      sawChart =
        /삼성생명/.test(joined) ||
        /verified_customer_chart/.test(joined) ||
        texts.some((t) => {
          try {
            const payload = JSON.parse(t);
            return payload?.available_verified_evidence?.personal?.chart != null;
          } catch {
            return false;
          }
        });
      return {
        ok: true,
        async json() {
          return { content: [{ type: "text", text: answer }], stop_reason: "end_turn" };
        },
      };
    },
  });
  assert.equal(sawChart, true, "A1: verified chart delivered with image original");
  assert.equal(toolNames.includes("web_search"), true, "D1: web_search on attach turn");
  assert.equal(toolNames.includes("record_confirmed_source_facts"), false, "B1: no record_*");
  assert.equal(result.key_monopoly_failure, false);
  assert.match(String(result.customerText), /원본과 차트/);
  assert.equal(String(result.customerText).includes(KEY_RECORD_SIDECAR_START), false);
  assert.equal((result.visualBlocks ?? []).length >= 1, true, "D4: visual_blocks");
}

// A5 — EXIF orientation reader
{
  // Minimal JPEG SOI + APP1 Exif Orientation=6 (synthetic)
  const app1Body = Buffer.alloc(100);
  app1Body.write("Exif\0\0", 0);
  app1Body.write("MM", 6); // big-endian
  app1Body.writeUInt16BE(0x002a, 8);
  app1Body.writeUInt32BE(8, 10); // IFD0 at offset 8 from TIFF start → absolute 14 in body? 
  // TIFF starts at byte 6. IFD0 offset from TIFF = 8 → index 14 in app1Body
  // Simpler: unit-test passthrough when sharp unavailable / orientation 1
  const plain = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  assert.equal(readJpegExifOrientation(plain), 1, "A5: default orientation 1");
  const normalized = await normalizeImageOrientationForClaude({
    base64: plain.toString("base64"),
    mediaType: "image/jpeg",
    sharpImpl: () => {
      throw new Error("forced_unavailable");
    },
  });
  assert.match(String(normalized.reason), /normalize_failed|sharp_unavailable/);
  assert.equal(normalized.rotated, false);
  assert.ok(normalized.base64, "A5: bytes preserved when normalize fails");
}

// B2 — progress-only rejected
assert.equal(isProgressOnlyCustomerAnswer("확인해볼게요."), true);
assert.equal(isProgressOnlyCustomerAnswer("원본 기준으로 12건입니다. 다음 단계도 안내합니다."), false);
{
  const split = splitCustomerAnswerAndKeyRecord(
    `완결된 답입니다.\n${KEY_RECORD_SIDECAR_START}\n{bad json\n${KEY_RECORD_SIDECAR_END}`,
  );
  assert.equal(split.customer_answer, "완결된 답입니다.");
  assert.equal(split.sidecar_ok, false);
  assert.equal(
    stripKeyRecordFromStreamText(`앞부분 ${KEY_RECORD_SIDECAR_START}{"a":1}`),
    "앞부분",
  );
}

// B1 tool assembly
{
  const tools = buildClaudeFirstAnswerTools({ pdfAttached: true, question: "내 보험 분석" });
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ["web_search"]);
  assert.equal(wantsClaudeFirstVisualBlocks("표로"), true);
}

// System prompt full replacement — ledger authority + insurance transition
{
  const prompt = buildSystemPrompt();
  assert.match(prompt, /AI 보험 주치의 KEY/);
  assert.match(prompt, /VERIFIED_POLICY_LEDGER/);
  assert.match(prompt, /active_distinct_count/);
  assert.match(prompt, /insurance_transition/);
  assert.match(prompt, /먼저 고객이 지금 물은 질문에 충실/);
  assert.match(prompt, /최고 수준의 보험 전문가/);
  assert.equal(/유일한 보험 설계사 KEY/.test(prompt), false);
  assert.equal(/available_verified_evidence의 현재 검증 자료에만 근거/.test(prompt), false);
}

// C — inventory upsert dedupe
{
  const facts = normalizePolicyInventoryFacts([
    {
      insurer: "A생명",
      product_name: "상품1",
      contract_date: "2019-01-01",
      maturity_date: "2099-01-01",
      monthly_premium: 10000,
      policy_number: "PN-1",
      source_document_id: "doc-1",
    },
    {
      insurer: "A생명",
      product_name: "상품1",
      contract_date: "2019-01-01",
      maturity_date: "2099-01-01",
      monthly_premium: 10000,
      policy_number: "PN-1",
      source_document_id: "doc-1",
    },
  ]);
  assert.equal(facts.length, 1, "C2: inventory normalize dedupe");

  let inserts = 0;
  let updates = 0;
  const rows = [];
  const supabase = {
    from(table) {
      assert.equal(table, "profile_insurance_policies");
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        update(payload) {
          updates += 1;
          const id = rows[0]?.id;
          if (id) Object.assign(rows[0], payload, { id });
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
  assert.equal(first.ok, true);
  assert.equal(first.stored, 1);
  assert.equal(inserts, 1);
  assert.equal(rows[0]?.coverage_summary?.policy_number, "PN-1");
  const second = await persistPolicyInventoryFactsToPolicies({
    supabase,
    customerId: "cust-1",
    facts,
    ownedDocumentIds: ["doc-1"],
  });
  assert.equal(second.stored, 1);
  assert.equal(rows.length, 1, "C2: reprocess keeps distinct count 1");
  assert.equal(inserts, 1, "C2: reprocess does not insert again");
  assert.equal(updates >= 1, true);
  assert.equal(rows[0].coverage_summary.verification_status, "document_read");
}

// D3 — no recommendation ban in prompt
{
  const prompt = buildSystemPrompt();
  assert.equal(/추천하지\s*말/.test(prompt), false);
}

// Progress-only live path → failureMode (not seal progress text)
{
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험 분석해줘",
    history: [],
    loadedContext: { policies: [], policy_count: 0 },
    env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { content: [{ type: "text", text: "확인해볼게요." }] };
      },
    }),
  });
  assert.equal(result.key_monopoly_failure, true, "B2: progress-only not sealed as success");
  assert.equal(String(result.customerText).includes("확인해볼게요"), false);
}

console.log("key-claude-first-truth-sync-unit-test: PASS");
