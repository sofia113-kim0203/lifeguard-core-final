/**
 * P6-0 L2 — cross-tenant RLS runtime verification (JWT customer A must not read customer B).
 *
 * LIVE TEST — run only by Jinwoo directly, or with Jinwoo approval.
 * Do not run from Cursor Agent without explicit approval.
 *
 * True PASS requires BOTH:
 *   1) service-role confirms B customer_id has rows > 0 (evidence tables)
 *   2) A JWT + anon client querying B customer_id returns 0 rows on all 6 tables
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { createUserSupabaseClient } from "../server/requireCustomerAuth.js";

const EVIDENCE_TABLES = new Set([
  "customer_conversations",
  "active_profile_insurance_policies",
  "customer_documents",
]);

const TABLES = [
  {
    name: "customer_profiles",
    adminCount: (client, otherCustomerId) =>
      client.from("customer_profiles").select("id", { count: "exact", head: true }).eq("id", otherCustomerId),
    jwtQuery: (client, otherCustomerId) =>
      client.from("customer_profiles").select("id").eq("id", otherCustomerId),
  },
  {
    name: "active_profile_insurance_policies",
    adminCount: (client, otherCustomerId) =>
      client
        .from("active_profile_insurance_policies")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", otherCustomerId),
    jwtQuery: (client, otherCustomerId) =>
      client
        .from("active_profile_insurance_policies")
        .select("id")
        .eq("customer_id", otherCustomerId),
  },
  {
    name: "customer_documents",
    adminCount: (client, otherCustomerId) =>
      client
        .from("customer_documents")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", otherCustomerId)
        .is("deleted_at", null),
    jwtQuery: (client, otherCustomerId) =>
      client
        .from("customer_documents")
        .select("id")
        .eq("customer_id", otherCustomerId)
        .is("deleted_at", null),
  },
  {
    name: "customer_memory_facts",
    adminCount: (client, otherCustomerId) =>
      client
        .from("customer_memory_facts")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", otherCustomerId),
    jwtQuery: (client, otherCustomerId) =>
      client.from("customer_memory_facts").select("id").eq("customer_id", otherCustomerId),
  },
  {
    name: "customer_consents",
    adminCount: (client, otherCustomerId) =>
      client
        .from("customer_consents")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", otherCustomerId),
    jwtQuery: (client, otherCustomerId) =>
      client.from("customer_consents").select("id").eq("customer_id", otherCustomerId),
  },
  {
    name: "customer_conversations",
    adminCount: (client, otherCustomerId) =>
      client
        .from("customer_conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", otherCustomerId),
    jwtQuery: (client, otherCustomerId) =>
      client.from("customer_conversations").select("id").eq("customer_id", otherCustomerId),
  },
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env.local");

async function countAdminRows(adminClient, tableDef, otherCustomerId) {
  const { count, error } = await tableDef.adminCount(adminClient, otherCustomerId);
  if (error) throw new Error(`${tableDef.name}_admin_count_failed: ${error.message}`);
  return count ?? 0;
}

async function resolveOtherCustomerId(adminClient, selfCustomerId) {
  const envOther = String(process.env.P6_L2_OTHER_CUSTOMER_ID ?? "").trim();
  if (envOther && envOther !== selfCustomerId) return envOther;

  const { data, error } = await adminClient
    .from("customer_profiles")
    .select("id")
    .neq("id", selfCustomerId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`other_customer_lookup_failed: ${error.message}`);
  return data?.id ?? null;
}

async function main() {
  console.log("p6-l2-cross-tenant-rls-verify (LIVE — Jinwoo-run only)");

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const email = String(
    process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "sofia113@naver.com",
  ).trim();
  const password = String(process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "").trim();

  if (!supabaseUrl || !supabaseAnon || !serviceRoleKey || !password) {
    console.log("SKIP — missing Supabase env, service role, or QA_PASSWORD");
    process.exit(2);
  }

  const authClient = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (authError || !authData.session?.access_token) {
    console.log(`FAIL auth — ${authError?.message ?? "no session"}`);
    process.exit(1);
  }

  const userSupabase = createUserSupabaseClient(`Bearer ${authData.session.access_token}`);
  const { data: selfProfile, error: selfProfileError } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (selfProfileError || !selfProfile?.id) {
    console.log(`FAIL self profile — ${selfProfileError?.message ?? "not found"}`);
    process.exit(1);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const otherCustomerId = await resolveOtherCustomerId(adminClient, selfProfile.id);
  if (!otherCustomerId) {
    console.log("SKIP — no second customer profile in database for cross-tenant probe");
    process.exit(2);
  }

  console.log(`A_email=${email}`);
  console.log(`A_user_id=${authData.user.id}`);
  console.log(`A_customer_id=${selfProfile.id}`);
  console.log(`B_customer_id=${otherCustomerId}`);
  console.log("--- B row counts (service-role setup, same B customer_id) ---");

  const bCounts = {};
  for (const table of TABLES) {
    const count = await countAdminRows(adminClient, table, otherCustomerId);
    bCounts[table.name] = count;
    console.log(`B_ROW_COUNT ${table.name}=${count}`);
  }

  const evidencePresent = [...EVIDENCE_TABLES].some((name) => (bCounts[name] ?? 0) > 0);
  if (!evidencePresent) {
    console.log(
      "STOP — B has no rows in evidence tables (conversations / policies / documents). " +
        "Set P6_L2_OTHER_CUSTOMER_ID to a customer with real data and re-run.",
    );
    process.exit(3);
  }

  console.log("--- A JWT cross-tenant probe (anon + Bearer token, filter B customer_id) ---");

  let failed = 0;
  for (const table of TABLES) {
    const bHas = bCounts[table.name] ?? 0;
    const { data, error } = await table.jwtQuery(userSupabase, otherCustomerId);
    if (error) {
      console.log(`FAIL ${table.name} — JWT query error: ${error.message} (B_has=${bHas})`);
      failed += 1;
      continue;
    }
    const jwtCount = (data ?? []).length;
    if (jwtCount > 0) {
      console.log(`FAIL ${table.name} — A JWT sees ${jwtCount} row(s) (B_has=${bHas})`);
      failed += 1;
    } else {
      console.log(`PASS ${table.name} — A JWT sees 0 rows (B_has=${bHas})`);
    }
  }

  if (failed > 0) {
    console.log(`L2 STOP — ${failed} table(s) leaked cross-tenant data`);
    process.exit(1);
  }

  console.log(
    "L2 PASS — B_has_rows>0 (evidence tables) AND A_JWT_sees_0 on all 6 tables for same B customer_id",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
