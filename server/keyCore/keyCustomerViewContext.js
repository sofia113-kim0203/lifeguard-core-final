/**
 * Unified customer view — personal / corporate / both context contract.
 * Same Claude-first KEY; ownership packs stay separated (never auto-merged).
 */

import { isExplicitCorporateClaimUtterance } from "./keyClaimIntakeSidecar.js";

export const CUSTOMER_VIEW_MODES = Object.freeze(["personal", "corporate", "both"]);

const DUAL_CONTEXT_RE =
  /(개인\s*(보험|청구|차트)?\s*(과|와|이랑)\s*(회사|법인)|회사\s*(보험|청구)?\s*(과|와|이랑)\s*개인|(개인|회사|법인).{0,24}비교|둘\s*다\s*(다\s*)?(비교|보여|알려)|비교해\s*(줘|주세요|봐))/;

const CORPORATE_VIEW_RE =
  /우리\s*회사|회사\s*보험|법인\s*보험|사업장|단체보험|법인\s*청구|회사\s*청구|임직원/;

export function isExplicitDualContextQuestion(question = "") {
  return DUAL_CONTEXT_RE.test(String(question ?? "").trim());
}

export function isCorporateViewUtterance(question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  if (isExplicitCorporateClaimUtterance(text)) return true;
  return CORPORATE_VIEW_RE.test(text);
}

/**
 * Resolve view mode for one KEY turn.
 * Default personal. Single corporate membership never forces corporate.
 */
export function resolveCustomerViewMode({
  question = "",
  selectedEntityIdHint = null,
  viewModeHint = null,
} = {}) {
  const hint = String(viewModeHint ?? "")
    .trim()
    .toLowerCase();
  const entityHint = String(selectedEntityIdHint ?? "").trim() || null;

  // Explicit dual always wins (utterance or client compare mode).
  if (hint === "both" || hint === "dual" || isExplicitDualContextQuestion(question)) {
    return {
      mode: "both",
      reason:
        hint === "both" || hint === "dual" ? "client_view_mode" : "explicit_dual_utterance",
      entity_id: entityHint,
    };
  }

  // Explicit personal picker — never keep a stale entity_id hint.
  if (hint === "personal") {
    return {
      mode: "personal",
      reason: "client_view_mode",
      entity_id: null,
    };
  }

  if (hint === "corporate" || entityHint || isCorporateViewUtterance(question)) {
    return {
      mode: "corporate",
      reason: hint === "corporate"
        ? "client_view_mode"
        : entityHint
          ? "explicit_entity_selection"
          : "corporate_utterance",
      entity_id: entityHint,
    };
  }

  return {
    mode: "personal",
    reason: "default_personal",
    entity_id: null,
  };
}

/**
 * Filter Claude evidence packs by view mode. Never invents facts; only withholds packs.
 */
export function applyCustomerViewModeToUserPayload(userPayload = null, view = null) {
  if (!userPayload || typeof userPayload !== "object") return userPayload;
  const mode = String(view?.mode ?? "personal").trim().toLowerCase();
  const entityId = String(view?.entity_id ?? "").trim() || null;
  const evidence =
    userPayload.available_verified_evidence &&
    typeof userPayload.available_verified_evidence === "object"
      ? { ...userPayload.available_verified_evidence }
      : {};
  const personal =
    evidence.personal && typeof evidence.personal === "object"
      ? { ...evidence.personal }
      : {
          subject_type: "individual",
          chart: null,
          key_confirmed_source_facts: [],
          active_claim_cases: [],
        };
  let corporate = Array.isArray(evidence.corporate) ? [...evidence.corporate] : [];
  if (entityId) {
    corporate = corporate.filter((c) => String(c?.entity_id ?? "") === entityId);
  }

  const baseContext =
    userPayload.current_context && typeof userPayload.current_context === "object"
      ? userPayload.current_context
      : {};
  const clockRaw =
    baseContext.insurance_clock && typeof baseContext.insurance_clock === "object"
      ? baseContext.insurance_clock
      : null;
  const evidenceRaw =
    baseContext.claim_evidence && typeof baseContext.claim_evidence === "object"
      ? baseContext.claim_evidence
      : null;

  function scopeKeep(row, scopeMode) {
    const eid = String(row?.entity_id ?? "").trim();
    if (scopeMode === "personal") return !eid;
    if (scopeMode === "corporate") return Boolean(entityId) && eid === entityId;
    return !eid || (entityId && eid === entityId);
  }

  function scopeClockBrief(brief, scopeMode) {
    if (!brief) return null;
    return {
      ...brief,
      upcoming: (brief.upcoming || []).filter((row) => scopeKeep(row, scopeMode)),
      overdue: (brief.overdue || []).filter((row) => scopeKeep(row, scopeMode)),
      unknown_date: (brief.unknown_date || []).filter((row) => scopeKeep(row, scopeMode)),
      completed_recent: (brief.completed_recent || []).filter((row) =>
        scopeKeep(row, scopeMode),
      ),
      packs_separated: true,
    };
  }

  function scopeClaimEvidenceBrief(brief, scopeMode) {
    if (!brief) return null;
    const packages = (brief.packages || []).filter((row) => scopeKeep(row, scopeMode));
    return {
      ...brief,
      packages,
      item_count: packages.reduce(
        (n, p) =>
          n +
          (p.held_evidence?.length || 0) +
          (p.submitted_evidence?.length || 0) +
          (p.insurer_evidence?.length || 0) +
          (p.outcome_evidence?.length || 0),
        0,
      ),
      packs_separated: true,
    };
  }

  const current_context = {
    ...baseContext,
    customer_view: {
      mode,
      entity_id: entityId,
      reason: view?.reason ?? null,
      packs_separated: true,
      auto_select_forbidden: true,
    },
  };

  if (mode === "personal") {
    const insurance_clock = scopeClockBrief(clockRaw, "personal");
    const claim_evidence = scopeClaimEvidenceBrief(evidenceRaw, "personal");
    const personalContext = {
      ...current_context,
      corporate_turn: {
        selected_entity_id: null,
        authorization_verified: false,
        note: "personal_view_corporate_pack_withheld",
      },
    };
    if (insurance_clock) personalContext.insurance_clock = insurance_clock;
    else delete personalContext.insurance_clock;
    if (claim_evidence) personalContext.claim_evidence = claim_evidence;
    else delete personalContext.claim_evidence;
    return {
      ...userPayload,
      current_context: personalContext,
      available_verified_evidence: {
        ...evidence,
        personal,
        corporate: [],
        documents: Array.isArray(evidence.documents)
          ? evidence.documents.filter((d) => !d?.entity_id)
          : evidence.documents,
      },
    };
  }

  if (mode === "corporate") {
    const insurance_clock = scopeClockBrief(clockRaw, "corporate");
    const claim_evidence = scopeClaimEvidenceBrief(evidenceRaw, "corporate");
    return {
      ...userPayload,
      current_context: {
        ...current_context,
        ...(insurance_clock ? { insurance_clock } : {}),
        ...(claim_evidence ? { claim_evidence } : {}),
      },
      available_verified_evidence: {
        ...evidence,
        personal: {
          subject_type: "individual",
          chart: null,
          key_confirmed_source_facts: [],
          active_claim_cases: [],
          provenance: null,
          evidence_state: "withheld_for_corporate_view",
          note: "personal_pack_withheld_corporate_view",
        },
        corporate,
        documents: Array.isArray(evidence.documents)
          ? evidence.documents.filter(
              (d) => entityId && String(d?.entity_id ?? "") === entityId,
            )
          : [],
      },
    };
  }

  // both — keep separated packs; never merge.
  const insurance_clock = scopeClockBrief(clockRaw, "both");
  const claim_evidence = scopeClaimEvidenceBrief(evidenceRaw, "both");
  return {
    ...userPayload,
    current_context: {
      ...current_context,
      dual_context: {
        personal_block: true,
        corporate_block: true,
        merged: false,
        note: "explicit_dual_keep_packs_separate",
      },
      ...(insurance_clock ? { insurance_clock } : {}),
      ...(claim_evidence ? { claim_evidence } : {}),
    },
    available_verified_evidence: {
      ...evidence,
      personal,
      corporate,
    },
  };
}
