/**
 * Unified KEY corporate contexts — membership-scoped facts beside personal chart.
 * Fake loaders only. No keyword router. No personal/corporate XOR.
 */
import assert from "node:assert/strict";
import {
  buildClaudeCorporateFactPack,
  loadAllowedCorporateContextsForClaude,
  CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
  CLAUDE_CORPORATE_FACT_PACK_V1,
} from "../server/keyCore/keyClaudeCorporateContext.js";
import {
  buildUserPayload,
  runClaudeFirstDirectQuestionTurn,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { CORPORATE_SNAPSHOT_V1 } from "../server/entity/corporate/corporateSnapshot.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(typeof CORPORATE_AUTH_FAILED_CUSTOMER_TEXT, "string");

const ENTITY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTITY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const ENTITY_FOREIGN = "cccccccc-dddd-4eee-8fff-000000000000";

function makeEntityRecord(id = ENTITY_A, displayName = "테스트법인") {
  return {
    entity_id: id,
    id,
    entity_type: "corporate",
    entity_status: "active",
    entity_scope: "owner",
    display_name: displayName,
    memory_version: 3,
    metadata_json: {},
  };
}

function makeMembership(id = ENTITY_A) {
  return {
    entity_id: id,
    user_id: "user-1",
    member_role: "owner",
    member_scope: "read",
    status: "active",
  };
}

function makeMemorySnapshot(entityId = ENTITY_A, industry = "제조") {
  return {
    entity_id: entityId,
    entity_type: "corporate",
    memory_version: 3,
    memory_namespace: "entity_memory_facts",
    fact_count: 3,
    facts: [
      {
        fact_key: "corporate.basic.industry",
        fact_value: industry,
        fact_type: "corporate",
        importance: "high",
      },
      {
        fact_key: "corporate.group_insurance.presence",
        fact_value: "있음",
        fact_type: "corporate",
        importance: "high",
      },
      {
        fact_key: "corporate.note.soft",
        fact_value: "참고용 메모",
        fact_type: "corporate",
        importance: "low",
      },
    ],
  };
}

function makeSnapshot(industry = "제조") {
  return {
    contract_version: CORPORATE_SNAPSHOT_V1,
    derived: {
      industry,
      group_insurance_status: "present",
      employee_count: 12,
      executive_protection: null,
      fire_insurance: null,
      liability: null,
      unknowns: ["executive_protection", "fire_insurance", "liability"],
    },
  };
}

{
  const pack = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(),
    membership: makeMembership(),
    snapshot: makeSnapshot(),
    memorySnapshot: makeMemorySnapshot(),
  });
  assert.equal(pack.contract_version, CLAUDE_CORPORATE_FACT_PACK_V1);
  assert.equal(pack.entity_id, ENTITY_A);
  assert.equal(pack.authorization_verified, true);
  assert.equal(pack.membership_role, "owner");
  assert.ok(pack.verified_facts.some((f) => f.key === "corporate.basic.industry"));
  assert.ok(pack.partial_facts.some((f) => f.key === "corporate.note.soft"));
  assert.ok(pack.unknowns.includes("executive_protection"));
  assert.equal(pack.provenance.memory_namespace, "entity_memory_facts");
  assert.equal(JSON.stringify(pack).includes(ENTITY_B), false);
}

// --- membership none → empty contexts, personal path unchanged ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    listMyCorporateEntitiesImpl: async () => ({ ok: true, entities: [] }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.corporate_contexts, []);
}

// --- membership 1 → one context ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [{ entity_id: ENTITY_A, display_name: "A법인" }],
    }),
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
      membership: makeMembership(ENTITY_A),
    }),
    loadCorporateMemorySnapshotImpl: async (_sb, entityId) => makeMemorySnapshot(entityId, "제조"),
    buildCorporateSnapshotImpl: () => makeSnapshot("제조"),
  });
  assert.equal(result.corporate_contexts.length, 1);
  assert.equal(result.corporate_contexts[0].entity_id, ENTITY_A);
  assert.equal(result.corporate_contexts[0].authorization_verified, true);
}

// --- membership many → separated contexts, no mix ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [
        { entity_id: ENTITY_A, display_name: "A법인" },
        { entity_id: ENTITY_B, display_name: "B법인" },
      ],
    }),
    loadEntityContextRecordsImpl: async (_sb, { conversationContext }) => {
      const id = conversationContext.entity_id;
      return {
        entityRecord: makeEntityRecord(id, id === ENTITY_A ? "A법인" : "B법인"),
        membership: makeMembership(id),
      };
    },
    loadCorporateMemorySnapshotImpl: async (_sb, entityId) =>
      makeMemorySnapshot(entityId, entityId === ENTITY_A ? "제조" : "유통"),
    buildCorporateSnapshotImpl: ({ entityRecord }) =>
      makeSnapshot(entityRecord.display_name === "A법인" ? "제조" : "유통"),
  });
  assert.equal(result.corporate_contexts.length, 2);
  assert.equal(result.corporate_contexts[0].entity_id, ENTITY_A);
  assert.equal(result.corporate_contexts[1].entity_id, ENTITY_B);
  const aJson = JSON.stringify(result.corporate_contexts[0]);
  const bJson = JSON.stringify(result.corporate_contexts[1]);
  assert.equal(aJson.includes(ENTITY_B), false);
  assert.equal(bJson.includes(ENTITY_A), false);
}

// --- no membership on listed entity → skipped, not whole-turn failure ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [{ entity_id: ENTITY_A, display_name: "A법인" }],
    }),
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: makeEntityRecord(ENTITY_A),
      membership: null,
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.corporate_contexts, []);
}

// --- payload: personal chart always present; corporate contexts separate ---
{
  const personal = buildUserPayload({
    question: "내 보험 알려줘",
    chart: { policies: [{ insurer: "삼성생명" }], policy_count: 1 },
    allowlist: { allowed_numbers: [1], allowed_entities: ["삼성생명"] },
    contextPack: { recent_turns: [] },
  });
  assert.equal(personal.verified_customer_chart.policy_count, 1);
  assert.deepEqual(personal.verified_corporate_contexts, []);
  assert.equal(Object.prototype.hasOwnProperty.call(personal, "verified_corporate_facts"), false);
}

{
  const packA = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
    membership: makeMembership(ENTITY_A),
    snapshot: makeSnapshot("제조"),
    memorySnapshot: makeMemorySnapshot(ENTITY_A, "제조"),
  });
  const packB = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(ENTITY_B, "B법인"),
    membership: makeMembership(ENTITY_B),
    snapshot: makeSnapshot("유통"),
    memorySnapshot: makeMemorySnapshot(ENTITY_B, "유통"),
  });
  const payload = buildUserPayload({
    question: "내 보험과 회사 단체보험을 비교해줘",
    chart: { policies: [{ insurer: "개인보험사" }], policy_count: 34 },
    allowlist: { allowed_numbers: [34], allowed_entities: ["개인보험사"] },
    contextPack: { recent_turns: [] },
    corporateContexts: [packA, packB],
  });
  assert.equal(payload.verified_customer_chart.policy_count, 34);
  assert.equal(payload.verified_corporate_contexts.length, 2);
  assert.equal(payload.verified_corporate_contexts[0].entity_id, ENTITY_A);
  assert.equal(payload.verified_corporate_contexts[1].entity_id, ENTITY_B);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "guidance"), false);
  assert.equal(payload.verified_corporate_contexts?.length >= 1, true);
  assert.equal(JSON.stringify(payload.verified_corporate_contexts[0]).includes(ENTITY_B), false);
}

// --- home request body: no entity fields ---
{
  const body = buildHomeBrainFactRequestBody("내 보험은?", []);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_id"), false);
}

const previewEnv = {
  VERCEL_ENV: "preview",
  KEY_BORROWED_SENSES: "shadow",
  KEY_CLAUDE_FIRST_DIRECT: "1",
  ANTHROPIC_API_KEY: "test-key-corporate-unified",
};

function extractUserText(opts) {
  const body = JSON.parse(String(opts?.body ?? "{}"));
  const content = body?.messages?.[0]?.content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.find((b) => b?.type === "text")?.text ?? ""
      : "";
}

// --- arbitrary client entity_id → does not widen; membership list drives contexts ---
{
  let claudeCalls = 0;
  let sawPersonal = false;
  let sawForeign = false;
  let sawAllowed = false;
  const packA = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
    membership: makeMembership(ENTITY_A),
    snapshot: makeSnapshot("제조"),
    memorySnapshot: makeMemorySnapshot(ENTITY_A, "제조"),
  });
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험과 회사 단체보험 비교해줘",
    history: [],
    loadedContext: {
      policies: [{ insurer_name: "삼성생명", monthly_premium: 50000 }],
      policy_count: 2,
    },
    customerId: "cust-1",
    authUserId: "user-1",
    entityContext: {
      conversationContext: {
        entity_type: "corporate",
        entity_id: ENTITY_FOREIGN,
      },
    },
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const text = extractUserText(opts);
      if (/verified_customer_chart/.test(text) && /삼성생명/.test(text)) sawPersonal = true;
      if (text.includes(ENTITY_FOREIGN)) sawForeign = true;
      if (/verified_corporate_contexts/.test(text) && /제조/.test(text)) sawAllowed = true;
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "text",
                text: "개인 계약과 법인 검증 사실을 함께 확인했습니다.",
              },
            ],
          };
        },
      };
    },
    loadAllowedCorporateContextsForClaudeImpl: async () => ({
      ok: true,
      corporate_contexts: [packA],
    }),
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawPersonal, true);
  assert.equal(sawAllowed, true);
  assert.equal(sawForeign, false);
  assert.equal(result.key_monopoly_failure, false);
  assert.ok(String(result.customerText ?? "").length > 0);
}

// --- membership none → personal chart path regression ---
{
  let claudeCalls = 0;
  let sawPersonal = false;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험 몇 건이야?",
    history: [],
    loadedContext: {
      policies: [{ insurer_name: "한화생명" }],
      policy_count: 2,
    },
    customerId: "cust-1",
    authUserId: "user-1",
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const text = extractUserText(opts);
      if (/verified_customer_chart/.test(text)) sawPersonal = true;
      assert.match(text, /verified_corporate_contexts/);
      assert.equal(/Use only verified_corporate_facts/.test(text), false);
      return {
        ok: true,
        async json() {
          return {
            content: [{ type: "text", text: "확인된 계약은 2건입니다." }],
          };
        },
      };
    },
    loadAllowedCorporateContextsForClaudeImpl: async () => ({
      ok: true,
      corporate_contexts: [],
    }),
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawPersonal, true);
  assert.equal(result.key_monopoly_failure, false);
}

// --- UI / API dead assets removed ---
{
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.equal(/selectChatEntity|activeEntityId|대화 대상/.test(homeChat), false);
  assert.equal(/entityType|entityId/.test(homeChat), false);
  const sessionCore = readFileSync(join(ROOT, "src/lib/lifeguardChatSessionCore.js"), "utf8");
  assert.equal(/active_entity_type|active_entity_id|activeEntity/.test(sessionCore), false);
  const firstDirect = readFileSync(join(ROOT, "server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  assert.equal(/corporateTurn|Use only verified_corporate_facts|verified_customer_chart: null/.test(firstDirect), false);
  assert.match(firstDirect, /verified_corporate_contexts/);
  assert.match(firstDirect, /loadAllowedCorporateContextsForClaude/);
}

console.log("key-claude-corporate-context-unit-test: PASS");
