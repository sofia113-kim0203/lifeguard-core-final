import { fetchCustomerApi } from "./customerApiAuth.js";

export async function fetchAppRouteGate(path = "/") {
  const { response, payload } = await fetchCustomerApi(
    `/api/app-route-gate?path=${encodeURIComponent(path)}`,
    { method: "GET" },
  );
  if (!response.ok) {
    return { ok: false, allowed: false, redirect: "/" };
  }
  return payload;
}
