/** Pure helpers for analysis_jobs cron autopilot claim / retry policy. */

export const DEFAULT_STALE_MS = 5 * 60 * 1000;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Mark failed after this many autopilot catch failures (attempts is pre-increment value). */
export function shouldMarkFailed(attempts, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return Number(attempts) >= Number(maxAttempts);
}

/**
 * Mirror lifeguard_claim_analysis_jobs eligibility (client-side / unit tests).
 * Fresh updated_at => browser likely still polling — do not claim.
 */
export function isClaimEligible(job, nowMs = Date.now(), staleMs = DEFAULT_STALE_MS) {
  if (!job) return false;
  const status = String(job.status ?? "");
  if (status !== "queued" && status !== "processing") return false;

  const updatedAtMs = new Date(job.updated_at ?? 0).getTime();
  if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < staleMs) {
    return false;
  }

  if (job.locked_at) {
    const lockedAtMs = new Date(job.locked_at).getTime();
    if (Number.isFinite(lockedAtMs) && nowMs - lockedAtMs < staleMs) {
      return false;
    }
  }

  return true;
}

/** Fraction of maxDuration budget before skipping further jobs in one cron tick. */
export const TIME_BUDGET_FRACTION = 0.7;

export function isWithinTimeBudget(startedAtMs, nowMs, maxDurationMs) {
  const budgetMs = maxDurationMs * TIME_BUDGET_FRACTION;
  return nowMs - startedAtMs < budgetMs;
}
