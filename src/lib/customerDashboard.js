import { buildIntakeFormFromRecords } from "./intakeForm.js";
import { computeIntakeCompleteness } from "./intakeCompleteness.js";
import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const CONSENT_VERSION = "2026-01-01-ko";

export const REQUIRED_CONSENT_TYPES = [
  "privacy_collection",
  "sensitive_health_processing",
  "ai_consultation",
];

async function fetchCustomerProfile(userId) {
  return supabase
    .from("customer_profiles")
    .select("id, user_id, display_name, birth_date, gender, job_category, status, memory_version")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
}

async function bootstrapCustomerSignup(displayName) {
  return supabase.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: displayName?.trim() || null,
    p_consent_version: CONSENT_VERSION,
  });
}

function mapUnifiedPoliciesToDashboard(policies = []) {
  return policies.map((policy) => ({
    id: policy.id,
    insurer_name: policy.insurer_name ?? null,
    product_name: policy.product_name ?? null,
    coverage_summary: policy.coverage_summary ?? null,
    policy_type: policy.policy_type ?? null,
    is_active: policy.is_active ?? null,
    policy_status: policy.policy_status ?? null,
    source: policy.source ?? null,
  }));
}

function canReuseUnifiedPolicyRecords(unifiedState) {
  return (
    unifiedState?.customer_id &&
    Number.isFinite(unifiedState.policy_count) &&
    Array.isArray(unifiedState.policies)
  );
}

export function normalizeCustomerDashboardData({
  authUser,
  userRow,
  profile,
  health,
  insurancePolicy,
  insurancePolicies = [],
  consents,
}) {
  const activeRequiredConsents = (consents ?? []).filter(
    (consent) =>
      REQUIRED_CONSENT_TYPES.includes(consent.consent_type) &&
      consent.granted === true &&
      !consent.revoked_at,
  );

  const policies = insurancePolicies ?? [];
  const intakeForm = buildIntakeFormFromRecords(profile, health, insurancePolicy);
  const completeness = computeIntakeCompleteness(intakeForm);

  return {
    email: authUser?.email ?? userRow?.email ?? null,
    customerId: profile?.id ?? null,
    displayName: profile?.display_name ?? null,
    profileStatus: profile?.status ?? null,
    userRole: userRow?.role ?? null,
    profileHealthExists: Boolean(health),
    profileHealthSource: health?.source ?? null,
    requiredConsentCount: activeRequiredConsents.length,
    intakeCompletenessScore: completeness.score,
    intakeCompleteness: completeness,
    memoryVersion: profile?.memory_version ?? 0,
    insurancePolicyCount: policies.length,
    insurancePolicyIds: policies.map((policy) => policy.id),
    insurancePolicies: policies,
  };
}

export async function loadCustomerDashboardData(authUser, { unifiedState = null } = {}) {
  if (!authUser?.id) {
    throw new Error("로그인이 필요합니다.");
  }

  const displayNameFromMeta =
    authUser.user_metadata?.display_name ?? authUser.user_metadata?.displayName ?? null;

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("id", authUser.id)
    .maybeSingle();

  if (userError) {
    throw new Error(toCustomerErrorMessage(userError, "사용자 정보를 불러오지 못했습니다."));
  }

  let { data: profile, error: profileError } = await fetchCustomerProfile(authUser.id);

  if (profileError) {
    throw new Error(toCustomerErrorMessage(profileError, "고객 프로필을 불러오지 못했습니다."));
  }

  if (!profile) {
    const { error: bootstrapError } = await bootstrapCustomerSignup(displayNameFromMeta);
    if (bootstrapError) {
      throw new Error(toCustomerErrorMessage(bootstrapError, "고객 프로필을 준비하지 못했습니다."));
    }

    const retry = await fetchCustomerProfile(authUser.id);
    if (retry.error) {
      throw new Error(toCustomerErrorMessage(retry.error, "고객 프로필을 불러오지 못했습니다."));
    }
    profile = retry.data;
  }

  if (!profile) {
    throw new Error("고객 프로필을 불러오지 못했습니다.");
  }

  const customerId = profile.id;
  const reuseUnifiedPolicies = canReuseUnifiedPolicyRecords(unifiedState);

  const [healthResult, insuranceResult, consentsResult] = await Promise.all([
    supabase
      .from("profile_health")
      .select("customer_id, source, details_json")
      .eq("customer_id", customerId)
      .maybeSingle(),
    reuseUnifiedPolicies
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("profile_insurance_policies")
          .select(
            "id, insurer_name, product_name, coverage_summary, policy_type, is_active, policy_status, source",
          )
          .eq("customer_id", customerId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
    supabase
      .from("customer_consents")
      .select("consent_type, granted, revoked_at")
      .eq("customer_id", customerId),
  ]);

  if (healthResult.error) {
    throw new Error(toCustomerErrorMessage(healthResult.error, "건강 프로필을 불러오지 못했습니다."));
  }

  if (insuranceResult.error) {
    throw new Error(toCustomerErrorMessage(insuranceResult.error, "보험 정보를 불러오지 못했습니다."));
  }

  if (consentsResult.error) {
    throw new Error(toCustomerErrorMessage(consentsResult.error, "동의 정보를 불러오지 못했습니다."));
  }

  const insurancePolicies = reuseUnifiedPolicies
    ? mapUnifiedPoliciesToDashboard(unifiedState.policies)
    : (insuranceResult.data ?? []);

  const dashboard = normalizeCustomerDashboardData({
    authUser,
    userRow,
    profile,
    health: healthResult.data,
    insurancePolicy: insurancePolicies[0] ?? null,
    insurancePolicies,
    consents: consentsResult.data ?? [],
  });

  if (reuseUnifiedPolicies) {
    return {
      ...dashboard,
      customerId: unifiedState.customer_id ?? dashboard.customerId,
      memoryVersion: unifiedState.memory_version ?? dashboard.memoryVersion,
      insurancePolicyCount: unifiedState.policy_count ?? dashboard.insurancePolicyCount,
      insurancePolicyIds: unifiedState.policy_ids ?? dashboard.insurancePolicyIds,
    };
  }

  return dashboard;
}
