/**
 * P10-4 / P11-2F — KEY eligibility trace fingerprint safety (no network).
 */
import {
  buildKeyEligibilityDebug,
  isKeyTraceRawProfileIdsAllowed,
} from "../server/keyEligibilityTraceDebug.js";
import { parseKeyCustomerAllowlist } from "../server/salesDirectorKeyToolRegistry.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoRawUuid(value, label) {
  if (value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), label);
}

function buildDebugFromEnv({ customerId, env }) {
  const allowlist = parseKeyCustomerAllowlist(env);
  const allowlistProfileIds = allowlist ? [...allowlist] : null;
  const match = allowlist ? allowlist.has(customerId) : null;
  return buildKeyEligibilityDebug({
    customerId,
    allowlistProfileIds,
    match,
    env,
  });
}

function testDefaultFingerprintOnly() {
  const env = {
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "profile-a,profile-b",
    VERCEL_ENV: "preview",
  };
  const debug = buildDebugFromEnv({
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee8002",
    env,
  });

  assert(debug.runtime_profile_id === undefined, "runtime_profile_id forbidden on preview");
  assert(debug.allowlist_entry_ids === undefined, "allowlist_entry_ids forbidden on preview");
  assert(debug.runtime_profile_id_last4 === "8002", "last4 on hit");
  assert(Array.isArray(debug.allowlist_entry_last4), "allowlist last4 array");
  assert(debug.match === false, "match false when uuid not in short ids");
  assertNoRawUuid(JSON.stringify(debug), "preview trace must not contain raw uuid");
}

function testAllowlistMatchFields() {
  const env = {
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "profile-a,profile-b",
  };
  const hit = buildDebugFromEnv({ customerId: "profile-a", env });
  assert(hit.runtime_profile_id_last4 === "le-a", "runtime last4");
  assert(hit.allowlist_entry_last4.includes("le-a"), "allowlist lists entries");
  assert(hit.allowlist_entry_last4.includes("le-b"), "allowlist lists all entries");
  assert(hit.match === true, "match true when id in allowlist");

  const miss = buildDebugFromEnv({ customerId: "profile-c", env });
  assert(miss.runtime_profile_id_last4 === "le-c", "runtime last4 on miss");
  assert(miss.match === false, "match false when id not in allowlist");
}

function testAllowlistInactiveFields() {
  const env = {};
  const row = buildDebugFromEnv({ customerId: "profile-a", env });
  assert(row.runtime_profile_id_last4 === "le-a", "runtime last4 when allowlist off");
  assert(row.allowlist_entry_last4 === null, "allowlist last4 null when inactive");
  assert(row.match === null, "match null when allowlist inactive");
}

function testLocalDebugRawIdsAllowed() {
  const env = {
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "profile-a",
    KEY_TRACE_DEBUG_PROFILE_IDS: "1",
  };
  assert(isKeyTraceRawProfileIdsAllowed(env) === true, "local debug allowed without vercel env");

  const row = buildDebugFromEnv({ customerId: "profile-a", env });
  assert(row.runtime_profile_id === "profile-a", "raw id only in local debug");
  assert(row.allowlist_entry_ids?.[0] === "profile-a", "raw allowlist in local debug");
}

function testPreviewBlocksDebugRawIds() {
  const env = {
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "profile-a",
    KEY_TRACE_DEBUG_PROFILE_IDS: "1",
    VERCEL_ENV: "preview",
  };
  assert(isKeyTraceRawProfileIdsAllowed(env) === false, "preview blocks raw debug ids");

  const row = buildDebugFromEnv({
    customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee8002",
    env,
  });
  assert(row.runtime_profile_id === undefined, "preview omits raw runtime id");
  assert(row.allowlist_entry_ids === undefined, "preview omits raw allowlist");
  assertNoRawUuid(JSON.stringify(row), "preview debug trace has no raw uuid");
}

function testProductionBlocksDebugRawIds() {
  const env = {
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "profile-a",
    KEY_TRACE_DEBUG_PROFILE_IDS: "1",
    VERCEL_ENV: "production",
  };
  assert(isKeyTraceRawProfileIdsAllowed(env) === false, "production blocks raw debug ids");
}

const tests = [
  ["default fingerprint only", testDefaultFingerprintOnly],
  ["allowlist match fields", testAllowlistMatchFields],
  ["allowlist inactive fields", testAllowlistInactiveFields],
  ["local debug raw ids", testLocalDebugRawIdsAllowed],
  ["preview blocks debug raw ids", testPreviewBlocksDebugRawIds],
  ["production blocks debug raw ids", testProductionBlocksDebugRawIds],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`${passed}/${tests.length} PASS`);
