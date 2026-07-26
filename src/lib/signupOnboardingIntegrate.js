/**
 * Connect SignupOnboardingV1Prototype → existing AuthPanel signup path.
 * Reuses supabase.auth.signUp + lifeguard_bootstrap_customer_signup.
 * No parallel auth engine. Production schema unchanged.
 */
import { supabase } from "./supabase.js";
import {
  SIGNUP_CONSENT_VERSION,
  bootstrapSignupRecords,
  buildSignupMetadata,
} from "./signupBootstrap.js";
import { validateSignupBasicProfile } from "./signupValidation.js";
import { toCustomerErrorMessage } from "./uiLocale.js";
import {
  ONBOARDING_CONSENT_MAP,
  SIGNUP_ONBOARDING_PENDING_KEY,
  SIGNUP_ONBOARDING_SOURCE,
  birthDotsToIso,
  buildOnboardingPersistPayload,
  mapOnboardingGender,
  requiredOnboardingConsentsOk,
} from "./signupOnboardingMap.js";

export {
  ONBOARDING_CONSENT_MAP,
  SIGNUP_ONBOARDING_PENDING_KEY,
  SIGNUP_ONBOARDING_SOURCE,
  birthDotsToIso,
  buildOnboardingPersistPayload,
  mapOnboardingGender,
  requiredOnboardingConsentsOk,
};

let submitInFlight = false;

export function stashPendingOnboarding(payload) {
  try {
    sessionStorage.setItem(SIGNUP_ONBOARDING_PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function readPendingOnboarding() {
  try {
    const raw = sessionStorage.getItem(SIGNUP_ONBOARDING_PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPendingOnboarding() {
  try {
    sessionStorage.removeItem(SIGNUP_ONBOARDING_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function safeErrorMessage(err, fallback) {
  return toCustomerErrorMessage(err, fallback);
}

export async function recordOnboardingConsents(customerId, consents = {}) {
  if (!customerId) return { error: new Error("customer_id_missing") };

  const rows = ONBOARDING_CONSENT_MAP.map((spec) => {
    const accepted = Boolean(consents[spec.key]);
    const version = spec.version || SIGNUP_CONSENT_VERSION;
    return {
      customer_id: customerId,
      consent_type: spec.type,
      consent_version: version,
      granted: accepted,
      granted_at: accepted ? new Date().toISOString() : null,
      source: SIGNUP_ONBOARDING_SOURCE,
      purpose: spec.purpose,
      required: spec.required,
      consent_scope: {
        source: SIGNUP_ONBOARDING_SOURCE,
        onboarding_key: spec.key,
        reconfirm_on_insurer_submit: spec.key === "third_party",
      },
    };
  });

  for (const row of rows) {
    const { data: existing, error: readErr } = await supabase
      .from("customer_consents")
      .select("id, granted")
      .eq("customer_id", row.customer_id)
      .eq("consent_type", row.consent_type)
      .eq("consent_version", row.consent_version)
      .maybeSingle();
    if (readErr) return { error: readErr };

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("customer_consents")
        .update({
          granted: row.granted,
          granted_at: row.granted_at,
          source: row.source,
          purpose: row.purpose,
          required: row.required,
          consent_scope: row.consent_scope,
          revoked_at: null,
        })
        .eq("id", existing.id);
      if (updErr) return { error: updErr };
    } else {
      const { error: insErr } = await supabase.from("customer_consents").insert(row);
      if (insErr) return { error: insErr };
    }
  }

  return { error: null };
}

export async function persistOnboardingProfileExtras(customerId, payload) {
  if (!customerId || !payload) return { error: new Error("persist_payload_missing") };

  const { data: healthRow, error: healthReadError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (healthReadError) return { error: healthReadError };

  const existingDetails =
    healthRow?.details_json && typeof healthRow.details_json === "object"
      ? healthRow.details_json
      : {};

  const mergedDetails = {
    ...existingDetails,
    signup_onboarding: {
      source: SIGNUP_ONBOARDING_SOURCE,
      account: {
        customerType: payload.account?.customerType || "",
      },
      lifestyle: payload.lifestyle,
      health: {
        ...payload.health,
        kind: "customer_reported",
        source: SIGNUP_ONBOARDING_SOURCE,
        verified: false,
      },
      insurance: {
        ...payload.insurance,
        kind: "customer_reported",
        source: SIGNUP_ONBOARDING_SOURCE,
        verified: false,
        not_verified_chart: true,
        not_confirmed_policy: true,
      },
      saved_at: new Date().toISOString(),
    },
  };

  const healthPayload = {
    customer_id: customerId,
    details_json: mergedDetails,
    source: healthRow ? "update" : "signup",
    hospital_5y: payload.health?.hospitalSurgery || null,
    surgery_5y: payload.health?.hospitalSurgery || null,
    medication: payload.health?.medication || null,
    outpatient: payload.health?.treatment || null,
  };

  const healthWrite = healthRow
    ? supabase.from("profile_health").update(healthPayload).eq("customer_id", customerId)
    : supabase.from("profile_health").insert({ ...healthPayload, source: "signup" });

  const { error: healthError } = await healthWrite;
  if (healthError) return { error: healthError };

  if (payload.lifestyle?.occupation) {
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .update({ job_category: payload.lifestyle.occupation })
      .eq("id", customerId);
    if (profileError) return { error: profileError };
  }

  return { error: null };
}

export async function flushPendingOnboardingAfterAuth() {
  const pending = readPendingOnboarding();
  if (!pending) return { error: null, flushed: false };

  const profile = {
    displayName: pending.account?.displayName,
    phone: pending.account?.phone,
    birthDate: pending.account?.birthDate,
    gender: pending.account?.gender,
    jobCategory: pending.lifestyle?.occupation || null,
  };

  const { error: bootError, customerId } = await bootstrapSignupRecords(profile);
  if (bootError) return { error: bootError, flushed: false };

  const { error: consentError } = await recordOnboardingConsents(customerId, pending.consents);
  if (consentError) return { error: consentError, flushed: false, customerId };

  const { error: extraError } = await persistOnboardingProfileExtras(customerId, pending);
  if (extraError) return { error: extraError, flushed: false, customerId };

  clearPendingOnboarding();
  return { error: null, flushed: true, customerId };
}

/**
 * Step 4 "가입하기" only — creates auth user via existing engine, then persists onboarding.
 */
export async function submitSignupOnboarding(form) {
  if (submitInFlight) {
    return { ok: false, error: "처리 중입니다. 잠시만 기다려 주세요.", code: "duplicate_submit" };
  }
  submitInFlight = true;

  try {
    const email = String(form.email || "").trim().toLowerCase();
    const password = String(form.password || "");
    if (!email || !password) {
      return { ok: false, error: "이메일과 비밀번호를 입력해 주세요." };
    }
    if (!requiredOnboardingConsentsOk(form)) {
      return { ok: false, error: "필수 동의를 모두 체크해 주세요." };
    }

    const basic = validateSignupBasicProfile({
      displayName: form.name,
      phone: form.phone,
    });
    if (!basic.valid) {
      return {
        ok: false,
        error: Object.values(basic.fieldErrors)[0] || "입력값을 확인해 주세요.",
      };
    }

    const payload = buildOnboardingPersistPayload(form);
    const signupProfile = {
      displayName: payload.account.displayName,
      phone: payload.account.phone,
      birthDate: payload.account.birthDate,
      gender: payload.account.gender,
      jobCategory: payload.lifestyle.occupation || null,
    };

    const signupMetadata = {
      ...buildSignupMetadata(signupProfile),
      signup_onboarding: "v1",
      customer_type: payload.account.customerType || null,
    };

    stashPendingOnboarding(payload);

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: signupMetadata },
    });

    if (authError) {
      clearPendingOnboarding();
      return {
        ok: false,
        error: safeErrorMessage(authError, "회원가입에 실패했습니다."),
        code: "auth_failed",
      };
    }

    if (!data?.user) {
      clearPendingOnboarding();
      return { ok: false, error: "계정 생성에 실패했습니다. 다시 시도해 주세요.", code: "auth_failed" };
    }

    if (!data.session) {
      return {
        ok: true,
        needsEmailVerification: true,
        message: "회원가입 완료. 이메일 인증 후 로그인해 주세요.",
      };
    }

    if (data.user) {
      await supabase.auth.updateUser({ data: signupMetadata });
    }

    const flush = await flushPendingOnboardingAfterAuth();
    if (flush.error) {
      return {
        ok: false,
        error:
          "회원가입은 되었지만 프로필 저장에 실패했습니다. " +
          safeErrorMessage(flush.error, "잠시 후 다시 로그인해 주세요."),
        code: "bootstrap_failed",
        authUserCreated: true,
      };
    }

    return {
      ok: true,
      needsEmailVerification: false,
      customerId: flush.customerId,
      message: "회원가입이 완료되었습니다.",
    };
  } finally {
    submitInFlight = false;
  }
}
