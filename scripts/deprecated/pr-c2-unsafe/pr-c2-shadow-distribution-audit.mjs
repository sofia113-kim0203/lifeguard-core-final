/**
 * PR-C2 Shadow distribution audit — read-only, statistics only (no PII).
 *
 * Usage (user-scoped, own documents only):
 *   CUSTOMER_BEARER_TOKEN=<jwt> LIMIT=50 node scripts/pr-c2-shadow-distribution-audit.mjs
 *
 * Usage (operator opt-in, cross-customer metadata only):
 *   ALLOW_SERVICE_ROLE_READ=1 LIMIT=50 node scripts/pr-c2-shadow-distribution-audit.mjs
 *
 * Optional filters:
 *   SINCE_ISO=2026-06-13T08:20:00Z
 *   SHADOW_DOC_IDS=uuid1,uuid2
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const LIMIT = Math.max(1, Math.min(500, Number(process.env.LIMIT ?? "50")));
const SINCE_ISO = String(process.env.SINCE_ISO ?? "").trim();
const SHADOW_DOC_IDS = String(process.env.SHADOW_DOC_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_SERVICE_ROLE = process.env.ALLOW_SERVICE_ROLE_READ === "1";

const CHECK_KEYS = [
  "contaminated_field",
  "over_split_suspect",
  "insurer_validity",
  "product_name_present",
];

const QA_EMAIL_CANDIDATES = [
  process.env.QA_EMAIL,
  process.env.PHASE28_TEST_EMAIL,
].filter(Boolean);

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!ALLOW_SERVICE_ROLE && (key === "SERVICE_ROLE_KEY" || key === "SUPABASE_SERVICE_ROLE_KEY")) {
      continue;
    }
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}

function increment(map, key) {
  const normalized = key == null || key === "" ? "(null)" : String(key);
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function rate(fail, applicable) {
  if (!applicable) return null;
  return Number((fail / applicable).toFixed(4));
}

function summarizeCheckRates(counter) {
  const out = {};
  for (const key of CHECK_KEYS) {
    const bucket = counter[key] ?? { fail: 0, applicable: 0, null_or_missing: 0 };
    out[key] = {
      fail_count: bucket.fail,
      applicable_count: bucket.applicable,
      fail_rate: rate(bucket.fail, bucket.applicable),
      null_or_missing_count: bucket.null_or_missing ?? 0,
      null_or_missing_rate: rate(bucket.null_or_missing ?? 0, bucket.applicable),
    };
  }
  return out;
}

export function aggregateShadowDistribution(rows = []) {
  const documentRouteDistribution = {};
  const normalizedDocClassDistribution = {};
  const candidateRouteDistribution = {};
  const checkCounter = Object.fromEntries(
    CHECK_KEYS.map((key) => [key, { fail: 0, applicable: 0, null_or_missing: 0 }]),
  );

  let documentScoreSum = 0;
  let documentScoreCount = 0;
  let documentScoreMin = null;
  let documentScoreMax = null;
  let wouldAutoSaveTotal = 0;
  let actuallyPersistedTotal = 0;
  let persistGreaterThanWouldAuto = 0;
  let persistEqualWouldAuto = 0;
  let persistLessThanWouldAuto = 0;
  let candidateCount = 0;
  let policyCandidateCount = 0;

  for (const row of rows) {
    const pv = row?.metadata_json?.policy_validation;
    if (!pv || typeof pv !== "object") continue;

    increment(documentRouteDistribution, pv.document_route ?? "(null)");

    const normalizedDocClass =
      pv.doc_profile?.normalized_doc_class ??
      pv.doc_profile?.validator_doc_class ??
      pv.summary?.document_type ??
      "(null)";
    increment(normalizedDocClassDistribution, normalizedDocClass);

    if (typeof pv.document_score === "number") {
      documentScoreSum += pv.document_score;
      documentScoreCount += 1;
      documentScoreMin = documentScoreMin == null ? pv.document_score : Math.min(documentScoreMin, pv.document_score);
      documentScoreMax = documentScoreMax == null ? pv.document_score : Math.max(documentScoreMax, pv.document_score);
    }

    const wouldAuto = Number(pv.would_auto_save_count ?? 0);
    const actually = Number(pv.actually_persisted_count ?? 0);
    wouldAutoSaveTotal += wouldAuto;
    actuallyPersistedTotal += actually;
    if (actually > wouldAuto) persistGreaterThanWouldAuto += 1;
    else if (actually === wouldAuto) persistEqualWouldAuto += 1;
    else persistLessThanWouldAuto += 1;

    for (const candidate of pv.candidates ?? []) {
      candidateCount += 1;
      increment(candidateRouteDistribution, candidate.route ?? "(null)");
      if (candidate.source === "review_block") continue;

      policyCandidateCount += 1;
      const checks = candidate.checks ?? {};
      for (const key of CHECK_KEYS) {
        const check = checks[key];
        if (!check || typeof check !== "object") {
          checkCounter[key].null_or_missing += 1;
          continue;
        }
        if (check.applicable === false) continue;
        checkCounter[key].applicable += 1;
        if (check.status === "fail") checkCounter[key].fail += 1;
        if (check.status == null) checkCounter[key].null_or_missing += 1;
      }
    }
  }

  const totalDocuments = rows.filter((row) => row?.metadata_json?.policy_validation).length;

  return {
    total_documents: totalDocuments,
    candidate_count_total: candidateCount,
    policy_candidate_count_total: policyCandidateCount,
    document_route_distribution: documentRouteDistribution,
    candidate_route_distribution: candidateRouteDistribution,
    normalized_doc_class_distribution: normalizedDocClassDistribution,
    document_score: {
      count: documentScoreCount,
      avg: documentScoreCount ? Number((documentScoreSum / documentScoreCount).toFixed(2)) : null,
      min: documentScoreMin,
      max: documentScoreMax,
    },
    would_auto_save_count: {
      total: wouldAutoSaveTotal,
      per_document_avg: totalDocuments ? Number((wouldAutoSaveTotal / totalDocuments).toFixed(2)) : null,
    },
    actually_persisted_count: {
      total: actuallyPersistedTotal,
      per_document_avg: totalDocuments ? Number((actuallyPersistedTotal / totalDocuments).toFixed(2)) : null,
    },
    would_vs_actually_persisted: {
      documents_persist_gt_would_auto: persistGreaterThanWouldAuto,
      documents_persist_eq_would_auto: persistEqualWouldAuto,
      documents_persist_lt_would_auto: persistLessThanWouldAuto,
      total_delta: actuallyPersistedTotal - wouldAutoSaveTotal,
    },
    check_fail_rates: summarizeCheckRates(checkCounter),
    extraction_engine_triage: inferExtractionEngineTriage({
      totalDocuments,
      checkCounter,
      persistGreaterThanWouldAuto,
      documentRouteDistribution,
    }),
  };
}

function inferExtractionEngineTriage({ totalDocuments, checkCounter, persistGreaterThanWouldAuto, documentRouteDistribution }) {
  if (!totalDocuments) {
    return {
      verdict: "INSUFFICIENT_SAMPLE",
      rationale: "policy_validation 문서가 없어 1차 판단 불가",
    };
  }

  const contaminatedFailRate = rate(
    checkCounter.contaminated_field.fail,
    checkCounter.contaminated_field.applicable,
  );
  const overSplitFailRate = rate(
    checkCounter.over_split_suspect.fail,
    checkCounter.over_split_suspect.applicable,
  );
  const productFailRate = rate(
    checkCounter.product_name_present.fail,
    checkCounter.product_name_present.applicable,
  );

  const manualReviewShare =
    (documentRouteDistribution.manual_review ?? 0) / Math.max(1, totalDocuments);
  const autoSaveShare = (documentRouteDistribution.auto_save ?? 0) / Math.max(1, totalDocuments);

  const signals = [];
  if (contaminatedFailRate != null && contaminatedFailRate > 0) {
    signals.push("contaminated_field_fail_present");
  }
  if (productFailRate != null && productFailRate > 0) {
    signals.push("product_name_present_fail_present");
  }
  if (persistGreaterThanWouldAuto > 0) {
    signals.push("shadow_would_not_auto_save_but_persisted");
  }
  if (overSplitFailRate != null && overSplitFailRate === 0) {
    signals.push("over_split_suspect_clean");
  }

  let verdict = "MONITOR";
  let rationale = "Validator safety net appears active; monitor with more samples.";

  if (signals.includes("contaminated_field_fail_present") || signals.includes("shadow_would_not_auto_save_but_persisted")) {
    verdict = "EXTRACTION_ENGINE_IMPROVEMENT_NEEDED";
    rationale =
      "Shadow는 manual_review/reject를 기록하지만 persist가 진행되는 케이스와 contaminated_field fail이 관측됨. Live Gate 전환 전 추출 엔진(필드 오염) 개선 우선.";
  } else if (autoSaveShare > 0.5 && (contaminatedFailRate ?? 0) > 0.1) {
    verdict = "EXTRACTION_ENGINE_IMPROVEMENT_NEEDED";
    rationale = "auto_save 비중 대비 contaminated_field fail 비율이 높음.";
  } else if (manualReviewShare >= 0.5 && !signals.includes("contaminated_field_fail_present")) {
    verdict = "VALIDATOR_ONLY_OK_FOR_NOW";
    rationale = "Shadow 분포상 validator가 보수적으로 라우팅 중이며 hard contamination 신호는 낮음.";
  }

  return { verdict, rationale, signals };
}

async function createReadClient(url, anonKey) {
  const bearer = String(process.env.CUSTOMER_BEARER_TOKEN ?? "").trim();
  if (bearer) {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error("CUSTOMER_BEARER_TOKEN invalid");
    return { client, auth_mode: "customer_bearer_token" };
  }

  const password =
    process.env.QA_PASSWORD ??
    process.env.PHASE28_TEST_PASSWORD ??
    process.env.PHASE28_TEST_PASS ??
    "";

  if (password && QA_EMAIL_CANDIDATES.length) {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const email of [...new Set(QA_EMAIL_CANDIDATES)]) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (!error && data.session?.access_token) {
        return { client, auth_mode: "qa_password_sign_in" };
      }
    }
    throw new Error("qa_password_sign_in_failed");
  }

  if (ALLOW_SERVICE_ROLE) {
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
    if (!serviceRoleKey) throw new Error("ALLOW_SERVICE_ROLE_READ=1 but service role key missing");
    const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    return { client, auth_mode: "service_role_read_opt_in" };
  }

  throw new Error(
    "Auth required: CUSTOMER_BEARER_TOKEN, QA_EMAIL+QA_PASSWORD, or ALLOW_SERVICE_ROLE_READ=1",
  );
}

async function fetchShadowRows(client) {
  const fetchLimit = SHADOW_DOC_IDS.length ? Math.max(LIMIT, SHADOW_DOC_IDS.length) : LIMIT * 5;

  let query = client
    .from("customer_documents")
    .select("id, metadata_json, created_at, updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (SINCE_ISO) query = query.gte("created_at", SINCE_ISO);
  if (SHADOW_DOC_IDS.length) query = query.in("id", SHADOW_DOC_IDS);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => {
      const pv = row?.metadata_json?.policy_validation;
      return pv != null && typeof pv === "object" && Object.keys(pv).length > 0;
    })
    .slice(0, LIMIT);
}

function runSelfTest() {
  const sample = aggregateShadowDistribution([
    {
      metadata_json: {
        policy_validation: {
          document_route: "manual_review",
          document_score: 62,
          would_auto_save_count: 0,
          actually_persisted_count: 1,
          doc_profile: { normalized_doc_class: "insurance_certificate" },
          candidates: [
            {
              route: "manual_review",
              source: "policy",
              checks: {
                contaminated_field: { status: "fail", applicable: true },
                over_split_suspect: { status: "pass", applicable: true },
                insurer_validity: { status: "pass", applicable: true },
                product_name_present: { status: "pass", applicable: true },
              },
            },
          ],
        },
      },
    },
  ]);

  if (sample.total_documents !== 1) throw new Error("self_test_total_documents");
  if (sample.check_fail_rates.contaminated_field.fail_count !== 1) {
    throw new Error("self_test_contaminated_field");
  }
  if (sample.would_vs_actually_persisted.documents_persist_gt_would_auto !== 1) {
    throw new Error("self_test_persist_delta");
  }
  console.log(JSON.stringify({ ok: true, self_test: "passed" }, null, 2));
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  loadEnvLocal();

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");

  const { client, auth_mode } = await createReadClient(url, anonKey);
  const rows = await fetchShadowRows(client);
  const report = {
    ok: true,
    scope: {
      auth_mode,
      limit: LIMIT,
      since_iso: SINCE_ISO || null,
      shadow_doc_ids_count: SHADOW_DOC_IDS.length || null,
      query_columns: ["id", "metadata_json", "created_at", "updated_at"],
      pii_output: false,
    },
    ...aggregateShadowDistribution(rows),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
