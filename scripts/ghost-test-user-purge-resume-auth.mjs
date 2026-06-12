/**
 * Resume auth.users purge after partial execute (network interruption).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  console.error("BLOCKER: missing credentials");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function countTable(table) {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

async function deleteUserWithRetry(userId, email, preserveUserIds, maxAttempts = 5) {
  if (PRESERVE_EMAILS.includes(String(email).toLowerCase())) {
    throw new Error(`SAFETY: refuse delete preserve ${email}`);
  }
  if (preserveUserIds.has(userId)) {
    throw new Error(`SAFETY: refuse delete preserve id ${userId}`);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return true;
    if (attempt === maxAttempts) return error.message;
    await sleep(500 * attempt);
  }
  return "unknown";
}

console.log("=== Ghost Purge — Resume auth.users ===\n");

const beforeAuth = await listAllAuthUsers();
const preserveUsers = PRESERVE_EMAILS.map((email) => {
  const u = beforeAuth.find((x) => String(x.email).toLowerCase() === email);
  if (!u) throw new Error(`preserve missing: ${email}`);
  return u;
});
const preserveUserIds = new Set(preserveUsers.map((u) => u.id));
const toDelete = beforeAuth.filter((u) => !preserveUserIds.has(u.id));

console.log(`auth.users before resume: ${beforeAuth.length}`);
console.log(`remaining delete targets: ${toDelete.length}`);

let deleted = 0;
const failures = [];
for (let i = 0; i < toDelete.length; i++) {
  const user = toDelete[i];
  const result = await deleteUserWithRetry(user.id, user.email, preserveUserIds);
  if (result === true) {
    deleted += 1;
    if (deleted % 25 === 0) console.log(`progress: ${deleted}/${toDelete.length}`);
  } else {
    failures.push({ email: user.email, id: user.id, error: result });
    console.error(`FAIL ${user.email}: ${result}`);
  }
  if (i % 10 === 9) await sleep(200);
}

const afterAuth = await listAllAuthUsers();
const profilesAfter = await countTable("customer_profiles");
const publicUsersAfter = await countTable("users");

console.log("\n--- Resume result ---");
console.log(`auth deleted this run: ${deleted}/${toDelete.length}`);
console.log(`auth.users after: ${afterAuth.length}`);
console.log(`customer_profiles after: ${profilesAfter}`);
console.log(`public.users after: ${publicUsersAfter}`);
console.log(`failures: ${failures.length}`);

console.log("\nRemaining auth emails:");
for (const u of afterAuth) console.log(`  ${u.email}`);

const report = {
  resumed_at: new Date().toISOString(),
  before_auth: beforeAuth.length,
  deleted_this_run: deleted,
  after_auth: afterAuth.length,
  after_profiles: profilesAfter,
  after_public_users: publicUsersAfter,
  failures,
  remaining_emails: afterAuth.map((u) => u.email),
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join("scripts", "backups");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `ghost-purge-resume-${stamp}.json`), JSON.stringify(report, null, 2));
console.log("\n=== Resume complete ===");
