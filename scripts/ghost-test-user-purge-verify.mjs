/**
 * Post-purge verification — counts and orphan check.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ENV_LOCAL = ".env.local";
const PRESERVE_EMAILS = [
  "chungmomam@naver.com",
  "hanlove0114@hanmail.net",
  "msham0620@nate.com",
].map((e) => e.toLowerCase());

const ORPHAN_TABLES = [
  "customer_document_chunks",
  "customer_documents",
  "customer_memory_facts",
  "analysis_jobs",
  "customer_conversations",
  "customer_analysis_cache",
  "profile_health",
  "profile_insurance_policies",
  "customer_consents",
  "customer_profiles",
  "users",
];

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
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    all.push(...(data?.users ?? []));
    if ((data?.users?.length ?? 0) < 1000) break;
    page += 1;
  }
  return all;
}

async function countAll(table) {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error?.code === "42P01") return null;
  if (error) return null;
  return count ?? 0;
}

async function countPreserve(table, preserveCustomerIds) {
  if (!preserveCustomerIds.length) return 0;
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .in("customer_id", preserveCustomerIds);
  if (error?.code === "42P01") return null;
  if (error) return `error:${error.message}`;
  return count ?? 0;
}

const authUsers = await listAllAuthUsers();
const preserveCustomerIds = [];
for (const email of PRESERVE_EMAILS) {
  const u = authUsers.find((x) => String(x.email).toLowerCase() === email);
  if (!u) {
    console.log(`PRESERVE MISSING auth: ${email}`);
    continue;
  }
  const { data: p } = await admin
    .from("customer_profiles")
    .select("id, display_name")
    .eq("user_id", u.id)
    .maybeSingle();
  console.log(`${email}: auth=${u.id} profile=${p?.id ?? "MISSING"} name=${p?.display_name ?? "-"}`);
  if (p) preserveCustomerIds.push(p.id);
}

console.log("\n--- Table counts (total / preserve / orphan) ---");
let orphanTotal = 0;
for (const t of ORPHAN_TABLES) {
  const total = await countAll(t);
  if (total === null) {
    console.log(`${t}: N/A`);
    continue;
  }
  if (t === "users") {
    const orphan = total - authUsers.length;
    console.log(`${t}: total=${total} preserve=${authUsers.length} orphan=${orphan}`);
    orphanTotal += Math.max(0, orphan);
    continue;
  }
  if (t === "customer_profiles") {
    const orphan = total - preserveCustomerIds.length;
    console.log(`${t}: total=${total} preserve=${preserveCustomerIds.length} orphan=${orphan}`);
    orphanTotal += Math.max(0, orphan);
    continue;
  }
  const keep = await countPreserve(t, preserveCustomerIds);
  if (typeof keep !== "number") {
    console.log(`${t}: total=${total} preserve=? orphan=? (${keep})`);
    continue;
  }
  const orphan = total - keep;
  console.log(`${t}: total=${total} preserve=${keep} orphan=${orphan}`);
  orphanTotal += Math.max(0, orphan);
}

console.log(`\nauth.users: ${authUsers.length}`);
console.log(`orphan total: ${orphanTotal}`);
console.log(`PASS auth==3: ${authUsers.length === 3}`);
console.log(`PASS profiles==3: ${(await countAll("customer_profiles")) === 3}`);
console.log(`PASS orphan==0: ${orphanTotal === 0}`);
