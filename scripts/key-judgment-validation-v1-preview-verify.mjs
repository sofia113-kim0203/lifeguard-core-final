/**
 * KEY Judgment Validation v1 — Preview judgment utilization batch.
 *
 * Tom designs / freezes fixtures/key-judgment-validation-v1/judgment-bank-v1.json
 * Jerry executes only — observation report, no PASS declaration.
 *
 * Usage:
 *   node scripts/key-judgment-validation-v1-preview-verify.mjs [preview-url]
 *   node scripts/key-judgment-validation-v1-preview-verify.mjs [preview-url] --only J04,J07
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  fetchBypassSse,
  parseSse,
  resolveBypassSecret,
} from "./p10-5-preview-curl-helper.mjs";
import {
  assessJudgmentStep,
  aggregateJudgmentValidation,
} from "./key-judgment-validation-v1-checks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BANK_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/judgment-bank-v1.json");
const RUBRIC_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/judgment-rubric-v1.json");
const OUT_DIR = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT_JSON = join(OUT_DIR, "preview-judgment-validation-report.json");
const OUT_MD = join(OUT_DIR, "preview-judgment-validation-report.md");
const OUT_SLICE_JSON = join(OUT_DIR, "preview-judgment-slice-report.json");

const AXIS_COUNTS = {
  memory: 3,
  coverage_gap: 3,
  underwriting: 3,
  recommendation: 3,
};

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

function validateBankStructure(questions) {
  const axisCounts = { memory: 0, coverage_gap: 0, underwriting: 0, recommendation: 0 };
  for (const q of questions) {
    if (axisCounts[q.axis] !== undefined) axisCounts[q.axis] += 1;
  }
  const mismatches = Object.entries(AXIS_COUNTS)
    .filter(([axis, need]) => axisCounts[axis] !== need)
    .map(([axis, need]) => `${axis}: have ${axisCounts[axis]}, need ${need}`);
  return {
    total: questions.length,
    axisCounts,
    ok: questions.length === 12 && mismatches.length === 0,
    mismatches,
  };
}

function extractAnswer(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    factoryAudit: done.sales_director_factory_audit ?? null,
    judgmentAudit: done.sales_director_judgment_audit ?? null,
    answerEvidence:
      done.answer_evidence ?? done.sales_director_factory_audit?.answer_evidence ?? [],
    responseSource: done.response_source ?? null,
    composeMode: done.sales_director_trace?.finalize_trace?.key_compose_trace?.compose_mode ?? null,
  };
}

function parseOnlyFilter(argv = []) {
  const onlyIdx = argv.indexOf("--only");
  if (onlyIdx < 0) return null;
  const raw = String(argv[onlyIdx + 1] ?? "").trim();
  if (!raw) return null;
  return new Set(raw.split(/[,\s]+/).map((id) => id.trim().toUpperCase()).filter(Boolean));
}

function parseCliArgs(argv = []) {
  const onlyFilter = parseOnlyFilter(argv);
  let previewBase = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--only") {
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !previewBase) {
      previewBase = arg;
    }
  }
  return { previewBase, onlyFilter };
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));

  const argv = process.argv.slice(2);
  const { previewBase: previewArg, onlyFilter } = parseCliArgs(argv);

  const bank = JSON.parse(readFileSync(BANK_PATH, "utf8"));
  const rubric = JSON.parse(readFileSync(RUBRIC_PATH, "utf8"));
  let questions = bank.questions ?? [];
  if (onlyFilter) {
    questions = questions.filter((q) => onlyFilter.has(String(q.id).toUpperCase()));
    if (questions.length === 0) {
      console.log("BLOCKED — --only filter matched no questions");
      process.exit(2);
    }
  }

  if (questions.length === 0) {
    console.log("AWAITING_TOM — judgment bank empty:");
    console.log(`  ${BANK_PATH}`);
    console.log("Distribution: memory 3 · coverage_gap 3 · underwriting 3 · recommendation 3 (12 total)");
    process.exit(2);
  }

  if (bank.status === "draft_tom_review" && !onlyFilter) {
    console.log("NOTE — judgment bank status=draft_tom_review. Tom freeze recommended before baseline gate.");
  }

  const dist = validateBankStructure(onlyFilter ? bank.questions ?? [] : questions);
  if (!onlyFilter && !dist.ok) {
    console.log("BANK_INVALID — structure mismatch:");
    for (const m of dist.mismatches) console.log(`  ${m}`);
    if (dist.total !== 12) console.log(`  total: have ${dist.total}, need 12`);
    process.exit(2);
  }

  const previewBase = String(previewArg ?? process.env.PREVIEW_BASE ?? "").replace(/\/$/, "");
  const bypass = resolveBypassSecret();
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const email = process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "";
  const password = process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "";

  if (!previewBase || !bypass || !supabaseUrl || !supabaseAnon || !email || !password) {
    console.log("BLOCKED — missing PREVIEW_BASE, bypass, Supabase, or QA credentials");
    process.exit(2);
  }

  const { data: auth, error: authError } = await createClient(supabaseUrl, supabaseAnon).auth.signInWithPassword({
    email,
    password,
  });
  if (authError || !auth.session?.access_token) {
    console.log(`BLOCKED — auth failed: ${authError?.message ?? "no token"}`);
    process.exit(2);
  }
  const token = auth.session.access_token;

  console.log(
    `KEY Judgment Validation v1 — Preview ${questions.length}Q${onlyFilter ? ` (--only ${[...onlyFilter].join(",")})` : ""}`,
  );
  console.log(`Preview: ${previewBase}`);
  console.log("Observation only — judgment utilization. Jerry does not declare PASS.\n");

  const stepResults = [];

  for (const q of questions) {
    const probe = await fetchBypassSse({
      previewBase,
      token,
      question: q.question,
      history: [],
      bypassSecret: bypass,
    });

    if (!probe.ok) {
      stepResults.push({
        ...q,
        probe_ok: false,
        probe_error: probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status}`,
      });
      console.log(`OBSERVE ${q.id} probe_failed`);
      continue;
    }

    const extracted = extractAnswer(parseSse(probe.stdout));
    const assessment = assessJudgmentStep({
      id: q.id,
      axis: q.axis,
      question: q.question,
      answerText: extracted.answerText,
      factoryAudit: extracted.factoryAudit,
      judgmentAudit: extracted.judgmentAudit,
      answerEvidence: extracted.answerEvidence,
    });

    stepResults.push({
      ...q,
      probe_ok: true,
      ...extracted,
      answer_preview: extracted.answerText.slice(0, 220),
      ...assessment,
    });

    const util = assessment.utilization?.level ?? "?";
    const note = assessment.notes?.length ? ` notes=${assessment.notes.join(",")}` : "";
    console.log(`OBSERVE ${q.id} ${q.axis} util=${util}${note}`);
  }

  const aggregate = aggregateJudgmentValidation(stepResults);

  mkdirSync(OUT_DIR, { recursive: true });
  const outJson = onlyFilter ? OUT_SLICE_JSON : OUT_JSON;
  const report = {
    audit: onlyFilter ? "key_judgment_validation_v1_preview_slice" : "key_judgment_validation_v1_preview",
    only_filter: onlyFilter ? [...onlyFilter] : null,
    bank_id: bank.id,
    bank_version: bank.version,
    bank_status: bank.status,
    rubric_id: rubric.id,
    preview_base: previewBase,
    observed_at: new Date().toISOString(),
    note: "Observation only — Tom Audit. Jerry does not declare COMPLETE.",
    parallel_gate: rubric.parallel_gate,
    aggregate,
    steps: stepResults,
  };
  writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md = [
    "# KEY Judgment Validation v1 — Preview Report",
    "",
    `Preview: ${previewBase}`,
    `Questions: ${questions.length}`,
    `Bank status: ${bank.status}`,
    "",
    "## Aggregate",
    "",
    `- Probe OK: ${aggregate.probe_ok}`,
    `- Disconnect count: ${aggregate.disconnect_count}`,
    `- By axis: ${JSON.stringify(aggregate.by_axis)}`,
    "",
    "## Questions",
    "",
    ...stepResults.map(
      (r) =>
        `### ${r.id} [${r.axis}] util=${r.utilization?.level ?? "?"}\n- Q: ${r.question}\n- A: ${r.answer_preview ?? r.probe_error ?? ""}\n- Factory: ${JSON.stringify(r.utilization?.factory ?? {})}\n`,
    ),
  ].join("\n");
  writeFileSync(OUT_MD, md, "utf8");

  console.log("\n--- Aggregate ---");
  console.log(JSON.stringify(aggregate, null, 2));
  console.log(`Wrote ${outJson}`);

  const anyProbeFail = stepResults.some((r) => !r.probe_ok);
  process.exit(anyProbeFail ? 1 : 0);
}

await main();
