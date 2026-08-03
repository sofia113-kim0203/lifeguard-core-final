/**
 * C1 UI ENTRY RECONNECT — pure entry action (offline-testable).
 * panelView="insurance" is the SSOT for CustomerInsuranceList / pointedContractId.
 * Narrow sheet (insuranceRailOpen) is display-only and must not own selection.
 */
export function resolveC1InsurancePanelEntryAction() {
  return {
    panelView: "insurance",
    sidebarOpen: false,
    insuranceRailOpen: false,
  };
}

/**
 * Offline UI selection: exact C1 card click → pointedContractId (0..1).
 */
export function applyC1PolicySelection({
  pointedContractId = null,
  policyId = null,
} = {}) {
  const next = String(policyId ?? "").trim();
  if (!next) return null;
  const current = String(pointedContractId ?? "").trim();
  return current && current === next ? null : next;
}
