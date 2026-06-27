/**
 * P7-0 — Sales Director Factory Visibility Audit (measurement only).
 */
import { selectDisplayableAnalysisJob } from "./conversationalBackgroundAnalysisCore.js";

const STORED_FACTORY_KEYS = {
  coverage_gap: "coverage_gap",
  underwriting: "underwriting_risk",
  recommendation: "recommendation",
  design: "insurance_design",
};

function factoryEntry({
  available = false,
  loaded = false,
  used = false,
  record_count = 0,
  source = null,
} = {}) {
  return { available, loaded, used, record_count, source };
}

function isNonEmptyPayload(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

export function countStoredFactoryRecords(factoryKey, payload) {
  if (!isNonEmptyPayload(payload)) return 0;
  if (factoryKey === "coverage_gap") {
    const gaps = payload.coverage_gaps ?? payload.gaps ?? [];
    if (Array.isArray(gaps) && gaps.length > 0) return gaps.length;
    return payload.gap_score != null || payload.overall_severity ? 1 : 0;
  }
  if (factoryKey === "underwriting") {
    const healthItems = payload.health_risk_items ?? [];
    if (Array.isArray(healthItems) && healthItems.length > 0) {
      return healthItems.filter((item) => item?.status !== "none").length || healthItems.length;
    }
    const items = payload.items ?? [];
    if (Array.isArray(items) && items.length > 0) return items.length;
    const risks = payload.risk_factors ?? payload.flags ?? payload.risks ?? [];
    if (Array.isArray(risks) && risks.length > 0) return risks.length;
    return Object.keys(payload).length > 0 ? 1 : 0;
  }
  if (factoryKey === "recommendation") {
    const items = payload.recommendations ?? payload.items ?? payload.products ?? [];
    const top2 = payload.customer_visible_top2 ?? [];
    if (Array.isArray(top2) && top2.length > 0) return top2.length;
    if (Array.isArray(items) && items.length > 0) return items.length;
    return Object.keys(payload).length > 0 ? 1 : 0;
  }
  if (factoryKey === "design") {
    const plans = payload.plans ?? payload.designs ?? payload.items ?? [];
    if (Array.isArray(plans)) return plans.length;
    return Object.keys(payload).length > 0 ? 1 : 0;
  }
  return 0;
}

export function probeStoredFactoryAvailabilityFromJobs(jobs = []) {
  const completed = Array.isArray(jobs) ? jobs : [];
  const displayJob = selectDisplayableAnalysisJob(completed, null);
  const availability = {};

  for (const [factoryKey, resultKey] of Object.entries(STORED_FACTORY_KEYS)) {
    let payload = null;

    for (const job of completed) {
      const candidate = job?.result_json?.[resultKey];
      if (isNonEmptyPayload(candidate)) {
        payload = candidate;
        break;
      }
    }

    const record_count = countStoredFactoryRecords(factoryKey, payload);
    availability[factoryKey] = factoryEntry({
      available: record_count > 0 || isNonEmptyPayload(payload),
      loaded: false,
      used: false,
      record_count,
      source: payload ? "analysis_jobs" : null,
    });
  }

  return {
    jobs_scanned: completed.length,
    display_job_id: displayJob?.id ?? null,
    availability,
  };
}

export async function probeStoredFactoryRecords(userSupabase, customerId) {
  if (!userSupabase || !customerId) {
    return {
      ok: false,
      jobs_scanned: 0,
      display_job_id: null,
      availability: {},
      error: "supabase_or_customer_required",
    };
  }

  const { data, error } = await userSupabase
    .from("analysis_jobs")
    .select("id, status, result_json, created_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return {
      ok: false,
      jobs_scanned: 0,
      display_job_id: null,
      availability: {},
      error: error.message,
    };
  }

  const probe = probeStoredFactoryAvailabilityFromJobs(data ?? []);
  return { ok: true, error: null, ...probe };
}

function snapshotUsed(agentTurn = {}, customerContextBundle = null) {
  const policies = customerContextBundle?.policies ?? agentTurn?.factBundle?.policies ?? [];
  const trace = agentTurn?.trace ?? {};
  return (
    policies.length > 0 &&
    (trace?.tool_brain?.snapshot_insurance_used === true ||
      trace?.conversation_brain?.snapshot_insurance_used === true ||
      agentTurn?.factBundle?.snapshot_tool_used === true ||
      agentTurn?.factBundle?.customer_context_used === true ||
      agentTurn?.responseSource?.startsWith?.("sales_director_") ||
      agentTurn?.responseSource?.startsWith?.("p5_brain_"))
  );
}

function memoryUsed(agentTurn = {}) {
  const trace = agentTurn?.trace ?? {};
  return (
    trace?.conversation_brain?.memory_used === true ||
    trace?.tool_brain?.memory_used === true ||
    agentTurn?.factBundle?.memory_tool_used === true ||
    (agentTurn?.factBundle?.memory_fact_count ?? 0) > 0
  );
}

function engineLoaded(agentTurn = {}, factoryKey, customerContextBundle = null) {
  if (factoryKey === "coverage_gap") {
    return (
      customerContextBundle?.coverageGapContext?.loaded === true ||
      agentTurn?.toolUsed === "gap_audit" ||
      agentTurn?.tomGapLightPath === true
    );
  }
  if (factoryKey === "underwriting") {
    return (
      customerContextBundle?.underwritingRiskContext?.loaded === true ||
      agentTurn?.factBundle?.underwriting_loaded === true
    );
  }
  if (factoryKey === "recommendation") {
    return (
      customerContextBundle?.recommendationContext?.loaded === true ||
      agentTurn?.factBundle?.recommendation_loaded === true
    );
  }
  return false;
}

function engineUsed(agentTurn = {}, factoryKey, customerContextBundle = null) {
  if (factoryKey === "coverage_gap") {
    return (
      agentTurn?.trace?.conversation_brain?.coverage_gap_used === true ||
      agentTurn?.factBundle?.coverage_gap_used === true ||
      agentTurn?.toolUsed === "gap_audit" ||
      agentTurn?.tomGapLightPath === true
    );
  }
  if (factoryKey === "underwriting") {
    return (
      agentTurn?.trace?.conversation_brain?.underwriting_used === true ||
      agentTurn?.factBundle?.underwriting_used === true
    );
  }
  if (factoryKey === "recommendation") {
    return (
      agentTurn?.trace?.conversation_brain?.recommendation_used === true ||
      agentTurn?.factBundle?.recommendation_used === true
    );
  }
  return false;
}

export function buildAnswerEvidence(factoryAudit = {}) {
  return Object.entries(factoryAudit)
    .filter(([, entry]) => entry?.used === true)
    .map(([factoryKey]) => factoryKey);
}

export function findPrimaryFactoryDisconnect(factoryAudit = {}) {
  const priority = ["coverage_gap", "underwriting", "recommendation", "design", "memory", "snapshot"];
  for (const factoryKey of priority) {
    const entry = factoryAudit[factoryKey];
    if (!entry?.available) continue;
    if (!entry.loaded) {
      return {
        factory: factoryKey,
        disconnect: "available_not_loaded",
        available: entry.available,
        loaded: entry.loaded,
        used: entry.used,
        record_count: entry.record_count,
        source: entry.source,
      };
    }
    if (!entry.used) {
      return {
        factory: factoryKey,
        disconnect: "loaded_not_used",
        available: entry.available,
        loaded: entry.loaded,
        used: entry.used,
        record_count: entry.record_count,
        source: entry.source,
      };
    }
  }
  return null;
}

export function classifyFactoryHypothesis(factoryAudit = {}) {
  const engineKeys = ["coverage_gap", "underwriting", "recommendation", "design"];
  const enginesAvailable = engineKeys.filter((key) => factoryAudit[key]?.available === true);
  const enginesLoaded = engineKeys.filter((key) => factoryAudit[key]?.loaded === true);
  const enginesUsed = engineKeys.filter((key) => factoryAudit[key]?.used === true);

  if (enginesAvailable.length === 0) {
    return {
      hypothesis: "B",
      label: "공장 데이터 자체 없음 (analysis_jobs 엔진 패널 미보유)",
      engines_available: enginesAvailable,
      engines_loaded: enginesLoaded,
      engines_used: enginesUsed,
    };
  }

  if (enginesAvailable.length > 0 && enginesLoaded.length === 0) {
    return {
      hypothesis: "A",
      label: "공장 데이터 존재, 영업부장 경로에서 엔진 미로드",
      engines_available: enginesAvailable,
      engines_loaded: enginesLoaded,
      engines_used: enginesUsed,
    };
  }

  if (enginesLoaded.length > 0 && enginesUsed.length === 0) {
    return {
      hypothesis: "A",
      label: "공장 데이터 로드됐으나 답변에 미사용",
      engines_available: enginesAvailable,
      engines_loaded: enginesLoaded,
      engines_used: enginesUsed,
    };
  }

  return {
    hypothesis: "A_partial",
    label: "일부 공장만 연결됨 — 추가 실측 필요",
    engines_available: enginesAvailable,
    engines_loaded: enginesLoaded,
    engines_used: enginesUsed,
  };
}

export function buildSalesDirectorFactoryAudit({
  customerContextBundle = null,
  loadedContext = null,
  agentTurn = null,
  salesDirectorTrace = null,
  storedProbe = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const snapshotSource = salesDirectorTrace?.snapshot_cache_hit
    ? "sales_director_turn_cache"
    : "customer_context_snapshot";

  const audit = {
    snapshot: factoryEntry({
      available: loadedContext?.policies === "present" || policies.length > 0,
      loaded: Boolean(customerContextBundle),
      used: snapshotUsed(agentTurn, customerContextBundle),
      record_count: policies.length,
      source: snapshotSource,
    }),
    memory: factoryEntry({
      available: loadedContext?.memory === "present" || memoryFacts.length > 0,
      loaded: Boolean(customerContextBundle),
      used: memoryUsed(agentTurn),
      record_count: memoryFacts.length,
      source: "customer_memory_facts",
    }),
  };

  for (const factoryKey of Object.keys(STORED_FACTORY_KEYS)) {
    const stored = storedProbe?.availability?.[factoryKey] ?? factoryEntry();
    const bundleGap = customerContextBundle?.coverageGapContext;
    const bundleUw = customerContextBundle?.underwritingRiskContext;
    const bundleRec = customerContextBundle?.recommendationContext;
    audit[factoryKey] = factoryEntry({
      available:
        stored.available === true ||
        (factoryKey === "coverage_gap" && bundleGap?.available === true) ||
        (factoryKey === "underwriting" && bundleUw?.available === true) ||
        (factoryKey === "recommendation" && bundleRec?.available === true),
      loaded: engineLoaded(agentTurn, factoryKey, customerContextBundle),
      used: engineUsed(agentTurn, factoryKey, customerContextBundle),
      record_count:
        factoryKey === "coverage_gap" && bundleGap?.record_count
          ? bundleGap.record_count
          : factoryKey === "underwriting" && bundleUw?.record_count
            ? bundleUw.record_count
            : factoryKey === "recommendation" && bundleRec?.record_count
              ? bundleRec.record_count
              : stored.record_count ?? 0,
      source:
        factoryKey === "coverage_gap" && bundleGap?.source
          ? bundleGap.source
          : factoryKey === "underwriting" && bundleUw?.source
            ? bundleUw.source
            : factoryKey === "recommendation" && bundleRec?.source
              ? bundleRec.source
              : stored.source ?? null,
    });
  }

  const answer_evidence = buildAnswerEvidence(audit);
  const primary_disconnect = findPrimaryFactoryDisconnect(audit);
  const hypothesis = classifyFactoryHypothesis(audit);

  return {
    ...audit,
    answer_evidence,
    primary_disconnect,
    hypothesis: hypothesis.hypothesis,
    hypothesis_label: hypothesis.label,
    probe: {
      ok: storedProbe?.ok !== false,
      jobs_scanned: storedProbe?.jobs_scanned ?? 0,
      display_job_id: storedProbe?.display_job_id ?? null,
      error: storedProbe?.error ?? null,
    },
  };
}
