/**
 * KEY Customer Card — Claude Provider SSOT (Tom lock).
 *
 * Wire:
 *   question + key_customer_card + this-turn original bytes (if any) → Claude
 *
 * Past entrusted originals: LINKS ONLY on the card (id/filename).
 * Full PDF/image bytes only for delivery authority (current_upload | explicit_reopen).
 * No vault dump. No OCR extract. No document pick/rank in front of Claude.
 */

import { buildConfirmedCustomerMemoryBrief } from "./keyOwnedOriginalsCanonical.js";

export const KEY_CUSTOMER_CARD_SCHEMA = "key-customer-card-v1";
/** Tom lock — past originals never bulk-dumped into Provider. */
export const PAST_ORIGINAL_BYTES_MODE = "links_only";

/**
 * Keep existing KEY/READY row fields as-is.
 * Do not invent keys; do not skeleton-strip contracts/coverages.
 */
function preserveExistingRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { ...row };
}

function existingInsuranceContracts(policyTruthContext, ssot) {
  const ssotPolicies = Array.isArray(ssot?.policies)
    ? ssot.policies.map(preserveExistingRow).filter(Boolean)
    : [];
  // Live path: reality/READY policies still carry coverage_summary — prefer when present.
  if (ssotPolicies.length > 0) return ssotPolicies.slice(0, 24);

  const ledger =
    policyTruthContext?.VERIFIED_POLICY_LEDGER &&
    typeof policyTruthContext.VERIFIED_POLICY_LEDGER === "object"
      ? policyTruthContext.VERIFIED_POLICY_LEDGER
      : null;
  const fromLedger = Array.isArray(ledger?.confirmed_contracts)
    ? ledger.confirmed_contracts.map(preserveExistingRow).filter(Boolean)
    : [];
  if (fromLedger.length > 0) return fromLedger.slice(0, 24);

  const fromTruth = Array.isArray(policyTruthContext?.confirmed_contracts)
    ? policyTruthContext.confirmed_contracts.map(preserveExistingRow).filter(Boolean)
    : [];
  return fromTruth.slice(0, 24);
}

function existingConfirmedFacts(policyTruthContext) {
  const out = [];
  const pushAll = (list) => {
    if (!Array.isArray(list)) return;
    for (const row of list.slice(0, 24)) {
      const preserved = preserveExistingRow(row);
      if (preserved) out.push(preserved);
    }
  };
  pushAll(policyTruthContext?.confirmed_facts);
  pushAll(policyTruthContext?.verified_facts);
  const ledger =
    policyTruthContext?.VERIFIED_POLICY_LEDGER &&
    typeof policyTruthContext.VERIFIED_POLICY_LEDGER === "object"
      ? policyTruthContext.VERIFIED_POLICY_LEDGER
      : null;
  pushAll(ledger?.confirmed_facts);
  pushAll(ledger?.verified_facts);
  return out.slice(0, 40);
}

/**
 * Build the card KEY hands to Claude this turn (wholesale, no selection plan).
 * Prefers READY CARD / KEY SSOT briefs already loaded for the turn.
 */
export function buildKeyCustomerCardForClaude({
  policyTruthContext = null,
  history = null,
  readyCardMeta = null,
  relationshipState = null,
  ownedOriginals = [],
  originalDeliveryReason = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  /** materialsFromReadyCard / Direct turn SSOT */
  readyCardSsot = null,
} = {}) {
  const memory = buildConfirmedCustomerMemoryBrief({
    policyTruthContext,
    history,
  });
  const ready =
    readyCardMeta && typeof readyCardMeta === "object" ? readyCardMeta : null;
  const ssot =
    readyCardSsot && typeof readyCardSsot === "object" ? readyCardSsot : null;

  const docStatus =
    ready?.document_status && typeof ready.document_status === "object"
      ? ready.document_status
      : { active_count: 0, documents: [] };
  const activeDocs = Array.isArray(ssot?.activeDocuments)
    ? ssot.activeDocuments
    : Array.isArray(docStatus.documents)
      ? docStatus.documents
      : [];
  const entrustedLinks = [];
  const seenDoc = new Set();
  for (const d of activeDocs) {
    if (!d || typeof d !== "object") continue;
    const id = String(d.id ?? d.document_id ?? "").trim();
    if (!id || seenDoc.has(id)) continue;
    seenDoc.add(id);
    entrustedLinks.push({
      document_id: id,
      original_filename:
        d.original_filename != null
          ? String(d.original_filename).slice(0, 240)
          : d.filename != null
            ? String(d.filename).slice(0, 240)
            : null,
    });
    if (entrustedLinks.length >= 40) break;
  }

  const thisTurnOriginals = (Array.isArray(ownedOriginals) ? ownedOriginals : []).map(
    (o) => ({
      document_id: o?.document_id ? String(o.document_id) : null,
      mime_type: o?.mime_type || o?.mediaType || null,
      sha256: o?.sha256 || o?.content_sha256 || null,
      source: o?.source || null,
      ownership_verified: o?.ownership_verified !== false,
      bytes_attached_this_turn: true,
    }),
  );

  const confirmedFacts = existingConfirmedFacts(policyTruthContext);
  const insuranceContracts = existingInsuranceContracts(policyTruthContext, ssot);

  const activeClaims = (Array.isArray(ssot?.activeClaimCases)
    ? ssot.activeClaimCases
    : []
  )
    .map(preserveExistingRow)
    .filter(Boolean)
    .slice(0, 12);

  let activeGoal = null;
  if (ssot?.ssotGoal && typeof ssot.ssotGoal === "object") {
    activeGoal = preserveExistingRow({
      ...ssot.ssotGoal,
      reason: ssot.ssotReason || ssot.ssotGoal.reason || null,
    });
  }

  let priorConsultation = null;
  if (ssot?.priorConsultation && typeof ssot.priorConsultation === "object") {
    priorConsultation = preserveExistingRow({
      ...ssot.priorConsultation,
      reason:
        ssot.priorConsultationReason || ssot.priorConsultation.reason || null,
    });
  }

  return {
    schema_version: KEY_CUSTOMER_CARD_SCHEMA,
    authority: "KEY",
    delivery_mode: "CUSTOMER_CARD_WHOLESALE",
    past_original_bytes_mode: PAST_ORIGINAL_BYTES_MODE,
    note: [
      "KEY customer card from KEY/READY SSOT for this turn.",
      "Lifeguard did not pick or rank documents in front of Claude.",
      "Past entrusted originals are links only — not full byte dump.",
      "This-turn original bytes (upload/explicit reopen) attach as native document/image blocks.",
    ].join(" "),
    relationship: relationshipState
      ? {
          authority: relationshipState.authority,
          relationship: relationshipState.relationship,
          conversation: relationshipState.conversation,
          prior_original_in_same_conversation:
            relationshipState.prior_original_in_same_conversation === true,
          states: relationshipState.states,
          memory_availability: relationshipState.memory_availability,
          memory_query_failed: relationshipState.memory_query_failed === true,
        }
      : null,
    insurance_contracts: insuranceContracts,
    confirmed_facts: confirmedFacts,
    active_goal: activeGoal,
    prior_consultation: priorConsultation,
    insurance_clock: ssot?.insuranceClockBrief || null,
    life_ledger: ssot?.lifeLedgerBrief || null,
    claim_evidence: ssot?.claimEvidenceBrief || null,
    active_claims: activeClaims,
    recent_conversation: memory.recent_conversation,
    entrusted_originals: {
      past_original_bytes_mode: PAST_ORIGINAL_BYTES_MODE,
      active_count:
        Number(docStatus.active_count) ||
        Number(ssot?.policy_count) ||
        entrustedLinks.length,
      links: entrustedLinks,
      materials_connected: ready?.materials_connected === true,
      ready_card_status: ready?.status || null,
      card_version: ready?.card_version || null,
      unknowns: Array.isArray(ready?.unknowns) ? ready.unknowns.slice(0, 12) : [],
      insurer_source: ready?.insurer_source || null,
    },
    this_turn_original_delivery: {
      reason: originalDeliveryReason || null,
      current_turn_document_ids: Array.isArray(currentTurnDocumentIds)
        ? currentTurnDocumentIds.map(String).filter(Boolean)
        : [],
      explicit_reopen_document_ids: Array.isArray(explicitReopenDocumentIds)
        ? explicitReopenDocumentIds.map(String).filter(Boolean)
        : [],
      attached: thisTurnOriginals,
    },
    memory_status: relationshipState?.memory_availability || null,
  };
}
