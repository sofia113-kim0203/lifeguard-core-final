/**
 * Pure mapping for Signup Onboarding → existing signup/bootstrap fields.
 * No supabase / auth side effects.
 */
import { normalizeSignupPhone } from "./signupValidation.js";

/** Keep in sync with signupBootstrap.SIGNUP_CONSENT_VERSION */
export const SIGNUP_ONBOARDING_CONSENT_VERSION = "2026-01-01-ko";
export const SIGNUP_ONBOARDING_SOURCE = "signup_onboarding";
export const SIGNUP_ONBOARDING_PENDING_KEY = "lg_signup_onboarding_pending_v1";

const GENDER_MAP = {
  남성: "male",
  여성: "female",
};

/** Map onboarding consent keys → DB consent_type (+ optional version suffix). */
export const ONBOARDING_CONSENT_MAP = [
  { key: "terms", type: "service_terms", required: true, purpose: "서비스 이용약관 동의" },
  { key: "privacy", type: "privacy_collection", required: true, purpose: "개인정보 수집 및 이용 동의" },
  {
    key: "sensitive",
    type: "sensitive_health_processing",
    required: true,
    purpose: "민감정보 처리 동의",
  },
  {
    key: "insurance_store",
    type: "insurance_data_processing",
    required: true,
    purpose: "보험정보 저장 및 분석 동의",
  },
  {
    key: "doc_store",
    type: "document_storage",
    required: true,
    purpose: "보험자료·문서 저장 및 분석 동의",
  },
  {
    key: "doc_store",
    type: "document_analysis",
    required: true,
    purpose: "보험자료·문서 저장 및 분석 동의",
  },
  { key: "ai", type: "ai_consultation", required: true, purpose: "AI 상담 이용 동의" },
  { key: "key_memory", type: "memory_retention", required: true, purpose: "KEY 기억 유지 동의" },
  {
    key: "marketing",
    type: "marketing_optional",
    required: false,
    purpose: "마케팅 정보 수신 동의",
  },
  {
    key: "third_party",
    type: "insurance_data_processing",
    required: false,
    purpose: "보험사 제출을 위한 개인정보 제3자 제공 동의",
    version: `${SIGNUP_ONBOARDING_CONSENT_VERSION}+insurer_third_party`,
  },
];

export function birthDotsToIso(value = "") {
  const m = String(value).trim().match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function mapOnboardingGender(value = "") {
  return GENDER_MAP[value] || null;
}

export function buildOnboardingPersistPayload(form = {}) {
  const birthIso = birthDotsToIso(form.birthDate);
  const gender = mapOnboardingGender(form.gender);
  const phone = normalizeSignupPhone(form.phone);
  return {
    source: SIGNUP_ONBOARDING_SOURCE,
    savedAt: new Date().toISOString(),
    account: {
      email: String(form.email || "").trim().toLowerCase(),
      displayName: String(form.name || "").trim(),
      phone,
      birthDate: birthIso,
      gender,
      customerType: form.customerType || "",
    },
    lifestyle: {
      occupation: form.occupation || "",
      employmentType: form.employmentType || "",
      married: form.married || "",
      hasChildren: form.hasChildren || "",
      dependents: form.dependents || "",
      familyMembers: Array.isArray(form.familyMembers) ? form.familyMembers : [],
    },
    health: {
      kind: "customer_reported",
      source: SIGNUP_ONBOARDING_SOURCE,
      verified: false,
      treatment: form.healthTreatment || "",
      hospitalSurgery: form.healthHospitalSurgery || "",
      medication: form.healthMedication || "",
      checkupFollowup: form.healthCheckupFollowup || "",
    },
    insurance: {
      kind: "customer_reported",
      source: SIGNUP_ONBOARDING_SOURCE,
      verified: false,
      hasInsurance: form.hasInsurance || "",
      policyCount: form.policyCount || "",
      monthlyPremium: form.monthlyPremium || "",
      recentChange: form.recentChange || "",
      activeClaim: form.activeClaim || "",
      worry: form.worry || "",
      policyUploadTiming: form.policyUploadTiming || "",
    },
    consents: { ...(form.consents || {}) },
  };
}

export function requiredOnboardingConsentsOk(form) {
  const c = form?.consents || {};
  return ["terms", "privacy", "sensitive", "insurance_store", "doc_store", "ai", "key_memory"].every(
    (k) => c[k],
  );
}
