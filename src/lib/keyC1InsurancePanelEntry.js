/**
 * C1 UI ENTRY — panelView insurance SSOT (entry only).
 * Contract focus selection lives in keyContractFocusSsot.js.
 */
import {
  applyPointedContractSelection,
  buildPointedContractIdsPayload,
} from "./keyContractFocusSsot.js";

export function resolveC1InsurancePanelEntryAction() {
  return {
    panelView: "insurance",
    sidebarOpen: false,
    insuranceRailOpen: false,
  };
}

/** @deprecated use applyPointedContractSelection — kept as thin alias for entry tests */
export function applyC1PolicySelection({
  pointedContractId = null,
  policyId = null,
  contractId = null,
} = {}) {
  return applyPointedContractSelection({
    pointedContractId,
    contractId: contractId ?? policyId,
  });
}

export { applyPointedContractSelection, buildPointedContractIdsPayload };
