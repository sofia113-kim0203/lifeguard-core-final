/**
 * C2-B — Agent KEY briefing API unit gates (no Preview DB, no KEY network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAgentAuth } from "../server/agent/requireAgentAuth.js";
import {
  buildAgentBriefingKeyQuestion,
  createAgentKeyBriefing,
  validatePurposeQuestion,
} from "../server/agent/agentKeyBriefingCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const AGENT_A = "agent-aaa";
const AGENT_B = "agent-bbb";
const CUSTOMER = "cust-001";
const ASSIGNMENT = "asg-001";
const BINDING = "bind-001";

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
    async rpc(name, args) {
      return this._rpc?.(name, args) ?? { data: false, error: null };
    },
  };
}

function buildAdminMock({
  assignment,
  bindings = [],
  insertResult = { id: "brf-1", created_at: "2026-07-13T00:00:00.000Z" },
  insertError = null,
  onInsert = null,
  onConversationWrite = null,
} = {}) {
  return {
    from(table) {
      if (table === "customer_conversations") {
        onConversationWrite?.(table);
        throw new Error("customer_conversations must not be written");
      }
      if (table === "agent_assignments") {
        return {
          select() {
            return {
              eq(_col, id) {
                return {
                  async maybeSingle() {
                    if (assignment && assignment.id === id) {
                      return { data: assignment, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "agent_assignment_consents") {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      then(resolve) {
                        return Promise.resolve({ data: bindings, error: null }).then(resolve);
                      },
                      async thenable() {
                        return { data: bindings, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "agent_key_briefings") {
        return {
          insert(row) {
            onInsert?.(row);
            return {
              select() {
                return {
                  async maybeSingle() {
                    if (insertError) return { data: null, error: insertError };
                    return { data: insertResult, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

/** Awaitable thenable chain for .select().eq().is() */
function fixBindingsChain(admin, bindings) {
  admin.from = ((orig) => (table) => {
    if (table !== "agent_assignment_consents") return orig.call(admin, table);
    const result = Promise.resolve({ data: bindings, error: null });
    return {
      select() {
        return {
          eq() {
            return {
              is() {
                return result;
              },
            };
          },
        };
      },
    };
  })(admin.from.bind(admin));
  return admin;
}

{
  const deniedCustomer = await requireAgentAuth(
    mockUserSupabase({ userId: "u-cust", role: "customer" }),
  );
  assert.equal(deniedCustomer.ok, false);
  assert.equal(deniedCustomer.reason, "FORBIDDEN_ROLE");
}

{
  const deniedAdmin = await requireAgentAuth(
    mockUserSupabase({ userId: "u-admin", role: "admin" }),
  );
  assert.equal(deniedAdmin.ok, false);
  assert.equal(deniedAdmin.reason, "FORBIDDEN_ROLE");
}

{
  const okAgent = await requireAgentAuth(
    mockUserSupabase({ userId: AGENT_A, role: "agent" }),
  );
  assert.equal(okAgent.ok, true);
  assert.equal(okAgent.agentUserId, AGENT_A);
}

{
  const v = validatePurposeQuestion("상담 준비", "이 고객 보장 요약?");
  assert.equal(v.ok, true);
  const framed = buildAgentBriefingKeyQuestion(v.purpose, v.question);
  assert.match(framed, /설계사 내부 브리핑/);
  assert.match(framed, /상담 준비/);
  assert.match(framed, /이 고객 보장 요약/);
}

{
  let keyCalls = 0;
  const userSupabase = mockUserSupabase({ userId: AGENT_A, role: "agent" });
  userSupabase._rpc = async () => ({ data: true, error: null });
  const admin = fixBindingsChain(
    buildAdminMock({
      assignment: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT_B,
        status: "active",
        deleted_at: null,
      },
      bindings: [{ id: BINDING }],
    }),
    [{ id: BINDING }],
  );
  const result = await createAgentKeyBriefing({
    userSupabase,
    agentUserId: AGENT_A,
    assignmentId: ASSIGNMENT,
    purpose: "준비",
    question: "요약?",
    adminSupabase: admin,
    runKeyTurn: async () => {
      keyCalls += 1;
      return { ok: true, customerText: "should not run" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, "NOT_ASSIGNED");
  assert.equal(keyCalls, 0);
}

{
  let keyCalls = 0;
  const userSupabase = mockUserSupabase({ userId: AGENT_A, role: "agent" });
  userSupabase._rpc = async () => ({ data: true, error: null });
  const admin = fixBindingsChain(
    buildAdminMock({
      assignment: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT_A,
        status: "pending",
        deleted_at: null,
      },
      bindings: [{ id: BINDING }],
    }),
    [{ id: BINDING }],
  );
  const result = await createAgentKeyBriefing({
    userSupabase,
    agentUserId: AGENT_A,
    assignmentId: ASSIGNMENT,
    purpose: "준비",
    question: "요약?",
    adminSupabase: admin,
    runKeyTurn: async () => {
      keyCalls += 1;
      return { ok: true, customerText: "should not run" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, "ASSIGNMENT_NOT_ACTIVE");
  assert.equal(keyCalls, 0);
}

{
  let keyCalls = 0;
  const userSupabase = mockUserSupabase({ userId: AGENT_A, role: "agent" });
  userSupabase._rpc = async () => ({ data: false, error: null });
  const admin = fixBindingsChain(
    buildAdminMock({
      assignment: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT_A,
        status: "active",
        deleted_at: null,
      },
      bindings: [{ id: BINDING }],
    }),
    [{ id: BINDING }],
  );
  const result = await createAgentKeyBriefing({
    userSupabase,
    agentUserId: AGENT_A,
    assignmentId: ASSIGNMENT,
    purpose: "준비",
    question: "요약?",
    adminSupabase: admin,
    runKeyTurn: async () => {
      keyCalls += 1;
      return { ok: true, customerText: "should not run" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, "CONSENT_BINDING_REQUIRED");
  assert.equal(keyCalls, 0);
}

{
  let keyCalls = 0;
  let inserts = 0;
  let conversationWrites = 0;
  let capturedKeyArgs = null;
  let capturedInsert = null;
  const userSupabase = mockUserSupabase({ userId: AGENT_A, role: "agent" });
  userSupabase._rpc = async (name, args) => {
    assert.equal(name, "lifeguard_agent_has_active_assignment_consent");
    assert.equal(args.p_customer_id, CUSTOMER);
    assert.equal(Object.prototype.hasOwnProperty.call(args, "p_agent_user_id"), false);
    return { data: true, error: null };
  };
  const admin = fixBindingsChain(
    buildAdminMock({
      assignment: {
        id: ASSIGNMENT,
        customer_id: CUSTOMER,
        agent_user_id: AGENT_A,
        status: "active",
        deleted_at: null,
      },
      bindings: [{ id: BINDING }],
      onInsert: (row) => {
        inserts += 1;
        capturedInsert = row;
      },
      onConversationWrite: () => {
        conversationWrites += 1;
      },
    }),
    [{ id: BINDING }],
  );

  const result = await createAgentKeyBriefing({
    userSupabase,
    agentUserId: AGENT_A,
    assignmentId: ASSIGNMENT,
    purpose: "상담 준비",
    question: "원질문입니다",
    adminSupabase: admin,
    runKeyTurn: async (args) => {
      keyCalls += 1;
      capturedKeyArgs = args;
      return {
        ok: true,
        customerText: "밀봉된 KEY 브리핑 본문",
        contextSnapshot: { context_snapshot_id: "snap-1" },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(keyCalls, 1);
  assert.equal(inserts, 1);
  assert.equal(conversationWrites, 0);
  assert.equal(capturedKeyArgs.event, "question");
  assert.equal(capturedKeyArgs.customerId, CUSTOMER);
  assert.equal(capturedKeyArgs.userSupabase, admin);
  assert.deepEqual(capturedKeyArgs.history, []);
  assert.equal(capturedKeyArgs.sessionId, null);
  assert.equal(capturedKeyArgs.authUserId, null);
  assert.equal(capturedKeyArgs.attachedDocumentId, null);
  assert.equal(capturedKeyArgs.priorAttachFollowUp, false);
  assert.equal(capturedKeyArgs.presenceTurn, false);
  assert.match(capturedKeyArgs.question, /설계사 내부 브리핑/);
  assert.match(capturedKeyArgs.question, /상담 준비/);
  assert.match(capturedKeyArgs.question, /원질문입니다/);
  assert.equal(capturedInsert.assignment_id, ASSIGNMENT);
  assert.equal(capturedInsert.assignment_consent_id, BINDING);
  assert.equal(capturedInsert.agent_user_id, AGENT_A);
  assert.equal(capturedInsert.customer_id, CUSTOMER);
  assert.equal(capturedInsert.purpose, "상담 준비");
  assert.equal(capturedInsert.question, "원질문입니다");
  assert.equal(capturedInsert.briefing_text, "밀봉된 KEY 브리핑 본문");
  assert.equal(capturedInsert.key_event, "question");
  assert.equal(capturedInsert.key_trace_id, "snap-1");
  assert.equal(result.briefing.briefing_text, "밀봉된 KEY 브리핑 본문");
}

{
  const core = readFileSync(join(ROOT, "server/agent/agentKeyBriefingCore.js"), "utf8");
  const api = readFileSync(join(ROOT, "api/agent-key-briefing.js"), "utf8");
  const auth = readFileSync(join(ROOT, "server/agent/requireAgentAuth.js"), "utf8");
  assert.doesNotMatch(core, /finalizeKeyCustomerText/);
  assert.doesNotMatch(api, /finalizeKeyCustomerText/);
  assert.doesNotMatch(core, /customer_conversations/);
  assert.doesNotMatch(api, /customer_conversations/);
  assert.match(auth, /resolveAppUserRole/);
  assert.match(auth, /APP_ROLES\.AGENT|role !== APP_ROLES\.AGENT/);
  assert.match(core, /runOneKeyCoreTurn/);
  assert.match(core, /lifeguard_agent_has_active_assignment_consent/);
  assert.match(api, /CLIENT_IDENTITY_FORBIDDEN/);
  assert.match(api, /requireAgentAuth/);
}

console.log("agent-key-briefing-unit-test: PASS");
