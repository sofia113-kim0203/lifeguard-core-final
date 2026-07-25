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
  selectAdminAssignmentHandSurface,
  uniqueTopMatch,
  validateAdminAssignmentProposal,
} from "../server/keyCore/adminKeyAssignmentHand.js";
import {
  assertAdminAssignmentConfirmCardAligned,
  buildAlignedAssignmentBody,
  findUniqueExactDisplayNameOptionMatch,
  findUniqueExactEmailOptionMatch,
  findUniqueExactLocalPartOptionMatch,
  findUniqueUtteranceOptionIdentity,
  formatAssignmentOptionLabel,
  optionLabelsHideIds,
  pickRehydratableLiveAssignment,
  resolveAdminAssignmentOptionRow,
  utteranceHasExactLocalPartToken,
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

// validate create_pending card — no auto execute; body from same options rows
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
    utterance: "qa-customer-b@staging-qa.example.com 를 e2-3-qa-agent@staging-qa.example.com 에게",
  });
  assert.equal(out.ok, true);
  assert.equal(out.card?.action, "create_pending");
  assert.equal(out.card?.customer_id, CUSTOMER);
  assert.equal(out.card?.customer_label, formatAssignmentOptionLabel(customers[0]));
  assert.equal(out.card?.agent_label, formatAssignmentOptionLabel(agents[0]));
  assert.ok(!String(out.text).includes(CUSTOMER));
  assert.ok(!String(out.card.customer_label).includes(CUSTOMER));
  const catalogs = { customers, agents };
  const body = buildConfirmedAssignmentBody(out.card, catalogs);
  assert.deepEqual(body, {
    action: "create_pending",
    customer_id: CUSTOMER,
    agent_user_id: AGENT,
    notes: "memo",
  });
  assert.equal(
    assertAdminAssignmentConfirmCardAligned(out.card, customers, agents).ok,
    true,
  );
}

// Identity lock: email+id same options row; Claude ids never execution identity
{
  assert.equal(resolveAdminAssignmentOptionRow(customers, "nope"), null);
  assert.equal(
    findUniqueExactEmailOptionMatch(
      customers,
      "qa-customer-b@staging-qa.example.com 배정",
    ).person?.id,
    CUSTOMER,
  );

  const seatUtterance =
    "qa-customer-b@staging-qa.example.com 를 e2-3-qa-agent@staging-qa.example.com 에게 배정해줘";

  // A. Claude wrong customer_id → resolver still builds correct card
  const wrongCustomer = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER_B,
      agent_user_id: AGENT,
      notes: "QA Customer B → e2-3-qa-agent@staging-qa.example.com",
    },
    customers,
    agents,
    assignments: [],
    utterance: seatUtterance,
  });
  assert.equal(wrongCustomer.card?.customer_id, CUSTOMER);
  assert.equal(wrongCustomer.card?.agent_user_id, AGENT);
  assert.notEqual(wrongCustomer.card?.customer_id, CUSTOMER_B);
  assert.deepEqual(buildConfirmedAssignmentBody(wrongCustomer.card, { customers, agents }), {
    action: "create_pending",
    customer_id: CUSTOMER,
    agent_user_id: AGENT,
    notes: "QA Customer B → e2-3-qa-agent@staging-qa.example.com",
  });

  // Claude wrong agent_user_id → resolver agent row wins
  const wrongAgent = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER,
      agent_user_id: AGENT_B,
    },
    customers,
    agents,
    assignments: [],
    utterance: seatUtterance,
  });
  assert.equal(wrongAgent.card?.customer_id, CUSTOMER);
  assert.equal(wrongAgent.card?.agent_user_id, AGENT);
  assert.notEqual(wrongAgent.card?.agent_user_id, AGENT_B);

  // Tampered card label vs id → body null (POST 0)
  const good = validateAdminAssignmentProposal({
    proposal: { action: "create_pending", customer_id: CUSTOMER_B, agent_user_id: AGENT_B },
    customers,
    agents,
    assignments: [],
    utterance: seatUtterance,
  });
  assert.ok(good.card);
  const tampered = {
    ...good.card,
    customer_label: formatAssignmentOptionLabel(customers[1]),
  };
  assert.equal(assertAdminAssignmentConfirmCardAligned(tampered, customers, agents).ok, false);
  assert.equal(buildAlignedAssignmentBody(tampered, customers, agents), null);
  assert.equal(buildConfirmedAssignmentBody(tampered, { customers, agents }), null);

  // catalogs required — without options lock, no body
  assert.equal(buildConfirmedAssignmentBody(good.card), null);
  assert.equal(buildConfirmedAssignmentBody(good.card, null), null);
}

// A/B/C/D — resolver authority (email / local / display_name); no Claude id trust
{
  const clashCustomers = [
    {
      id: CUSTOMER,
      display_name: "QA 고객 B",
      email: "qa-customer-b@staging-qa.example.com",
    },
    {
      id: CUSTOMER_B,
      display_name: "QA Customer B",
      email: "e2-3-qa-customer-b@staging-qa.example.com",
    },
  ];
  const seatLocal = "qa-customer-b를 e2-3-qa-agent 설계사에게 배정해줘";
  const aliasAgentOnly = "qa-customer-b를 e2-3 설계사에게 배정해줘";

  assert.equal(utteranceHasExactLocalPartToken(seatLocal, "qa-customer-b"), true);
  assert.equal(
    utteranceHasExactLocalPartToken(seatLocal, "e2-3-qa-customer-b"),
    false,
  );
  assert.equal(
    findUniqueExactLocalPartOptionMatch(clashCustomers, seatLocal).person?.id,
    CUSTOMER,
  );
  assert.equal(
    findUniqueUtteranceOptionIdentity(clashCustomers, seatLocal).person?.id,
    CUSTOMER,
  );

  // A. Claude proposes wrong customer_id; utterance local unique → card = resolver rows
  const localClashWrong = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER_B,
      agent_user_id: AGENT_B,
      notes: "wrong ids ignored",
    },
    customers: clashCustomers,
    agents,
    assignments: [],
    utterance: seatLocal,
  });
  assert.equal(localClashWrong.card?.customer_id, CUSTOMER);
  assert.equal(localClashWrong.card?.agent_user_id, AGENT);
  assert.notEqual(localClashWrong.card?.customer_id, CUSTOMER_B);
  assert.notEqual(localClashWrong.card?.agent_user_id, AGENT_B);
  assert.ok(!String(localClashWrong.card.customer_label).includes("e2-3-qa-customer-b"));
  assert.ok(String(localClashWrong.card.customer_label).includes("qa-customer-b@"));
  assert.equal(localClashWrong.text, "아래 배정 내용을 확인해 주세요.");
  assert.deepEqual(
    buildConfirmedAssignmentBody(localClashWrong.card, {
      customers: clashCustomers,
      agents,
    }),
    {
      action: "create_pending",
      customer_id: CUSTOMER,
      agent_user_id: AGENT,
      notes: "wrong ids ignored",
    },
  );

  // B. Customer exact, agent unresolved (alias e2-3 — not this Slice) → no card, safe text
  const unresolvedAgent = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER_B,
      agent_user_id: AGENT,
    },
    customers: clashCustomers,
    agents,
    assignments: [],
    utterance: aliasAgentOnly,
  });
  assert.equal(unresolvedAgent.card, null);
  assert.equal(unresolvedAgent.reason, "AGENT_IDENTITY_UNRESOLVED");
  assert.match(unresolvedAgent.text, /설계사/);
  assert.ok(!unresolvedAgent.text.includes("e2-3-qa-customer-b"));
  assert.ok(!unresolvedAgent.text.includes("@staging-qa.example.com"));
  assert.equal(
    buildConfirmedAssignmentBody(unresolvedAgent.card, {
      customers: clashCustomers,
      agents,
    }),
    null,
  );

  // Surface prefers Hand text over Claude prose that names wrong options email
  const surface = selectAdminAssignmentHandSurface({
    validated: unresolvedAgent,
    prose:
      "QA Customer B (e2-3-qa-customer-b@staging-qa.example.com) 로 할까요?",
  });
  assert.equal(surface.card, null);
  assert.equal(surface.reason, "AGENT_IDENTITY_UNRESOLVED");
  assert.ok(!surface.text.includes("e2-3-qa-customer-b"));

  // C. Duplicate local-part → ambiguous, no card, POST 0
  const dupLocalCustomers = [
    {
      id: CUSTOMER,
      display_name: "B1",
      email: "qa-customer-b@staging-qa.example.com",
    },
    {
      id: CUSTOMER_B,
      display_name: "B2",
      email: "qa-customer-b@other-qa.example.com",
    },
  ];
  const dup = findUniqueExactLocalPartOptionMatch(dupLocalCustomers, "qa-customer-b 배정");
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "AMBIGUOUS_LOCAL");
  const dupCard = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER,
      agent_user_id: AGENT,
    },
    customers: dupLocalCustomers,
    agents,
    assignments: [],
    utterance: "qa-customer-b를 e2-3-qa-agent에게 배정해줘",
  });
  assert.equal(dupCard.card, null);
  assert.equal(dupCard.reason, "CUSTOMER_IDENTITY_AMBIGUOUS");
  assert.match(dupCard.text, /고객/);
  assert.ok(!dupCard.text.includes("@other-qa.example.com"));

  // D. Full email exact / local-part exact / display_name exact PASS
  const fullEmailOk = validateAdminAssignmentProposal({
    proposal: {
      action: "create_pending",
      customer_id: CUSTOMER_B,
      agent_user_id: AGENT_B,
    },
    customers: clashCustomers,
    agents,
    assignments: [],
    utterance:
      "qa-customer-b@staging-qa.example.com 를 e2-3-qa-agent@staging-qa.example.com 에게",
  });
  assert.equal(fullEmailOk.card?.customer_id, CUSTOMER);
  assert.equal(fullEmailOk.card?.agent_user_id, AGENT);
  assert.equal(
    findUniqueUtteranceOptionIdentity(clashCustomers, seatLocal).via,
    "local",
  );
  const byName = findUniqueExactDisplayNameOptionMatch(
    [{ id: AGENT, display_name: "e2-3-qa-agent", email: agents[0].email }],
    "e2-3-qa-agent 배정",
  );
  assert.equal(byName.person?.id, AGENT);
  const nameUtterance = "QA 고객 B를 e2-3-qa-agent에게 배정해줘";
  const nameCard = validateAdminAssignmentProposal({
    proposal: { action: "create_pending", customer_id: CUSTOMER_B, agent_user_id: AGENT_B },
    customers: clashCustomers,
    agents,
    assignments: [],
    utterance: nameUtterance,
  });
  assert.equal(nameCard.card?.customer_id, CUSTOMER);
  assert.equal(nameCard.card?.agent_user_id, AGENT);
  assert.equal(
    findUniqueUtteranceOptionIdentity(clashCustomers, nameUtterance).via,
    "display_name",
  );
}

// Missing utterance identity / clarify → no card (no POST path); no Claude email leak
{
  const missing = validateAdminAssignmentProposal({
    proposal: { action: "create_pending", customer_id: CUSTOMER, agent_user_id: AGENT },
    customers,
    agents,
    assignments: [],
    utterance: "",
  });
  assert.equal(missing.card, null);
  assert.equal(missing.reason, "CUSTOMER_IDENTITY_UNRESOLVED");

  const clarify = validateAdminAssignmentProposal({
    proposal: {
      action: "clarify",
      clarify_question:
        "e2-3-qa-customer-b@staging-qa.example.com 쪽일까요?",
    },
    customers,
    agents,
    assignments: [],
  });
  assert.equal(clarify.card, null);
  assert.equal(clarify.reason, "CLARIFY");
  assert.match(clarify.text, /고객/);
  assert.ok(!clarify.text.includes("e2-3-qa-customer-b"));
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
  assert.equal(activate.card?.customer_id, CUSTOMER);
  assert.equal(activate.card?.agent_user_id, AGENT);
  assert.deepEqual(buildConfirmedAssignmentBody(activate.card, { customers, agents }), {
    action: "activate",
    assignment_id: ASSIGNMENT,
  });

  const closePending = validateAdminAssignmentProposal({
    proposal: { action: "close", assignment_id: ASSIGNMENT },
    customers,
    agents,
    assignments,
  });
  assert.equal(closePending.card?.action, "close");
  assert.equal(closePending.card?.source_status, "pending");
  assert.equal(closePending.card?.primary_label, "배정 취소");
  assert.match(closePending.text, /취소/);
  assert.deepEqual(buildConfirmedAssignmentBody(closePending.card, { customers, agents }), {
    action: "close",
    assignment_id: ASSIGNMENT,
  });

  const close = validateAdminAssignmentProposal({
    proposal: { action: "close", assignment_id: ASSIGNMENT },
    customers,
    agents,
    assignments: [{ ...assignments[0], status: "active" }],
  });
  assert.equal(close.card?.action, "close");
  assert.equal(close.card?.source_status, "active");
  assert.equal(close.card?.primary_label, "배정 종료");
  assert.deepEqual(buildConfirmedAssignmentBody(close.card, { customers, agents }), {
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
  assert.ok(hand.includes("selectAdminAssignmentHandSurface"));
  assert.ok(hand.includes("resolveAdminAssignmentOptionRow"));
  assert.ok(hand.includes("findUniqueUtteranceOptionIdentity"));
  assert.ok(hand.includes("assertAdminAssignmentConfirmCardAligned"));
  assert.ok(hand.includes("CUSTOMER_IDENTITY_UNRESOLVED"));
  assert.ok(hand.includes("AGENT_IDENTITY_UNRESOLVED"));
  assert.ok(!hand.includes("CUSTOMER_IDENTITY_MISMATCH"));
  assert.ok(!hand.includes("prose || validated.text"));
  assert.ok(!hand.includes('includes("배정해줘")'));

  const menu = readFileSync(join(ROOT, "src/components/AdminMenuPanel.jsx"), "utf8");
  // Admin KEY chat UI hidden (product decision); Hand/API files preserved.
  assert.equal(menu.includes("KEY 배정 상담"), false);
  assert.equal(menu.includes("AdminKeyAssignmentChatPanel"), false);
  assert.ok(menu.includes("AdminAgentAssignmentPanel"));

  const panel = readFileSync(
    join(ROOT, "src/components/AdminAgentAssignmentPanel.jsx"),
    "utf8",
  );
  assert.ok(panel.includes("loadAdminLiveAssignments"));
  assert.ok(panel.includes("pickRehydratableLiveAssignment"));
  assert.ok(panel.includes("buildAlignedCreatePendingFromOptionIds"));

  const chatPanel = readFileSync(
    join(ROOT, "src/components/AdminKeyAssignmentChatPanel.jsx"),
    "utf8",
  );
  assert.ok(chatPanel.includes("buildAlignedAssignmentBody"));
  assert.ok(chatPanel.includes("loadAdminAssignmentOptions"));
  assert.ok(chatPanel.includes("일치하지 않아 등록하지 않았습니다"));

  const chatApi = readFileSync(
    join(ROOT, "api/admin-key-assignment-chat.js"),
    "utf8",
  );
  assert.ok(chatApi.includes("requireAdminAuth"));
  assert.ok(chatApi.includes("runAdminKeyAssignmentChatTurn"));
  assert.ok(chatApi.includes("Preserve Hand validation reason"));

  const readApi = readFileSync(
    join(ROOT, "api/admin-agent-assignments.js"),
    "utf8",
  );
  assert.ok(readApi.includes("loadAdminLiveAgentAssignments"));

  // POST API / Core / migration untouched by this Hand fix
  assert.ok(!hand.includes("runAdminAgentAssignmentAction"));
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/038_agent_assignments_one_active.sql"),
    "utf8",
  );
  assert.ok(migration.includes("agent_assignments"));
}

console.log("admin-key-assignment-hand-unit-test: PASS");
