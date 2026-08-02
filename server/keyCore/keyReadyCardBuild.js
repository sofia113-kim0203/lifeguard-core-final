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
import {
  assembleInsuranceClockItemsForHand,
  buildInsuranceClockHandBrief,
  loadInsuranceClockItems,
} from "./keyInsuranceClock.js";
import { loadPolicyDateFacts } from "./keyPolicyDateFacts.js";
import {
  buildClaimEvidenceHandBrief,
  loadClaimEvidenceItems,
} from "./keyClaimEvidenceVault.js";
import {
  buildLifeLedgerHandBrief,
  loadLifeLedgerItems,
} from "./keyLifeLedger.js";
import {
  canLoadCorporateProfileHand,
  loadHolderAuthorityGrants,
} from "../entity/entityAuthorityConsent.js";
import {
  buildKeyLatestDocumentContext,
  loadLatestCommittedKeyDocumentMemory,
  loadLatestCommittedMemoryVersion,
} from "./keyDocumentMemoryCommit.js";

export const READY_CARD_VERSION = "triangle-ready-card-v2.2";

/** T8.1 — official insurer link slot. Default unconnected; no live API / no fake contracts. */
export const INSURER_SOURCE_UNCONNECTED = Object.freeze({
  status: "unconnected",
  as_of: null,
  note: "원수사 공식 데이터가 연결되지 않았습니다.",
});

export function defaultInsurerSource() {
  return {
    status: INSURER_SOURCE_UNCONNECTED.status,
    as_of: INSURER_SOURCE_UNCONNECTED.as_of,
    note: INSURER_SOURCE_UNCONNECTED.note,
  };
}

/**
 * Claude meta slice for insurer_source (status / as_of / note only).
 * Independent of materials_connected (customer materials vs official insurer data).
 */
export function briefInsurerSourceForClaudeMeta(card = null) {
  const raw =
    card?.insurer_source && typeof card.insurer_source === "object"
      ? card.insurer_source
      : null;
  const status = String(raw?.status ?? "unconnected").trim() || "unconnected";
  const as_of =
    status === "unconnected"
      ? null
      : raw?.as_of != null && String(raw.as_of).trim()
        ? String(raw.as_of).trim()
        : null;
  const baseNote =
    typeof raw?.note === "string" && raw.note.trim()
      ? raw.note.trim().slice(0, 400)
      : INSURER_SOURCE_UNCONNECTED.note;
  const note =
    status === "unconnected"
      ? `${baseNote} materials_connected is customer-materials link status only; ` +
        `insurer_source is official insurer-data link status. ` +
        `When insurer_source.status is unconnected, do not say contracts, premiums, or renewal facts were confirmed from the insurer system.`
      : baseNote;
  return { status, as_of, note };
}

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
    .map((p) => {
      const coverage_summary =
        typeof p?.coverage_summary === "string"
          ? p.coverage_summary.slice(0, 240)
          : p?.coverage_summary ?? null;
      const summaryObj =
        coverage_summary && typeof coverage_summary === "object" ? coverage_summary : null;
      // Insurance Clock Slice 1 — only pass through verified date fields (never invent).
      const renewal_date =
        p?.renewal_date ??
        p?.next_renewal_date ??
        summaryObj?.renewal_date ??
        null;
      const maturity_date =
        p?.maturity_date ??
        summaryObj?.maturity_date ??
        null;
      return {
        id: p?.id != null ? String(p.id) : null,
        insurer_name: p?.insurer_name ?? null,
        product_name: p?.product_name ?? null,
        policy_type: p?.policy_type ?? null,
        is_active: p?.is_active !== false,
        policy_status: p?.policy_status ?? null,
        entity_id: p?.entity_id != null ? String(p.entity_id) : null,
        coverage_summary,
        ...(renewal_date ? { renewal_date } : {}),
        // maturity_date only — never alias end_date into maturity.
        ...(maturity_date ? { maturity_date } : {}),
      };
    })
    .filter((p) => p.id || p.product_name || p.insurer_name);
}

function briefClaims(cases = []) {
  return (Array.isArray(cases) ? cases : []).slice(0, 8).map((row) => {
    const medical =
      row?.medical_event && typeof row.medical_event === "object"
        ? row.medical_event
        : {};
    const kind =
      medical.event_kind != null
        ? String(medical.event_kind)
        : medical.event_type != null
          ? String(medical.event_type)
          : null;
    const summary =
      typeof row?.summary === "string"
        ? row.summary.slice(0, 200)
        : kind
          ? kind.slice(0, 200)
          : null;
    return {
      claim_case_key: row?.claim_case_key ?? null,
      // Slice 3 — ownership scope (personal default; corporate requires entity_id).
      claim_scope: row?.claim_scope === "corporate" ? "corporate" : "personal",
      entity_id:
        row?.claim_scope === "corporate" && row?.entity_id
          ? String(row.entity_id).slice(0, 64)
          : null,
      status: row?.status ?? null,
      source: row?.source ?? null,
      // Slice 1C — never imply insurer system confirmation from customer statement.
      insurer_verified: row?.insurer_verified === true,
      outcome_source: row?.source ?? null,
      denial_reason:
        typeof row?.denial_reason === "string"
          ? row.denial_reason.slice(0, 120)
          : null,
      payout_amount_text:
        typeof row?.payout_amount_text === "string"
          ? row.payout_amount_text.slice(0, 40)
          : null,
      summary,
      available_documents: Array.isArray(row?.available_documents)
        ? row.available_documents.slice(0, 12)
        : [],
      missing_documents: Array.isArray(row?.missing_documents)
        ? row.missing_documents.slice(0, 12)
        : [],
      next_action:
        typeof row?.next_action === "string"
          ? row.next_action.slice(0, 200)
          : null,
    };
  });
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
  selectedEntityId = null,
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
  loadInsuranceClockItemsImpl = loadInsuranceClockItems,
  loadPolicyDateFactsImpl = loadPolicyDateFacts,
  loadClaimEvidenceItemsImpl = loadClaimEvidenceItems,
  loadLifeLedgerItemsImpl = loadLifeLedgerItems,
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
      insurance_clock: {
        upcoming: [],
        overdue: [],
        unknown_date: [],
        completed_recent: [],
        packs_separated: true,
        note: "key_owns_dates_claude_explains_only_no_invented_deadlines",
        _items: [],
      },
      claim_evidence: {
        packages: [],
        item_count: 0,
        packs_separated: true,
        note: "key_owns_claim_evidence; claude_explains_only",
        _items: [],
      },
      life_ledger: {
        goals: [],
        decisions: [],
        open_questions: [],
        outcomes: [],
        item_count: 0,
        packs_separated: true,
        note: "key_owns_life_ledger; soft_reference_only; claude_judges_freely",
        _items: [],
      },
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
    storedClocks,
    policyDateFacts,
    claimEvidenceItems,
    lifeLedgerItems,
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
          selectedEntityId,
        }).catch(() => ({
          corporate_contexts: [],
          corporate_gap_evidence: [],
          corporate_recommendation_candidates: [],
          corporate_unknowns: [],
          selected_entity_id: null,
          authorization_denied: false,
        }))
      : Promise.resolve({
          corporate_contexts: [],
          corporate_gap_evidence: [],
          corporate_recommendation_candidates: [],
          corporate_unknowns: [],
          selected_entity_id: null,
          authorization_denied: false,
        }),
    typeof loadKeyActiveClaimCases === "function"
      ? loadKeyActiveClaimCases({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadActiveCustomerDocuments === "function"
      ? loadActiveCustomerDocuments({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadInsuranceClockItemsImpl === "function"
      ? loadInsuranceClockItemsImpl({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadPolicyDateFactsImpl === "function"
      ? loadPolicyDateFactsImpl({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadClaimEvidenceItemsImpl === "function"
      ? loadClaimEvidenceItemsImpl({ supabase: userSupabase, customerId: cid }).catch(() => [])
      : Promise.resolve([]),
    typeof loadLifeLedgerItemsImpl === "function"
      ? loadLifeLedgerItemsImpl({ supabase: userSupabase, customerId: cid }).catch(() => [])
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

  // Insurance Clock Slice 1 — KEY-owned deadlines (stored + projected consent/policy dates).
  const clockItems = assembleInsuranceClockItemsForHand({
    storedClocks,
    corporateContexts: corporate_contexts,
    policies,
    policyDateFacts,
    customerId: cid,
    entityId: corporateLoaded?.selected_entity_id ?? selectedEntityId ?? null,
    mode: "both",
  });
  const insurance_clock = {
    ...buildInsuranceClockHandBrief(clockItems),
    _items: clockItems,
  };
  const claim_evidence = {
    ...buildClaimEvidenceHandBrief({
      cases: claimCases,
      evidenceItems: claimEvidenceItems,
    }),
    _items: Array.isArray(claimEvidenceItems) ? claimEvidenceItems : [],
  };
  const life_ledger = {
    ...buildLifeLedgerHandBrief(lifeLedgerItems),
    _items: Array.isArray(lifeLedgerItems) ? lifeLedgerItems : [],
  };

  // Connected when any verified/soft SSOT material is present for this customer.
  const lifeThreadCount = Array.isArray(prior?.life_threads) ? prior.life_threads.length : 0;
  const clockLiveCount =
    (insurance_clock.upcoming?.length || 0) +
    (insurance_clock.overdue?.length || 0) +
    (insurance_clock.unknown_date?.length || 0);
  const materials_connected =
    policy_count > 0 ||
    docs.length > 0 ||
    claims_brief.length > 0 ||
    (claim_evidence.item_count || 0) > 0 ||
    (life_ledger.item_count || 0) > 0 ||
    clockLiveCount > 0 ||
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
    insurance_clock,
    claim_evidence,
    life_ledger,
    // T8.1 — independent of materials_connected; no live insurer API in this slice.
    insurer_source: defaultInsurerSource(),
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
      selected_entity_id: corporateLoaded?.selected_entity_id ?? null,
      authorization_denied: corporateLoaded?.authorization_denied === true,
      // Personal prior/goal are not corporate-scoped in this slice.
      corporate_conversation_context: {
        prior_status: "unknown",
        goal_status: "unknown",
        note: "no_corporate_scoped_prior_or_goal",
      },
    },
    unknowns: materials_connected ? unknowns : [...new Set([...unknowns, "materials_unconnected"])],
    materials_connected,
    customer_id: cid,
    session_id: sid,
    build_ms: Math.max(0, Date.now() - buildStarted),
    built_from_memory_version: 0,
    recent_document_memory: null,
  };

  try {
    const latestDocMem = await loadLatestCommittedKeyDocumentMemory({
      supabase: userSupabase,
      customerId: cid,
    });
    if (latestDocMem.ok && latestDocMem.row) {
      const ctx = buildKeyLatestDocumentContext(latestDocMem.row);
      card.built_from_memory_version = Number(latestDocMem.row.memory_version) || 0;
      // New session / re-login: reference only — never force prior session active focus.
      card.recent_document_memory = ctx
        ? {
            memory_commit_id: ctx.memory_commit_id,
            memory_version: ctx.memory_version,
            primary_document_id: ctx.primary_document_id,
            read_status: ctx.read_status,
            recorded_at: ctx.recorded_at,
            note: "reference_slot_not_auto_active_focus",
          }
        : null;
    }
  } catch {
    /* non-blocking */
  }
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
 * Handoff reuse gate for KEY document-memory version.
 * - lookup !ok → reject (never treat as fresh version 0)
 * - ok+miss (version 0) → allow reuse when token not stale
 * - ok+hit && tokenVer < dbVer → stale reject
 */
export function evaluateReadyCardHandoffMemoryGate(latestVer, tokenVer = 0) {
  if (!latestVer || latestVer.ok !== true) {
    return {
      reuse_handoff: false,
      reject_reason: "handoff_memory_lookup_failed",
    };
  }
  const dbVer = Number(latestVer.memory_version) || 0;
  const tv = Number(tokenVer) || 0;
  if (dbVer > 0 && tv < dbVer) {
    return {
      reuse_handoff: false,
      reject_reason: "handoff_memory_stale",
    };
  }
  return { reuse_handoff: true, reject_reason: null };
}

export async function resolveReadyCardForQuestionTurn({
  userSupabase = null,
  customerId = null,
  sessionId = null,
  authUserId = null,
  selectedEntityId = null,
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
    selectedEntityId,
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
      let handoffMemoryStale = false;
      let handoffMemoryLookupFailed = false;
      try {
        const latestVer = await loadLatestCommittedMemoryVersion({
          supabase: userSupabase,
          customerId,
        });
        tokenValidationMs = opened.validation_ms ?? null;
        const tokenVer =
          opened.card?.built_from_memory_version == null
            ? 0
            : Number(opened.card.built_from_memory_version) || 0;
        const gate = evaluateReadyCardHandoffMemoryGate(latestVer, tokenVer);
        if (gate.reject_reason === "handoff_memory_lookup_failed") {
          handoffMemoryLookupFailed = true;
          handoffRejectReason = "handoff_memory_lookup_failed";
          console.error("[key_document_memory_version_lookup]", {
            reason: latestVer.reason ?? "query_failed",
            error: latestVer.error ?? null,
            customer_id: customerId ? String(customerId).slice(0, 8) : null,
          });
        } else if (gate.reject_reason === "handoff_memory_stale") {
          handoffMemoryStale = true;
          handoffRejectReason = "handoff_memory_stale";
        }
      } catch (err) {
        handoffMemoryLookupFailed = true;
        handoffRejectReason = "handoff_memory_lookup_failed";
        tokenValidationMs = opened.validation_ms ?? null;
        console.error("[key_document_memory_version_lookup]", {
          reason: "exception",
          error: String(err?.message ?? err).slice(0, 200),
          customer_id: customerId ? String(customerId).slice(0, 8) : null,
        });
      }
      if (!handoffMemoryStale && !handoffMemoryLookupFailed) {
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
      // lookup failed or stale vs KEY document memory version — rebuild; reject token.
    } else {
      // Fall through to memory / parallel rebuild — do not trust token contents.
      handoffRejectReason = opened.reason ?? "handoff_rejected";
      tokenValidationMs = opened.validation_ms ?? null;
    }
  }

  const cached = readReadyCardCache(customerId, sessionId);

  // Never reuse an unconnected card as hit/stale — rebuild so Claude gets real SSOT.
  const cachedReusable =
    cached.card &&
    cached.card.materials_connected === true &&
    String(cached.card.customer_id ?? "").trim() === String(customerId ?? "").trim();

  /**
   * Authority must be revalidated every turn (Insurance Clock Seat C).
   * Cached corporate Hand is invalid once expires_at/revoke removes scopes.
   */
  async function cachedCorporateAuthorityStillValid(card) {
    const contexts = Array.isArray(card?.corporate?.corporate_contexts)
      ? card.corporate.corporate_contexts
      : [];
    if (!contexts.length) return true;
    if (!userSupabase || !authUserId) return false;
    for (const ctx of contexts) {
      const eid = String(ctx?.entity_id ?? "").trim();
      if (!eid) continue;
      const grantPack = await loadHolderAuthorityGrants({
        supabase: userSupabase,
        entityId: eid,
        holderUserId: authUserId,
      });
      if (!canLoadCorporateProfileHand(grantPack)) return false;
    }
    return true;
  }

  if (cached.status === "normal" && cachedReusable) {
    if (await cachedCorporateAuthorityStillValid(cached.card)) {
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
    // Fall through — rebuild with fresh authority.
  }

  if (cached.status === "stale" && cachedReusable) {
    if (await cachedCorporateAuthorityStillValid(cached.card)) {
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
    // Fall through — rebuild with fresh authority.
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

/**
 * T7.2 — existence-only document brief for Claude soft context.
 * id + filename only; never dump body/chunks/extracts; never verified insurance facts.
 * Card is already customer-scoped; rows with a foreign customer_id are dropped fail-closed.
 */
export function briefDocumentStatusForClaudeMeta(card = null) {
  const cardCid = String(card?.customer_id ?? "").trim();
  const status = card?.document_status && typeof card.document_status === "object"
    ? card.document_status
    : null;
  const raw = Array.isArray(status?.documents)
    ? status.documents
    : Array.isArray(status?._active_documents)
      ? status._active_documents
      : [];
  const seen = new Set();
  const documents = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const rowCid = d.customer_id != null ? String(d.customer_id).trim() : "";
    if (cardCid && rowCid && rowCid !== cardCid) continue;
    const id = d.id != null ? String(d.id).trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const filename = d.original_filename ?? d.filename ?? null;
    documents.push({
      id,
      original_filename:
        filename != null && String(filename).trim()
          ? String(filename).trim().slice(0, 240)
          : null,
    });
    if (documents.length >= 40) break;
  }
  return {
    active_count: documents.length,
    documents,
    note:
      "Existence listing for this customer's active uploaded documents (id + filename only). " +
      "This is not document body and not DOCUMENT_EVIDENCE. " +
      "If document content is not separately provided as DOCUMENT_EVIDENCE / attached original this turn, " +
      "do not claim you read the document and do not invent or estimate coverage terms from the filename alone.",
  };
}

/** Claude payload slice — status + as-of + T7.2 document existence + T8.1 insurer_source; never dump full card. */
export function buildReadyCardClaudeMeta(card = null, readyCardStatus = null) {
  const insurer_source = briefInsurerSourceForClaudeMeta(card);
  if (!card || typeof card !== "object") {
    return {
      status: "miss",
      prepared_at: null,
      card_version: READY_CARD_VERSION,
      materials_connected: false,
      note: "Customer materials are not connected for this turn. Do not invent verified insurance facts.",
      document_status: {
        active_count: 0,
        documents: [],
        note:
          "Existence listing for this customer's active uploaded documents (id + filename only). " +
          "This is not document body and not DOCUMENT_EVIDENCE. " +
          "If document content is not separately provided as DOCUMENT_EVIDENCE / attached original this turn, " +
          "do not claim you read the document and do not invent or estimate coverage terms from the filename alone.",
      },
      insurer_source,
    };
  }
  const status =
    readyCardStatus === "stale" || card.status === "stale"
      ? "stale"
      : card.materials_connected === false || card.status === "miss"
        ? "miss"
        : "normal";
  const document_status = briefDocumentStatusForClaudeMeta(card);
  if (status === "miss") {
    return {
      status: "miss",
      prepared_at: card.prepared_at ?? null,
      card_version: card.card_version ?? READY_CARD_VERSION,
      materials_connected: false,
      unknowns: Array.isArray(card.unknowns) ? card.unknowns.slice(0, 12) : [],
      note: "Customer materials are not connected for this turn. Do not invent verified insurance facts. Ask only from the current question and conversation until materials are linked.",
      document_status,
      insurer_source,
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
      document_status,
      insurer_source,
    };
  }
  return {
    status: "normal",
    prepared_at: card.prepared_at ?? null,
    card_version: card.card_version ?? READY_CARD_VERSION,
    materials_connected: true,
    note: "READY CARD prepared from KEY SSOT before this question.",
    document_status,
    insurer_source,
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
      selectedCorporateEntityId: null,
      corporateAuthorizationDenied: false,
      activeClaimCases: [],
      activeDocuments: [],
      policies: [],
      policy_count: 0,
      insuranceClockItems: null,
      insuranceClockBrief: null,
      claimEvidenceItems: null,
      claimEvidenceBrief: null,
      lifeLedgerItems: null,
      lifeLedgerBrief: null,
    };
  }
  const goalObj = card.active_goal?._goal_object ?? null;
  const priorObj = card.important_history?._prior_object ?? null;
  const policies = Array.isArray(card.insurance_card?.policies)
    ? card.insurance_card.policies
    : [];
  const insuranceClockBrief =
    card.insurance_clock && typeof card.insurance_clock === "object"
      ? {
          upcoming: card.insurance_clock.upcoming || [],
          overdue: card.insurance_clock.overdue || [],
          unknown_date: card.insurance_clock.unknown_date || [],
          completed_recent: card.insurance_clock.completed_recent || [],
          packs_separated: card.insurance_clock.packs_separated === true,
          note: card.insurance_clock.note ?? null,
        }
      : null;
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
    selectedCorporateEntityId: card.corporate?.selected_entity_id ?? null,
    corporateAuthorizationDenied: card.corporate?.authorization_denied === true,
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
    insuranceClockItems: Array.isArray(card.insurance_clock?._items)
      ? card.insurance_clock._items
      : null,
    insuranceClockBrief,
    claimEvidenceItems: Array.isArray(card.claim_evidence?._items)
      ? card.claim_evidence._items
      : null,
    claimEvidenceBrief:
      card.claim_evidence && typeof card.claim_evidence === "object"
        ? {
            packages: card.claim_evidence.packages || [],
            item_count: card.claim_evidence.item_count ?? 0,
            packs_separated: card.claim_evidence.packs_separated === true,
            note: card.claim_evidence.note ?? null,
          }
        : null,
    lifeLedgerItems: Array.isArray(card.life_ledger?._items)
      ? card.life_ledger._items
      : null,
    lifeLedgerBrief:
      card.life_ledger && typeof card.life_ledger === "object"
        ? {
            goals: card.life_ledger.goals || [],
            decisions: card.life_ledger.decisions || [],
            open_questions: card.life_ledger.open_questions || [],
            outcomes: card.life_ledger.outcomes || [],
            item_count: card.life_ledger.item_count ?? 0,
            packs_separated: card.life_ledger.packs_separated === true,
            note: card.life_ledger.note ?? null,
          }
        : null,
  };
}
