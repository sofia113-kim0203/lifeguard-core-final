/**
 * Triangle v2.2 T2 — READY CARD assembly from existing SSOT loaders (parallel).
 * Not a new truth DB. No Claude call. No Presence.
 * T5 — LIFE THREAD brief may ride on important_history (remember only; do not ask first).
 */

import {
  readReadyCardCache,
  writeReadyCardCache,
  READY_CARD_CACHE_TTL_MS,
} from "./keyReadyCardCache.js";
import { openReadyCardHandoff } from "./keyReadyCardHandoff.js";
import {
  formatLifeThreadsForReadyCard,
  loadCustomerLifeThreadsFromConversations,
  selectActiveLifeThreads,
} from "./keyLifeThread.js";

export const READY_CARD_VERSION = "triangle-ready-card-v2.2";

/**
 * T5.1 — always overlay active LIFE THREADS from conversations onto a READY CARD.
 * Breaks login_handoff / memory_cache stale reuse that skipped DB life_threads.
 */
export async function attachActiveLifeThreadsToReadyCard({
  card = null,
  userSupabase = null,
  customerId = null,
  loadLifeThreads = loadCustomerLifeThreadsFromConversations,
} = {}) {
  if (!card || typeof card !== "object") {
    return { card, active_count: 0, reason: "no_card" };
  }
  const cid = String(customerId ?? card.customer_id ?? "").trim();
  if (!cid || !userSupabase) {
    return { card, active_count: 0, reason: "missing_scope" };
  }
  const loaded = await loadLifeThreads({
    supabase: userSupabase,
    customerId: cid,
  });
  const active = selectActiveLifeThreads(loaded.active ?? loaded.threads ?? [], {
    customerId: cid,
  });
  const brief = formatLifeThreadsForReadyCard(active, {
    limit: 6,
    activeOnly: false,
    customerId: cid,
  });
  const priorObj =
    card.important_history?._prior_object &&
    typeof card.important_history._prior_object === "object"
      ? {
          ...card.important_history._prior_object,
          life_threads: active,
        }
      : {
          related_turns: Array.isArray(card.important_history?.related_turns)
            ? card.important_history.related_turns
            : [],
          open_goals: Array.isArray(card.important_history?.open_goals)
            ? card.important_history.open_goals
            : [],
          open_tasks: Array.isArray(card.important_history?.open_tasks)
            ? card.important_history.open_tasks
            : [],
          life_threads: active,
          note: "prior_consultation_reference_only_not_verified_fact",
        };
  const next = {
    ...card,
    important_history: {
      ...(card.important_history && typeof card.important_history === "object"
        ? card.important_history
        : {}),
      life_threads: brief,
      _prior_object: priorObj,
    },
  };
  return {
    card: next,
    active_count: active.length,
    reason: loaded.reason ?? "ok",
  };
}

function profileBriefFromContexts({
  loadedContext = null,
  unifiedState = null,
  customerContextBundle = null,
} = {}) {
  const profile =
    loadedContext?.profile ??
    unifiedState?.profile ??
    customerContextBundle?.profile ??
    null;
  const display =
    profile?.display_name ??
    profile?.name ??
    loadedContext?.display_name ??
    unifiedState?.profile?.display_name ??
    null;
  return {
    display_name: display != null ? String(display).trim().slice(0, 80) || null : null,
    has_profile: Boolean(profile || display),
    memory_version: Number(
      unifiedState?.memory_version ??
        profile?.memory_version ??
        loadedContext?.memory_version ??
        0,
    ) || 0,
  };
}

function briefPolicies(policies = []) {
  return (Array.isArray(policies) ? policies : [])
    .slice(0, 24)
    .map((p) => ({
      id: p?.id != null ? String(p.id) : null,
      insurer_name: p?.insurer_name ?? null,
      product_name: p?.product_name ?? null,
      policy_type: p?.policy_type ?? null,
      is_active: p?.is_active !== false,
      policy_status: p?.policy_status ?? null,
      coverage_summary:
        typeof p?.coverage_summary === "string"
          ? p.coverage_summary.slice(0, 240)
          : p?.coverage_summary ?? null,
    }))
    .filter((p) => p.id || p.product_name || p.insurer_name);
}

function briefClaims(cases = []) {
  return (Array.isArray(cases) ? cases : []).slice(0, 8).map((row) => ({
    claim_case_key: row?.claim_case_key ?? null,
    status: row?.status ?? null,
    summary:
      typeof row?.summary === "string"
        ? row.summary.slice(0, 200)
        : row?.medical_event?.event_type
          ? String(row.medical_event.event_type).slice(0, 200)
          : null,
  }));
}

function briefDocuments(docs = []) {
  return (Array.isArray(docs) ? docs : [])
    .slice(0, 40)
    .map((d) => ({
      id: d?.id != null ? String(d.id) : null,
      original_filename: d?.original_filename ?? null,
    }))
    .filter((d) => d.id);
}

function collectUnknowns({
  profileBrief,
  policyCount,
  documentCount,
  goalReason,
  priorReason,
  corporateUnknowns,
} = {}) {
  const unknowns = [];
  if (!profileBrief?.has_profile) unknowns.push("profile_not_linked");
  if (!(Number(policyCount) > 0)) unknowns.push("no_verified_policies");
  if (!(Number(documentCount) > 0)) unknowns.push("no_active_documents");
  if (goalReason === "missing_scope" || goalReason === "query_failed") {
    unknowns.push("goal_lookup_unavailable");
  }
  if (priorReason === "missing_scope" || priorReason === "query_failed") {
    unknowns.push("prior_consultation_unavailable");
  }
  for (const u of Array.isArray(corporateUnknowns) ? corporateUnknowns : []) {
    const label =
      typeof u === "string"
        ? u
        : u?.unknown ?? u?.item ?? null;
    if (label) unknowns.push(String(label).slice(0, 120));
  }
  return [...new Set(unknowns)].slice(0, 24);
}

/**
 * Parallel SSOT fetch → READY CARD. Inject loaders to avoid circular imports.
 */
export async function buildKeyReadyCard({
  userSupabase = null,
  customerId = null,
  sessionId = null,
  authUserId = null,
  loadedContext = null,
  unifiedState = null,
  customerContextBundle = null,
  discardGoal = false,
  extractPoliciesFromContext = null,
  loadLatestSessionGoalFromConversations = null,
  loadLatestActiveCustomerGoalFromConversations = null,
  loadCustomerPriorConsultationForClaude = null,
  loadAllowedCorporateContextsForClaude = null,
  loadKeyActiveClaimCases = null,
  loadActiveCustomerDocuments = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const sid = String(sessionId ?? "").trim() || null;
  const prepared_at = new Date().toISOString();
  const buildStarted = Date.now();

  if (!cid || !userSupabase) {
    return {
      card_version: READY_CARD_VERSION,
      prepared_at,
      status: "miss",
      freshness: {
        memory_version: 0,
        age_ms: 0,
        ttl_ms: READY_CARD_CACHE_TTL_MS,
        reason: "missing_scope",
      },
      profile_brief: { display_name: null, has_profile: false, memory_version: 0 },
      insurance_card: { policy_count: 0, policies: [], claims_brief: [] },
      active_goal: { goal: null, status: null, reason: "missing_scope" },
      important_history: {
        related_turns: [],
        open_goals: [],
        open_tasks: [],
        life_threads: [],
        note: "prior_consultation_reference_only_not_verified_fact",
      },
      document_status: { active_count: 0, documents: [] },
      corporate: {
        corporate_contexts: [],
        corporate_gap_evidence: [],
        corporate_recommendation_candidates: [],
        corporate_unknowns: [],
      },
      unknowns: ["materials_unconnected"],
      materials_connected: false,
      customer_id: cid || null,
      session_id: sid,
      build_ms: Math.max(0, Date.now() - buildStarted),
    };
  }

  const policyExtract =
    typeof extractPoliciesFromContext === "function"
      ? extractPoliciesFromContext({
          loadedContext,
          customerContextBundle,
          unifiedState,
        })
      : { policies: [], policy_count: 0 };

  const [
    sessionGoalLoaded,
    priorLoaded,
    corporateLoaded,
    claimCases,
    activeDocuments,
  ] = await Promise.all([
    discardGoal || !sid || typeof loadLatestSessionGoalFromConversations !== "function"
      ? Promise.resolve({ goal: null, reason: discardGoal ? "discard_requested" : "skipped" })
      : loadLatestSessionGoalFromConversations({
          supabase: userSupabase,
          customerId: cid,
          sessionId: sid,
        }),
    typeof loadCustomerPriorConsultationForClaude === "function"
      ? loadCustomerPriorConsultationForClaude({
          supabase: userSupabase,
          customerId: cid,
          currentSessionId: sid,
        })
      : Promise.resolve({ prior: null, reason: "skipped" }),
    typeof loadAllowedCorporateContextsForClaude === "function"
      ? loadAllowedCorporateContextsForClaude({
          userSupabase,
          customerId: cid,
          authUserId,
        }).catch(() => ({
          corporate_contexts: [],
          corporate_gap_evidence: [],
          corporate_recommendation_candidates: [],
          corporate_unknowns: [],
        }))
      : Promise.resolve({
          corporate_contexts: [],
          corporate_gap_evidence: [],
          corporate_recommendation_candidates: [],
          corporate_unknowns: [],
        }),
    typeof loadKeyActiveClaimCases === "function"
      ? loadKeyActiveClaimCases({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadActiveCustomerDocuments === "function"
      ? loadActiveCustomerDocuments({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
  ]);

  let goal = sessionGoalLoaded?.goal ?? null;
  let goalReason = sessionGoalLoaded?.reason ?? "none";
  if (!goal && !discardGoal && typeof loadLatestActiveCustomerGoalFromConversations === "function") {
    const customerGoal = await loadLatestActiveCustomerGoalFromConversations({
      supabase: userSupabase,
      customerId: cid,
      excludeSessionId: sid,
    });
    if (customerGoal?.goal) {
      goal = customerGoal.goal;
      goalReason = customerGoal.reason;
    }
  }

  const profile_brief = profileBriefFromContexts({
    loadedContext,
    unifiedState,
    customerContextBundle,
  });
  const policies = briefPolicies(policyExtract.policies);
  const policy_count = Number(policyExtract.policy_count) || policies.length;
  const docs = briefDocuments(activeDocuments);
  const claims_brief = briefClaims(claimCases);
  const prior = priorLoaded?.prior && typeof priorLoaded.prior === "object" ? priorLoaded.prior : null;
  const corporate_contexts = Array.isArray(corporateLoaded?.corporate_contexts)
    ? corporateLoaded.corporate_contexts
    : [];
  const corporate_unknowns = Array.isArray(corporateLoaded?.corporate_unknowns)
    ? corporateLoaded.corporate_unknowns
    : [];

  const unknowns = collectUnknowns({
    profileBrief: profile_brief,
    policyCount: policy_count,
    documentCount: docs.length,
    goalReason,
    priorReason: priorLoaded?.reason,
    corporateUnknowns: corporate_unknowns,
  });

  // Connected when any verified/soft SSOT material is present for this customer.
  const lifeThreadCount = Array.isArray(prior?.life_threads) ? prior.life_threads.length : 0;
  const materials_connected =
    policy_count > 0 ||
    docs.length > 0 ||
    claims_brief.length > 0 ||
    Boolean(goal) ||
    Boolean(prior) ||
    lifeThreadCount > 0 ||
    corporate_contexts.length > 0 ||
    profile_brief.has_profile === true;

  const card = {
    card_version: READY_CARD_VERSION,
    prepared_at,
    status: materials_connected ? "normal" : "miss",
    freshness: {
      memory_version: profile_brief.memory_version,
      age_ms: 0,
      ttl_ms: READY_CARD_CACHE_TTL_MS,
      reason: materials_connected ? "built_parallel_ssot" : "materials_unconnected",
    },
    profile_brief,
    insurance_card: {
      policy_count,
      policies,
      claims_brief,
      // Full claim rows kept server-side for Claude-first reuse (not a client dump).
      _active_claim_cases: Array.isArray(claimCases) ? claimCases : [],
    },
    active_goal: {
      goal: goal?.goal ?? null,
      status: goal?.status ?? null,
      updated_at: goal?.updated_at ?? null,
      reason: goalReason,
      _goal_object: goal,
    },
    important_history: prior
      ? {
          related_turns: Array.isArray(prior.related_turns) ? prior.related_turns : [],
          open_goals: Array.isArray(prior.open_goals) ? prior.open_goals : [],
          open_tasks: Array.isArray(prior.open_tasks) ? prior.open_tasks : [],
          life_threads: formatLifeThreadsForReadyCard(
            Array.isArray(prior.life_threads) ? prior.life_threads : [],
            { limit: 6, activeOnly: true, customerId: cid },
          ),
          note: "prior_consultation_reference_only_not_verified_fact",
          _prior_object: prior,
        }
      : {
          related_turns: [],
          open_goals: [],
          open_tasks: [],
          life_threads: [],
          note: "prior_consultation_reference_only_not_verified_fact",
          _prior_object: null,
        },
    document_status: {
      active_count: docs.length,
      documents: docs,
      _active_documents: Array.isArray(activeDocuments) ? activeDocuments : [],
    },
    corporate: {
      corporate_contexts,
      corporate_gap_evidence: Array.isArray(corporateLoaded?.corporate_gap_evidence)
        ? corporateLoaded.corporate_gap_evidence
        : [],
      corporate_recommendation_candidates: Array.isArray(
        corporateLoaded?.corporate_recommendation_candidates,
      )
        ? corporateLoaded.corporate_recommendation_candidates
        : [],
      corporate_unknowns,
    },
    unknowns: materials_connected ? unknowns : [...new Set([...unknowns, "materials_unconnected"])],
    materials_connected,
    customer_id: cid,
    session_id: sid,
    build_ms: Math.max(0, Date.now() - buildStarted),
  };
  return card;
}

export async function warmAndStoreKeyReadyCard(args = {}) {
  const built = await buildKeyReadyCard(args);
  const cid = String(args.customerId ?? "").trim();
  const sid = String(args.sessionId ?? "").trim() || null;
  // T5.1 — seal/handoff must carry active life_threads, not a pre-thread warm snapshot.
  const attached = await attachActiveLifeThreadsToReadyCard({
    card: built,
    userSupabase: args.userSupabase ?? null,
    customerId: cid,
    loadLifeThreads:
      args.loadCustomerLifeThreadsFromConversations ||
      loadCustomerLifeThreadsFromConversations,
  });
  const card = attached.card ?? built;
  if (cid && card) {
    writeReadyCardCache(cid, sid, card);
    // Also seed customer-wide slot for login→chat handoff before session settles.
    if (sid) writeReadyCardCache(cid, null, card);
  }
  return {
    ok: true,
    status: card.status,
    prepared_at: card.prepared_at,
    card_version: card.card_version,
    build_ms: card.build_ms,
    materials_connected: card.materials_connected === true,
    customer_id: card.customer_id,
    session_id: card.session_id,
    life_threads_attached_count: attached.active_count ?? 0,
    // Server-only — warm API seals into opaque token; never send plaintext to client.
    card,
  };
}

/**
 * Question-turn resolve: hit/stale reuse; miss → parallel rebuild now.
 * Stale schedules background refresh (non-blocking).
 */
export async function resolveReadyCardForQuestionTurn({
  userSupabase = null,
  customerId = null,
  sessionId = null,
  authUserId = null,
  loadedContext = null,
  unifiedState = null,
  customerContextBundle = null,
  discardGoal = false,
  buildDeps = {},
  backgroundRefresh = true,
  handoffToken = null,
  env = process.env,
} = {}) {
  const resolveStarted = Date.now();
  const warmArgs = {
    userSupabase,
    customerId,
    sessionId,
    authUserId,
    loadedContext,
    unifiedState,
    customerContextBundle,
    discardGoal,
    ...buildDeps,
  };

  let handoffRejectReason = null;
  let tokenValidationMs = null;

  async function finalize(result) {
    const attached = await attachActiveLifeThreadsToReadyCard({
      card: result?.card ?? null,
      userSupabase,
      customerId,
      loadLifeThreads:
        buildDeps.loadCustomerLifeThreadsFromConversations ||
        loadCustomerLifeThreadsFromConversations,
    });
    const card = attached.card ?? result.card;
    const cid = String(customerId ?? "").trim();
    const sid = String(sessionId ?? "").trim() || null;
    // Refresh cache/handoff reuse slot with life_threads overlay (never keep pre-thread card).
    if (cid && card) {
      writeReadyCardCache(cid, sid, card);
      if (sid) writeReadyCardCache(cid, null, card);
    }
    return {
      ...result,
      card,
      life_threads_attached_count: attached.active_count ?? 0,
      life_threads_attach_reason: attached.reason ?? null,
      ready_card_ms: Math.max(0, Date.now() - resolveStarted),
    };
  }

  // T2.1 — opaque login handoff first (cross-instance). Never trust client card JSON.
  if (handoffToken) {
    const opened = openReadyCardHandoff(handoffToken, {
      customerId,
      authUserId,
      sessionId,
      env,
    });
    if (opened.ok) {
      return finalize({
        card: {
          ...opened.card,
          freshness: {
            ...(opened.card.freshness || {}),
            age_ms: 0,
            reason: "login_handoff",
          },
          build_ms: 0,
        },
        ready_card_status: "hit",
        ready_card_ms: Math.max(0, Date.now() - resolveStarted),
        ready_card_build_ms: 0,
        ready_card_source: "login_handoff",
        ready_card_hit: true,
        token_validation_ms: opened.validation_ms,
        token_reject_reason: null,
        reused: true,
      });
    }
    // Fall through to memory / parallel rebuild — do not trust token contents.
    handoffRejectReason = opened.reason ?? "handoff_rejected";
    tokenValidationMs = opened.validation_ms ?? null;
  }

  const cached = readReadyCardCache(customerId, sessionId);

  // Never reuse an unconnected card as hit/stale — rebuild so Claude gets real SSOT.
  const cachedReusable =
    cached.card &&
    cached.card.materials_connected === true &&
    String(cached.card.customer_id ?? "").trim() === String(customerId ?? "").trim();

  if (cached.status === "normal" && cachedReusable) {
    return finalize({
      card: {
        ...cached.card,
        freshness: {
          ...(cached.card.freshness || {}),
          age_ms: cached.age_ms,
          reason: "cache_fresh",
        },
      },
      ready_card_status: "hit",
      ready_card_ms: Math.max(0, Date.now() - resolveStarted),
      ready_card_build_ms:
        typeof cached.card.build_ms === "number" ? cached.card.build_ms : null,
      ready_card_source: "memory_cache",
      ready_card_hit: true,
      token_validation_ms: tokenValidationMs,
      token_reject_reason: handoffRejectReason,
      reused: true,
    });
  }

  if (cached.status === "stale" && cachedReusable) {
    if (backgroundRefresh) {
      void warmAndStoreKeyReadyCard(warmArgs).catch(() => {});
    }
    return finalize({
      card: {
        ...cached.card,
        status: "stale",
        freshness: {
          ...(cached.card.freshness || {}),
          age_ms: cached.age_ms,
          reason: "cache_stale_reuse_as_of_prepared_at",
        },
      },
      ready_card_status: "stale",
      ready_card_ms: Math.max(0, Date.now() - resolveStarted),
      ready_card_build_ms:
        typeof cached.card.build_ms === "number" ? cached.card.build_ms : null,
      ready_card_source: "memory_cache_stale",
      ready_card_hit: true,
      token_validation_ms: tokenValidationMs,
      token_reject_reason: handoffRejectReason,
      reused: true,
    });
  }

  const card = await buildKeyReadyCard(warmArgs);
  return finalize({
    card,
    // Verification vocabulary: miss = was not prewarmed (even if rebuilt now).
    ready_card_status: "miss",
    ready_card_ms: Math.max(0, Date.now() - resolveStarted),
    ready_card_build_ms: card.build_ms ?? null,
    ready_card_source: "rebuilt_miss",
    ready_card_hit: false,
    token_validation_ms: tokenValidationMs,
    token_reject_reason: handoffRejectReason,
    reused: false,
    built_on_miss: true,
  });
}

/** Claude payload slice — status + as-of; never dump full card. */
export function buildReadyCardClaudeMeta(card = null, readyCardStatus = null) {
  if (!card || typeof card !== "object") {
    return {
      status: "miss",
      prepared_at: null,
      card_version: READY_CARD_VERSION,
      materials_connected: false,
      note: "Customer materials are not connected for this turn. Do not invent verified insurance facts.",
    };
  }
  const status =
    readyCardStatus === "stale" || card.status === "stale"
      ? "stale"
      : card.materials_connected === false || card.status === "miss"
        ? "miss"
        : "normal";
  if (status === "miss") {
    return {
      status: "miss",
      prepared_at: card.prepared_at ?? null,
      card_version: card.card_version ?? READY_CARD_VERSION,
      materials_connected: false,
      unknowns: Array.isArray(card.unknowns) ? card.unknowns.slice(0, 12) : [],
      note: "Customer materials are not connected for this turn. Do not invent verified insurance facts. Ask only from the current question and conversation until materials are linked.",
    };
  }
  if (status === "stale") {
    return {
      status: "stale",
      prepared_at: card.prepared_at ?? null,
      card_version: card.card_version ?? READY_CARD_VERSION,
      materials_connected: card.materials_connected === true,
      as_of: card.prepared_at ?? null,
      note: "READY CARD is stale. Treat verified evidence as of prepared_at / as_of. Background refresh is in progress — do not invent newer facts.",
    };
  }
  return {
    status: "normal",
    prepared_at: card.prepared_at ?? null,
    card_version: card.card_version ?? READY_CARD_VERSION,
    materials_connected: true,
    note: "READY CARD prepared from KEY SSOT before this question.",
  };
}

export function materialsFromReadyCard(card = null) {
  if (!card || typeof card !== "object") {
    return {
      ssotGoal: null,
      ssotReason: "ready_card_miss",
      priorConsultation: null,
      priorConsultationReason: "ready_card_miss",
      corporateContexts: [],
      corporateGapEvidence: [],
      corporateRecommendationCandidates: [],
      corporateUnknowns: [],
      activeClaimCases: [],
      activeDocuments: [],
      policies: [],
      policy_count: 0,
    };
  }
  const goalObj = card.active_goal?._goal_object ?? null;
  const priorObj = card.important_history?._prior_object ?? null;
  const policies = Array.isArray(card.insurance_card?.policies)
    ? card.insurance_card.policies
    : [];
  return {
    ssotGoal: goalObj,
    ssotReason: card.active_goal?.reason ?? "ready_card",
    priorConsultation: priorObj,
    priorConsultationReason: priorObj ? "ready_card" : "none",
    corporateContexts: Array.isArray(card.corporate?.corporate_contexts)
      ? card.corporate.corporate_contexts
      : [],
    corporateGapEvidence: Array.isArray(card.corporate?.corporate_gap_evidence)
      ? card.corporate.corporate_gap_evidence
      : [],
    corporateRecommendationCandidates: Array.isArray(
      card.corporate?.corporate_recommendation_candidates,
    )
      ? card.corporate.corporate_recommendation_candidates
      : [],
    corporateUnknowns: Array.isArray(card.corporate?.corporate_unknowns)
      ? card.corporate.corporate_unknowns
      : [],
    activeClaimCases: Array.isArray(card.insurance_card?._active_claim_cases)
      ? card.insurance_card._active_claim_cases
      : [],
    activeDocuments: Array.isArray(card.document_status?._active_documents)
      ? card.document_status._active_documents
      : Array.isArray(card.document_status?.documents)
        ? card.document_status.documents
        : [],
    policies,
    policy_count: Number(card.insurance_card?.policy_count) || policies.length,
  };
}
