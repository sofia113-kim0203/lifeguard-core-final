/**
 * Official Preview QA customer resolution — email → auth user → customer_profiles.id.
 * Never falls back to a hardcoded customer UUID. e2-3 staging accounts are forbidden.
 */
import { createClient } from "@supabase/supabase-js";

export const OFFICIAL_QA_EMAIL = "qa-customer-a@staging-qa.example.com";
/** Observed id for official QA (assertion aid only — not a fallback). */
export const OFFICIAL_QA_CUSTOMER_ID_EXPECTED = "36aadc18-6e16-4d1f-9417-7a753b7e3692";

const FORBIDDEN_EMAIL_RE = /^e2-3-qa-customer/i;
const LEGACY_HARDCODED_IDS = new Set(["a247a66f-a597-4ccf-9530-761b82518002"]);

export class OfficialQaCustomerResolveError extends Error {
  constructor(reason, details = {}) {
    super(`OFFICIAL_QA_CUSTOMER_STOP:${reason}`);
    this.name = "OfficialQaCustomerResolveError";
    this.reason = reason;
    this.details = details;
  }
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * @param {{
 *   supabaseUrl?: string,
 *   supabaseAnonKey?: string,
 *   email?: string,
 *   password?: string,
 *   expectedCustomerId?: string | null,
 *   requireOfficialEmail?: boolean,
 * }} [options]
 */
export async function resolveOfficialQaCustomerId({
  supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
  email = process.env.QA_EMAIL || process.env.QA_TEST_EMAIL || "",
  password = process.env.QA_PASSWORD || process.env.QA_TEST_PASSWORD || "",
  expectedCustomerId = OFFICIAL_QA_CUSTOMER_ID_EXPECTED,
  requireOfficialEmail = true,
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const url = String(supabaseUrl ?? "").trim();
  const anon = String(supabaseAnonKey ?? "").trim();
  const pwd = String(password ?? "");

  if (!url || !anon) {
    throw new OfficialQaCustomerResolveError("supabase_env_missing");
  }
  if (!normalizedEmail || !pwd) {
    throw new OfficialQaCustomerResolveError("qa_credentials_missing");
  }
  if (FORBIDDEN_EMAIL_RE.test(normalizedEmail) || normalizedEmail.includes("e2-3-qa-customer")) {
    throw new OfficialQaCustomerResolveError("forbidden_e2_3_qa_account", {
      email: normalizedEmail,
    });
  }
  if (requireOfficialEmail && normalizedEmail !== normalizeEmail(OFFICIAL_QA_EMAIL)) {
    throw new OfficialQaCustomerResolveError("email_not_official_qa", {
      email: normalizedEmail,
      expected: OFFICIAL_QA_EMAIL,
    });
  }

  const { data: auth, error } = await createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email: normalizedEmail, password: pwd });

  if (error || !auth?.session?.access_token || !auth?.user?.id) {
    throw new OfficialQaCustomerResolveError("auth_sign_in_failed", {
      email: normalizedEmail,
      message: error?.message ?? "no_session",
    });
  }

  const sessionEmail = normalizeEmail(auth.user.email);
  if (sessionEmail !== normalizedEmail) {
    throw new OfficialQaCustomerResolveError("auth_email_mismatch", {
      requested: normalizedEmail,
      session: sessionEmail,
    });
  }

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
  });

  const { data: profile, error: profileError } = await userClient
    .from("customer_profiles")
    .select("id, user_id")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError || !profile?.id) {
    throw new OfficialQaCustomerResolveError("customer_profile_not_found", {
      email: normalizedEmail,
      user_id: auth.user.id,
      message: profileError?.message ?? "missing",
    });
  }

  const customerId = String(profile.id).trim();
  if (LEGACY_HARDCODED_IDS.has(customerId)) {
    throw new OfficialQaCustomerResolveError("resolved_legacy_hardcoded_id", {
      email: normalizedEmail,
      customer_id: customerId,
    });
  }

  if (
    expectedCustomerId &&
    String(expectedCustomerId).trim() &&
    customerId !== String(expectedCustomerId).trim()
  ) {
    throw new OfficialQaCustomerResolveError("customer_id_email_mismatch", {
      email: normalizedEmail,
      customer_id: customerId,
      expected_customer_id: String(expectedCustomerId).trim(),
    });
  }

  return {
    ok: true,
    email: normalizedEmail,
    user_id: auth.user.id,
    customer_id: customerId,
    access_token: auth.session.access_token,
  };
}
