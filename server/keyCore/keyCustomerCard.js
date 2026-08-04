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

function briefPolicy(row) {
  if (!row || typeof row !== "object") return null;
  return {
    insurer: row.insurer || row.company_name || null,
    product_name: row.product_name || row.product_label || null,
    policy_number: row.policy_number || null,
    status: row.status || row.contract_status || null,
    contract_id: row.contract_id || row.id || null,
  };
}

function briefClaim(row) {
  if (!row || typeof row !== "object") return null;
  return {
    claim_id: row.claim_id || row.id || null,
    status: row.status || null,
    title: row.title || row.label || null,
  };
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

  const confirmedFacts = [];
  const pushFact = (row) => {
    if (!row || typeof row !== "object") return;
    confirmedFacts.push({
      kind: row.kind || row.type || "fact",
      value: row.value ?? row.text ?? row.summary ?? null,
      source_document_id: row.source_document_id || row.document_id || null,
    });
  };
  if (Array.isArray(policyTruthContext?.confirmed_facts)) {
    for (const row of policyTruthContext.confirmed_facts.slice(0, 24)) pushFact(row);
  }
  if (Array.isArray(policyTruthContext?.verified_facts)) {
    for (const row of policyTruthContext.verified_facts.slice(0, 24)) pushFact(row);
  }

  const ssotPolicies = Array.isArray(ssot?.policies)
    ? ssot.policies.map(briefPolicy).filter(Boolean).slice(0, 24)
    : [];
  const contractsFromTruth = memory.confirmed_contracts || [];
  // Prefer ledger confirmed contracts; fill from READY insurance_card policies when empty.
  const insuranceContracts =
    contractsFromTruth.length > 0 ? contractsFromTruth : ssotPolicies;

  const activeClaims = (Array.isArray(ssot?.activeClaimCases)
    ? ssot.activeClaimCases
    : []
  )
    .map(briefClaim)
    .filter(Boolean)
    .slice(0, 12);

  let activeGoal = null;
  if (ssot?.ssotGoal && typeof ssot.ssotGoal === "object") {
    activeGoal = {
      summary:
        ssot.ssotGoal.summary ||
        ssot.ssotGoal.goal_text ||
        ssot.ssotGoal.text ||
        null,
      status: ssot.ssotGoal.status || null,
      reason: ssot.ssotReason || null,
    };
  }

  let priorConsultation = null;
  if (ssot?.priorConsultation && typeof ssot.priorConsultation === "object") {
    priorConsultation = {
      summary:
        ssot.priorConsultation.summary ||
        ssot.priorConsultation.text ||
        null,
      reason: ssot.priorConsultationReason || null,
    };
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
    confirmed_facts: confirmedFacts.slice(0, 40),
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
