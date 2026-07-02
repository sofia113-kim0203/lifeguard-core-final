/**
 * KEY-GI-1 Phase 0b — GI1-MEASURE classification baseline (READ ONLY).
 * No server mutation · no API · no regression runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  detectCasualChatIntent,
  hasInsuranceTopicSignal,
} from "../server/intentGateLayer.js";
import {
  classifyHomeBrainIntent,
  resolveHomeBrainRoute,
  isCasualHomeQuestion,
  HOME_BRAIN_ROUTES,
} from "../server/homeBrainRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BANK_PATH = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json",
);
const OUT_PATH = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-gi-1-classification-baseline-v1-evidence.json",
);

const INSURANCE_INTENTS = new Set([
  "design_request",
  "design_priority_check",
  "design_review_check",
  "recommendation_request",
  "recommendation_priority_check",
  "underwriting_bound_check",
  "coverage_review_request",
  "coverage_gap_check",
  "claim_eligibility_check",
  "policy_detail",
]);

const SUPPLEMENT_GK = [
  { id: "SUP-01", domain: "과학", q: "태양계 행성 몇 개야" },
  { id: "SUP-02", domain: "역사", q: "한국 독립운동 3·1운동이 뭐야" },
  { id: "SUP-03", domain: "경제", q: "CPI가 뭐야" },
  { id: "SUP-04", domain: "IT", q: "5G와 LTE 차이" },
  { id: "SUP-05", domain: "생활", q: "신발 세탁 방법" },
  { id: "SUP-06", domain: "여행", q: "속초 당일치기 코스" },
  { id: "SUP-07", domain: "맛집", q: "이태원 저녁 맛집" },
  { id: "SUP-08", domain: "건강상식", q: "스트레스 줄이는 방법" },
  { id: "SUP-09", domain: "교육", q: "토익 공부 3개월 계획" },
  { id: "SUP-10", domain: "생활", q: "장마철 빨래 안 마를 때" },
];

function loadBank() {
  return JSON.parse(readFileSync(BANK_PATH, "utf8"));
}

function flattenGk(bank) {
  const rows = [];
  for (const [domain, items] of Object.entries(bank.general_knowledge_90)) {
    for (const item of items) {
      rows.push({ id: item.id, domain, q: item.q, corpus: "gk_bank" });
    }
  }
  for (const item of SUPPLEMENT_GK) {
    rows.push({ id: item.id, domain: item.domain, q: item.q, corpus: "gk_supplement" });
  }
  return rows;
}

function tomIntentBucket(classification, question) {
  const intent = classification.intent;
  if (classification.general_knowledge || classification.matched_rule === "general_knowledge_eligible") {
    return "general_consultation";
  }
  if (intent === "casual_chat") return "casual_chat";
  if (INSURANCE_INTENTS.has(intent)) return "insurance";
  if (intent === "factual_lookup" && hasInsuranceTopicSignal(question)) return "insurance";
  if (intent === "general_consultation" && hasInsuranceTopicSignal(question)) {
    if (classification.companion_cluster) return "insurance";
  }
  if (intent === "general_consultation") return "general_consultation";
  if (intent === "factual_lookup") return "fallback";
  return "fallback";
}

function inferComposePreview(row) {
  const { home_route, is_casual_home, classification, insurance_topic } = row;
  if (home_route === HOME_BRAIN_ROUTES.GAP_GROUNDED) return "gap_compose";
  if (home_route === HOME_BRAIN_ROUTES.FACTUAL_GROUNDED) return "factual_lookup_compose";
  if (home_route === HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER) return "defer";
  if (home_route === HOME_BRAIN_ROUTES.CASUAL_CHAT) {
    if (classification.intent === "casual_chat" && !is_casual_home) return "key_relational_likely";
    if (is_casual_home) return "casual_home_likely_relational_or_chatcore";
    return "casual_route_ambiguous";
  }
  if (insurance_topic) return "insurance_judgment_likely";
  return "unknown";
}

function classifyRow(meta) {
  const question = meta.q;
  const classification = classifyConsultationIntent(question);
  const casualDetect = detectCasualChatIntent(question);
  const homeBrainIntent = classifyHomeBrainIntent(question);
  const homeRoute = resolveHomeBrainRoute(question, classification);
  const casualHome = isCasualHomeQuestion(question, classification);
  const insuranceTopic = hasInsuranceTopicSignal(question);
  const tomBucket = tomIntentBucket(classification, question);

  const row = {
    id: meta.id,
    domain: meta.domain ?? null,
    corpus: meta.corpus,
    question,
    tom_bucket: tomBucket,
    classification: {
      intent: classification.intent,
      matched_rule: classification.matched_rule ?? null,
      companion_cluster: classification.companion_cluster ?? null,
      confidence: classification.confidence ?? null,
    },
    casual_detect_rule: casualDetect?.matched_rule ?? null,
    home_brain_intent: homeBrainIntent,
    home_route: homeRoute,
    is_casual_home: casualHome,
    insurance_topic_signal: insuranceTopic,
  };
  row.compose_preview = inferComposePreview({ ...row, classification: row.classification, insurance_topic: insuranceTopic });
  return row;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function countBy(rows, keyFn) {
  const map = {};
  for (const row of rows) {
    const k = keyFn(row);
    map[k] = (map[k] ?? 0) + 1;
  }
  return map;
}

function analyzeGkMisroutes(gkRows) {
  const misroutes = [];
  for (const row of gkRows) {
    const issues = [];
    if (row.home_route === HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER) {
      issues.push("gk_to_defer");
    }
    if (row.home_route === HOME_BRAIN_ROUTES.GAP_GROUNDED) {
      issues.push("gk_to_gap");
    }
    if (row.tom_bucket === "insurance") {
      issues.push("gk_misclassified_insurance");
    }
    if (row.classification.intent !== "general_consultation" && INSURANCE_INTENTS.has(row.classification.intent)) {
      issues.push("gk_insurance_intent");
    }
    if (!row.is_casual_home && row.home_route !== HOME_BRAIN_ROUTES.FACTUAL_GROUNDED) {
      issues.push("not_casual_home_no_lifeguard_easy_path");
    }
    if (
      row.compose_preview === "defer" ||
      row.compose_preview === "gap_compose" ||
      row.compose_preview === "factual_lookup_compose"
    ) {
      issues.push(`compose_not_gk:${row.compose_preview}`);
    }
    if (issues.length) {
      misroutes.push({
        id: row.id,
        domain: row.domain,
        question: row.question,
        issues,
        tom_bucket: row.tom_bucket,
        intent: row.classification.intent,
        matched_rule: row.classification.matched_rule,
        home_route: row.home_route,
        is_casual_home: row.is_casual_home,
        compose_preview: row.compose_preview,
      });
    }
  }
  return misroutes;
}

function analyzeInsuranceGkLeak(insRows) {
  const leaks = [];
  for (const row of insRows) {
    const issues = [];
    if (row.tom_bucket === "casual_chat") issues.push("insurance_as_casual_chat");
    if (row.is_casual_home && row.tom_bucket !== "insurance") issues.push("insurance_is_casual_home");
    if (row.home_route === HOME_BRAIN_ROUTES.CASUAL_CHAT && row.tom_bucket === "insurance") {
      issues.push("insurance_on_casual_chat_route");
    }
    if (
      row.compose_preview === "casual_home_likely_relational_or_chatcore" &&
      row.tom_bucket === "insurance"
    ) {
      issues.push("insurance_would_hit_gk_compose_preview");
    }
    if (issues.length) {
      leaks.push({
        id: row.id,
        question: row.question,
        issues,
        tom_bucket: row.tom_bucket,
        intent: row.classification.intent,
        matched_rule: row.classification.matched_rule,
        home_route: row.home_route,
        is_casual_home: row.is_casual_home,
        compose_preview: row.compose_preview,
      });
    }
  }
  return leaks;
}

function domainMisrouteSummary(misroutes) {
  const byDomain = {};
  for (const m of misroutes) {
    const d = m.domain ?? "unknown";
    if (!byDomain[d]) byDomain[d] = { count: 0, ids: [], issue_types: {} };
    byDomain[d].count += 1;
    byDomain[d].ids.push(m.id);
    for (const issue of m.issues) {
      byDomain[d].issue_types[issue] = (byDomain[d].issue_types[issue] ?? 0) + 1;
    }
  }
  return byDomain;
}

function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
  const bank = loadBank();
  const gkMeta = flattenGk(bank);
  const insMeta = bank.insurance_regression_20.map((item) => ({
    id: item.id,
    domain: "insurance",
    q: item.q,
    corpus: "insurance_regression",
  }));

  const gkRows = gkMeta.map(classifyRow);
  const insRows = insMeta.map(classifyRow);

  const gkTotal = gkRows.length;
  const gkTomBuckets = countBy(gkRows, (r) => r.tom_bucket);
  const gkHomeRoutes = countBy(gkRows, (r) => r.home_route);
  const gkIntents = countBy(gkRows, (r) => r.classification.intent);
  const gkCompose = countBy(gkRows, (r) => r.compose_preview);
  const gkCasualHome = gkRows.filter((r) => r.is_casual_home).length;

  const domainBucket = {};
  for (const row of gkRows) {
    if (!domainBucket[row.domain]) domainBucket[row.domain] = {};
    domainBucket[row.domain][row.tom_bucket] =
      (domainBucket[row.domain][row.tom_bucket] ?? 0) + 1;
  }

  const misroutes = analyzeGkMisroutes(gkRows);
  const domainMisroutes = domainMisrouteSummary(misroutes);
  const insuranceLeaks = analyzeInsuranceGkLeak(insRows);

  const gkReachLikely = gkRows.filter(
    (r) =>
      r.is_casual_home &&
      r.home_route === HOME_BRAIN_ROUTES.CASUAL_CHAT &&
      r.tom_bucket !== "insurance",
  ).length;

  const evidence = {
    document: "key_gi_1_classification_baseline_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-MEASURE",
    mode: "READ ONLY · classification baseline",
    status: "measured — no PASS declaration",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    exec_plan_ref: "fixtures/key-judgment-validation-v1/key-gi-1-exec-plan-v1-evidence.json",
    input_corpus: {
      gk_count: gkTotal,
      gk_bank: 90,
      gk_supplement: SUPPLEMENT_GK.length,
      insurance_probe_count: insRows.length,
      bank_ref: "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json",
    },
    gk_tom_bucket_distribution: {
      counts: gkTomBuckets,
      percent: Object.fromEntries(
        Object.entries(gkTomBuckets).map(([k, v]) => [k, pct(v, gkTotal)]),
      ),
      total: gkTotal,
    },
    gk_home_route_distribution: {
      counts: gkHomeRoutes,
      percent: Object.fromEntries(
        Object.entries(gkHomeRoutes).map(([k, v]) => [k, pct(v, gkTotal)]),
      ),
    },
    gk_classification_intent_distribution: {
      counts: gkIntents,
      percent: Object.fromEntries(
        Object.entries(gkIntents).map(([k, v]) => [k, pct(v, gkTotal)]),
      ),
    },
    gk_compose_preview_distribution: {
      counts: gkCompose,
      percent: Object.fromEntries(
        Object.entries(gkCompose).map(([k, v]) => [k, pct(v, gkTotal)]),
      ),
    },
    gk_casual_home_rate: {
      count: gkCasualHome,
      percent: pct(gkCasualHome, gkTotal),
      note: "isCasualHomeQuestion true — proxy for lifeguardChatCore easy path today",
    },
    gk_likely_reachable_casual_chat_route: {
      count: gkReachLikely,
      percent: pct(gkReachLikely, gkTotal),
    },
    gk_domain_bucket_matrix: domainBucket,
    gk_misroute_summary: {
      total_misrouted: misroutes.length,
      percent_misrouted: pct(misroutes.length, gkTotal),
      by_domain: domainMisroutes,
    },
    gk_misroute_list: misroutes,
    insurance_gk_leak_summary: {
      total_leaks: insuranceLeaks.length,
      percent_leaks: pct(insuranceLeaks.length, insRows.length),
      note: "insurance questions wrongly appearing GK-eligible (casual_home / casual_chat route)",
    },
    insurance_gk_leak_list: insuranceLeaks,
    gk_rows: gkRows,
    insurance_probe_rows: insRows,
    tom_readout: {
      headline:
        "GK questions mostly general_consultation + CASUAL_CHAT route when regex matches; history/science/economy/IT/education often miss CASUAL_LIFE_TOPIC → defer",
      r2_implication:
        "Expand eligibility beyond CASUAL_LIFE_TOPIC regex — domain gaps visible in misroute list",
      delegation_implication:
        "Even CASUAL_CHAT route questions may hit relational template before lifeguardChatCore (compose preview)",
    },
    jerry: "GI1-MEASURE complete · READ ONLY · no code change · no PASS",
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: OUT_PATH,
    gk_total: gkTotal,
    gk_tom_buckets: gkTomBuckets,
    gk_misrouted: misroutes.length,
    insurance_leaks: insuranceLeaks.length,
  }));
}

main();
