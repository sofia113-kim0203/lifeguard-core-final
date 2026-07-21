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
import { clearReadyCardCache } from "../server/keyCore/keyReadyCardCache.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { CORPORATE_SNAPSHOT_V1 } from "../server/entity/corporate/corporateSnapshot.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

clearReadyCardCache();

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
      business_description: null,
      group_insurance_status: "present",
      employee_count: 12,
      workplace_or_facilities: null,
      executive_protection: null,
      fire_insurance: null,
      liability: null,
      confirmed_goals: null,
      concerns: null,
      unknowns: [
        "business_description",
        "workplace_or_facilities",
        "executive_protection",
        "fire_insurance",
        "liability",
        "confirmed_goals",
        "concerns",
      ],
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
  assert.equal(pack.chart?.fields?.industry?.status, "known");
  assert.equal(pack.chart?.fields?.industry?.value, "제조");
  assert.equal(pack.chart?.fields?.fire_insurance?.status, "unknown");
  assert.equal(pack.provenance.memory_namespace, "entity_memory_facts");
  assert.equal(JSON.stringify(pack).includes(ENTITY_B), false);
}

// --- unauthorized selected entity → fail-closed empty ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    selectedEntityId: ENTITY_FOREIGN,
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [{ entity_id: ENTITY_A, display_name: "A법인" }],
    }),
  });
  assert.equal(result.authorization_denied, true);
  assert.deepEqual(result.corporate_contexts, []);
  assert.equal(result.skipped_reason, "selected_entity_not_authorized");
}

// --- corporate documents stay entity-scoped ---
{
  const docs = [
    {
      document_id: "doc-a",
      entity_id: ENTITY_A,
      original_filename: "a.pdf",
      evidence_tier: "original_presence",
    },
    {
      document_id: "doc-b",
      entity_id: ENTITY_B,
      original_filename: "b.pdf",
      evidence_tier: "original_presence",
    },
  ];
  const pack = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
    membership: makeMembership(ENTITY_A),
    snapshot: makeSnapshot("제조"),
    memorySnapshot: makeMemorySnapshot(ENTITY_A, "제조"),
    documents: docs,
  });
  assert.equal(pack.documents.length, 1);
  assert.equal(pack.documents[0].document_id, "doc-a");
  assert.equal(JSON.stringify(pack.documents).includes(ENTITY_B), false);
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

const grantAll = async ({ entityId }) => ({
  ok: true,
  grants: [],
  scopes_entity_level: [
    "corporate_profile",
    "corporate_documents",
    "insurance_consultation",
  ],
  subjects: {},
  authority_types: ["representative"],
});

// --- membership 1 + authority → one context ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [{ entity_id: ENTITY_A, display_name: "A법인" }],
    }),
    loadHolderAuthorityGrantsImpl: grantAll,
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
  assert.equal(result.corporate_contexts[0].authority_brief?.membership_is_not_consent, true);
}

// --- membership without authority consent → empty (fail-closed) ---
{
  const result = await loadAllowedCorporateContextsForClaude({
    userSupabase: {},
    customerId: "cust-1",
    authUserId: "user-1",
    selectedEntityId: ENTITY_A,
    listMyCorporateEntitiesImpl: async () => ({
      ok: true,
      entities: [{ entity_id: ENTITY_A, display_name: "A법인" }],
    }),
    loadHolderAuthorityGrantsImpl: async () => ({
      ok: true,
      grants: [],
      scopes_entity_level: [],
      subjects: {},
      authority_types: [],
    }),
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
      membership: makeMembership(ENTITY_A),
    }),
  });
  assert.equal(result.corporate_contexts.length, 0);
  assert.equal(result.authorization_denied, true);
  assert.equal(result.skipped_reason, "no_active_authority_consent");
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
    loadHolderAuthorityGrantsImpl: grantAll,
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
  assert.equal(personal.available_verified_evidence.personal.chart.policy_count, 1);
  assert.deepEqual(personal.available_verified_evidence.corporate, []);
  assert.equal(Object.prototype.hasOwnProperty.call(personal, "verified_corporate_facts"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(personal, "verified_customer_chart"), false);
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
    selectedCorporateEntityId: ENTITY_A,
    priorConsultation: {
      related_turns: [{ text: "개인 상담" }],
      open_goals: [],
      open_tasks: [],
      life_threads: [],
    },
  });
  assert.equal(payload.available_verified_evidence.personal.chart.policy_count, 34);
  assert.equal(payload.available_verified_evidence.corporate.length, 2);
  assert.equal(payload.available_verified_evidence.corporate[0].entity_id, ENTITY_A);
  assert.equal(payload.available_verified_evidence.corporate[1].entity_id, ENTITY_B);
  assert.equal(payload.current_context.corporate_turn.selected_entity_id, ENTITY_A);
  assert.equal(
    payload.current_context.corporate_turn.corporate_prior_consultation.status,
    "unknown",
  );
  assert.equal(payload.current_context.prior_consultation.subject_scope, "personal_only");
  assert.ok(payload.available_verified_evidence.corporate[0].chart);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "guidance"), false);
  assert.equal(
    JSON.stringify(payload.available_verified_evidence.corporate[0]).includes(ENTITY_B),
    false,
  );
  assert.equal(
    JSON.stringify(payload.available_verified_evidence.corporate[0]).includes("개인보험사"),
    false,
  );
}

// --- home request body: default personal has no entity fields; optional hint allowed ---
{
  const body = buildHomeBrainFactRequestBody("내 보험은?", []);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "view_mode"), false);
  const hinted = buildHomeBrainFactRequestBody("우리 회사", [], {
    viewMode: "corporate",
    entityId: ENTITY_A,
    entityType: "corporate",
  });
  assert.equal(hinted.view_mode, "corporate");
  assert.equal(hinted.entity_id, ENTITY_A);
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
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // Prompt cache splits B (evidence) + C (question/context) into multiple text blocks.
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// --- arbitrary client entity_id → does not widen; membership list drives contexts ---
{
  clearReadyCardCache();
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
    customerId: "cust-corp-deny-1",
    authUserId: "user-1",
    userSupabase: { __test: true },
    // Client may send a foreign entity_id; Hand must not widen (membership list / mock).
    entityContext: {
      entity_type: "corporate",
      entity_id: ENTITY_FOREIGN,
    },
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const text = extractUserText(opts);
      if (/available_verified_evidence/.test(text) && /삼성생명/.test(text)) sawPersonal = true;
      if (text.includes(ENTITY_FOREIGN)) sawForeign = true;
      if (/available_verified_evidence/.test(text) && /제조/.test(text) && text.includes(ENTITY_A)) {
        sawAllowed = true;
      }
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
    loadAllowedCorporateContextsForClaudeImpl: async ({ selectedEntityId } = {}) => {
      // Unauthorized selection → fail-closed (no widen to foreign entity materials).
      if (selectedEntityId && selectedEntityId !== ENTITY_A) {
        return {
          ok: true,
          corporate_contexts: [],
          authorization_denied: true,
          skipped_reason: "selected_entity_not_authorized",
        };
      }
      return {
        ok: true,
        corporate_contexts: [packA],
        selected_entity_id: ENTITY_A,
      };
    },
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawPersonal, true);
  // Foreign client entity_id must not inject foreign facts; membership mock returns A only when authorized.
  assert.equal(sawForeign, false);
  // With unauthorized selection, corporate pack is empty (fail-closed) — personal still answers.
  assert.equal(sawAllowed, false);
  assert.equal(result.key_monopoly_failure, false);
  assert.ok(String(result.customerText ?? "").length > 0);
}

// --- authorized selected entity → corporate chart reaches Claude ---
{
  clearReadyCardCache();
  let claudeCalls = 0;
  let sawAllowed = false;
  const packA = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(ENTITY_A, "A법인"),
    membership: makeMembership(ENTITY_A),
    snapshot: makeSnapshot("제조"),
    memorySnapshot: makeMemorySnapshot(ENTITY_A, "제조"),
  });
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "우리 회사 보험 상태 알려줘",
    history: [],
    loadedContext: {
      policies: [{ insurer_name: "삼성생명" }],
      policy_count: 1,
    },
    customerId: "cust-corp-allow-1",
    authUserId: "user-1",
    userSupabase: { __test: true },
    entityContext: {
      conversationContext: { entity_type: "corporate", entity_id: ENTITY_A },
    },
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const text = extractUserText(opts);
      if (/제조/.test(text) && text.includes(ENTITY_A) && /corporate_turn/.test(text)) {
        sawAllowed = true;
      }
      return {
        ok: true,
        async json() {
          return {
            content: [{ type: "text", text: "법인 차트 기준으로 확인했습니다." }],
          };
        },
      };
    },
    loadAllowedCorporateContextsForClaudeImpl: async ({ selectedEntityId } = {}) => {
      assert.equal(selectedEntityId, ENTITY_A);
      return {
        ok: true,
        corporate_contexts: [packA],
        selected_entity_id: ENTITY_A,
      };
    },
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawAllowed, true);
  assert.equal(result.key_monopoly_failure, false);
}

// --- membership none → personal chart path regression ---
{
  clearReadyCardCache();
  let claudeCalls = 0;
  let sawPersonal = false;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험 몇 건이야?",
    history: [],
    loadedContext: {
      policies: [{ insurer_name: "한화생명" }],
      policy_count: 2,
    },
    customerId: "cust-corp-personal-1",
    authUserId: "user-1",
    userSupabase: { __test: true },
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const text = extractUserText(opts);
      if (/available_verified_evidence/.test(text) && /한화생명/.test(text)) sawPersonal = true;
      assert.match(text, /available_verified_evidence/);
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

// --- unified view: one HomeChat surface; hint-only entity; no session-persisted auto entity ---
{
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /fetchMyCorporateEntities/);
  assert.match(homeChat, /viewMode/);
  assert.match(homeChat, /selectedEntityId/);
  assert.equal(/CorporatePanel|법인 대시보드/.test(homeChat), false);
  const sessionCore = readFileSync(join(ROOT, "src/lib/lifeguardChatSessionCore.js"), "utf8");
  assert.equal(/active_entity_type|active_entity_id|activeEntity/.test(sessionCore), false);
  const firstDirect = readFileSync(join(ROOT, "server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  // corporate_turn / corporateTurnContext are Chart Hand Slice 1 (selected entity honesty).
  // Forbidden: old XOR speech / nulling personal chart for corporate mode.
  assert.equal(/Use only verified_corporate_facts|verified_customer_chart:\s*null/.test(firstDirect), false);
  assert.match(firstDirect, /available_verified_evidence/);
  assert.match(firstDirect, /loadAllowedCorporateContextsForClaude/);
  assert.match(firstDirect, /corporate_turn/);
  assert.match(firstDirect, /resolveCustomerViewMode/);
  assert.match(firstDirect, /applyCustomerViewModeToUserPayload/);
}

console.log("key-claude-corporate-context-unit-test: PASS");
