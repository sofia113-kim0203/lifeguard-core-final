import { supabase } from "./supabase.js";
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

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }
  return data.session.access_token;
}

export async function loadCustomerUnifiedState({ lastEvent = null } = {}) {
  const token = await getAccessToken();
  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(lastEvent ? { last_event: lastEvent } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const err = new Error(
      toCustomerErrorMessage(
        { message: payload?.error_message ?? payload?.reason },
        "고객 통합 상태를 불러오지 못했습니다.",
      ),
    );
    err.reason = payload?.reason ?? null;
    throw err;
  }

  return payload.unified_state ?? null;
}
