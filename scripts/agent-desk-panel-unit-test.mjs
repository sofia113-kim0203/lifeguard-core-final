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
} from "../src/lib/appRouting.js";
import {
  AGENT_BRIEFING_GENERIC_ERROR,
  assignmentStatusLabel,
  buildAgentBriefingPostBody,
  canSubmitAgentBriefing,
  customerDisplayLabel,
  mapAgentBriefingErrorMessage,
  pickInitialAssignment,
} from "../src/lib/agentKeyBriefing.js";

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
  assert.equal(assignmentStatusLabel(ELIGIBLE), "KEY 브리핑 가능");
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

test("pending button disabled", () => {
  assert.equal(
    canSubmitAgentBriefing({
      selected: PENDING,
      purpose: "목적",
      question: "질문",
      submitting: false,
    }),
    false,
  );
});

test("active without consent button disabled", () => {
  assert.equal(
    canSubmitAgentBriefing({
      selected: ACTIVE_NO_CONSENT,
      purpose: "목적",
      question: "질문",
      submitting: false,
    }),
    false,
  );
});

test("eligible selection enables button when purpose/question filled", () => {
  assert.equal(
    canSubmitAgentBriefing({
      selected: ELIGIBLE,
      purpose: "목적",
      question: "질문",
      submitting: false,
    }),
    true,
  );
  assert.equal(
    canSubmitAgentBriefing({
      selected: ELIGIBLE,
      purpose: "  ",
      question: "질문",
      submitting: false,
    }),
    false,
  );
});

test("POST body has exactly three fields", () => {
  const body = buildAgentBriefingPostBody({
    assignmentId: "asg-eligible",
    purpose: "보장 점검",
    question: "공백을 요약해 주세요",
  });
  assert.deepEqual(Object.keys(body).sort(), [
    "assignment_id",
    "purpose",
    "question",
  ]);
  assert.equal(body.assignment_id, "asg-eligible");
  assert.equal(body.purpose, "보장 점검");
  assert.equal(body.question, "공백을 요약해 주세요");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "customer_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "agent_user_id"), false);
});

test("submitting blocks duplicate POST", () => {
  assert.equal(
    canSubmitAgentBriefing({
      selected: ELIGIBLE,
      purpose: "목적",
      question: "질문",
      submitting: true,
    }),
    false,
  );
});

test("success briefing_text is displayed as KEY message as-is", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.match(panel, /LifeguardAssistantMarkdown/);
  assert.match(panel, /msg\.briefing_text \?\? msg\.content/);
  assert.doesNotMatch(panel, /briefing_text\s*\+/);
  assert.doesNotMatch(panel, /summarize|rewrite|재작성|요약\(/);
  assert.match(panel, /KEY 내부 브리핑/);
  assert.match(panel, /KEY 협진실/);
  assert.match(panel, /FINAL_UI/);
  assert.doesNotMatch(panel, /gridTemplateColumns:\s*"minmax\(240px/);
});

test("error codes map to customer-facing copy", () => {
  assert.equal(
    mapAgentBriefingErrorMessage("FORBIDDEN_ROLE"),
    "설계사 계정만 이용할 수 있습니다.",
  );
  assert.equal(
    mapAgentBriefingErrorMessage("NOT_ASSIGNED"),
    "현재 설계사에게 배정된 고객이 아닙니다.",
  );
  assert.equal(
    mapAgentBriefingErrorMessage("ASSIGNMENT_NOT_ACTIVE"),
    "아직 활성화되지 않은 배정입니다.",
  );
  assert.equal(
    mapAgentBriefingErrorMessage("CONSENT_BINDING_REQUIRED"),
    "고객의 정보 공유 동의가 필요합니다.",
  );
  assert.equal(mapAgentBriefingErrorMessage("KEY_TURN_FAILED"), AGENT_BRIEFING_GENERIC_ERROR);
  assert.equal(mapAgentBriefingErrorMessage(null), AGENT_BRIEFING_GENERIC_ERROR);
});

test("customer/admin route blocked; agent allowed", () => {
  assert.equal(canAccessPath("/agent", APP_ROLES.AGENT), true);
  assert.equal(canAccessPath("/agent", APP_ROLES.CUSTOMER), false);
  assert.equal(canAccessPath("/agent", APP_ROLES.ADMIN), false);
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.match(panel, /requiredRoles=\{\["agent"\]\}/);
});

test("PanelKeyVoice and customer_conversations stay unused", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  const helper = readFileSync(join(ROOT, "src/lib/agentKeyBriefing.js"), "utf8");
  for (const src of [panel, helper]) {
    assert.equal(src.includes("PanelKeyVoice"), false);
    assert.equal(src.includes("customer_conversations"), false);
    assert.equal(src.includes("/api/customer-home-brain-fact"), false);
    assert.equal(src.includes("runOneKeyCoreTurn"), false);
  }
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

test("ineligible disables composer; eligible uses chat composer", () => {
  const panel = readFileSync(join(ROOT, "src/components/AgentDeskPanel.jsx"), "utf8");
  assert.match(panel, /disabled=\{!eligible \|\| submitting \|\| !selected\}/);
  assert.match(panel, /lg-v31-composer/);
  assert.match(panel, /KEY가 확인하고 있어요/);
  assert.doesNotMatch(panel, /PanelKeyVoice/);
  assert.doesNotMatch(panel, /AiRecommendationPanel/);
});

console.log(`agent-desk-panel-unit-test: PASS (${passed})`);
