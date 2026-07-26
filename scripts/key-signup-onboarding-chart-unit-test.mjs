/**
 * Signup onboarding → KEY chart materials (customer_reported / verified=false).
 * Also asserts left-rail displayName wiring source (no hardcoded 고객님).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractSignupOnboardingChartMaterial,
  softSignupOnboardingContext,
  SIGNUP_ONBOARDING_CHART_SOURCE,
} from "../server/keyCore/keySignupOnboardingChart.js";
import { buildUserPayload, buildSystemPrompt } from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildSourceSummaryFromUnifiedState } from "../server/unifiedCustomerState.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const healthDetails = {
  medication: "있음",
  signup_onboarding: {
    source: "signup_onboarding",
    saved_at: "2026-07-12T00:00:00.000Z",
    health: {
      kind: "customer_reported",
      source: "signup_onboarding",
      verified: false,
      treatment: "치료·추적관찰 있음",
      hospitalSurgery: "입원·수술 없음",
      medication: "정기 복용약 있음",
      checkupFollowup: "잘 모르겠음",
    },
    insurance: {
      kind: "customer_reported",
      source: "signup_onboarding",
      verified: false,
      hasInsurance: "있음",
      policyCount: "3~5건",
      monthlyPremium: "10~30만 원",
      not_verified_chart: true,
      not_confirmed_policy: true,
    },
  },
};

{
  assert.equal(extractSignupOnboardingChartMaterial(null), null);
  assert.equal(extractSignupOnboardingChartMaterial({}), null);
  assert.equal(extractSignupOnboardingChartMaterial({ medication: "x" }), null);
}

const material = extractSignupOnboardingChartMaterial(healthDetails);
assert.ok(material);
assert.equal(material.source, SIGNUP_ONBOARDING_CHART_SOURCE);
assert.equal(material.customer_reported, true);
assert.equal(material.verified, false);
assert.equal(material.verification_status, "customer_reported");
assert.equal(material.health.treatment, "치료·추적관찰 있음");
assert.equal(material.health.hospitalSurgery, "입원·수술 없음");
assert.equal(material.health.medication, "정기 복용약 있음");
assert.equal(material.health.checkupFollowup, "잘 모르겠음");
assert.equal(material.health.verified, false);
assert.equal(material.health.kind, "customer_reported");
assert.equal(material.insurance.hasInsurance, "있음");
assert.equal(material.insurance.policyCount, "3~5건");
assert.equal(material.insurance.monthlyPremium, "10~30만 원");
assert.equal(material.insurance.verified, false);
assert.equal(material.insurance.not_verified_chart, true);
assert.equal(material.insurance.not_confirmed_policy, true);

// Forced false even if storage were wrongly marked verified.
const forced = extractSignupOnboardingChartMaterial({
  signup_onboarding: {
    health: { treatment: "있음", verified: true, kind: "verified" },
    insurance: { hasInsurance: "있음", verified: true },
  },
});
assert.equal(forced.health.verified, false);
assert.equal(forced.health.kind, "customer_reported");
assert.equal(forced.insurance.verified, false);
assert.equal(forced.verified, false);

const soft = softSignupOnboardingContext(material);
assert.ok(soft.signup_onboarding);
assert.equal(soft.signup_onboarding.verified, false);
assert.equal(soft.signup_onboarding.customer_reported, true);

const payload = buildUserPayload({
  question: "내가 가입할 때 입력한 건강·보험 정보를 알려줘.",
  chart: { policy_count: { status: "verified", value: 0 }, contracts: [] },
  contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
  signupOnboardingBrief: material,
});
assert.ok(payload.current_context.signup_onboarding);
assert.equal(payload.current_context.signup_onboarding.source, "signup_onboarding");
assert.equal(payload.current_context.signup_onboarding.verified, false);
assert.equal(payload.current_context.signup_onboarding.customer_reported, true);
assert.equal(
  payload.current_context.signup_onboarding.health.treatment,
  "치료·추적관찰 있음",
);
assert.equal(payload.current_context.signup_onboarding.insurance.policyCount, "3~5건");
// Must not land in verified chart.
assert.equal(
  Object.prototype.hasOwnProperty.call(
    payload.available_verified_evidence.personal.chart || {},
    "signup_onboarding",
  ),
  false,
);

const prompt = buildSystemPrompt();
assert.match(prompt, /signup_onboarding/);
assert.match(prompt, /customer_reported/);
assert.match(prompt, /verified=false/);

const summary = buildSourceSummaryFromUnifiedState({
  profile: { display_name: "김직행" },
  health_details: healthDetails,
  policies: [],
});
assert.ok(summary.health.signup_onboarding);
assert.equal(summary.health.signup_onboarding.health.treatment, "치료·추적관찰 있음");
assert.equal(summary.health.signup_onboarding.insurance.policyCount, "3~5건");

{
  const leftRail = readFileSync(join(root, "src/components/KeyCustomerLeftRail.jsx"), "utf8");
  assert.match(leftRail, /displayName/);
  assert.match(leftRail, /customerDisplayName\}님/);
  assert.match(leftRail, /내 보험 주치의 KEY/);
  assert.equal(leftRail.includes(">고객님<"), false);
  const home = readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(home, /displayName=\{displayName\}/);
  const minimal = readFileSync(join(root, "server/unifiedCustomerState.js"), "utf8");
  assert.match(minimal, /loadSalesDirectorMinimalRawRecords/);
  assert.match(minimal, /profile_health/);
  assert.match(minimal, /signup_onboarding/);
}

console.log("key-signup-onboarding-chart-unit-test: PASS");
