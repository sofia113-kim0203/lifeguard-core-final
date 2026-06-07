import { supabase } from "./supabase.js";

const CONSENT_VERSION = "2026-01-01-ko";

export const REQUIRED_CONSENT_TYPES = [
  "privacy_collection",
  "sensitive_health_processing",
  "ai_consultation",
];

async function fetchCustomerProfile(userId) {
  return supabase
    .from("customer_profiles")
    .select("id, user_id, display_name, status")
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

export function normalizeCustomerDashboardData({
  authUser,
  userRow,
  profile,
  health,
  consents,
}) {
  const activeRequiredConsents = (consents ?? []).filter(
    (consent) =>
      REQUIRED_CONSENT_TYPES.includes(consent.consent_type) &&
      consent.granted === true &&
      !consent.revoked_at,
  );

  return {
    email: authUser?.email ?? userRow?.email ?? null,
    customerId: profile?.id ?? null,
    displayName: profile?.display_name ?? null,
    profileStatus: profile?.status ?? null,
    userRole: userRow?.role ?? null,
    profileHealthExists: Boolean(health),
    profileHealthSource: health?.source ?? null,
    requiredConsentCount: activeRequiredConsents.length,
  };
}

export async function loadCustomerDashboardData(authUser) {
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
    throw new Error(userError.message);
  }

  let { data: profile, error: profileError } = await fetchCustomerProfile(authUser.id);

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profile) {
    const { error: bootstrapError } = await bootstrapCustomerSignup(displayNameFromMeta);
    if (bootstrapError) {
      throw new Error(bootstrapError.message);
    }

    const retry = await fetchCustomerProfile(authUser.id);
    if (retry.error) {
      throw new Error(retry.error.message);
    }
    profile = retry.data;
  }

  if (!profile) {
    throw new Error("고객 프로필을 불러오지 못했습니다.");
  }

  const customerId = profile.id;

  const [healthResult, consentsResult] = await Promise.all([
    supabase
      .from("profile_health")
      .select("customer_id, source")
      .eq("customer_id", customerId)
      .maybeSingle(),
    supabase
      .from("customer_consents")
      .select("consent_type, granted, revoked_at")
      .eq("customer_id", customerId),
  ]);

  if (healthResult.error) {
    throw new Error(healthResult.error.message);
  }

  if (consentsResult.error) {
    throw new Error(consentsResult.error.message);
  }

  return normalizeCustomerDashboardData({
    authUser,
    userRow,
    profile,
    health: healthResult.data,
    consents: consentsResult.data ?? [],
  });
}
