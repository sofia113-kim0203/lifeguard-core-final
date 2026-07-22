/**
 * Client loader for unified-view corporate entity picker.
 */
import { getCustomerAccessToken } from "./customerApiAuth.js";

const ROUTE = "/api/key-my-corporate-entities";

/**
 * Fetch membership-scoped corporate entities for the signed-in customer.
 * Never throws — token/session races return ok:false + empty entities.
 */
export async function fetchMyCorporateEntities() {
  try {
    const accessToken = await getCustomerAccessToken();
    const response = await fetch(ROUTE, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        entities: [],
        reason: payload?.reason ?? `http_${response.status}`,
      };
    }
    return {
      ok: true,
      entities: Array.isArray(payload.entities) ? payload.entities : [],
      list_status: payload.list_status ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      entities: [],
      reason: err?.reason ?? err?.name ?? "corporate_list_fetch_failed",
    };
  }
}
