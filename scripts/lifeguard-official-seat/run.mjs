#!/usr/bin/env node
/**
 * lifeguard-official-seat — official KEY Human Seat runner (harness only).
 * KEY product code must not change for this tool.
 *
 * ONE_COMMAND examples:
 *   npm run seat:official -- --target production --suite a1-a2 --source 731ddae --deployment-id dpl_... --resume-from seat
 *   npm run seat:official -- --target preview --suite a1-a2 --source 731ddae --url https://....vercel.app --deployment-id dpl_...
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultUrlForTarget,
  loadEnvLocal,
  PRODUCTION_ALIAS,
} from "./lib/env.mjs";
import { ensurePlaywright, runPreflight } from "./lib/preflight.mjs";
import { runSeatEngine } from "./lib/seat-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

function parseArgs(argv) {
  const out = {
    target: "",
    suite: "a1-a2",
    source: "",
    deploymentId: "",
    url: "",
    resumeFrom: "seat",
    outDir: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--target") {
      out.target = String(next || "");
      i += 1;
    } else if (a === "--suite") {
      out.suite = String(next || "a1-a2");
      i += 1;
    } else if (a === "--source") {
      out.source = String(next || "");
      i += 1;
    } else if (a === "--deployment-id") {
      out.deploymentId = String(next || "");
      i += 1;
    } else if (a === "--url") {
      out.url = String(next || "");
      i += 1;
    } else if (a === "--resume-from") {
      out.resumeFrom = String(next || "seat");
      i += 1;
    } else if (a === "--out") {
      out.outDir = String(next || "");
      i += 1;
    }
  }
  return out;
}

function loadSuite(suiteId) {
  const path = join(__dirname, "suites", `${suiteId}.json`);
  if (!existsSync(path)) {
    throw new Error(`SUITE_NOT_FOUND:${suiteId}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Never persist raw QA/bypass secrets into .tmp seat artifacts. */
function redactPreflightForReport(pre) {
  if (!pre || typeof pre !== "object") return pre;
  const auth = pre.auth;
  return {
    ...pre,
    bypass: pre.bypass ? "[PRESENT]" : "",
    auth: auth
      ? {
          target: auth.target,
          emailKey: auth.emailKey,
          passwordKey: auth.passwordKey,
          email: auth.email ? "[REDACTED]" : "",
          password: auth.password ? "[PRESENT]" : "",
          allowSignup: auth.allowSignup,
          forbidFallbackKeys: auth.forbidFallbackKeys,
        }
      : undefined,
  };
}

function writeTranscript(outDir, result, suite) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "result.json");
  const mdPath = join(outDir, "full-transcript.md");
  const safe = {
    ...result,
    PREFLIGHT_DETAIL: redactPreflightForReport(result.PREFLIGHT_DETAIL),
  };
  writeFileSync(jsonPath, JSON.stringify(safe, null, 2), "utf8");
  const md = [
    `# lifeguard-official-seat — ${suite.id}`,
    "",
    `- SOURCE_SHA: \`${result.SOURCE_SHA}\``,
    `- DEPLOYMENT_ID: \`${result.DEPLOYMENT_ID}\``,
    `- TARGET: ${result.TARGET}`,
    `- URL: ${result.URL}`,
    `- TEST_COMPLETE: ${result.TEST_COMPLETE}`,
    `- FIRST_BREAK: ${result.FIRST_BREAK}`,
    `- FAIL_DOMAIN: ${result.FAIL_DOMAIN}`,
    `- PREFLIGHT: ${result.PREFLIGHT}`,
    "",
  ];
  if (Array.isArray(result.isolation_events) && result.isolation_events.length) {
    md.push("## ISOLATION_EVENTS");
    md.push("```json");
    md.push(JSON.stringify(result.isolation_events, null, 2));
    md.push("```");
    md.push("");
  }
  for (const t of result.turns || []) {
    md.push(`## ${t.TURN}`);
    if (t.SET_ID) md.push(`SET_ID=${t.SET_ID}`);
    if (t.ISOLATION) md.push(`ISOLATION=${JSON.stringify(t.ISOLATION)}`);
    md.push(`QUESTION=${t.QUESTION}`);
    md.push("FINAL_CUSTOMER_VISIBLE_ANSWER=");
    md.push(t.FINAL_CUSTOMER_VISIBLE_ANSWER || "(empty)");
    md.push("");
  }
  writeFileSync(mdPath, md.join("\n"), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  loadEnvLocal(REPO_ROOT);
  const args = parseArgs(process.argv.slice(2));
  const target = String(args.target || process.env.OKF_TARGET || "").toLowerCase();
  const source =
    String(args.source || process.env.OKF_SOURCE || "").trim() ||
    String(process.env.SOURCE_SHA || "").trim();
  const deploymentId = String(
    args.deploymentId || process.env.OKF_DEPLOYMENT_ID || "",
  ).trim();
  const url =
    String(args.url || process.env.OKF_URL || "").trim() ||
    defaultUrlForTarget(target) ||
    (target === "production" ? PRODUCTION_ALIAS : "");
  const suite = loadSuite(args.suite);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir =
    args.outDir ||
    join(
      REPO_ROOT,
      ".tmp",
      "lifeguard-official-seat",
      `${target}-${suite.id}-${stamp}`,
    );

  const report = {
    RUNNER: "lifeguard-official-seat",
    PRODUCT_CODE_CHANGE: "NO",
    KEY_BEHAVIOR_CHANGE: "NO",
    ONE_COMMAND: "YES",
    SUITE: suite.id,
    RESUME_FROM: args.resumeFrom,
    PREFLIGHT: "NOT_RUN",
    DEPLOY: args.resumeFrom === "seat" ? "SKIPPED_RESUME" : "NOT_RUN",
    INSPECT: "NOT_RUN",
    SEAT: "NOT_RUN",
    turns: [],
  };

  console.log(`RUNNER=lifeguard-official-seat`);
  console.log(`TARGET=${target}`);
  console.log(`SUITE=${suite.id}`);
  console.log(`SOURCE_SHA=${source}`);
  console.log(`DEPLOYMENT_ID=${deploymentId || "(none)"}`);
  console.log(`URL=${url || "(none)"}`);
  console.log(`RESUME_FROM=${args.resumeFrom}`);

  const pw = ensurePlaywright(REPO_ROOT);
  if (pw && typeof pw === "object" && pw.ok === false) {
    report.PREFLIGHT = "FAIL";
    report.FAIL_DOMAIN = "HARNESS";
    report.FIRST_BREAK = pw.error;
    report.PRODUCT_TEST = "NOT_STARTED";
    writeTranscript(outDir, report, suite);
    console.log(`PREFLIGHT=FAIL`);
    console.log(`FIRST_BREAK=${pw.error}`);
    console.log(`FAIL_DOMAIN=HARNESS`);
    process.exit(2);
  }

  const pre = runPreflight({
    repoRoot: REPO_ROOT,
    target,
    sourceSha: source,
    url,
    deploymentId,
    resumeFrom: args.resumeFrom,
    requireDeployMeta: args.resumeFrom === "seat",
  });
  report.PREFLIGHT = pre.PREFLIGHT;
  report.PREFLIGHT_DETAIL = pre;
  if (pre.PREFLIGHT !== "PASS") {
    report.FAIL_DOMAIN = "HARNESS";
    report.FIRST_BREAK = pre.FIRST_BREAK;
    report.PRODUCT_TEST = "NOT_STARTED";
    report.SEAT = "NOT_RUN";
    const paths = writeTranscript(outDir, report, suite);
    console.log(`PREFLIGHT=${pre.PREFLIGHT}`);
    console.log(`LAYER=${pre.LAYER}`);
    console.log(`FIRST_BREAK=${pre.FIRST_BREAK}`);
    console.log(`FAIL_DOMAIN=HARNESS`);
    console.log(`PRODUCT_TEST=NOT_STARTED`);
    console.log(`OUT_JSON=${paths.jsonPath}`);
    process.exit(pre.PREFLIGHT === "HOLD" ? 3 : 2);
  }

  console.log("PREFLIGHT=PASS");
  const seat = await runSeatEngine({
    repoRoot: REPO_ROOT,
    url: pre.url,
    bypass: pre.bypass,
    email: pre.auth.email,
    password: pre.auth.password,
    turns: suite.turns,
    sourceSha: source,
    deploymentId,
    target,
  });

  Object.assign(report, seat, {
    PREFLIGHT: "PASS",
    DEPLOY: report.DEPLOY,
    SEAT: seat.TEST_COMPLETE === "YES" ? "PASS" : "FAIL",
    SUITE: suite.id,
    RUNNER: "lifeguard-official-seat",
    PRODUCT_CODE_CHANGE: "NO",
    KEY_BEHAVIOR_CHANGE: "NO",
    ONE_COMMAND: "YES",
  });

  const paths = writeTranscript(outDir, report, suite);
  console.log(`LOGIN=${seat.LOGIN}`);
  console.log(`COMPOSER=${seat.COMPOSER}`);
  for (const t of seat.turns || []) {
    console.log(`TURN=${t.TURN}`);
    console.log(`QUESTION=${t.QUESTION}`);
    console.log("FINAL_CUSTOMER_VISIBLE_ANSWER:");
    console.log("<<<");
    console.log(t.FINAL_CUSTOMER_VISIBLE_ANSWER || "");
    console.log(">>>");
  }
  console.log(`TEST_COMPLETE=${seat.TEST_COMPLETE}`);
  console.log(`FIRST_BREAK=${seat.FIRST_BREAK}`);
  console.log(`FAIL_DOMAIN=${seat.FAIL_DOMAIN}`);
  console.log(`SEAT=${report.SEAT}`);
  console.log(`OUT_JSON=${paths.jsonPath}`);
  console.log(`OUT_MD=${paths.mdPath}`);

  process.exit(seat.TEST_COMPLETE === "YES" ? 0 : 5);
}

main().catch((e) => {
  console.log(`FAIL_DOMAIN=HARNESS`);
  console.log(`FIRST_BREAK=${String(e?.message || e)}`);
  process.exit(1);
});
