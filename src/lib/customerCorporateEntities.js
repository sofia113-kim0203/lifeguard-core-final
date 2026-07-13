/**
 * Slice 2 — client Hand for membership-scoped corporate list.
 */
import { fetchCustomerApi, isCustomerUnauthorizedError } from "./customerApiAuth.js";
import { CORPORATE_LIST_FAILED_CUSTOMER_TEXT } from "./chatActiveEntity.js";
import {
  mapCorporateEntitiesPayload,
  normalizeCorporateEntityListItem,
} from "./corporateEntitiesMap.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export {
  mapCorporateEntitiesPayload,
  normalizeCorporateEntityListItem,
} from "./corporateEntitiesMap.js";

const ROUTE_PATH = "/api/customer-corporate-entities";

/**
 * Fetch membership corporates for the logged-in user.
 * List fetch failure is returned as ok:false (not empty list).
 */
export async function fetchMyCorporateEntities() {
  try {
    const { response, payload } = await fetchCustomerApi(ROUTE_PATH, {
      method: "POST",
      body: {},
    });

    if (response.status === 401 || payload?.reason === "UNAUTHORIZED") {
      const err = new Error(payload?.error_message ?? "로그인이 필요합니다.");
      err.reason = "UNAUTHORIZED";
      err.status = 401;
      throw err;
    }

    // Soft list failure (200 ok:false) and hard HTTP failure both map to error — not empty.
    if (!response.ok || payload?.ok === false) {
      return mapCorporateEntitiesPayload({
        ok: false,
        reason: payload?.reason ?? "LIST_FAILED",
        customer_message: payload?.customer_message ?? CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
        entities: [],
        list_status: "error",
      });
    }

    return mapCorporateEntitiesPayload(payload);
  } catch (error) {
    if (isCustomerUnauthorizedError(error) || error?.reason === "UNAUTHORIZED") {
      throw error;
    }
    return {
      ok: false,
      listStatus: "error",
      entities: [],
      customerMessage: toCustomerErrorMessage(error, CORPORATE_LIST_FAILED_CUSTOMER_TEXT),
    };
  }
}
