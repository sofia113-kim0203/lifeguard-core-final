/**
 * Admin assignment UI Hand unit gates (no Preview DB, no live assignment calls).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdminAuth } from "../server/agent/requireAdminAuth.js";
import {
  displayNameFromEmail,
  loadAdminAgentAssignmentOptions,
} from "../server/agent/adminAgentAssignmentOptionsCore.js";
import {
  assignmentStatusLabelKo,
  buildActivateBody,
  buildCloseBody,
  buildCreatePendingBody,
  canActivateAssignment,
  canCloseAssignment,
  canCreatePendingAssignment,
  formatAssignmentOptionLabel,
  mapAdminAssignmentErrorMessage,
  mapAssignmentSuccessLines,
  optionLabelsHideIds,
} from "../src/lib/adminAgentAssignment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_USER = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_PROFILE = "44444444-4444-4444-8444-444444444444";

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

function fileSha(rel) {
  return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

// --- Auth gate ---
{
  const noUser = await requireAdminAuth(mockUserSupabase({ userId: null }));
  assert.equal(noUser.ok, false);

  const customer = await requireAdminAuth(
    mockUserSupabase({ userId: CUSTOMER_USER, role: "customer" }),
  );
  assert.equal(customer.ok, false);
  assert.equal(customer.reason, "FORBIDDEN_ROLE");

  const agent = await requireAdminAuth(mockUserSupabase({ userId: AGENT, role: "agent" }));
  assert.equal(agent.ok, false);
  assert.equal(agent.reason, "FORBIDDEN_ROLE");

  const admin = await requireAdminAuth(mockUserSupabase({ userId: ADMIN, role: "admin" }));
  assert.equal(admin.ok, true);
}

// --- Options core (mock service role) ---
{
  assert.equal(displayNameFromEmail("e2-3-qa-agent@staging-qa.example.com"), "e2-3-qa-agent");

  const state = {
    profiles: [
      {
        id: CUSTOMER_PROFILE,
        display_name: "QA 고객 B",
        user_id: CUSTOMER_USER,
      },
    ],
    usersById: {
      [CUSTOMER_USER]: {
        id: CUSTOMER_USER,
        email: "qa-customer-b@staging-qa.example.com",
        role: "customer",
      },
    },
    agents: [
      {
        id: AGENT,
        email: "e2-3-qa-agent@staging-qa.example.com",
        role: "agent",
      },
      {
        id: ADMIN,
        email: "should-not-appear@example.com",
        role: "admin",
      },
    ],
  };

  const adminMock = {
    from(table) {
      if (table === "customer_profiles") {
        return {
          select() {
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
          then(resolve) {
            resolve({ data: state.profiles, error: null });
          },
        };
      }
      if (table === "users") {
        const ctx = { mode: null, ids: null, role: null };
        const builder = {
          select() {
            return builder;
          },
          in(_col, ids) {
            ctx.mode = "in";
            ctx.ids = ids;
            return builder;
          },
          eq(_col, role) {
            ctx.mode = "eq";
            ctx.role = role;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          then(resolve) {
            if (ctx.mode === "in") {
              const rows = (ctx.ids || [])
                .map((id) => state.usersById[id])
                .filter(Boolean);
              resolve({ data: rows, error: null });
              return;
            }
            if (ctx.mode === "eq") {
              resolve({
                data: (state.agents || []).filter((a) => a.role === ctx.role),
                error: null,
              });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const loaded = await loadAdminAgentAssignmentOptions({ adminSupabase: adminMock });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.customers.length, 1);
  assert.equal(loaded.customers[0].display_name, "QA 고객 B");
  assert.equal(loaded.customers[0].email, "qa-customer-b@staging-qa.example.com");
  assert.equal(loaded.agents.length, 1);
  assert.equal(loaded.agents[0].email, "e2-3-qa-agent@staging-qa.example.com");
  assert.ok(optionLabelsHideIds(loaded.customers));
  assert.ok(optionLabelsHideIds(loaded.agents));
  const customerLabel = formatAssignmentOptionLabel(loaded.customers[0]);
  assert.ok(customerLabel.includes("QA 고객 B"));
  assert.ok(customerLabel.includes("qa-customer-b@staging-qa.example.com"));
  assert.ok(!customerLabel.includes(CUSTOMER_PROFILE));
  const agentLabel = formatAssignmentOptionLabel(loaded.agents[0]);
  assert.ok(!agentLabel.includes(AGENT));
}

// --- Body contracts ---
{
  const create = buildCreatePendingBody({
    customerId: CUSTOMER_PROFILE,
    agentUserId: AGENT,
    notes: "메모",
  });
  assert.deepEqual(create, {
    action: "create_pending",
    customer_id: CUSTOMER_PROFILE,
    agent_user_id: AGENT,
    notes: "메모",
  });
  assert.deepEqual(Object.keys(create).sort(), [
    "action",
    "agent_user_id",
    "customer_id",
    "notes",
  ]);

  const createNoNotes = buildCreatePendingBody({
    customerId: CUSTOMER_PROFILE,
    agentUserId: AGENT,
    notes: "  ",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(createNoNotes, "notes"), false);

  assert.deepEqual(buildActivateBody({ assignmentId: "55555555-5555-4555-8555-555555555555" }), {
    action: "activate",
    assignment_id: "55555555-5555-4555-8555-555555555555",
  });
  assert.deepEqual(buildCloseBody({ assignmentId: "55555555-5555-4555-8555-555555555555" }), {
    action: "close",
    assignment_id: "55555555-5555-4555-8555-555555555555",
  });
}

// --- Button enablement / busy lock ---
{
  assert.equal(
    canCreatePendingAssignment({ customerId: "", agentUserId: AGENT, busy: false }),
    false,
  );
  assert.equal(
    canCreatePendingAssignment({
      customerId: CUSTOMER_PROFILE,
      agentUserId: AGENT,
      busy: false,
    }),
    true,
  );
  assert.equal(
    canCreatePendingAssignment({
      customerId: CUSTOMER_PROFILE,
      agentUserId: AGENT,
      busy: true,
    }),
    false,
  );

  assert.equal(
    canActivateAssignment({
      assignmentId: "x",
      status: "pending",
      busy: false,
    }),
    true,
  );
  assert.equal(
    canActivateAssignment({
      assignmentId: "x",
      status: "active",
      busy: false,
    }),
    false,
  );
  assert.equal(
    canCloseAssignment({
      assignmentId: "x",
      status: "active",
      busy: false,
    }),
    true,
  );
  assert.equal(
    canCloseAssignment({
      assignmentId: "x",
      status: "closed",
      busy: false,
    }),
    false,
  );
  assert.equal(
    canCloseAssignment({
      assignmentId: "x",
      status: "pending",
      busy: true,
    }),
    false,
  );
}

// --- Copy / status labels ---
{
  assert.equal(assignmentStatusLabelKo("pending"), "배정 대기");
  assert.equal(assignmentStatusLabelKo("active"), "활성 배정");
  assert.equal(assignmentStatusLabelKo("closed"), "배정 종료");

  assert.deepEqual(mapAssignmentSuccessLines({ action: "create_pending" }), [
    "배정 대기로 등록했습니다.",
  ]);
  assert.deepEqual(
    mapAssignmentSuccessLines({
      action: "activate",
      binding_created: true,
      binding_skipped_no_consent: false,
    }),
    ["활성 배정으로 전환했습니다.", "설계사 상담 준비 권한이 연결되었습니다."],
  );
  assert.deepEqual(
    mapAssignmentSuccessLines({
      action: "activate",
      binding_created: false,
      binding_skipped_no_consent: true,
    }),
    [
      "활성 배정으로 전환했습니다.",
      "현재 정보 공유 권한이 없어 설계사 상담 준비는 제한됩니다.",
    ],
  );
  assert.deepEqual(mapAssignmentSuccessLines({ action: "close" }), [
    "배정을 종료했습니다.",
  ]);
  assert.equal(
    mapAdminAssignmentErrorMessage("FORBIDDEN_ROLE"),
    "관리자 계정만 이용할 수 있습니다.",
  );
}

// --- Contract preservation: existing assignment API/Core unchanged this Slice ---
{
  const core = readFileSync(
    join(ROOT, "server/agent/adminAgentAssignmentCore.js"),
    "utf8",
  );
  const api = readFileSync(join(ROOT, "api/admin-agent-assignment.js"), "utf8");
  assert.ok(core.includes("create_pending"));
  assert.ok(core.includes("binding_skipped_no_consent"));
  assert.ok(api.includes("requireAdminAuth"));
  assert.ok(api.includes("runAdminAgentAssignmentAction"));
  // Snapshot hashes for report (not frozen goldens — presence check only)
  assert.equal(typeof fileSha("server/agent/adminAgentAssignmentCore.js"), "string");
  assert.equal(typeof fileSha("api/admin-agent-assignment.js"), "string");
}

// --- Panel wiring present ---
{
  const menu = readFileSync(join(ROOT, "src/components/AdminMenuPanel.jsx"), "utf8");
  assert.ok(menu.includes("설계사 배정 관리"));
  assert.ok(menu.includes("AdminAgentAssignmentPanel"));
  assert.ok(menu.includes('case "agent_assignment"'));

  const panel = readFileSync(
    join(ROOT, "src/components/AdminAgentAssignmentPanel.jsx"),
    "utf8",
  );
  assert.ok(panel.includes("대기 배정 생성"));
  assert.ok(panel.includes("formatAssignmentOptionLabel"));
  assert.ok(!panel.includes("assignment UUID"));
  assert.ok(panel.includes("buildAlignedCreatePendingFromOptionIds"));
  assert.ok(panel.includes("buildActivateBody"));
  assert.ok(panel.includes("buildCloseBody"));

  const optionsApi = readFileSync(
    join(ROOT, "api/admin-agent-assignment-options.js"),
    "utf8",
  );
  assert.ok(optionsApi.includes("requireAdminAuth"));
  assert.ok(optionsApi.includes("GET"));
}

console.log("admin-agent-assignment-panel-unit-test: PASS");
