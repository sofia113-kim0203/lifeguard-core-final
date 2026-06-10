import { supabase } from "./supabase.js";
import { normalizeSignupPhone } from "./signupValidation.js";

export const SIGNUP_CONSENT_VERSION = "2026-01-01-ko";

export function buildSignupMetadata({
  displayName,
  phone,
  birthDate,
  gender,
  jobCategory,
} = {}) {
  const metadata = {
    signup_complete: "true",
    signup_consent_version: SIGNUP_CONSENT_VERSION,
  };

  const trimmedName = displayName?.trim();
  if (trimmedName) metadata.display_name = trimmedName;

  const normalizedPhone = normalizeSignupPhone(phone);
  if (normalizedPhone) metadata.phone = normalizedPhone;

  const birth = birthDate?.trim();
  if (birth) metadata.birth_date = birth;

  const genderValue = gender?.trim();
  if (genderValue) metadata.gender = genderValue;

  const job = jobCategory?.trim();
  if (job) metadata.job_category = job;

  return metadata;
}

export function extractSignupProfileFromMetadata(metadata = {}) {
  return {
    displayName: metadata.display_name ?? metadata.displayName ?? null,
    phone: metadata.phone ?? null,
    birthDate: metadata.birth_date ?? metadata.birthDate ?? null,
    gender: metadata.gender ?? null,
    jobCategory: metadata.job_category ?? metadata.jobCategory ?? null,
  };
}

export async function bootstrapSignupRecords(profile = {}) {
  const payload = {
    p_display_name: profile.displayName?.trim() || null,
    p_consent_version: SIGNUP_CONSENT_VERSION,
    p_phone: profile.phone ? normalizeSignupPhone(profile.phone) : null,
    p_birth_date: profile.birthDate?.trim() || null,
    p_gender: profile.gender?.trim() || null,
    p_job_category: profile.jobCategory?.trim() || null,
  };

  const { data, error } = await supabase.rpc("lifeguard_bootstrap_customer_signup", payload);
  if (error) return { error };
  return { error: null, customerId: data?.customer_id ?? null };
}
