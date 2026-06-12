/**
 * Verify new signup account in auth.users + customer_profiles.
 * Usage: CHECK_EMAIL=screen-recovery-...@example.com SUPABASE_ENV=local node scripts/screen-recovery-check-account.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { assertSafeTestScriptExecution, isExampleTestEmail, loadEnvLocal } from "./lib/productionSafetyGuard.mjs";

const SCRIPT_NAME = "screen-recovery-check-account";
const EMAIL = (process.env.CHECK_EMAIL ?? "").toLowerCase();

loadEnvLocal();

if (!EMAIL) {
  console.error("CHECK_EMAIL required");
  process.exit(1);
}

assertSafeTestScriptExecution({
  scriptName: SCRIPT_NAME,
  plannedTestEmail: EMAIL,
  createsTestAccount: isExampleTestEmail(EMAIL),
});

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const user = list?.users?.find((u) => String(u.email ?? "").toLowerCase() === EMAIL);

console.log(JSON.stringify({
  email: EMAIL,
  auth_found: Boolean(user),
  auth_user_id: user?.id ?? null,
  email_confirmed_at: user?.email_confirmed_at ?? null,
  created_at: user?.created_at ?? null,
  metadata_display_name: user?.user_metadata?.display_name ?? null,
}, null, 2));

if (!user) process.exit(1);

const { data: pubUser } = await admin.from("users").select("id, email, role").eq("id", user.id).maybeSingle();
const { data: profile } = await admin
  .from("customer_profiles")
  .select("id, user_id, display_name, status")
  .eq("user_id", user.id)
  .maybeSingle();
const { count: consents } = await admin
  .from("customer_consents")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", profile?.id ?? "00000000-0000-0000-0000-000000000000");

console.log(JSON.stringify({
  public_users: pubUser,
  customer_profile: profile,
  customer_consents_count: consents,
}, null, 2));

const { count: totalAuth } = await admin.from("users").select("id", { count: "exact", head: true });
console.log(JSON.stringify({ public_users_total: totalAuth }, null, 2));
