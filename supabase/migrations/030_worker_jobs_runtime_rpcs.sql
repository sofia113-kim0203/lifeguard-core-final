-- =============================================================================
-- LIFEGUARD Core — 030_worker_jobs_runtime_rpcs.sql
-- A1 worker jobs runtime RPCs (service_role only).
-- Requires: 010_worker_jobs.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- lifeguard_enqueue_worker_job — idempotent active enqueue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_enqueue_worker_job(
  p_job_type TEXT,
  p_customer_id UUID,
  p_source_ref TEXT,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_priority TEXT DEFAULT 'medium',
  p_max_retries INTEGER DEFAULT 5
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  IF p_job_type IS NULL OR p_customer_id IS NULL OR p_source_ref IS NULL THEN
    RAISE EXCEPTION 'job_type_customer_id_source_ref_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_job_type <> ALL (public.lifeguard_worker_job_types()) THEN
    RAISE EXCEPTION 'invalid_job_type'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.worker_jobs (
    job_type,
    status,
    priority,
    payload_json,
    customer_id,
    source_ref,
    max_retries
  )
  VALUES (
    p_job_type,
    'queued',
    COALESCE(p_priority, 'medium'),
    COALESCE(p_payload, '{}'::JSONB),
    p_customer_id,
    p_source_ref,
    COALESCE(p_max_retries, 5)
  )
  ON CONFLICT (customer_id, job_type, source_ref)
    WHERE status IN ('pending', 'queued', 'running', 'retrying')
  DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NOT NULL THEN
    RETURN v_job_id;
  END IF;

  SELECT wj.id
  INTO v_job_id
  FROM public.worker_jobs wj
  WHERE wj.customer_id = p_customer_id
    AND wj.job_type = p_job_type
    AND wj.source_ref = p_source_ref
    AND wj.status IN ('pending', 'queued', 'running', 'retrying')
  ORDER BY wj.created_at DESC
  LIMIT 1;

  RETURN v_job_id;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_enqueue_worker_job(TEXT, UUID, TEXT, JSONB, TEXT, INTEGER) IS
  'A1 runtime: idempotent enqueue for active worker_jobs (service_role).';

-- ---------------------------------------------------------------------------
-- lifeguard_claim_worker_jobs — atomically claim due jobs → running
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_claim_worker_jobs(
  p_limit INTEGER DEFAULT 5
)
RETURNS SETOF public.worker_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.worker_jobs%ROWTYPE;
  v_limit INTEGER;
  v_attempt INTEGER;
BEGIN
  v_limit := GREATEST(LEAST(COALESCE(p_limit, 5), 50), 0);
  IF v_limit = 0 THEN
    RETURN;
  END IF;

  FOR v_job IN
    SELECT *
    FROM public.worker_jobs
    WHERE status IN ('pending', 'queued', 'retrying')
      AND scheduled_at <= NOW()
    ORDER BY priority DESC, scheduled_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_attempt := COALESCE(v_job.retry_count, 0) + 1;

    UPDATE public.worker_jobs
    SET status = 'running',
        started_at = COALESCE(started_at, NOW()),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = v_job.id
    RETURNING * INTO v_job;

    INSERT INTO public.worker_runs (worker_job_id, attempt_number, status, started_at)
    VALUES (v_job.id, v_attempt, 'running', NOW())
    ON CONFLICT (worker_job_id, attempt_number) DO NOTHING;

    RETURN NEXT v_job;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) IS
  'A1 runner: atomically claim due worker_jobs (FOR UPDATE SKIP LOCKED) → running.';

-- ---------------------------------------------------------------------------
-- lifeguard_complete_worker_job
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_complete_worker_job(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id_required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.worker_jobs
  SET status = 'completed',
      finished_at = v_now,
      error_message = NULL,
      updated_at = v_now
  WHERE id = p_job_id
    AND status = 'running';

  UPDATE public.worker_runs
  SET status = 'completed',
      finished_at = v_now
  WHERE worker_job_id = p_job_id
    AND status = 'running'
    AND finished_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_complete_worker_job(UUID) IS
  'A1 runner: mark a running worker_job completed and close open worker_run.';

-- ---------------------------------------------------------------------------
-- lifeguard_fail_worker_job — failed attempt → retry_queue or dead_letter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_fail_worker_job(
  p_job_id UUID,
  p_error TEXT,
  p_backoff_seconds INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.worker_jobs%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_next_retry INTEGER;
  v_backoff INTEGER;
  v_error TEXT;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id_required'
      USING ERRCODE = '22023';
  END IF;

  v_error := LEFT(COALESCE(p_error, 'worker_job_failed'), 500);

  SELECT *
  INTO v_job
  FROM public.worker_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_next_retry := COALESCE(v_job.retry_count, 0) + 1;

  UPDATE public.worker_runs
  SET status = 'failed',
      finished_at = v_now,
      error_message = v_error
  WHERE worker_job_id = p_job_id
    AND status = 'running'
    AND finished_at IS NULL;

  IF v_next_retry >= v_job.max_retries THEN
    UPDATE public.worker_jobs
    SET status = 'dead_letter',
        retry_count = v_next_retry,
        finished_at = v_now,
        error_message = v_error,
        updated_at = v_now
    WHERE id = p_job_id;

    INSERT INTO public.dead_letter_jobs (
      worker_job_id,
      customer_id,
      job_type,
      source_ref,
      payload_json,
      retry_count,
      error_message,
      failed_at
    )
    VALUES (
      v_job.id,
      v_job.customer_id,
      v_job.job_type,
      v_job.source_ref,
      v_job.payload_json,
      v_next_retry,
      v_error,
      v_now
    )
    ON CONFLICT (worker_job_id) DO UPDATE
    SET retry_count = EXCLUDED.retry_count,
        error_message = EXCLUDED.error_message,
        failed_at = EXCLUDED.failed_at;

    RETURN;
  END IF;

  v_backoff := COALESCE(
    p_backoff_seconds,
    CASE v_next_retry
      WHEN 1 THEN 30
      WHEN 2 THEN 120
      WHEN 3 THEN 600
      ELSE 3600
    END
  );

  UPDATE public.worker_jobs
  SET status = 'retrying',
      retry_count = v_next_retry,
      scheduled_at = v_now + make_interval(secs => v_backoff),
      finished_at = NULL,
      error_message = v_error,
      updated_at = v_now
  WHERE id = p_job_id;

  INSERT INTO public.retry_queue (
    worker_job_id,
    attempt_number,
    next_attempt_at,
    backoff_seconds
  )
  VALUES (
    p_job_id,
    v_next_retry,
    v_now + make_interval(secs => v_backoff),
    v_backoff
  )
  ON CONFLICT (worker_job_id, attempt_number) DO UPDATE
  SET next_attempt_at = EXCLUDED.next_attempt_at,
      backoff_seconds = EXCLUDED.backoff_seconds,
      cancelled_at = NULL;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) IS
  'A1 runner: record failed attempt then retry (retry_queue) or dead_letter.';

-- ---------------------------------------------------------------------------
-- Grants — service_role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.lifeguard_enqueue_worker_job(TEXT, UUID, TEXT, JSONB, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_complete_worker_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lifeguard_enqueue_worker_job(TEXT, UUID, TEXT, JSONB, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_claim_worker_jobs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_complete_worker_job(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lifeguard_fail_worker_job(UUID, TEXT, INTEGER) TO service_role;

COMMIT;
