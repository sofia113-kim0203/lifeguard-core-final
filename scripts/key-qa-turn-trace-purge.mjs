/**
 * Purge Preview QA turn traces.
 *
 * Usage:
 *   KEY_QA_TURN_RECORDER_PURGE=1 node scripts/key-qa-turn-trace-purge.mjs --trace-id=<id>
 *   KEY_QA_TURN_RECORDER_PURGE=1 node scripts/key-qa-turn-trace-purge.mjs --all-expired
 *   KEY_QA_TURN_RECORDER_PURGE=1 node scripts/key-qa-turn-trace-purge.mjs --customer-hash=<hash>
 *   node scripts/key-qa-turn-trace-purge.mjs --all-expired --dry-run
 *
 * Production Supabase is blocked. Never prints secrets.
 */
import {
  assertSafeTestScriptExecution,
  loadEnvLocal,
  isProductionSupabaseUrl,
  resolveSupabaseUrl,
} from "./lib/productionSafetyGuard.mjs";
import { purgeQaTurnTraces } from "../server/keyCore/keyQaTurnRecorder.js";

loadEnvLocal();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const traceArg = args.find((a) => a.startsWith("--trace-id="));
const hashArg = args.find((a) => a.startsWith("--customer-hash="));
const allExpired = args.includes("--all-expired");

assertSafeTestScriptExecution({
  scriptName: "key-qa-turn-trace-purge",
  createsTestAccount: false,
  usesServiceRoleAuthAdmin: false,
});

if (isProductionSupabaseUrl(resolveSupabaseUrl())) {
  console.error("PURGE_BLOCKED: production Supabase URL");
  process.exit(1);
}

let mode = null;
let traceId = null;
let customerHash = null;
if (traceArg) {
  mode = "trace-id";
  traceId = traceArg.slice("--trace-id=".length).trim();
} else if (hashArg) {
  mode = "customer-hash";
  customerHash = hashArg.slice("--customer-hash=".length).trim();
} else if (allExpired) {
  mode = "all-expired";
} else {
  console.error(
    "Usage: --trace-id=… | --all-expired | --customer-hash=…  [--dry-run]",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  ...(dryRun ? {} : { KEY_QA_TURN_RECORDER_PURGE: process.env.KEY_QA_TURN_RECORDER_PURGE || "1" }),
};

const result = await purgeQaTurnTraces({
  env,
  mode,
  traceId,
  customerHash,
  dryRun,
});

console.log(
  JSON.stringify(
    {
      ok: result.ok === true,
      mode,
      dry_run: dryRun === true || result.dry_run === true,
      deleted: result.deleted ?? 0,
      would_delete: result.would_delete ?? null,
      error: result.error ?? null,
    },
    null,
    2,
  ),
);

process.exit(result.ok === true ? 0 : 1);
