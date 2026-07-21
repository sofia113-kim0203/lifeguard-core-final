/**
 * Client loader for unified-view corporate entity picker.
 */
import { getCustomerAccessToken } from "./customerApiAuth.js";

const ROUTE = "/api/key-my-corporate-entities";

export async function fetchMyCorporateEntities() {
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
}
