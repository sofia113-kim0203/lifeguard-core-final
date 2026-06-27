/**
 * L2 helper — find another customer_id with evidence rows (service-role, setup only).
 * Run manually when auto-picked B has empty evidence tables.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const selfId = String(process.env.P6_L2_SELF_CUSTOMER_ID ?? "284020a8-7bcb-40d6-9b0d-15ff3aca998f").trim();
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const key = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function countRows(admin, table, customerId, { deletedOnly = false } = {}) {
  let query = admin.from(table).select("id", { count: "exact", head: true }).eq("customer_id", customerId);
  if (deletedOnly) query = query.is("deleted_at", null);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  if (!url || !key) {
    console.log("SKIP — missing Supabase URL or service role key");
    process.exit(2);
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profiles, error } = await admin
    .from("customer_profiles")
    .select("id, display_name")
    .neq("id", selfId)
    .is("deleted_at", null)
    .limit(50);

  if (error) {
    console.log(`FAIL — ${error.message}`);
    process.exit(1);
  }

  for (const profile of profiles ?? []) {
    const conversations = await countRows(admin, "customer_conversations", profile.id);
    const policies = await countRows(admin, "active_profile_insurance_policies", profile.id);
    const documents = await countRows(admin, "customer_documents", profile.id, { deletedOnly: true });
    if (conversations > 0 || policies > 0 || documents > 0) {
      console.log(
        JSON.stringify({
          customer_id: profile.id,
          display_name: profile.display_name,
          conversations,
          policies,
          documents,
        }),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
