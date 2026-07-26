/**
 * Signup onboarding health/insurance → KEY chart materials (customer_reported only).
 * Stored in profile_health.details_json.signup_onboarding — not verified contracts.
 */

export const SIGNUP_ONBOARDING_CHART_SOURCE = "signup_onboarding";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function preserveReportedBlock(block, { notPolicy = false } = {}) {
  const src = asObject(block);
  if (!src) return null;
  const out = {
    ...src,
    kind: "customer_reported",
    source: SIGNUP_ONBOARDING_CHART_SOURCE,
    customer_reported: true,
    verified: false,
  };
  if (notPolicy) {
    out.not_verified_chart = true;
    out.not_confirmed_policy = true;
  }
  return out;
}

/**
 * Extract signup_onboarding health + insurance for KEY current_context materials.
 * Preserves original field values; forces customer_reported / verified=false.
 */
export function extractSignupOnboardingChartMaterial(healthDetails = null) {
  const details = asObject(healthDetails) || {};
  const signup = asObject(details.signup_onboarding);
  if (!signup) return null;

  const health = preserveReportedBlock(signup.health);
  const insurance = preserveReportedBlock(signup.insurance, { notPolicy: true });
  if (!health && !insurance) return null;

  return {
    source: SIGNUP_ONBOARDING_CHART_SOURCE,
    customer_reported: true,
    verification_status: "customer_reported",
    verified: false,
    health,
    insurance,
    saved_at: signup.saved_at ?? null,
    note: "customer_reported_signup_onboarding_not_verified_policy_or_medical_record",
  };
}

/** Soft current_context wrapper — never merges into verified_customer_chart. */
export function softSignupOnboardingContext(material = null) {
  if (!material || typeof material !== "object") return null;
  return {
    signup_onboarding: {
      ...material,
      source: SIGNUP_ONBOARDING_CHART_SOURCE,
      customer_reported: true,
      verification_status: "customer_reported",
      verified: false,
    },
  };
}
