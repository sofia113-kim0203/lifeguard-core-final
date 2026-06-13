-- ===========================================================================
-- 030_worker_jobs_runtime_rpcs.sql
-- A1 — worker_jobs runtime loop (RPC-centric transitions).
--
-- The worker_jobs / worker_runs / retry_queue / dead_letter_jobs TABLES already
-- exist (010_worker_jobs.sql). This migration adds NO tables/columns — it only
-- adds the SECURITY DEFINER functions that drive the queue at runtime:
--   • lifeguard_enqueue_worker_job   — idempotent insert
--   • lifeguard_claim_worker_jobs    — atomic claim (FOR UPDATE SKIP LOCKED)
--   • lifeguard_complete_worker_job  — mark completed + worker_runs audit
--   • lifeguard_fail_worker_job      — retry (retry_queue) or dead_letter
--
-- Multi-table state changes happen inside one function call so they are atomic
-- (no half-applied transitions). All functions are service_role-only.
--
-- Scope (A1): proven on job_type 'memory_builder'. Generic for all job types.
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- enqueue: one active job per (customer_id, job_type, source_ref), enforced by
-- the partial unique index worker_jobs_idempotent_active_uq (010). On conflict
-- with an existing ACTIVE job, returns that job's id instead of raising.
-- Sets max_retries explicitly (table default is 5; A1 policy is 3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_enqueue_worker_job(
  p_job_type    TEXT,
  p_customer_id UUID,
  p_source_ref  TEXT,
  p_payload     JSONB    DEFAULT '{}'::JSONB,
  p_max_retries INTEGER  DEFAULT 3,
  p_priority    TEXT     DEFAULT 'medium'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.worker_jobs (
    job_type, customer_id, source_ref, payload_json, max_retries, priority, status
  )
  VALUES (
    p_job_type, p_customer_id, p_source_ref,
    COALESCE(p_payload, '{}'::JSONB), p_max_retries, p_priority, 'pending'
  )
  ON CONFLICT (customer_id, job_type, source_ref)
    WHERE status IN ('pending', 'queued', 'running', 'retrying')
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.worker_jobs
    WHERE customer_id = p_customer_id
      AND job_type = p_job_type
      AND source_ref = p_source_ref
      AND status IN ('pending', 'queued', 'running', 'retrying')
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.lifeguard_claim_worker_jobs(
  p_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  id           UUID,
  job_type     TEXT,
  customer_id  UUID,
  source_ref   TEXT,
  payload_json JSONB,
  retry_count  INTEGER,
  max_retries  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.worker_jobs AS wj
    SET status     = 'running',
        started_at = NOW(),
        updated_at = NOW()
    WHERE wj.id IN (
      SELECT j.id
      FROM public.worker_jobs AS j
      WHERE j.status IN ('pending', 'queued', 'retrying')
        AND j.scheduled_at <= NOW()
      ORDER BY j.scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 1)
    )
    RETURNING wj.id, wj.job_type, wj.customer_id, wj.source_ref,
              wj.payload_json, wj.retry_count, wj.max_retries
  )
  SELECT c.id, c.job_type, c.customer_id, c.source_ref,
         c.payload_json, c.retry_count, c.max_retries
  FROM claimed AS c;
END;
$$;
CREATE OR REPLACE FUNCTION public.lifeguard_complete_worker_job(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_count INTEGER;
  v_started_at  TIMESTAMPTZ;
BEGIN
  SELECT retry_count, started_at
    INTO v_retry_count, v_started_at
  FROM public.worker_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_job_not_found: %', p_job_id;
  END IF;
  INSERT INTO public.worker_runs (
    worker_job_id, attempt_number, status, started_at, finished_at
  )
  VALUES (
    p_job_id, v_retry_count + 1, 'completed', COALESCE(v_started_at, NOW()), NOW()
  )
  ON CONFLICT (worker_job_id, attempt_number) DO UPDATE
    SET status = 'completed', finished_at = NOW();
  UPDATE public.worker_jobs
  SET status        = 'completed',
      finished_at   = NOW(),
      error_message = NULL,
      updated_at    = NOW()
  WHERE id = p_job_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.lifeguard_fail_worker_job(
  p_job_id          UUID,
  p_error           TEXT,
  p_backoff_seconds INTEGER DEFAULT 60
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
  v_started_at  TIMESTAMPTZ;
  v_customer_id UUID;
  v_job_type    TEXT;
  v_source_ref  TEXT;
  v_payload     JSONB;
  v_new_count   INTEGER;
  v_backoff     INTEGER;
  v_result      TEXT;
BEGIN
  SELECT retry_count, max_retries, started_at, customer_id, job_type, source_ref, payload_json
    INTO v_retry_count, v_max_retries, v_started_at, v_customer_id, v_job_type, v_source_ref, v_payload
  FROM public.worker_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_job_not_found: %', p_job_id;
  END IF;
  INSERT INTO public.worker_runs (
    worker_job_id, attempt_number, status, started_at, finished_at, error_message
  )
  VALUES (
    p_job_id, v_retry_count + 1, 'failed', COALESCE(v_started_at, NOW()), NOW(), LEFT(p_error, 500)
  )
  ON CONFLICT (worker_job_id, attempt_number) DO UPDATE
    SET status = 'failed', finished_at = NOW(), error_message = LEFT(p_error, 500);
  IF v_retry_count < v_max_retries THEN
    v_new_count := v_retry_count + 1;
    v_backoff   := GREATEST(COALESCE(p_backoff_seconds, 60), 1);
    UPDATE public.worker_jobs
    SET status        = 'retrying',
        retry_count   = v_new_count,
        scheduled_at  = NOW() + make_interval(secs => v_backoff),
        error_message = LEFT(p_error, 500),
        updated_at    = NOW()
    WHERE id = p_job_id;
    INSERT INTO public.retry_queue (
      worker_job_id, attempt_number, next_attempt_at, backoff_seconds
    )
    VALUES (
      p_job_id, v_new_count, NOW() + make_interval(secs => v_backoff), v_backoff
    )
    ON CONFLICT (worker_job_id, attempt_number) DO NOTHING;
    v_result := 'retrying';
  ELSE
    UPDATE public.worker_jobs
    SET status        = 'dead_letter',
        finished_at   = NOW(),
        error_message = LEFT(p_error, 500),
        updated_at    = NOW()
    WHERE id = p_job_id;
    INSERT INTO public.dead_letter_jobs (
      worker_job_id, customer_id, job_type, source_ref, payload_json, retry_count, error_message
    )
    VALUES (
      p_job_id, v_customer_id, v_job_type, v_source_ref,
      COALESCE(v_payload, '{}'::JSONB), v_retry_count, LEFT(p_error, 500)
    )
    ON CONFLICT (worker_job_id) DO NOTHING;
    v_result := 'dead_letter';
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.lifeguard_enqueue_worker_job(TEXT, UUID, TEXT, JSONB, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_complete_worker_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeguard_enqueue_worker_job(TEXT, UUID, TEXT, JSONB, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_complete_worker_job(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) TO service_role;
COMMENT ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) IS
  'A1 runner: atomically claim due worker_jobs (FOR UPDATE SKIP LOCKED) → running.';
COMMENT ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) IS
  'A1 runner: record failed attempt then retry (retry_queue) or dead_letter.';
