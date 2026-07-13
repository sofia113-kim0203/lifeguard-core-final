/**
 * Slice 1 — corporate entity context → Claude-first fact pack (fake loaders only).
 */
import assert from "node:assert/strict";
import {
  buildClaudeCorporateFactPack,
  hasExplicitCorporateEntitySignal,
  resolveClaudeCorporateContext,
  CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
  CLAUDE_CORPORATE_FACT_PACK_V1,
} from "../server/keyCore/keyClaudeCorporateContext.js";
import {
  buildUserPayload,
  runClaudeFirstDirectQuestionTurn,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { parseEntityContextFromRequestBody } from "../server/entity/entityApiContextPassthrough.js";
import { CORPORATE_SNAPSHOT_V1 } from "../server/entity/corporate/corporateSnapshot.js";

assert.equal(typeof CORPORATE_AUTH_FAILED_CUSTOMER_TEXT, "string");

// --- explicit signal only (no keyword guess) ---
assert.equal(hasExplicitCorporateEntitySignal({}), false);
assert.equal(hasExplicitCorporateEntitySignal({ entity_type: "corporate" }), false);
assert.equal(
  hasExplicitCorporateEntitySignal({
    entity_type: "corporate",
    entity_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  }),
  true,
);
assert.equal(
  hasExplicitCorporateEntitySignal({
    entity_type: "individual",
    entity_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  }),
  false,
);
assert.equal(
  hasExplicitCorporateEntitySignal(
    parseEntityContextFromRequestBody({
      entity_type: "corporate",
      entity_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }),
  ),
  true,
);

const ENTITY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTITY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function makeEntityRecord(id = ENTITY_A) {
  return {
    entity_id: id,
    id,
    entity_type: "corporate",
    entity_status: "active",
    entity_scope: "owner",
    display_name: "테스트법인",
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

function makeMemorySnapshot(entityId = ENTITY_A) {
  return {
    entity_id: entityId,
    entity_type: "corporate",
    memory_version: 3,
    memory_namespace: "entity_memory_facts",
    fact_count: 3,
    facts: [
      {
        fact_key: "corporate.basic.industry",
        fact_value: "제조",
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

{
  const entityRecord = makeEntityRecord();
  const membership = makeMembership();
  const memorySnapshot = makeMemorySnapshot();
  const snapshot = {
    contract_version: CORPORATE_SNAPSHOT_V1,
    derived: {
      industry: "제조",
      group_insurance_status: "present",
      employee_count: null,
      executive_protection: null,
      fire_insurance: null,
      liability: null,
      unknowns: ["employee_count", "executive_protection", "fire_insurance", "liability"],
    },
  };
  const pack = buildClaudeCorporateFactPack({
    entityRecord,
    membership,
    snapshot,
    memorySnapshot,
  });
  assert.equal(pack.contract_version, CLAUDE_CORPORATE_FACT_PACK_V1);
  assert.equal(pack.entity_id, ENTITY_A);
  assert.equal(pack.authorization_verified, true);
  assert.equal(pack.membership_role, "owner");
  assert.ok(pack.verified_facts.some((f) => f.key === "corporate.basic.industry"));
  assert.ok(pack.partial_facts.some((f) => f.key === "corporate.note.soft"));
  assert.ok(pack.unknowns.includes("employee_count"));
  assert.equal(pack.provenance.memory_namespace, "entity_memory_facts");
  assert.equal(JSON.stringify(pack).includes(ENTITY_B), false);
}

// --- resolve: individual when no corporate signal ---
{
  const result = await resolveClaudeCorporateContext({
    requestBody: { question: "우리 회사 보험 어때?" },
    authUserId: "user-1",
    customerId: "cust-1",
    userSupabase: {},
  });
  assert.equal(result.mode, "individual");
  assert.equal(result.ok, true);
}

// --- resolve: missing entity → fail, no individual fallback ---
{
  const result = await resolveClaudeCorporateContext({
    requestBody: {
      entity_type: "corporate",
      entity_id: ENTITY_A,
    },
    authUserId: "user-1",
    customerId: "cust-1",
    userSupabase: {},
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: null,
      membership: null,
      load_error: "entity_record_not_found",
    }),
  });
  assert.equal(result.mode, "corporate");
  assert.equal(result.ok, false);
  assert.equal(result.failure_reason, "entity_record_not_found");
  assert.equal(result.customer_text, CORPORATE_AUTH_FAILED_CUSTOMER_TEXT);
  assert.equal(result.authorization.authorization_verified, false);
}

// --- resolve: no membership → fail ---
{
  let memoryLoads = 0;
  const result = await resolveClaudeCorporateContext({
    requestBody: { entity_type: "corporate", entity_id: ENTITY_A },
    authUserId: "user-1",
    customerId: "cust-1",
    userSupabase: {},
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: makeEntityRecord(),
      membership: null,
    }),
    loadCorporateMemorySnapshotImpl: async () => {
      memoryLoads += 1;
      return makeMemorySnapshot();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure_reason, "membership_required");
  assert.equal(memoryLoads, 0, "unauthorized must not load corporate memory");
}

// --- resolve: authorized → fact pack for ENTITY_A only ---
{
  let loadedEntityIds = [];
  const result = await resolveClaudeCorporateContext({
    requestBody: { entity_type: "corporate", entity_id: ENTITY_A },
    authUserId: "user-1",
    customerId: "cust-1",
    userSupabase: {},
    loadEntityContextRecordsImpl: async () => ({
      entityRecord: makeEntityRecord(ENTITY_A),
      membership: makeMembership(ENTITY_A),
    }),
    loadCorporateMemorySnapshotImpl: async (_sb, entityId) => {
      loadedEntityIds.push(entityId);
      return makeMemorySnapshot(entityId);
    },
    buildCorporateSnapshotImpl: ({ entityRecord, memorySnapshot }) => ({
      contract_version: CORPORATE_SNAPSHOT_V1,
      identity: { entity_id: entityRecord.id },
      derived: {
        industry: "제조",
        group_insurance_status: "present",
        employee_count: 12,
        executive_protection: null,
        fire_insurance: null,
        liability: null,
        unknowns: ["executive_protection", "fire_insurance", "liability"],
      },
      memory_summary: { fact_count: memorySnapshot.fact_count },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "corporate");
  assert.equal(result.factPack.entity_id, ENTITY_A);
  assert.equal(result.authorization.authorization_verified, true);
  assert.deepEqual(loadedEntityIds, [ENTITY_A]);
  assert.equal(JSON.stringify(result.factPack).includes(ENTITY_B), false);
}

// --- payload: personal unchanged chart path ---
{
  const personal = buildUserPayload({
    question: "내 보험 알려줘",
    chart: { policies: [{ insurer: "삼성생명" }], policy_count: 1 },
    allowlist: { allowed_numbers: [1], allowed_entities: ["삼성생명"] },
    contextPack: { recent_turns: [] },
  });
  assert.equal(personal.verified_customer_chart.policy_count, 1);
  assert.equal(personal.verified_corporate_facts, undefined);
}

// --- payload: corporate has pack, no personal chart ---
{
  const pack = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(),
    membership: makeMembership(),
    snapshot: {
      contract_version: CORPORATE_SNAPSHOT_V1,
      derived: {
        industry: "제조",
        group_insurance_status: "present",
        employee_count: 12,
        executive_protection: null,
        fire_insurance: null,
        liability: null,
        unknowns: ["executive_protection", "fire_insurance", "liability"],
      },
    },
    memorySnapshot: makeMemorySnapshot(),
  });
  const payload = buildUserPayload({
    question: "우리 법인 단체보험 현황은?",
    chart: { policies: [{ insurer: "개인보험사" }], policy_count: 34 },
    allowlist: { allowed_numbers: [34], allowed_entities: ["개인보험사"] },
    contextPack: { recent_turns: [] },
    corporateFactPack: pack,
  });
  assert.equal(payload.verified_customer_chart, null);
  assert.equal(payload.verified_corporate_facts.entity_id, ENTITY_A);
  assert.ok(Array.isArray(payload.verified_corporate_facts.verified_facts));
  assert.ok(Array.isArray(payload.verified_corporate_facts.partial_facts));
  assert.ok(Array.isArray(payload.verified_corporate_facts.unknowns));
  assert.ok(payload.verified_corporate_facts.provenance);
  assert.equal(JSON.stringify(payload).includes("개인보험사"), false);
  assert.equal(JSON.stringify(payload).includes("\"policy_count\":34"), false);
}

const previewEnv = {
  VERCEL_ENV: "preview",
  KEY_BORROWED_SENSES: "shadow",
  KEY_CLAUDE_FIRST_DIRECT: "1",
  ANTHROPIC_API_KEY: "test-key-corporate-slice1",
};

// --- unauthorized corporate → no Claude, failureMode+seal ---
{
  let claudeCalls = 0;
  let memoryLoads = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "우리 법인 단체보험 알려줘",
    history: [],
    loadedContext: {
      policies: [{ insurer: "삼성생명", product_name: "종신" }],
      policy_count: 1,
    },
    customerId: "cust-1",
    authUserId: "user-1",
    entityContext: parseEntityContextFromRequestBody({
      entity_type: "corporate",
      entity_id: ENTITY_A,
    }),
    env: previewEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run");
    },
    resolveClaudeCorporateContextImpl: async () => ({
      mode: "corporate",
      ok: false,
      failure_reason: "membership_required",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: "corporate",
        entity_id: ENTITY_A,
        authorization_verified: false,
        membership_role: null,
      },
    }),
  });
  assert.equal(claudeCalls, 0);
  assert.equal(memoryLoads, 0);
  assert.equal(result.key_monopoly_failure, true);
  assert.match(result.customerText, /권한이 확인되지 않았습니다/);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.corporate_auth_fail_closed,
    true,
  );
  assert.ok(
    (result.oneKeyCoreTrace?.legacy_paths_blocked ?? []).includes("runCorporateKeyLoopTurn"),
  );
  assert.ok(
    (result.oneKeyCoreTrace?.legacy_paths_blocked ?? []).includes(
      "verified_customer_chart_substitute",
    ),
  );
}

// --- authorized corporate → Claude 1회, personal chart not in body ---
{
  let claudeCalls = 0;
  let sawPersonalChart = false;
  let sawCorporateFacts = false;
  let sawPolicyDump = false;
  const pack = buildClaudeCorporateFactPack({
    entityRecord: makeEntityRecord(),
    membership: makeMembership(),
    snapshot: {
      contract_version: CORPORATE_SNAPSHOT_V1,
      derived: {
        industry: "제조",
        group_insurance_status: "present",
        employee_count: 12,
        executive_protection: null,
        fire_insurance: null,
        liability: null,
        unknowns: ["executive_protection", "fire_insurance", "liability"],
      },
    },
    memorySnapshot: makeMemorySnapshot(),
  });
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "법인 단체보험 현황을 설명해줘",
    history: [],
    loadedContext: {
      policies: [{ insurer: "삼성생명", monthly_premium: 50000 }],
      policy_count: 34,
    },
    customerId: "cust-1",
    authUserId: "user-1",
    entityContext: parseEntityContextFromRequestBody({
      entity_type: "corporate",
      entity_id: ENTITY_A,
    }),
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const body = JSON.parse(String(opts?.body ?? "{}"));
      const content = body?.messages?.[0]?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.find((b) => b?.type === "text")?.text ?? ""
            : "";
      if (/verified_customer_chart/.test(text) && /삼성생명/.test(text)) {
        sawPersonalChart = true;
      }
      if (/\"policy_count\":\s*34/.test(text) || /삼성생명/.test(text)) {
        sawPolicyDump = true;
      }
      if (/verified_corporate_facts/.test(text) && /제조/.test(text)) {
        sawCorporateFacts = true;
      }
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "text",
                text: "법인 검증 사실 기준으로 단체보험은 있음으로 확인됩니다.",
              },
            ],
          };
        },
      };
    },
    resolveClaudeCorporateContextImpl: async () => ({
      mode: "corporate",
      ok: true,
      factPack: pack,
      session: { entity_id: ENTITY_A, entity_type: "corporate" },
      authorization: {
        entity_type: "corporate",
        entity_id: ENTITY_A,
        authorization_verified: true,
        membership_role: "owner",
      },
    }),
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawCorporateFacts, true);
  assert.equal(sawPersonalChart, false);
  assert.equal(sawPolicyDump, false);
  assert.equal(result.key_monopoly_failure, false);
  assert.ok(String(result.customerText ?? "").includes("단체보험"));
}

// --- personal path regression: no entity → personal chart still used ---
{
  let claudeCalls = 0;
  let sawPersonal = false;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험 몇 건이야?",
    history: [],
    loadedContext: {
      policies: [{ insurer: "한화생명" }],
      policy_count: 2,
    },
    customerId: "cust-1",
    authUserId: "user-1",
    entityContext: parseEntityContextFromRequestBody({}),
    env: previewEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const body = JSON.parse(String(opts?.body ?? "{}"));
      const content = body?.messages?.[0]?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.find((b) => b?.type === "text")?.text ?? ""
            : "";
      if (/verified_customer_chart/.test(text)) sawPersonal = true;
      assert.equal(/verified_corporate_facts/.test(text), false);
      return {
        ok: true,
        async json() {
          return {
            content: [{ type: "text", text: "확인된 계약은 2건입니다." }],
          };
        },
      };
    },
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawPersonal, true);
  assert.equal(result.key_monopoly_failure, false);
}

console.log("key-claude-corporate-context-unit-test: PASS");
