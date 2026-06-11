/**
 * Sandbox auth guard — blocks production customer password mutation.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  BLOCKED_PRODUCTION_CUSTOMER_ID,
  DEFAULT_SANDBOX_CUSTOMER_ID,
  assertNotBlockedCustomerId,
  assertNotBlockedEmail,
  assertSandboxPasswordResetTarget,
  resolveSandboxCustomerId,
  safeAdminUpdateUserPassword,
} from "./lib/sandboxAuthGuard.js";

assert.throws(
  () => assertNotBlockedCustomerId(BLOCKED_PRODUCTION_CUSTOMER_ID),
  /FORBIDDEN_CUSTOMER_ID/,
);

assert.throws(() => assertNotBlockedEmail("sofia113@naver.com"), /FORBIDDEN_EMAIL_DOMAIN: naver.com/);
assert.throws(() => assertNotBlockedEmail("user@gmail.com"), /FORBIDDEN_EMAIL_DOMAIN: gmail.com/);
assert.throws(() => assertNotBlockedEmail("user@daum.net"), /FORBIDDEN_EMAIL_DOMAIN: daum.net/);

assert.throws(
  () =>
    assertSandboxPasswordResetTarget({
      customerId: BLOCKED_PRODUCTION_CUSTOMER_ID,
      email: "phase23-2a-primary-1780913883773@example.com",
    }),
  /FORBIDDEN_CUSTOMER_ID/,
);

assert.throws(
  () =>
    assertSandboxPasswordResetTarget({
      customerId: DEFAULT_SANDBOX_CUSTOMER_ID,
      email: "sofia113@naver.com",
    }),
  /FORBIDDEN_EMAIL_DOMAIN/,
);

assert.doesNotThrow(() =>
  assertSandboxPasswordResetTarget({
    customerId: DEFAULT_SANDBOX_CUSTOMER_ID,
    email: "phase23-2a-primary-1780913883773@example.com",
  }),
);

assert.equal(resolveSandboxCustomerId(), DEFAULT_SANDBOX_CUSTOMER_ID);
assert.throws(
  () => resolveSandboxCustomerId(BLOCKED_PRODUCTION_CUSTOMER_ID),
  /FORBIDDEN_CUSTOMER_ID/,
);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (url && serviceRoleKey) {
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id,user_id")
    .eq("id", BLOCKED_PRODUCTION_CUSTOMER_ID)
    .maybeSingle();

  assert.ok(profile?.user_id, "production profile must exist for live guard proof");

  let blocked = false;
  try {
    await safeAdminUpdateUserPassword(admin, {
      userId: profile.user_id,
      email: "sofia113@naver.com",
      customerId: BLOCKED_PRODUCTION_CUSTOMER_ID,
      password: "MustNeverApply123!",
    });
  } catch (error) {
    blocked = /FORBIDDEN_CUSTOMER_ID|FORBIDDEN_EMAIL_DOMAIN/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  assert.equal(blocked, true, "production customer password mutation must be blocked");
}

console.log(
  JSON.stringify(
    {
      phase: "sandbox-auth-guard-unit-test",
      pass: true,
      blocked_customer_id: BLOCKED_PRODUCTION_CUSTOMER_ID,
      default_sandbox_customer_id: DEFAULT_SANDBOX_CUSTOMER_ID,
      live_production_block_proof: Boolean(url && serviceRoleKey),
    },
    null,
    2,
  ),
);
