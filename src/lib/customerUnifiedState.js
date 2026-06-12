import {
  assertCustomerApiOk,
  fetchCustomerApi,
  isCustomerUnauthorizedError,
  rethrowCustomerApiError,
} from "./customerApiAuth.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-unified-state";

export function isUnifiedProfileMissingError(error) {
  const reason = String(error?.reason ?? "");
  const message = String(error?.message ?? "");
  return (
    reason === "CUSTOMER_PROFILE_NOT_FOUND" ||
    message.includes("CUSTOMER_PROFILE_NOT_FOUND") ||
    message.includes("Customer profile not found") ||
    message.includes("고객 프로필을 찾을 수 없")
  );
}

export { isCustomerUnauthorizedError };

/** Align dashboard count fields with unified contract (source of truth). */
export function applyUnifiedDashboardFields(dashboard, unifiedState) {
  if (!dashboard || !unifiedState) return dashboard;
  return {
    ...dashboard,
    customerId: unifiedState.customer_id ?? dashboard.customerId,
    memoryVersion: unifiedState.memory_version ?? dashboard.memoryVersion,
    insurancePolicyCount: unifiedState.policy_count ?? dashboard.insurancePolicyCount,
    insurancePolicyIds: unifiedState.policy_ids ?? dashboard.insurancePolicyIds,
  };
}

export async function loadCustomerUnifiedState({ lastEvent = null } = {}) {
  const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
    body: lastEvent ? { last_event: lastEvent } : {},
  });

  try {
    assertCustomerApiOk({ response, payload }, "고객 통합 상태를 불러오지 못했습니다.");
  } catch (error) {
    rethrowCustomerApiError(error, {
      payload,
      response,
      fallbackMessage: "고객 통합 상태를 불러오지 못했습니다.",
      mapMessage: (body) =>
        toCustomerErrorMessage(
          { message: body?.error_message ?? body?.reason, reason: body?.reason },
          "고객 통합 상태를 불러오지 못했습니다.",
        ),
    });
  }

  return payload.unified_state ?? null;
}
