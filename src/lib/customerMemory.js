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

  if (payload.memory_status === "failed") {
    const failureMessage =
      payload.rebuild_error?.error ??
      payload.rebuild_error?.code ??
      payload.rebuild_summary?.error ??
      "Memory rebuild failed";
    throw new Error(
      toCustomerErrorMessage({ message: failureMessage }, "고객 Memory 갱신에 실패했습니다."),
    );
  }

  return {
    customerId: payload.customer_id,
    memoryVersion: payload.memory_version ?? 0,
    factCount: payload.fact_count ?? 0,
    structured: payload.structured ?? null,
    memoryStatus: payload.memory_status ?? null,
    rebuilt: payload.rebuilt ?? false,
    rebuildSummary: payload.rebuild_summary ?? null,
    rebuildError: payload.rebuild_error ?? null,
  };
}

/** I-5 — after document soft-delete policy retire: scrub document-derived insurance memory. */
export async function scrubInsuranceMemoryAfterDocumentDelete({ retiredPolicyIds = [] } = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    return { ok: false, reason: "unauthorized" };
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({
      scrub_insurance_memory: true,
      rebuild: false,
      retired_policy_ids: Array.isArray(retiredPolicyIds) ? retiredPolicyIds : [],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    return {
      ok: false,
      reason: payload?.reason ?? "memory_scrub_failed",
      error_message: payload?.error_message ?? null,
    };
  }

  return {
    ok: true,
    scrub: payload.scrub_insurance_memory ?? null,
    customerId: payload.customer_id ?? null,
  };
}
