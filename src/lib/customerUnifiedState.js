import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-unified-state";

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
    throw new Error(
      toCustomerErrorMessage(
        { message: payload?.error_message ?? payload?.reason },
        "고객 통합 상태를 불러오지 못했습니다.",
      ),
    );
  }

  return payload.unified_state ?? null;
}
