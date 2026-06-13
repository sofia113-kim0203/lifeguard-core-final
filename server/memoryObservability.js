export const MEMORY_DISPLAY_STATUSES = ["ready", "degraded", "failed"];

export function assessMemoryBuilderInvoke({ status, body = {} } = {}) {
  const normalizedBody = body && typeof body === "object" ? body : {};
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      body: normalizedBody,
      error: normalizedBody.error ?? `http_${status}`,
    };
  }
  if (normalizedBody.error) {
    return {
      ok: false,
      status,
      body: normalizedBody,
      error: String(normalizedBody.error),
    };
  }
  return { ok: true, status, body: normalizedBody, error: null };
}

export class MemoryBuilderRebuildError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "MemoryBuilderRebuildError";
    this.code = code;
    this.partial = Boolean(details.partial);
    this.profile_health_policy = details.profile_health_policy ?? null;
    this.customer_conversation = details.customer_conversation ?? null;
    this.snapshot = details.snapshot ?? null;
    this.structured = details.structured ?? null;
  }
}

export function assessMemorySyncNeed(sourceContext, snapshot) {
  const facts = snapshot?.facts ?? [];
  const factCount = facts.length;
  const hasSourceData =
    sourceContext.has_profile || sourceContext.has_health || sourceContext.has_policies;

  if (!hasSourceData) {
    return { needed: false, reason: "no_source_data" };
  }
  if (factCount === 0) {
    return { needed: true, reason: "memory_empty_but_source_exists" };
  }

  const healthFactCount = facts.filter((fact) => fact.fact_type === "health").length;
  const insuranceFactCount = facts.filter((fact) => fact.fact_type === "insurance").length;
  const identityFactCount = facts.filter((fact) => fact.fact_type === "identity").length;

  if (sourceContext.has_profile && identityFactCount === 0) {
    return { needed: true, reason: "profile_not_in_memory" };
  }
  if (sourceContext.has_health && healthFactCount === 0) {
    return { needed: true, reason: "health_not_in_memory" };
  }
  if (sourceContext.has_policies && insuranceFactCount === 0) {
    return { needed: true, reason: "policies_not_in_memory" };
  }

  return { needed: false, reason: "memory_ok" };
}

export function resolveMemoryDisplayStatus({
  rebuildError = null,
  rebuildSucceeded = false,
  syncAssessment = null,
  memorySyncStatus = null,
  serviceRoleConfigured = true,
  rebuildRequested = false,
} = {}) {
  if (memorySyncStatus && MEMORY_DISPLAY_STATUSES.includes(memorySyncStatus)) {
    return memorySyncStatus;
  }
  if (rebuildError) {
    if (rebuildError.code === "service_role_not_configured") {
      return rebuildRequested ? "failed" : "degraded";
    }
    return rebuildError.partial ? "degraded" : "failed";
  }
  if (rebuildSucceeded) {
    return "ready";
  }
  if (rebuildRequested && !serviceRoleConfigured) {
    return "failed";
  }
  if (syncAssessment?.needed) {
    return "degraded";
  }
  return "ready";
}

export function formatMemoryBuilderFailure(profileResult, conversationResult) {
  const failures = [];
  if (profileResult && !profileResult.ok) {
    failures.push({
      scope: profileResult.scope ?? "profile_health_policy",
      status: profileResult.status,
      error: profileResult.error ?? profileResult.body?.error ?? "invoke_failed",
    });
  }
  if (conversationResult && !conversationResult.ok) {
    failures.push({
      scope: conversationResult.scope ?? "customer_conversation",
      status: conversationResult.status,
      error: conversationResult.error ?? conversationResult.body?.error ?? "invoke_failed",
    });
  }
  return failures;
}
