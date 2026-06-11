/**
 * Blocks admin password resets on production customer accounts.
 * Only sandbox customer IDs / sandbox email domains may be mutated.
 */

export const BLOCKED_PRODUCTION_CUSTOMER_ID = "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
export const DEFAULT_SANDBOX_CUSTOMER_ID = "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
export const DEFAULT_SANDBOX_EMAIL = "phase23-2a-primary-1780913883773@example.com";

const BLOCKED_CUSTOMER_IDS = new Set([BLOCKED_PRODUCTION_CUSTOMER_ID]);

const BLOCKED_EMAIL_DOMAINS = ["naver.com", "gmail.com", "daum.net"];

const SANDBOX_CUSTOMER_IDS = new Set([DEFAULT_SANDBOX_CUSTOMER_ID]);

const SANDBOX_EMAIL_DOMAINS = ["example.com", "test.local", "sandbox.local"];

function emailDomain(email) {
  return String(email ?? "")
    .trim()
    .split("@")[1]
    ?.toLowerCase() ?? "";
}

export function assertNotBlockedCustomerId(customerId) {
  const id = String(customerId ?? "").trim();
  if (!id) {
    throw new Error("CUSTOMER_ID_REQUIRED");
  }
  if (BLOCKED_CUSTOMER_IDS.has(id)) {
    throw new Error(
      `FORBIDDEN_CUSTOMER_ID: production customer ${id} cannot be used for password mutation`,
    );
  }
}

export function assertNotBlockedEmail(email) {
  const domain = emailDomain(email);
  if (!domain) {
    throw new Error("EMAIL_REQUIRED");
  }
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) {
    throw new Error(`FORBIDDEN_EMAIL_DOMAIN: ${domain} password mutation is permanently blocked`);
  }
}

export function assertSandboxPasswordResetTarget({ customerId = null, email = null } = {}) {
  if (customerId) {
    assertNotBlockedCustomerId(customerId);
  }
  if (email) {
    assertNotBlockedEmail(email);
  }
  if (!customerId && !email) {
    throw new Error("SANDBOX_TARGET_REQUIRED: customerId or email is required");
  }

  const sandboxById = customerId ? SANDBOX_CUSTOMER_IDS.has(customerId) : false;
  const sandboxByDomain = email ? SANDBOX_EMAIL_DOMAINS.includes(emailDomain(email)) : false;

  if (!sandboxById && !sandboxByDomain) {
    throw new Error(
      `NOT_SANDBOX_ACCOUNT: only sandbox customers are allowed (customerId=${customerId ?? "n/a"}, email=${email ?? "n/a"})`,
    );
  }
}

/** Default sandbox id; blocks production customer even when passed via env. */
export function resolveSandboxCustomerId(envValue = null) {
  const customerId = String(envValue ?? DEFAULT_SANDBOX_CUSTOMER_ID).trim();
  assertNotBlockedCustomerId(customerId);
  return customerId;
}

/** Read-only audits: sandbox by default; production id only when explicitly set in env. */
export function resolveAuditCustomerId(envValue = null) {
  return String(envValue ?? DEFAULT_SANDBOX_CUSTOMER_ID).trim();
}

export async function safeAdminUpdateUserPassword(
  adminClient,
  { userId, email, customerId, password },
) {
  if (!userId) {
    throw new Error("USER_ID_REQUIRED");
  }
  if (!password) {
    throw new Error("PASSWORD_REQUIRED");
  }

  assertSandboxPasswordResetTarget({ customerId, email });

  const { data, error } = await adminClient.auth.admin.updateUserById(userId, { password });
  if (error) {
    throw error;
  }
  return data;
}
