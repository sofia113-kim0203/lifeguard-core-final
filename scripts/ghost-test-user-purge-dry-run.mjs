/**
 * Ghost/Test User Purge — DRY RUN counts only (no deletes).
 * Preserve: chungmomam@naver.com, hanlove0114@hanmail.net, msham0620@nate.com
 * Delete: sofia113@naver.com + all other accounts
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ENV_LOCAL = ".env.local";

const PRESERVE_EMAILS = [
  "chungmomam@naver.com",
  "hanlove0114@hanmail.net",
  "msham0620@nate.com",
].map((e) => e.toLowerCase());

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}

loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("BLOCKER: missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const batch = data?.users ?? [];
    all.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }
  return all;
}

async function countByCustomerIds(table, customerIds) {
  if (!customerIds.length) return 0;
  let total = 0;
  for (let i = 0; i < customerIds.length; i += 80) {
    const chunk = customerIds.slice(i, i + 80);
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("customer_id", chunk);
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

console.log("=== Ghost/Test User Purge — DRY RUN (no deletes) ===");
console.log(`Preserve (${PRESERVE_EMAILS.length}): ${PRESERVE_EMAILS.join(", ")}`);
console.log("Delete: sofia113@naver.com + all other non-preserve accounts\n");

const authUsers = await listAllAuthUsers();
const preserveUsers = [];
const missingPreserve = [];

for (const email of PRESERVE_EMAILS) {
  const user = authUsers.find((u) => String(u.email ?? "").toLowerCase() === email);
  if (!user) missingPreserve.push(email);
  else preserveUsers.push(user);
}

if (missingPreserve.length) {
  console.warn(`WARN: preserve account(s) not found in auth.users: ${missingPreserve.join(", ")}`);
}

const preserveUserIds = new Set(preserveUsers.map((u) => u.id));
const deleteUsers = authUsers.filter((u) => !preserveUserIds.has(u.id));

const { data: allProfiles, error: profilesError } = await admin
  .from("customer_profiles")
  .select("id, user_id, display_name");
if (profilesError) throw new Error(`customer_profiles list failed: ${profilesError.message}`);

const deleteProfiles = (allProfiles ?? []).filter((p) => !preserveUserIds.has(p.user_id));
const deleteCustomerIds = deleteProfiles.map((p) => p.id);

const sofiaInDelete = deleteUsers.some(
  (u) => String(u.email ?? "").toLowerCase() === "sofia113@naver.com"
);

const authDeleteCount = deleteUsers.length;
const profilesDeleteCount = deleteProfiles.length;
const documentsDeleteCount = await countByCustomerIds("customer_documents", deleteCustomerIds);
const memoryFactsDeleteCount = await countByCustomerIds("customer_memory_facts", deleteCustomerIds);
const analysisJobsDeleteCount = await countByCustomerIds("analysis_jobs", deleteCustomerIds);

console.log("--- Delete targets (dry-run) ---");
console.log(`1. auth.users:              ${authDeleteCount}`);
console.log(`2. customer_profiles:      ${profilesDeleteCount}`);
console.log(`3. customer_documents:     ${documentsDeleteCount}`);
console.log(`4. customer_memory_facts:  ${memoryFactsDeleteCount}`);
console.log(`5. analysis_jobs:          ${analysisJobsDeleteCount}`);

console.log("\n--- Safety checks ---");
console.log(`sofia113@naver.com in delete list: ${sofiaInDelete ? "YES" : "NO"}`);
console.log(`preserve accounts found: ${preserveUsers.length}/${PRESERVE_EMAILS.length}`);
for (const user of preserveUsers) {
  console.log(`  keep: ${user.email} (${user.id})`);
}

console.log("\n--- Totals in DB (reference) ---");
console.log(`auth.users total:         ${authUsers.length}`);
console.log(`customer_profiles total:  ${allProfiles?.length ?? 0}`);

console.log("\nDRY RUN complete — no data was deleted.");
