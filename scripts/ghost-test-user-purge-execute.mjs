/**
 * Ghost/Test User Purge — EXECUTE (real deletes).
 * Preserve: chungmomam@naver.com, hanlove0114@hanmail.net, msham0620@nate.com
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

const CUSTOMER_DATA_TABLES = [
  "customer_document_chunks",
  "document_ingest_traces",
  "document_upload_events",
  "customer_documents",
  "customer_memory_facts",
  "analysis_jobs",
  "customer_conversations",
  "customer_analysis_cache",
  "consultation_traces",
  "consultation_messages",
  "consultations",
  "profile_insurance_policies",
  "profile_health",
  "customer_consents",
  "customer_state_snapshots",
  "customer_monitoring_signals",
  "case_extraction_jobs",
  "notification_events",
  "notification_preferences",
  "dead_letter_jobs",
  "retry_queue",
  "worker_jobs",
  "agent_assignments",
  "outbox_events",
  "claude_result_cache",
  "claude_performance_logs",
];

const ORPHAN_TABLES = [
  ...CUSTOMER_DATA_TABLES,
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

if (!url || !serviceRoleKey) {
  console.error("BLOCKER: missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function assertNotPreserveEmail(email, context) {
  if (PRESERVE_EMAILS.includes(String(email ?? "").toLowerCase())) {
    throw new Error(`SAFETY ABORT: preserve email ${email} in ${context}`);
  }
}

function assertNotPreserveUserId(userId, preserveUserIds, context) {
  if (preserveUserIds.has(userId)) {
    throw new Error(`SAFETY ABORT: preserve user_id ${userId} in ${context}`);
  }
}

function assertNotPreserveCustomerId(customerId, preserveCustomerIds, context) {
  if (preserveCustomerIds.has(customerId)) {
    throw new Error(`SAFETY ABORT: preserve customer_id ${customerId} in ${context}`);
  }
}

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

async function countTable(table, customerIds = null) {
  if (customerIds) {
    if (!customerIds.length) return 0;
    let total = 0;
    for (let i = 0; i < customerIds.length; i += 80) {
      const chunk = customerIds.slice(i, i + 80);
      const { count, error } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .in("customer_id", chunk);
      if (error) {
        if (error.code === "42P01") return null;
        throw new Error(`${table} count failed: ${error.message}`);
      }
      total += count ?? 0;
    }
    return total;
  }
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) {
    if (error.code === "42P01") return null;
    throw new Error(`${table} count failed: ${error.message}`);
  }
  return count ?? 0;
}

async function countOrphans(preserveCustomerIds) {
  const orphans = {};
  for (const table of ORPHAN_TABLES) {
    const total = await countTable(table);
    if (total === null) {
      orphans[table] = null;
      continue;
    }
    if (!preserveCustomerIds.size) {
      orphans[table] = total;
      continue;
    }
    const keep = [...preserveCustomerIds];
    let preserveCount = 0;
    if (table === "users") {
      const preserveUserIds = keep;
      for (let i = 0; i < preserveUserIds.length; i += 80) {
        const chunk = preserveUserIds.slice(i, i + 80);
        const { count, error } = await admin
          .from("users")
          .select("id", { count: "exact", head: true })
          .in("id", chunk);
        if (error) {
          orphans[table] = `error:${error.message}`;
          preserveCount = null;
          break;
        }
        preserveCount += count ?? 0;
      }
    } else {
      for (let i = 0; i < keep.length; i += 80) {
        const chunk = keep.slice(i, i + 80);
        const col = table === "case_extraction_jobs" ? "source_customer_id" : "customer_id";
        const { count, error } = await admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .in(col, chunk);
        if (error) {
          if (error.code === "42P01") {
            orphans[table] = null;
            preserveCount = null;
            break;
          }
          if (error.code === "42703" && col === "source_customer_id") {
            const retry = await admin
              .from(table)
              .select("id", { count: "exact", head: true })
              .in("customer_id", chunk);
            if (retry.error) {
              orphans[table] = `error:${retry.error.message}`;
              preserveCount = null;
              break;
            }
            preserveCount += retry.count ?? 0;
            continue;
          }
          orphans[table] = `error:${error.message}`;
          preserveCount = null;
          break;
        }
        preserveCount += count ?? 0;
      }
    }
    if (preserveCount !== null) orphans[table] = total - preserveCount;
  }
  return orphans;
}

async function deleteByCustomerIds(table, customerIds, preserveCustomerIds) {
  if (!customerIds.length) return 0;
  const col = table === "case_extraction_jobs" ? "source_customer_id" : "customer_id";
  let deleted = 0;
  for (const id of customerIds) assertNotPreserveCustomerId(id, preserveCustomerIds, `${table} delete`);
  for (let i = 0; i < customerIds.length; i += 80) {
    const chunk = customerIds.slice(i, i + 80);
    const { data, error } = await admin.from(table).delete().in(col, chunk).select("id");
    if (error) {
      if (error.code === "42P01" || error.code === "42703") return deleted;
      throw new Error(`${table} delete failed: ${error.message}`);
    }
    deleted += data?.length ?? 0;
  }
  return deleted;
}

async function deleteCustomerProfiles(profileIds, preserveCustomerIds) {
  if (!profileIds.length) return 0;
  let deleted = 0;
  for (const id of profileIds) assertNotPreserveCustomerId(id, preserveCustomerIds, "customer_profiles delete");
  for (let i = 0; i < profileIds.length; i += 80) {
    const chunk = profileIds.slice(i, i + 80);
    const { data, error } = await admin.from("customer_profiles").delete().in("id", chunk).select("id");
    if (error) throw new Error(`customer_profiles delete failed: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

async function deletePublicUsers(userIds, preserveUserIds) {
  if (!userIds.length) return 0;
  let deleted = 0;
  for (const id of userIds) assertNotPreserveUserId(id, preserveUserIds, "public.users delete");
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    const { data, error } = await admin.from("users").delete().in("id", chunk).select("id");
    if (error) throw new Error(`public.users delete failed: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

const report = {
  mode: "EXECUTE",
  started_at: new Date().toISOString(),
  preserve_emails: PRESERVE_EMAILS,
  before: {},
  deleted: {},
  after: {},
  preserve_status: [],
  errors: [],
};

console.log("=== Ghost/Test User Purge — EXECUTE ===\n");

const authUsersBefore = await listAllAuthUsers();
report.before.auth_users = authUsersBefore.length;

const { data: profilesBefore, error: profilesBeforeError } = await admin
  .from("customer_profiles")
  .select("id, user_id, display_name");
if (profilesBeforeError) throw new Error(profilesBeforeError.message);
report.before.customer_profiles = profilesBefore?.length ?? 0;

console.log("--- Step 1: 삭제 전 count ---");
console.log(`auth.users:         ${report.before.auth_users}`);
console.log(`customer_profiles:  ${report.before.customer_profiles}`);

const preserveUsers = [];
for (const email of PRESERVE_EMAILS) {
  const user = authUsersBefore.find((u) => String(u.email ?? "").toLowerCase() === email);
  if (!user) {
    console.error(`BLOCKER: preserve auth user missing: ${email}`);
    process.exit(1);
  }
  preserveUsers.push(user);
}

console.log("\n--- Step 2: 보존 auth.users 확인 ---");
for (const user of preserveUsers) {
  console.log(`OK ${user.email} (${user.id})`);
}

const preserveUserIds = new Set(preserveUsers.map((u) => u.id));
const preserveProfiles = (profilesBefore ?? []).filter((p) => preserveUserIds.has(p.user_id));

console.log("\n--- Step 3: 보존 customer_profiles 확인 ---");
if (preserveProfiles.length !== PRESERVE_EMAILS.length) {
  console.warn(`WARN: preserve profiles ${preserveProfiles.length}/${PRESERVE_EMAILS.length}`);
}
for (const email of PRESERVE_EMAILS) {
  const user = preserveUsers.find((u) => String(u.email).toLowerCase() === email);
  const profile = preserveProfiles.find((p) => p.user_id === user.id);
  console.log(profile ? `OK ${email} customer_id=${profile.id}` : `MISSING profile for ${email}`);
}

const preserveCustomerIds = new Set(preserveProfiles.map((p) => p.id));
const deleteUsers = authUsersBefore.filter((u) => !preserveUserIds.has(u.id));
const deleteUserIds = deleteUsers.map((u) => u.id);
const profilesToDelete = (profilesBefore ?? []).filter((p) => !preserveUserIds.has(p.user_id));
const deleteCustomerIds = profilesToDelete.map((p) => p.id);
const deleteProfileIds = profilesToDelete.map((p) => p.id);

for (const user of deleteUsers) assertNotPreserveEmail(user.email, "deleteUsers list");

console.log("\n--- Step 4: 삭제 대상 목록 ---");
console.log(`delete auth user_ids: ${deleteUserIds.length}`);
console.log(`delete customer_ids:  ${deleteCustomerIds.length}`);
console.log(`sofia113@naver.com in delete list: ${
  deleteUsers.some((u) => String(u.email).toLowerCase() === "sofia113@naver.com") ? "YES" : "NO"
}`);

report.before.documents = await countTable("customer_documents", deleteCustomerIds);
report.before.memory_facts = await countTable("customer_memory_facts", deleteCustomerIds);
report.before.analysis_jobs = await countTable("analysis_jobs", deleteCustomerIds);
report.before.conversations = await countTable("customer_conversations", deleteCustomerIds);

console.log("\n--- Step 5: 고객 데이터 삭제 ---");
for (const table of CUSTOMER_DATA_TABLES) {
  const n = await deleteByCustomerIds(table, deleteCustomerIds, preserveCustomerIds);
  report.deleted[table] = n;
  console.log(`${table}: ${n}`);
}

console.log("\n--- Step 6: customer_profiles 삭제 ---");
report.deleted.customer_profiles = await deleteCustomerProfiles(deleteProfileIds, preserveCustomerIds);
console.log(`customer_profiles: ${report.deleted.customer_profiles}`);

console.log("\n--- Step 7: public.users 삭제 ---");
report.deleted.public_users = await deletePublicUsers(deleteUserIds, preserveUserIds);
console.log(`public.users: ${report.deleted.public_users}`);

console.log("\n--- Step 8: auth.users 삭제 ---");
let authDeleted = 0;
for (const user of deleteUsers) {
  assertNotPreserveEmail(user.email, "auth.admin.deleteUser");
  assertNotPreserveUserId(user.id, preserveUserIds, "auth.admin.deleteUser");
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    report.errors.push({ step: "auth.users", id: user.id, email: user.email, error: error.message });
    console.error(`FAIL ${user.email}: ${error.message}`);
  } else {
    authDeleted += 1;
  }
}
report.deleted.auth_users = authDeleted;
console.log(`auth.users: ${authDeleted}/${deleteUsers.length}`);

const authUsersAfter = await listAllAuthUsers();
const { data: profilesAfter } = await admin
  .from("customer_profiles")
  .select("id, user_id, display_name");

report.after.auth_users = authUsersAfter.length;
report.after.customer_profiles = profilesAfter?.length ?? 0;

console.log("\n--- Step 9–12: 삭제 후 검증 ---");
console.log(`auth.users after:        ${report.after.auth_users}`);
console.log(`customer_profiles after: ${report.after.customer_profiles}`);

const orphans = await countOrphans(preserveCustomerIds);
report.after.orphans = orphans;
const orphanTotal = Object.values(orphans).reduce(
  (sum, v) => (typeof v === "number" ? sum + v : sum),
  0
);
report.after.orphan_total = orphanTotal;

for (const email of PRESERVE_EMAILS) {
  const user = authUsersAfter.find((u) => String(u.email ?? "").toLowerCase() === email);
  const preserveUser = preserveUsers.find((u) => String(u.email).toLowerCase() === email);
  const profile = (profilesAfter ?? []).find((p) => p.user_id === preserveUser?.id);
  const status = {
    email,
    auth: user ? "OK" : "MISSING",
    auth_id: user?.id ?? null,
    profile: profile ? "OK" : "MISSING",
    customer_id: profile?.id ?? null,
    display_name: profile?.display_name ?? null,
  };
  report.preserve_status.push(status);
  console.log(
    `${email}: auth=${status.auth} profile=${status.profile}${profile ? ` (${profile.display_name})` : ""}`
  );
}

console.log("\nauth.users remaining emails:");
for (const u of authUsersAfter) console.log(`  ${u.email} (${u.id})`);

console.log(`\nauth.users final == 3: ${report.after.auth_users === 3 ? "PASS" : "FAIL"}`);
console.log(`customer_profiles final == 3: ${report.after.customer_profiles === 3 ? "PASS" : "FAIL"}`);
console.log(`orphan total: ${orphanTotal}`);

report.completed_at = new Date().toISOString();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join("scripts", "backups");
mkdirSync(backupDir, { recursive: true });
const reportPath = join(backupDir, `ghost-purge-execute-report-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\nReport saved: ${reportPath}`);
console.log("=== 삭제 실행 완료 ===");
