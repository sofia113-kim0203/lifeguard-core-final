import { supabase } from "./supabase.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

const ROUTE_PATH = "/api/customer-memory-load";

export async function loadCustomerMemoryFoundation({ rebuild = true } = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ rebuild }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(
      toCustomerErrorMessage(
        { message: payload?.error_message ?? payload?.reason },
        "고객 Memory를 불러오지 못했습니다.",
      ),
    );
  }

  return {
    customerId: payload.customer_id,
    memoryVersion: payload.memory_version ?? 0,
    factCount: payload.fact_count ?? 0,
    structured: payload.structured ?? null,
    rebuilt: payload.rebuilt ?? false,
    rebuildSummary: payload.rebuild_summary ?? null,
  };
}
