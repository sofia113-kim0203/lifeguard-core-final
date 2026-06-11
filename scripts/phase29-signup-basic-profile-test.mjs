/**
 * Phase 29-C — signup basic profile verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { validateSignupProfile } from "../src/lib/signupValidation.js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !serviceRoleKey || !anonKey) {
  throw new Error("SUPABASE_URL, SERVICE_ROLE_KEY, and anon key are required");
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false } });

const EXISTING_CUSTOMER_ID =
  resolveAuditCustomerId(process.env.PHASE28_TEST_CUSTOMER_ID);

const validation = validateSignupProfile({
  displayName: "가입테스트",
  phone: "01012345678",
  birthDate: "1990-05-15",
  gender: "male",
});
assert.equal(validation.valid, true);
assert.equal(validation.normalizedPhone, "010-1234-5678");

const ts = Date.now();
const email = `phase29-signup-basic+${ts}@example.com`;
const password = "Phase29SignupBasic!2026";
const signupProfile = {
  display_name: "가입테스트",
  signup_complete: "true",
  signup_consent_version: "2026-01-01-ko",
  phone: "010-9876-5432",
  birth_date: "1992-03-20",
  gender: "female",
  job_category: "사무직",
};

const signup = await client.auth.signUp({
  email,
  password,
  options: { data: signupProfile },
});
assert.equal(signup.error, null, signup.error?.message ?? "signup failed");
assert.ok(signup.data?.user?.id, "user id required");

if (signup.data?.session) {
  const authed = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${signup.data.session.access_token}` } },
  });
  const rpc = await authed.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: signupProfile.display_name,
    p_consent_version: "2026-01-01-ko",
    p_phone: signupProfile.phone,
    p_birth_date: signupProfile.birth_date,
    p_gender: signupProfile.gender,
    p_job_category: signupProfile.job_category,
  });
  assert.equal(rpc.error, null, rpc.error?.message ?? "bootstrap rpc failed");
}

await new Promise((resolve) => setTimeout(resolve, 1500));

const userId = signup.data.user.id;
const { data: userRow } = await admin
  .from("users")
  .select("id, email, phone, role")
  .eq("id", userId)
  .maybeSingle();
const { data: profile } = await admin
  .from("customer_profiles")
  .select("id, display_name, birth_date, gender, job_category, status")
  .eq("user_id", userId)
  .maybeSingle();

assert.equal(userRow?.phone, "010-9876-5432", `users.phone mismatch: ${userRow?.phone}`);
assert.equal(profile?.display_name, "가입테스트");
assert.equal(profile?.birth_date, "1992-03-20");
assert.equal(profile?.gender, "female");
assert.equal(profile?.job_category, "사무직");

const { data: health } = await admin
  .from("profile_health")
  .select("customer_id, source, details_json")
  .eq("customer_id", profile.id)
  .maybeSingle();
assert.ok(health, "profile_health row required");
assert.equal(health.source, "signup");

const { count: consentCount } = await admin
  .from("customer_consents")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", profile.id);
assert.equal(consentCount, 3);

const { data: existingProfileBefore } = await admin
  .from("customer_profiles")
  .select("user_id, display_name, birth_date, gender, job_category")
  .eq("id", EXISTING_CUSTOMER_ID)
  .maybeSingle();
const { data: existingUserBefore } = await admin
  .from("users")
  .select("phone")
  .eq("id", existingProfileBefore.user_id)
  .maybeSingle();

const { error: preserveError } = await admin.rpc("lifeguard_bootstrap_customer_signup", {
  p_display_name: null,
  p_consent_version: "2026-01-01-ko",
  p_phone: null,
  p_birth_date: null,
  p_gender: null,
  p_job_category: null,
});

const { data: existingProfileAfter } = await admin
  .from("customer_profiles")
  .select("display_name, birth_date, gender, job_category")
  .eq("id", EXISTING_CUSTOMER_ID)
  .maybeSingle();
const { data: existingUserAfter } = await admin
  .from("users")
  .select("phone")
  .eq("id", existingProfileBefore.user_id)
  .maybeSingle();

assert.deepEqual(existingProfileAfter, {
  display_name: existingProfileBefore.display_name,
  birth_date: existingProfileBefore.birth_date,
  gender: existingProfileBefore.gender,
  job_category: existingProfileBefore.job_category,
});
assert.equal(existingUserAfter?.phone, existingUserBefore?.phone);

console.log(
  JSON.stringify(
    {
      phase: "29-signup-basic-profile",
      pass: true,
      test_email: email,
      user_id: userId,
      customer_id: profile.id,
      users_phone: userRow?.phone,
      profile,
      consent_count: consentCount,
      existing_profile_preserved: true,
      preserve_rpc_error: preserveError?.message ?? null,
    },
    null,
    2,
  ),
);
