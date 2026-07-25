/**
 * C2-C — AgentDesk UI unit gates (no Preview DB, no KEY network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ROLES,
  canAccessPath,
  getRedirectPathForRole,
} from "../src/lib/appRouting.js";
import {
  AGENT_BRIEFING_GENERIC_ERROR,
  assignmentStatusLabel,
  customerDisplayLabel,
  mapAgentBriefingErrorMessage,
  pickInitialAssignment,
} from "../src/lib/agentKeyBriefing.js";
import {
  AGENT_FREE_KEY_GENERIC_ERROR,
  buildAgentFreeKeyPostBody,
  canSubmitAgentFreeKey,
  mapAgentFreeKeyErrorMessage,
} from "../src/lib/agentFreeKey.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PENDING = {
  assignment_id: "asg-pending",
  status: "pending",
  briefing_eligible: false,
  customer: { customer_id: "c1", display_name: "대기고객" },
};
const ACTIVE_NO_CONSENT = {
  assignment_id: "asg-active-no",
  status: "active",
  briefing_eligible: false,
  customer: { customer_id: "c2", display_name: "동의없음" },
};
const ELIGIBLE = {
  assignment_id: "asg-eligible",
  status: "active",
  briefing_eligible: true,
  customer: { customer_id: "c3", display_name: "가능고객" },
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("agent-desk-panel-unit-test");

test("GET list status labels render contract", () => {
  assert.equal(assignmentStatusLabel(PENDING), "배정 승인 대기");
  assert.equal(assignmentStatusLabel(ACTIVE_NO_CONSENT), "고객 동의가 필요합니다");
  assert.equal(assignmentStatusLabel(ELIGIBLE), "KEY 상담 준비 가능");
  assert.equal(customerDisplayLabel(ELIGIBLE), "가능고객");
  assert.equal(
    customerDisplayLabel({ customer: { display_name: null } }),
    "이름 없는 고객",
  );
});

test("pickInitialAssignment prefers first eligible then first row", () => {
  assert.equal(
    pickInitialAssignment([PENDING, ACTIVE_NO_CONSENT, ELIGIBLE])?.assignment_id,
    "asg-eligible",
  );
  assert.equal(
    pickInitialAssignment([PENDING, ACTIVE_NO_CONSENT])?.assignment_id,
    "asg-pending",
  );
  assert.equal(pickInitialAssignment([]), null);
});

test("free KEY composer enabled by question only (scope does not gate submit)", () => {
  assert.equal(
    canSubmitAgentFreeKey({ question: "실손 청구 기간이 어떻게 되나요?", submitting: false }),
    true,
  );
  assert.equal(canSubmitAgentFreeKey({ question: "  ", submitting: false }), false);
  assert.equal(
    canSubmitAgentFreeKey({ question: "질문", submitting: true }),
    false,
  );
});

test("POST body is agent-owned; never sends customer_id / agent_user_id", () => {
  const general = buildAgentFreeKeyPostBody({
    question: "실손 청구 기간이 어떻게 되나요?",
    history: [{ role: "user", content: "이전 질문" }],
    assignmentId: null,
  });
  assert.deepEqual(Object.keys(general).sort(), ["history", "question"]);
  assert.equal(Object.prototype.hasOwnProperty.call(general, "assignment_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(general, "customer_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(general, "agent_user_id"), false);

  const scoped = buildAgentFreeKeyPostBody({
    question: "이 고객 보장 공백 알려줘",
    history: [],
    assignmentId: "asg-eligible",
  });
  assert.deepEqual(Object.keys(scoped).sort(), ["assignment_id", "history", "question"]);
  assert.equal(scoped.assignment_id, "asg-eligible");
  assert.equal(Object.prototype.hasOwnProperty.call(scoped, "customer_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scoped, "agent_user_id"), false);
});

test("submitting blocks duplicate POST", () => {
  assert.equal(
    canSubmitAgentFreeKey({ question: "질문", submitting: true }),
    false,
  );
});

test("success KEY text is displayed as message as-is", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.match(panel, /LifeguardAssistantMarkdown/);
  assert.match(panel, /result\.text/);
  assert.match(panel, /postAgentFreeKeyChat/);
  assert.doesNotMatch(panel, /briefing_text\s*\+/);
  assert.doesNotMatch(panel, /summarize|rewrite|재작성|요약\(/);
  assert.match(panel, /설계사 데스크/);
  assert.match(panel, /KEY에게 무엇을 물어볼까요/);
  assert.match(panel, /일반 질문/);
  assert.match(panel, /FINAL_UI/);
  assert.doesNotMatch(panel, /gridTemplateColumns:\s*"minmax\(240px/);
});

test("error codes map to customer-facing copy", () => {
  assert.equal(
    mapAgentFreeKeyErrorMessage("FORBIDDEN_ROLE"),
    "설계사 계정만 이용할 수 있습니다.",
  );
  assert.equal(
    mapAgentFreeKeyErrorMessage("INVALID_QUESTION"),
    "질문을 확인해 주세요.",
  );
  assert.equal(
    mapAgentFreeKeyErrorMessage("CLIENT_IDENTITY_FORBIDDEN"),
    "요청 형식이 올바르지 않습니다.",
  );
  assert.equal(mapAgentFreeKeyErrorMessage("KEY_TURN_FAILED"), AGENT_FREE_KEY_GENERIC_ERROR);
  assert.equal(mapAgentFreeKeyErrorMessage(null), AGENT_FREE_KEY_GENERIC_ERROR);
  // Briefing helper messages remain for list/gate UX labels (not free-KEY POST errors).
  assert.equal(
    mapAgentBriefingErrorMessage("NOT_ASSIGNED"),
    "현재 설계사에게 배정된 고객이 아닙니다.",
  );
  assert.equal(
    mapAgentBriefingErrorMessage("CONSENT_BINDING_REQUIRED"),
    "고객의 정보 공유 동의가 필요합니다.",
  );
  assert.equal(mapAgentBriefingErrorMessage("KEY_TURN_FAILED"), AGENT_BRIEFING_GENERIC_ERROR);
});

test("customer/admin route blocked; agent allowed", () => {
  assert.equal(canAccessPath("/agent", APP_ROLES.AGENT), true);
  assert.equal(canAccessPath("/agent", APP_ROLES.CUSTOMER), false);
  assert.equal(canAccessPath("/agent", APP_ROLES.ADMIN), false);
  assert.equal(getRedirectPathForRole("/agent", APP_ROLES.AGENT), "/agent");
  assert.equal(getRedirectPathForRole("/agent", APP_ROLES.CUSTOMER), "/");
  assert.equal(getRedirectPathForRole("/agent", APP_ROLES.ADMIN), "/");
  assert.equal(getRedirectPathForRole("/", APP_ROLES.AGENT), "/");
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.doesNotMatch(panel, /import RoleAccessPanel/);
  assert.doesNotMatch(panel, /<RoleAccessPanel[\s>]/);
  assert.doesNotMatch(panel, /useCustomerContext/);
  assert.match(panel, /return <AgentDeskConsultRoom/);
  assert.match(panel, /설계사 데스크/);
  assert.match(panel, /KEY에게 무엇을 물어볼까요/);
  assert.doesNotMatch(panel, /KEY 협진실/);
  assert.doesNotMatch(panel, /KEY에게 브리핑 요청/);
  assert.doesNotMatch(panel, /KEY에게 상담 준비 요청/);
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  assert.match(app, /case \"agent\":\s*return <AgentDeskPanel/);
  assert.match(app, /import RoleAccessPanel/);
  assert.match(app, /requiredRoles=\{\["admin"\]\}/);
  assert.match(app, /handleLoginSuccess/);
  assert.match(app, /getRedirectPathForRole\(requestedPath,\s*userRole\)/);
  assert.match(app, /canAccessPath\(requestedPath,\s*userRole\)/);
  assert.doesNotMatch(
    app,
    /const handleLoginSuccess = \(\) => \{\s*setActiveMenu\("home"\);\s*navigateTo\(LIFEGUARD_PATH\);\s*\};/,
  );
  const shell = readFileSync(join(ROOT, "src/components/CustomerLifeguardShell.jsx"), "utf8");
  assert.match(shell, /isRegisteredNonCustomerPath/);
  assert.match(shell, /canAccessPath\(path,\s*APP_ROLES\.CUSTOMER\)/);
  assert.match(shell, /if \(isRegisteredNonCustomerPath\(path\)\) \{\s*return;/);
  const preserveIdx = shell.search(/isRegisteredNonCustomerPath\(path\)\) \{\s*return;/);
  const wipeIdx = shell.indexOf('replaceState({}, "", LIFEGUARD_PATH)');
  assert.ok(preserveIdx >= 0 && wipeIdx > preserveIdx, "preserve /agent before any LIFEGUARD wipe");

  // A — unsettled role must not run customer/backoffice redirects
  assert.doesNotMatch(
    app,
    /context\?\.userRole \?\? \(user \? APP_ROLES\.CUSTOMER : null\)/,
  );
  assert.match(app, /context\?\.userRole \?\? null/);
  assert.match(app, /if \(!user \|\| roleLoading \|\| !userRole\) return;/);
  assert.match(app, /user && \(roleLoading \|\| !userRole\)/);

  // B — user null→id gap must report awaitingRole (loading) before context resolves
  const ctxHook = readFileSync(join(ROOT, "src/hooks/useCustomerContext.js"), "utf8");
  assert.match(ctxHook, /resolvedUserId/);
  assert.match(ctxHook, /awaitingRole/);
  assert.match(ctxHook, /resolvedUserId !== userId/);
});

test("PanelKeyVoice and customer_conversations stay unused", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  const helper = readFileSync(join(ROOT, "src/lib/agentKeyBriefing.js"), "utf8");
  const freeHelper = readFileSync(join(ROOT, "src/lib/agentFreeKey.js"), "utf8");
  for (const src of [panel, helper, freeHelper]) {
    assert.equal(src.includes("PanelKeyVoice"), false);
    assert.equal(src.includes("customer_conversations"), false);
    assert.equal(src.includes("/api/customer-home-brain-fact"), false);
  }
  assert.equal(panel.includes("runOneKeyCoreTurn"), false);
  assert.ok(panel.includes("postAgentFreeKeyChat"));
  assert.ok(freeHelper.includes("/api/agent-key-chat"));
});

test("UUID fields are not rendered as visible labels", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  // Internal selection keys may use assignment_id; visible text must not.
  assert.doesNotMatch(panel, />\{[^}]*assignment_id[^}]*\}</);
  assert.doesNotMatch(panel, />\{[^}]*customer_id[^}]*\}</);
  assert.doesNotMatch(panel, /assignment_consent_id/);
  assert.doesNotMatch(panel, /key_trace_id/);
  assert.doesNotMatch(panel, /context_snapshot/);
  assert.match(panel, /customerDisplayLabel\(item\)/);
  assert.match(panel, /assignmentStatusLabel\(item\)/);
  assert.match(panel, /customerDisplayLabel\(selected\)/);
});

test("no foreign assignment input UI", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.doesNotMatch(panel, /assignment_id 입력/);
  assert.match(panel, /role=\"listbox\"/);
});

test("free KEY composer always available; general scope present", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.match(panel, /disabled=\{submitting\}/);
  assert.match(panel, /lg-v31-composer/);
  assert.match(panel, /KEY가 확인하고 있어요/);
  assert.match(panel, /일반 질문/);
  assert.match(panel, /postAgentFreeKeyChat/);
  assert.doesNotMatch(panel, /PanelKeyVoice/);
  assert.doesNotMatch(panel, /AiRecommendationPanel/);
});

console.log(`agent-desk-panel-unit-test: PASS (${passed})`);
