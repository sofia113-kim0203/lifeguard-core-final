/**
 * Admin KEY assignment Hand unit gates (no Preview DB, no live POST).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdminAuth } from "../server/agent/requireAdminAuth.js";
import {
  buildConfirmedAssignmentBody,
  pickLiveAssignment,
  rankPeopleAgainstUtterance,
  uniqueTopMatch,
  validateAdminAssignmentProposal,
} from "../server/keyCore/adminKeyAssignmentHand.js";
import {
  optionLabelsHideIds,
  pickRehydratableLiveAssignment,
} from "../src/lib/adminAgentAssignment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const AGENT_B = "22222222-2222-4222-8222-222222222233";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_B = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT = "55555555-5555-4555-8555-555555555555";

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

const customers = [
  {
    id: CUSTOMER,
    display_name: "QA 고객 B",
    email: "qa-customer-b@staging-qa.example.com",
  },
  {
    id: CUSTOMER_B,
    display_name: "다른 고객",
    email: "other@staging-qa.example.com",
  },
];
const agents = [
  {
    id: AGENT,
    display_name: "e2-3-qa-agent",
    email: "e2-3-qa-agent@staging-qa.example.com",
  },
  {
    id: AGENT_B,
    display_name: "qa-agent-a",
    email: "qa-agent-a@staging-qa.example.com",
  },
];

// Auth: admin only
{
  assert.equal((await requireAdminAuth(mockUserSupabase({ userId: null }))).ok, false);
  assert.equal(
    (await requireAdminAuth(mockUserSupabase({ userId: CUSTOMER, role: "customer" }))).ok,
    false,
  );
  assert.equal(
    (await requireAdminAuth(mockUserSupabase({ userId: AGENT, role: "agent" }))).ok,
    false,
  );
  assert.equal(
    (await requireAdminAuth(mockUserSupabase({ userId: ADMIN, role: "admin" }))).ok,
    true,
  );
}

// Deterministic match helpers (not keyword intent routers)
{
  const ranked = rankPeopleAgainstUtterance(
    customers,
    "qa-customer-b를 e2-3 설계사에게 배정해줘",
  );
  const top = uniqueTopMatch(ranked);
  assert.equal(top.ok, true);
  assert.equal(top.person.id, CUSTOMER);
  assert.ok(optionLabelsHideIds(customers));
  assert.ok(optionLabelsHideIds(agents));
}

// validate create_pending card — no auto execute
{
  const out = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER,
      agent_user_id: AGENT,
      notes: "memo",
    },
    customers,
    agents,
    assignments: [],
  });
  assert.equal(out.ok, true);
  assert.equal(out.card?.action, "create_pending");
  assert.equal(out.card?.customer_id, CUSTOMER);
  assert.ok(!String(out.text).includes(CUSTOMER));
  assert.ok(!String(out.card.customer_label).includes(CUSTOMER));
  const body = buildConfirmedAssignmentBody(out.card);
  assert.deepEqual(body, {
    action: "create_pending",
    customer_id: CUSTOMER,
    agent_user_id: AGENT,
    notes: "memo",
  });
}

// Ambiguous / missing ids → no card (no POST path)
{
  const missing = validateAdminAssignmentProposal({
    proposal: { action: "create_pending", customer_id: "nope", agent_user_id: AGENT },
    customers,
    agents,
    assignments: [],
  });
  assert.equal(missing.card, null);

  const clarify = validateAdminAssignmentProposal({
    proposal: { action: "clarify", clarify_question: "어느 고객일까요?" },
    customers,
    agents,
    assignments: [],
  });
  assert.equal(clarify.card, null);
  assert.match(clarify.text, /고객/);
}

// Live assignment pick + activate/close bodies from rehydrated id
{
  const assignments = [
    {
      id: ASSIGNMENT,
      status: "pending",
      customer: customers[0],
      agent: agents[0],
    },
  ];
  const picked = pickLiveAssignment(assignments, { customerId: CUSTOMER, status: "pending" });
  assert.equal(picked.ok, true);
  assert.equal(picked.assignment.id, ASSIGNMENT);

  const activate = validateAdminAssignmentProposal({
    proposal: { action: "activate", customer_id: CUSTOMER },
    customers,
    agents,
    assignments,
  });
  assert.equal(activate.card?.assignment_id, ASSIGNMENT);
  assert.deepEqual(buildConfirmedAssignmentBody(activate.card), {
    action: "activate",
    assignment_id: ASSIGNMENT,
  });

  const close = validateAdminAssignmentProposal({
    proposal: { action: "close", assignment_id: ASSIGNMENT },
    customers,
    agents,
    assignments: [{ ...assignments[0], status: "active" }],
  });
  assert.equal(close.card?.action, "close");
  assert.deepEqual(buildConfirmedAssignmentBody(close.card), {
    action: "close",
    assignment_id: ASSIGNMENT,
  });
}

// Rehydrate helper: single pending wins; multi without filter → null
{
  assert.equal(
    pickRehydratableLiveAssignment([
      {
        id: ASSIGNMENT,
        status: "pending",
        customer: { id: CUSTOMER },
        agent: { id: AGENT },
      },
    ])?.id,
    ASSIGNMENT,
  );
  assert.equal(
    pickRehydratableLiveAssignment([
      {
        id: ASSIGNMENT,
        status: "pending",
        customer: { id: CUSTOMER },
        agent: { id: AGENT },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        status: "active",
        customer: { id: CUSTOMER_B },
        agent: { id: AGENT_B },
      },
    ]),
    null,
  );
}

// Contract files: POST core untouched; keyword-first router not introduced
{
  const core = readFileSync(
    join(ROOT, "server/agent/adminAgentAssignmentCore.js"),
    "utf8",
  );
  assert.ok(core.includes("create_pending"));
  assert.ok(core.includes("binding_skipped_no_consent"));

  const postApi = readFileSync(join(ROOT, "api/admin-agent-assignment.js"), "utf8");
  assert.ok(postApi.includes("runAdminAgentAssignmentAction"));

  const hand = readFileSync(
    join(ROOT, "server/keyCore/adminKeyAssignmentHand.js"),
    "utf8",
  );
  assert.ok(hand.includes("propose_admin_assignment_hand"));
  assert.ok(!hand.includes('includes("배정해줘")'));
  assert.ok(!hand.includes('includes("활성화")'));
  assert.ok(hand.includes("validateAdminAssignmentProposal"));

  const menu = readFileSync(join(ROOT, "src/components/AdminMenuPanel.jsx"), "utf8");
  assert.ok(menu.includes("KEY 배정 상담"));
  assert.ok(menu.includes("AdminKeyAssignmentChatPanel"));
  assert.ok(menu.includes("AdminAgentAssignmentPanel"));

  const panel = readFileSync(
    join(ROOT, "src/components/AdminAgentAssignmentPanel.jsx"),
    "utf8",
  );
  assert.ok(panel.includes("loadAdminLiveAssignments"));
  assert.ok(panel.includes("pickRehydratableLiveAssignment"));

  const chatApi = readFileSync(
    join(ROOT, "api/admin-key-assignment-chat.js"),
    "utf8",
  );
  assert.ok(chatApi.includes("requireAdminAuth"));
  assert.ok(chatApi.includes("runAdminKeyAssignmentChatTurn"));

  const readApi = readFileSync(
    join(ROOT, "api/admin-agent-assignments.js"),
    "utf8",
  );
  assert.ok(readApi.includes("loadAdminLiveAgentAssignments"));
}

console.log("admin-key-assignment-hand-unit-test: PASS");
