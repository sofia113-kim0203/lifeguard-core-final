/**
 * Admin agent-assignment engine unit gates (no Preview DB, no network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdminAuth } from "../server/agent/requireAdminAuth.js";
import {
  ADMIN_ASSIGNMENT_ACTIONS,
  activateAgentAssignment,
  assertAdminAssignmentBodyKeys,
  closeAgentAssignment,
  createPendingAgentAssignment,
  runAdminAgentAssignmentAction,
} from "../server/agent/adminAgentAssignmentCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_B = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT = "55555555-5555-4555-8555-555555555555";
const CONSENT = "66666666-6666-4666-8666-666666666666";
const BINDING = "77777777-7777-4777-8777-777777777777";

function mockUserSupabase({ userId, role }) {
  return {
    auth: {
      async getUser() {
        if (!userId) return { data: { user: null }, error: { message: "no user" } };
        return { data: { user: { id: userId } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, "users");
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: role ? { role } : null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

/**
 * Minimal thenable query builder for admin core paths.
 */
function buildAdminMock(state) {
  const api = {
    from(table) {
      return makeTable(table, state);
    },
  };
  return api;
}

function makeTable(table, state) {
  const ctx = { table, filters: {}, op: "select", payload: null, neq: null };

  const builder = {
    select() {
      // insert/update().select().maybeSingle() must keep write op
      if (ctx.op !== "insert" && ctx.op !== "update") {
        ctx.op = "select";
      }
      return builder;
    },
    insert(row) {
      ctx.op = "insert";
      ctx.payload = row;
      return builder;
    },
    update(row) {
      ctx.op = "update";
      ctx.payload = row;
      return builder;
    },
    eq(col, val) {
      ctx.filters[col] = val;
      return builder;
    },
    neq(col, val) {
      ctx.neq = { col, val };
      return builder;
    },
    is(col, val) {
      ctx.filters[`is:${col}`] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(resolveMaybe(table, state, ctx));
    },
    then(resolve, reject) {
      return Promise.resolve(resolveList(table, state, ctx)).then(resolve, reject);
    },
  };
  return builder;
}

function resolveMaybe(table, state, ctx) {
  if (table === "customer_profiles" && ctx.op === "select") {
    const id = ctx.filters.id;
    if (state.customers?.[id]) return { data: { id }, error: null };
    return { data: null, error: null };
  }
  if (table === "users" && ctx.op === "select") {
    const id = ctx.filters.id;
    const row = state.users?.[id];
    return { data: row ?? null, error: null };
  }
  if (table === "agent_assignments" && ctx.op === "select") {
    const id = ctx.filters.id;
    const row = state.assignments?.[id] ?? null;
    return { data: row ? { ...row } : null, error: null };
  }
  if (table === "agent_assignments" && ctx.op === "insert") {
    const id = state.nextAssignmentId ?? ASSIGNMENT;
    const row = {
      id,
      customer_id: ctx.payload.customer_id,
      agent_user_id: ctx.payload.agent_user_id,
      status: ctx.payload.status,
      notes: ctx.payload.notes ?? null,
      assigned_at: null,
      created_at: "2026-07-25T00:00:00.000Z",
      deleted_at: null,
    };
    state.assignments = state.assignments ?? {};
    state.assignments[id] = row;
    state.inserts = state.inserts ?? [];
    state.inserts.push({ table, row: ctx.payload });
    return { data: { ...row }, error: null };
  }
  if (table === "agent_assignments" && ctx.op === "update") {
    const id = ctx.filters.id;
    const row = state.assignments?.[id];
    if (!row) return { data: null, error: null };
    if (ctx.filters.status && row.status !== ctx.filters.status) {
      return { data: null, error: null };
    }
    if (ctx.filters["is:deleted_at"] === null && row.deleted_at != null) {
      return { data: null, error: null };
    }
    Object.assign(row, ctx.payload);
    state.updates = state.updates ?? [];
    state.updates.push({ table, id, payload: ctx.payload });
    return { data: { ...row }, error: null };
  }
  if (table === "agent_assignment_consents" && ctx.op === "insert") {
    const id = state.nextBindingId ?? BINDING;
    const row = {
      id,
      assignment_id: ctx.payload.assignment_id,
      customer_consent_id: ctx.payload.customer_consent_id,
      revoked_at: null,
    };
    state.bindings = state.bindings ?? [];
    state.bindings.push(row);
    state.inserts = state.inserts ?? [];
    state.inserts.push({ table, row: ctx.payload });
    return { data: { id }, error: null };
  }
  return { data: null, error: null };
}

function resolveList(table, state, ctx) {
  if (table === "customer_consents" && ctx.op === "select") {
    const customerId = ctx.filters.customer_id;
    const rows = (state.consents ?? []).filter(
      (c) =>
        c.customer_id === customerId &&
        c.consent_type === "agent_sharing" &&
        c.granted === true &&
        c.revoked_at == null,
    );
    return { data: rows.map((r) => ({ id: r.id })), error: null };
  }
  if (table === "agent_assignment_consents" && ctx.op === "select") {
    const assignmentId = ctx.filters.assignment_id;
    const rows = (state.bindings ?? []).filter(
      (b) => b.assignment_id === assignmentId && b.revoked_at == null,
    );
    return { data: rows.map((r) => ({ id: r.id })), error: null };
  }
  if (table === "agent_assignment_consents" && ctx.op === "update") {
    const assignmentId = ctx.filters.assignment_id;
    const now = ctx.payload.revoked_at;
    let count = 0;
    for (const b of state.bindings ?? []) {
      if (b.assignment_id === assignmentId && b.revoked_at == null) {
        b.revoked_at = now;
        count += 1;
      }
    }
    state.updates = state.updates ?? [];
    state.updates.push({ table, assignmentId, payload: ctx.payload });
    return {
      data: Array.from({ length: count }, (_, i) => ({ id: `rev-${i}` })),
      error: null,
    };
  }
  if (table === "agent_assignments" && ctx.op === "select") {
    // other active lookup
    const customerId = ctx.filters.customer_id;
    const status = ctx.filters.status;
    let rows = Object.values(state.assignments ?? {}).filter(
      (a) => a.customer_id === customerId && a.status === status && a.deleted_at == null,
    );
    if (ctx.neq?.col === "id") {
      rows = rows.filter((a) => a.id !== ctx.neq.val);
    }
    return { data: rows.map((r) => ({ id: r.id })), error: null };
  }
  return { data: [], error: null };
}

async function testAuthGates() {
  const noUser = await requireAdminAuth(mockUserSupabase({ userId: null }));
  assert.equal(noUser.ok, false);
  assert.equal(noUser.reason, "UNAUTHORIZED");

  const customer = await requireAdminAuth(
    mockUserSupabase({ userId: CUSTOMER, role: "customer" }),
  );
  assert.equal(customer.ok, false);
  assert.equal(customer.reason, "FORBIDDEN_ROLE");

  const agent = await requireAdminAuth(mockUserSupabase({ userId: AGENT, role: "agent" }));
  assert.equal(agent.ok, false);
  assert.equal(agent.reason, "FORBIDDEN_ROLE");

  const admin = await requireAdminAuth(mockUserSupabase({ userId: ADMIN, role: "admin" }));
  assert.equal(admin.ok, true);
  assert.equal(admin.adminUserId, ADMIN);
}

async function testCreatePending() {
  const state = {
    customers: { [CUSTOMER]: true },
    users: { [AGENT]: { id: AGENT, role: "agent" } },
    assignments: {},
  };
  const admin = buildAdminMock(state);
  const ok = await createPendingAgentAssignment({
    adminSupabase: admin,
    customerId: CUSTOMER,
    agentUserId: AGENT,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.assignment.status, "pending");
  assert.equal(ok.assignment.customer_id, CUSTOMER);
  assert.equal(ok.assignment.agent_user_id, AGENT);

  const missingCustomer = await createPendingAgentAssignment({
    adminSupabase: buildAdminMock({
      customers: {},
      users: { [AGENT]: { id: AGENT, role: "agent" } },
    }),
    customerId: CUSTOMER,
    agentUserId: AGENT,
  });
  assert.equal(missingCustomer.ok, false);
  assert.equal(missingCustomer.reason, "CUSTOMER_NOT_FOUND");

  const notAgent = await createPendingAgentAssignment({
    adminSupabase: buildAdminMock({
      customers: { [CUSTOMER]: true },
      users: { [AGENT]: { id: AGENT, role: "customer" } },
    }),
    customerId: CUSTOMER,
    agentUserId: AGENT,
  });
  assert.equal(notAgent.ok, false);
  assert.equal(notAgent.reason, "NOT_AGENT_ROLE");

  const badId = await createPendingAgentAssignment({
    adminSupabase: admin,
    customerId: "not-a-uuid",
    agentUserId: AGENT,
  });
  assert.equal(badId.ok, false);
  assert.equal(badId.reason, "INVALID_ID");
}

async function testActivateWithBinding() {
  const state = {
    assignments: {
      [ASSIGNMENT]: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT,
        status: "pending",
        assigned_at: null,
        created_at: "2026-07-25T00:00:00.000Z",
        deleted_at: null,
      },
    },
    consents: [
      {
        id: CONSENT,
        customer_id: CUSTOMER,
        consent_type: "agent_sharing",
        granted: true,
        revoked_at: null,
      },
    ],
    bindings: [],
  };
  const first = await activateAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(first.ok, true);
  assert.equal(first.assignment.status, "active");
  assert.equal(first.binding_created, true);
  assert.equal(first.binding_id, BINDING);
  assert.equal(state.bindings.length, 1);

  const again = await activateAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(again.ok, true);
  assert.equal(again.binding_created, false);
  assert.equal(again.binding_id, BINDING);
  assert.equal(state.bindings.length, 1);
}

async function testActivateWithoutConsent() {
  const state = {
    assignments: {
      [ASSIGNMENT]: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT,
        status: "pending",
        assigned_at: null,
        created_at: "2026-07-25T00:00:00.000Z",
        deleted_at: null,
      },
    },
    consents: [],
    bindings: [],
  };
  const result = await activateAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignment.status, "active");
  assert.equal(result.binding_skipped_no_consent, true);
  assert.equal(result.binding_id, null);
  assert.equal(state.bindings.length, 0);
}

async function testDuplicateActive() {
  const other = "88888888-8888-4888-8888-888888888888";
  const state = {
    assignments: {
      [ASSIGNMENT]: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT,
        status: "pending",
        assigned_at: null,
        created_at: "2026-07-25T00:00:00.000Z",
        deleted_at: null,
      },
      [other]: {
        id: other,
        customer_id: CUSTOMER,
        agent_user_id: AGENT,
        status: "active",
        assigned_at: "2026-07-24T00:00:00.000Z",
        created_at: "2026-07-24T00:00:00.000Z",
        deleted_at: null,
      },
    },
    consents: [],
    bindings: [],
  };
  const result = await activateAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "DUPLICATE_ACTIVE");
}

async function testCloseRevokesBinding() {
  const state = {
    assignments: {
      [ASSIGNMENT]: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT,
        status: "active",
        assigned_at: "2026-07-25T00:00:00.000Z",
        created_at: "2026-07-25T00:00:00.000Z",
        deleted_at: null,
      },
    },
    bindings: [
      {
        id: BINDING,
        assignment_id: ASSIGNMENT,
        customer_consent_id: CONSENT,
        revoked_at: null,
      },
    ],
  };
  const result = await closeAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignment.status, "closed");
  assert.equal(result.binding_revoked_count, 1);
  assert.ok(state.bindings[0].revoked_at);

  const closedActivate = await activateAgentAssignment({
    adminSupabase: buildAdminMock(state),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(closedActivate.ok, false);
  assert.equal(closedActivate.reason, "INVALID_TRANSITION");
}

async function testRejectTransitionsAndFields() {
  const keys = assertAdminAssignmentBodyKeys(
    { action: "activate", assignment_id: ASSIGNMENT, extra: 1 },
    ADMIN_ASSIGNMENT_ACTIONS.ACTIVATE,
  );
  assert.equal(keys.ok, false);
  assert.equal(keys.reason, "UNEXPECTED_FIELD");

  const badAction = await runAdminAgentAssignmentAction({
    body: { action: "match" },
  });
  assert.equal(badAction.ok, false);
  assert.equal(badAction.reason, "INVALID_ACTION");

  const deleted = await activateAgentAssignment({
    adminSupabase: buildAdminMock({
      assignments: {
        [ASSIGNMENT]: {
          id: ASSIGNMENT,
          customer_id: CUSTOMER,
          agent_user_id: AGENT,
          status: "pending",
          assigned_at: null,
          created_at: "2026-07-25T00:00:00.000Z",
          deleted_at: "2026-07-25T01:00:00.000Z",
        },
      },
    }),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(deleted.ok, false);
  assert.equal(deleted.reason, "ASSIGNMENT_DELETED");

  const missing = await activateAgentAssignment({
    adminSupabase: buildAdminMock({ assignments: {} }),
    assignmentId: ASSIGNMENT,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "ASSIGNMENT_NOT_FOUND");

  // foreign customer id on create is just lookup — CUSTOMER_B missing
  const foreign = await createPendingAgentAssignment({
    adminSupabase: buildAdminMock({
      customers: { [CUSTOMER]: true },
      users: { [AGENT]: { id: AGENT, role: "agent" } },
    }),
    customerId: CUSTOMER_B,
    agentUserId: AGENT,
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "CUSTOMER_NOT_FOUND");
}

function testSourceContractsUnchanged() {
  const briefingApi = readFileSync(join(ROOT, "api/agent-key-briefing.js"), "utf8");
  const briefingCore = readFileSync(
    join(ROOT, "server/agent/agentKeyBriefingCore.js"),
    "utf8",
  );
  const desk = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  const authPanel = readFileSync(join(ROOT, "src/components/AuthPanel.jsx"), "utf8");
  assert.match(briefingApi, /requireAgentAuth/);
  assert.match(briefingCore, /lifeguard_agent_has_active_assignment_consent/);
  assert.match(desk, /설계사 데스크/);
  assert.match(authPanel, /consent_personal/);
  assert.doesNotMatch(
    readFileSync(join(ROOT, "api/admin-agent-assignment.js"), "utf8"),
    /AuthPanel|LifeguardHomeChat/,
  );
}

async function main() {
  await testAuthGates();
  await testCreatePending();
  await testActivateWithBinding();
  await testActivateWithoutConsent();
  await testDuplicateActive();
  await testCloseRevokesBinding();
  await testRejectTransitionsAndFields();
  testSourceContractsUnchanged();
  console.log("admin-agent-assignment-unit-test: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
