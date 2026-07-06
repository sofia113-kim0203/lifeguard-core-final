/**
 * Advisor-S1 — local read-only audit (Tom mute Advisor/Central → ONE KEY).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOneKeyCoreS1Enabled } from "../server/keyCore/oneKeyCoreFlags.js";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures", "key-judgment-validation-v1", "advisor-s1-local-audit-evidence.json");
const CORE = readFileSync(join(ROOT, "server/conversationalBackgroundAnalysisCore.js"), "utf8");

function auditCentralBrainMuted() {
  const guarded =
    /if \(!oneKeyCoreS1Active && isCentralBrainActive\(env\)\)/.test(CORE) ||
    /!oneKeyCoreS1Active && isCentralBrainActive/.test(CORE);
  return { pass: guarded, central_brain_guarded: guarded };
}

function auditAdvisorBrainMuted() {
  const guarded =
    /!oneKeyCoreS1Active[\s\S]*?shouldActivateAdvisorBrainForClassification/.test(CORE) &&
    /!fastResponse &&[\s\S]*?!oneKeyCoreS1Active/.test(CORE);
  return { pass: guarded, advisor_brain_guarded: guarded };
}

function auditOneKeyWired() {
  const wired =
    CORE.includes("resolveOneKeyCoreConversationalFastResponse") &&
    CORE.includes("runOneKeyCoreTurn") &&
    CORE.includes("oneKeyCoreS1Used");
  return { pass: wired };
}

function auditModulesNotDeleted() {
  const paths = [
    "server/advisorBrain/advisorBrainResponder.js",
    "server/centralBrain/centralBrainOrchestrator.js",
    "server/advisorBrain/advisorAuditLog.js",
  ];
  const present = paths.every((p) => {
    try {
      readFileSync(join(ROOT, p), "utf8");
      return true;
    } catch {
      return false;
    }
  });
  return { pass: present, modules_present: paths };
}

function auditFlagBehavior() {
  return {
    pass: isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "1" }) && !isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "0" }),
    enabled_with_1: isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "1" }),
    disabled_with_0: isOneKeyCoreS1Enabled({ ONE_KEY_CORE_S1: "0" }),
  };
}

const tomChecks = {
  check_1_central_brain_muted_when_one_key: {
    question: "ONE_KEY_CORE_S1 시 Central Brain fast path 차단",
    ...auditCentralBrainMuted(),
  },
  check_2_advisor_brain_muted_when_one_key: {
    question: "ONE_KEY_CORE_S1 시 Advisor Brain fast path 차단",
    ...auditAdvisorBrainMuted(),
  },
  check_3_one_key_wired: {
    question: "conversational-qa → runOneKeyCoreTurn 연결",
    ...auditOneKeyWired(),
  },
  check_4_modules_preserved: {
    question: "advisorBrain/centralBrain/audit 삭제 없음",
    ...auditModulesNotDeleted(),
  },
  check_5_flag_gate: {
    question: "isOneKeyCoreS1Enabled flag 동작",
    ...auditFlagBehavior(),
  },
};

const overallPass = Object.values(tomChecks).every((c) => c.pass === true);

const evidence = {
  schema_version: "advisor-s1-local-audit-v1",
  audit: "advisor_s1_local",
  status: overallPass ? "local_pass · commit_pending" : "local_fail",
  observed_at: new Date().toISOString(),
  tom_checks: tomChecks,
  overall_pass: overallPass,
  tom_one_liner:
    "customer-conversational-qa에서 ONE_KEY_CORE_S1=1이면 Advisor/Central fast path는 mute되고 ONE KEY가 먼저 말한다.",
  forbidden: ["advisor_brain_delete", "central_brain_delete", "db_migration", "customer_conversations_schema"],
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log("advisor-s1-local-audit");
for (const [key, check] of Object.entries(tomChecks)) {
  console.log(`  ${check.pass ? "ok" : "FAIL"} ${key}`);
}
console.log(`\nevidence → ${OUT}`);
console.log(`overall: ${overallPass ? "PASS" : "FAIL"}`);

if (!overallPass) process.exit(1);
