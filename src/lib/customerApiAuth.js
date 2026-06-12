import { supabase } from "./supabase.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;

export class CustomerLoginRequiredError extends Error {
  constructor(message = "로그인이 필요합니다.") {
    super(message);
    this.name = "CustomerLoginRequiredError";
    this.reason = "UNAUTHORIZED";
    this.status = 401;
  }
}

export class CustomerApiUnauthorizedError extends Error {
  constructor(message = "로그인이 필요합니다.", payload = null) {
    super(message);
    this.name = "CustomerApiUnauthorizedError";
    this.reason = "UNAUTHORIZED";
    this.status = 401;
    this.payload = payload;
  }
}

export function isCustomerUnauthorizedError(error) {
  return (
    error?.reason === "UNAUTHORIZED" ||
    error?.status === 401 ||
    error?.name === "CustomerLoginRequiredError" ||
    error?.name === "CustomerApiUnauthorizedError"
  );
}

function sessionNeedsRefresh(session) {
  if (!session?.access_token) return true;
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  return !expiresAtMs || Date.now() >= expiresAtMs - TOKEN_REFRESH_SKEW_MS;
}

/**
 * Returns a valid Supabase access_token for authenticated customer API calls.
 * Refreshes the session when missing or near expiry before server requests.
 */
export async function getCustomerAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new CustomerLoginRequiredError();
  }

  let session = sessionData?.session ?? null;
  if (sessionNeedsRefresh(session)) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session?.access_token) {
      throw new CustomerLoginRequiredError();
    }
    session = refreshData.session;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new CustomerLoginRequiredError();
  }

  const { data: freshSessionData } = await supabase.auth.getSession();
  const accessToken = freshSessionData?.session?.access_token ?? session?.access_token;
  if (!accessToken) {
    throw new CustomerLoginRequiredError();
  }

  return accessToken;
}

export async function fetchCustomerApi(path, { method = "POST", body = undefined, headers = {} } = {}) {
  const accessToken = await getCustomerAccessToken();
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export function rethrowCustomerApiError(error, { payload, response, fallbackMessage, mapMessage }) {
  if (isCustomerUnauthorizedError(error)) {
    throw error;
  }

  const wrapped = new Error(
    mapMessage?.(payload, response.status) ??
      payload?.error_message ??
      payload?.reason ??
      fallbackMessage,
  );
  wrapped.reason = error?.reason ?? payload?.reason ?? null;
  wrapped.status = error?.status ?? response.status;
  throw wrapped;
}

export function assertCustomerApiOk({ response, payload }, fallbackMessage) {
  if (response.status === 401 || payload?.reason === "UNAUTHORIZED") {
    throw new CustomerApiUnauthorizedError(
      payload?.error_message ?? "로그인이 필요합니다.",
      payload,
    );
  }

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error_message ?? payload?.reason ?? fallbackMessage);
    error.reason = payload?.reason ?? null;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}
