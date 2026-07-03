/**
 * KEY Customer Validation v1 — Preview 30Q batch (Tom Question Bank).
 *
 * Tom designs questions in fixtures/key-customer-validation-v1/question-bank-v1.json
 * Jerry executes only — no PASS declaration.
 *
 * Usage:
 *   node scripts/key-customer-validation-v1-preview-verify.mjs [preview-url]
 *   node scripts/key-customer-validation-v1-preview-verify.mjs [preview-url] --only Q16,Q24,Q25,Q29,Q30
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  probePreviewSse,
  resolvePreviewProbeEnv,
  resolveJudgmentComposeMode,
  resolveKeyComposeConversationPatternId,
} from "./preview-auth-probe-path.mjs";
import {
  assessPersonaStep,
  detectFrictions,
  scoreTomJourney,
} from "./key-persona-v1-journey-checks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BANK_PATH = join(ROOT, "fixtures/key-customer-validation-v1/question-bank-v1.json");
const OUT_DIR = join(ROOT, "fixtures/key-customer-validation-v1");
const OUT_JSON = join(OUT_DIR, "preview-validation-report.json");
const OUT_MD = join(OUT_DIR, "preview-validation-report.md");
const OUT_SLICE_JSON = join(OUT_DIR, "preview-slice-validation-report.json");
const OUT_SLICE_MD = join(OUT_DIR, "preview-slice-validation-report.md");

const REQUIRED_LEVELS = {
  L1: 12,
  L2: 8,
  L3: 6,
  L4: 4,
};

function loadEnvFile(path) {
  loadPreviewProbeEnvFile(path);
}

function bankStepFromQuestion(q) {
  const families = Array.isArray(q.families) ? q.families : [q.domain];
  const isRelationship = families.length === 1 && families[0] === "Relationship";
  const isMixed = q.domain === "Mixed" || families.length >= 2;
  return {
    id: q.id,
    label: q.domain,
    domain: q.domain,
    level: q.level,
    families,
    question: q.question,
    relationshipStep: isRelationship && !isMixed,
    mixed: isMixed,
  };
}

function validateBankStructure(questions) {
  const levelCounts = { L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const q of questions) {
    if (levelCounts[q.level] !== undefined) levelCounts[q.level] += 1;
  }
  const mismatches = Object.entries(REQUIRED_LEVELS)
    .filter(([level, need]) => levelCounts[level] !== need)
    .map(([level, need]) => `${level}: have ${levelCounts[level]}, need ${need}`);
  return {
    total: questions.length,
    levelCounts,
    ok: questions.length === 30 && mismatches.length === 0,
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
    composeMode: resolveJudgmentComposeMode(done),
    patternId: resolveKeyComposeConversationPatternId(done),
    responseSource: done.response_source ?? null,
  };
}

function manualRoleSplitPass(text, step) {
  const frictions = detectFrictions(text, step);
  if (step.relationshipStep && frictions.some((f) => f.id === "relationship_insurance_push")) {
    return false;
  }
  return frictions.length === 0;
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
  let questions = bank.questions ?? [];
  if (onlyFilter) {
    questions = questions.filter((q) => onlyFilter.has(String(q.id).toUpperCase()));
    if (questions.length === 0) {
      console.log("BLOCKED — --only filter matched no questions");
      process.exit(2);
    }
  }

  if (questions.length === 0) {
    console.log("AWAITING_TOM — question bank empty. Tom designs 30 in:");
    console.log(`  ${BANK_PATH}`);
    console.log("Distribution: L1 12 · L2 8 · L3 6 · L4 4 (30 total)");
    process.exit(2);
  }

  const dist = validateBankStructure(onlyFilter ? bank.questions ?? [] : questions);
  if (!onlyFilter && !dist.ok) {
    console.log("BANK_INVALID — structure mismatch:");
    for (const m of dist.mismatches) console.log(`  ${m}`);
    if (dist.total !== 30) console.log(`  total: have ${dist.total}, need 30`);
    process.exit(2);
  }

  const previewBase = String(
    previewArg ?? process.env.PREVIEW_BASE ?? "",
  ).replace(/\/$/, "");
  const probeEnv = resolvePreviewProbeEnv({ previewBase });
  if (!probeEnv.previewBase || !probeEnv.bypass || !probeEnv.supabaseUrl || !probeEnv.supabaseAnon || !probeEnv.email || !probeEnv.password) {
    console.log("BLOCKED — missing PREVIEW_BASE, bypass, Supabase, or QA credentials");
    process.exit(2);
  }

  const token = await mintPreviewProbeJwt(probeEnv);

  console.log(`KEY Customer Validation v1 — Preview ${questions.length}Q${onlyFilter ? ` (--only ${[...onlyFilter].join(",")})` : ""}`);
  console.log(`Preview: ${previewBase}`);

  const stepResults = [];

  for (const q of questions) {
    const stepDef = bankStepFromQuestion(q);
    const probe = await probePreviewSse({
      previewBase,
      token,
      question: q.question,
      history: [],
      bypassSecret: probeEnv.bypass,
    });

    if (!probe.probe_ok) {
      stepResults.push({
        ...q,
        probe_ok: false,
        probe_error: probe.probe_error ?? (probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status}`),
        persona: { pass: false, frictions: [{ id: "probe_failed", why: "Preview 실패" }] },
      });
      console.log(`OBSERVE ${q.id} probe_failed`);
      continue;
    }

    const extracted = extractAnswer(probe.events);
    const persona = assessPersonaStep({
      step: stepDef,
      answerText: extracted.answerText,
      composeMode: extracted.composeMode,
      patternId: extracted.patternId,
      ruleId: null,
    });
    const manualRoleSplit = manualRoleSplitPass(extracted.answerText, stepDef);

    stepResults.push({
      ...q,
      probe_ok: true,
      ...extracted,
      answer_preview: extracted.answerText.slice(0, 220),
      persona,
      manual_role_split_pass: manualRoleSplit,
    });

    const frictionNote =
      persona.frictions?.length > 0
        ? ` friction=${persona.frictions.map((f) => f.id).join(",")}`
        : "";
    console.log(`OBSERVE ${q.id} ${q.level} ${q.domain}${frictionNote}`);
  }

  const tomScore = scoreTomJourney(stepResults);
  const manualRoleHits = stepResults.filter((r) => r.manual_role_split_pass).length;

  mkdirSync(OUT_DIR, { recursive: true });
  const outJson = onlyFilter ? OUT_SLICE_JSON : OUT_JSON;
  const outMd = onlyFilter ? OUT_SLICE_MD : OUT_MD;
  const report = {
    audit: onlyFilter ? "key_customer_validation_v1_preview_slice" : "key_customer_validation_v1_preview",
    only_filter: onlyFilter ? [...onlyFilter] : null,
    bank_id: bank.id,
    bank_version: bank.version,
    preview_base: previewBase,
    observed_at: new Date().toISOString(),
    note: "Observation only — Tom Audit. Jerry does not declare COMPLETE.",
    tom_score_automated: tomScore.scores,
    manual_role_split: `${manualRoleHits}/${stepResults.length}`,
    level_distribution: dist.levelCounts,
    steps: stepResults,
  };
  writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md = [
    "# KEY Customer Validation v1 — Preview Report",
    "",
    `Preview: ${previewBase}`,
    `Questions: ${questions.length}`,
    "",
    "## Tom Score (automated)",
    "",
    `- Identity: ${tomScore.scores.same_key}`,
    `- Trust: ${tomScore.scores.trust}`,
    `- Continuity: ${tomScore.scores.continuity}`,
    `- Role Split (auto): ${tomScore.scores.role_split}`,
    `- Role Split (manual text): ${manualRoleHits}/${stepResults.length}`,
    `- Friction: ${tomScore.scores.friction}`,
    "",
    "## Questions",
    "",
    ...stepResults.map(
      (r) =>
        `### ${r.id} [${r.level}] ${r.domain}\n- Q: ${r.question}\n- A: ${r.answer_preview ?? r.probe_error ?? ""}\n`,
    ),
  ].join("\n");
  writeFileSync(outMd, md, "utf8");

  console.log("\n--- Tom Score ---");
  console.log(JSON.stringify(tomScore.scores, null, 2));
  console.log(`Manual Role Split: ${manualRoleHits}/${stepResults.length}`);
  console.log(`Wrote ${outJson}`);

  const anyFriction = tomScore.frictions.length > 0;
  const anyProbeFail = stepResults.some((r) => !r.probe_ok);
  process.exit(anyProbeFail || anyFriction ? 1 : 0);
}

await main();
