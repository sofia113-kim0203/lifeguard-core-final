/**
 * CONTRACT FOCUS SSOT — contract_id owns UI selection → request pointer.
 * No insurer/product name matching. No react_key dependency.
 */
import { isNonContractPolicyRow } from "./policyIdentityPollution.js";

/** Canonical internal contract id for a policy/card row. */
export function resolveCanonicalContractId(policy) {
  const fromContract = String(policy?.contract_id ?? "").trim();
  if (fromContract) return fromContract;
  const fromId = String(policy?.id ?? "").trim();
  return fromId || null;
}

/**
 * Real contract cards for selection UI:
 * - must have canonical contract_id
 * - exclude coverage-dump / polluted identity rows (not contracts)
 * - same contract_id rendered once (first wins)
 * Returns rows with both `contract_id` and `id` normalized to the canonical value.
 */
export function listUniqueContractCards(policies = []) {
  const seen = new Set();
  const out = [];
  for (const policy of Array.isArray(policies) ? policies : []) {
    if (isNonContractPolicyRow(policy)) continue;
    const contractId = resolveCanonicalContractId(policy);
    if (!contractId) continue;
    if (seen.has(contractId)) continue;
    seen.add(contractId);
    out.push({
      ...policy,
      contract_id: contractId,
      id: contractId,
    });
  }
  return out;
}

/** Card count vs unique id count (must match after listUniqueContractCards). */
export function assertContractCardIdUnique(cards = []) {
  const ids = cards.map((c) => resolveCanonicalContractId(c)).filter(Boolean);
  const unique = new Set(ids);
  return {
    card_count: cards.length,
    unique_contract_id_count: unique.size,
    ok: cards.length === unique.size && ids.length === cards.length,
  };
}

/**
 * Toggle/replace pointedContractId from a card click.
 * Same id again → clear (0). Different id → replace (no residual).
 */
export function applyPointedContractSelection({
  pointedContractId = null,
  contractId = null,
} = {}) {
  const next = String(contractId ?? "").trim();
  if (!next) return String(pointedContractId ?? "").trim() || null;
  const current = String(pointedContractId ?? "").trim();
  if (current && current === next) return null;
  return next;
}

/** Request payload: 0 or 1 id. */
export function buildPointedContractIdsPayload(pointedContractId = null) {
  const id = String(pointedContractId ?? "").trim();
  return id ? [id] : [];
}

/**
 * ROOT_B — when pointed selection must clear.
 * Keep across panel back-to-chat. Clear on new chat / logout / customer change.
 */
export function shouldClearPointedContractOnLifecycle({
  event = null,
} = {}) {
  const e = String(event ?? "").trim();
  return (
    e === "new_chat" ||
    e === "logout" ||
    e === "customer_change" ||
    e === "session_reset"
  );
}

/** Resolve selected card by data-contract-id after re-render (never by list index). */
export function findContractCardById(cards = [], contractId = null) {
  const id = String(contractId ?? "").trim();
  if (!id) return null;
  const list = Array.isArray(cards) ? cards : [];
  return list.find((c) => resolveCanonicalContractId(c) === id) || null;
}

/** Selected UI attrs from pointed id + card id (re-render safe). */
export function resolveContractCardSelectionState({
  pointedContractId = null,
  contractId = null,
} = {}) {
  const pointed = String(pointedContractId ?? "").trim();
  const id = String(contractId ?? "").trim();
  const selected = Boolean(pointed) && Boolean(id) && pointed === id;
  return {
    selected,
    aria_pressed: selected ? "true" : "false",
    aria_label: selected ? "선택한 보험" : "이 보험 선택",
    data_contract_selected: selected ? "true" : "false",
  };
}
