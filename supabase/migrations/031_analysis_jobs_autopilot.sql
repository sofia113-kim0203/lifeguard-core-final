-- ===========================================================================
-- 031_analysis_jobs_autopilot.sql
-- Analysis jobs autopilot — lease columns + atomic claim RPC (service_role only).
-- Prod apply: manual / deploy pipeline only (not auto-run by this task).
-- ===========================================================================

BEGIN;

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.analysis_jobs.locked_at IS
  'Cron lease timestamp; NULL when unclaimed. Stale lease allows re-claim.';

COMMENT ON COLUMN public.analysis_jobs.attempts IS
  'Autopilot failure count; incremented only on runner catch, not on claim.';

CREATE INDEX IF NOT EXISTS analysis_jobs_autopilot_claim_idx
  ON public.analysis_jobs (created_at ASC)
  WHERE status IN ('queued', 'processing');

CREATE OR REPLACE FUNCTION public.lifeguard_claim_analysis_jobs(
  p_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  id          UUID,
  customer_id UUID,
  status      TEXT,
  attempts    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.analysis_jobs AS j
    WHERE j.status IN ('queued', 'processing')
      AND j.updated_at < NOW() - INTERVAL '5 minutes'
      AND (
        j.locked_at IS NULL
        OR j.locked_at < NOW() - INTERVAL '5 minutes'
      )
    ORDER BY j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_limit, 1)
  ),
  claimed AS (
    UPDATE public.analysis_jobs AS aj
    SET locked_at = NOW()
    FROM picked AS p
    WHERE aj.id = p.id
    RETURNING aj.id, aj.customer_id, aj.status, aj.attempts
  )
  SELECT c.id, c.customer_id, c.status, c.attempts
  FROM claimed AS c;
END;
$$;

REVOKE ALL ON FUNCTION public.lifeguard_claim_analysis_jobs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeguard_claim_analysis_jobs(INTEGER) TO service_role;

COMMENT ON FUNCTION public.lifeguard_claim_analysis_jobs(INTEGER) IS
  'Atomically lease stale analysis_jobs for cron autopilot (FOR UPDATE SKIP LOCKED).';

COMMIT;
