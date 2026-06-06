-- =============================================================================
-- LIFEGUARD Core — 010_worker_jobs.sql
-- Worker job queue per WORKER_ARCHITECTURE.md
-- Requires: 001, 002 (customer_profiles, lifeguard_is_admin, lifeguard_set_updated_at)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake worker rows.
-- =============================================================================
--
-- CONSENT REVOKE (service_role handler — CONSENT_ARCHITECTURE §6):
--   On customer_consents.revoked_at set for any consent_type affecting a worker:
--   • UPDATE worker_jobs SET status = 'cancelled', finished_at = now(), error_message = 'cancelled:consent_revoked'
--     WHERE customer_id = :customer_id
--       AND status IN ('pending', 'queued', 'retrying')
--       AND job_type is in scope for that consent (see WORKER_ARCHITECTURE §2 per worker).
--   • UPDATE retry_queue rows for those jobs to cancelled / skip poll.
--   • Do NOT cancel 'running' mid-flight in SQL alone — worker must check consent at start and abort;
--     admin may force-cancel running if revoke handler races.
--
-- IDEMPOTENCY / DEDUP ENQUEUE (application / service_role before INSERT):
--   • payload_json SHOULD include stable ids; worker_jobs.source_ref MUST be set to the canonical key
--     (e.g. document_id, outbox_event id, signal_id, 'memory_rebuild:{version}').
--   • Duplicate enqueue: same (customer_id, job_type, source_ref) while status IN
--     ('pending','queued','running','retrying') → use ON CONFLICT DO NOTHING or skip INSERT
--     (partial unique index notification_events_dedup pattern — see index below).
--   • New work after completed/failed/dead_letter/cancelled may reuse source_ref only if business allows.
--
-- EXECUTION: service_role only (RLS bypass). Customers and agents have NO policies → zero rows.
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_worker_job_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'memory_builder',
    'document_ingest',
    'customer_state',
    'monitoring',
    'outbox_processing',
    'notification_delivery',
    'case_extraction'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_worker_job_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'pending',
    'queued',
    'running',
    'completed',
    'failed',
    'retrying',
    'dead_letter',
    'cancelled'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_worker_job_types() IS
  'Queue job_type values; align with WORKER_ARCHITECTURE.md §2.';

-- ---------------------------------------------------------------------------
-- worker_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE public.worker_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  priority        TEXT NOT NULL DEFAULT 'medium',
  payload_json    JSONB NOT NULL DEFAULT '{}'::JSONB,
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  source_ref      TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries     INTEGER NOT NULL DEFAULT 5 CHECK (max_retries >= 0),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT worker_jobs_type_chk CHECK (
    job_type = ANY (public.lifeguard_worker_job_types())
  ),

  CONSTRAINT worker_jobs_status_chk CHECK (
    status = ANY (public.lifeguard_worker_job_statuses())
  ),

  CONSTRAINT worker_jobs_priority_chk CHECK (
    priority = ANY (public.lifeguard_notification_priorities())
  ),

  CONSTRAINT worker_jobs_running_started_chk CHECK (
    status != 'running' OR started_at IS NOT NULL
  ),

  CONSTRAINT worker_jobs_terminal_finished_chk CHECK (
    status NOT IN ('completed', 'failed', 'dead_letter', 'cancelled')
    OR finished_at IS NOT NULL
  ),

  CONSTRAINT worker_jobs_dead_letter_retries_chk CHECK (
    status != 'dead_letter' OR retry_count >= max_retries
  )
);

COMMENT ON TABLE public.worker_jobs IS
  'Background worker queue; service_role enqueue/dequeue. Consent revoke cancels pending/queued/retrying.';

COMMENT ON COLUMN public.worker_jobs.source_ref IS
  'Idempotency key with customer_id + job_type; e.g. document UUID, outbox id, signal id.';

CREATE INDEX worker_jobs_poll_idx
  ON public.worker_jobs (status, scheduled_at)
  WHERE status IN ('pending', 'queued', 'retrying');

CREATE INDEX worker_jobs_customer_type_idx
  ON public.worker_jobs (customer_id, job_type, created_at DESC);

CREATE INDEX worker_jobs_priority_idx
  ON public.worker_jobs (priority DESC, scheduled_at)
  WHERE status IN ('queued', 'retrying');

-- Idempotent enqueue: one active job per (customer_id, job_type, source_ref)
CREATE UNIQUE INDEX worker_jobs_idempotent_active_uq
  ON public.worker_jobs (customer_id, job_type, source_ref)
  WHERE status IN ('pending', 'queued', 'running', 'retrying');

CREATE TRIGGER worker_jobs_set_updated_at
  BEFORE UPDATE ON public.worker_jobs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- worker_runs (per-attempt audit)
-- ---------------------------------------------------------------------------
CREATE TABLE public.worker_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_job_id   UUID NOT NULL REFERENCES public.worker_jobs (id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL CHECK (attempt_number >= 1),
  status          TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT worker_runs_status_chk CHECK (
    status = ANY (public.lifeguard_worker_job_statuses())
  ),

  CONSTRAINT worker_runs_job_attempt_uq UNIQUE (worker_job_id, attempt_number)
);

COMMENT ON TABLE public.worker_runs IS
  'Execution attempt log per worker_job; service_role writes.';

CREATE INDEX worker_runs_job_id_idx
  ON public.worker_runs (worker_job_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- retry_queue
-- ---------------------------------------------------------------------------
CREATE TABLE public.retry_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_job_id   UUID NOT NULL REFERENCES public.worker_jobs (id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL CHECK (attempt_number >= 1),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  backoff_seconds INTEGER NOT NULL CHECK (backoff_seconds > 0),
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT retry_queue_job_attempt_uq UNIQUE (worker_job_id, attempt_number)
);

COMMENT ON TABLE public.retry_queue IS
  'Scheduled retries; poll next_attempt_at. Cancelled on consent revoke or job cancelled.';

CREATE INDEX retry_queue_due_idx
  ON public.retry_queue (next_attempt_at)
  WHERE cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- dead_letter_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE public.dead_letter_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_job_id   UUID NOT NULL UNIQUE REFERENCES public.worker_jobs (id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL,
  source_ref      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::JSONB,
  retry_count     INTEGER NOT NULL,
  error_message   TEXT,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dead_letter_jobs_type_chk CHECK (
    job_type = ANY (public.lifeguard_worker_job_types())
  )
);

COMMENT ON TABLE public.dead_letter_jobs IS
  'Poison queue after max_retries; admin review only.';

CREATE INDEX dead_letter_jobs_customer_idx
  ON public.dead_letter_jobs (customer_id, failed_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — admin SELECT only; no customer / agent policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.worker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.retry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retry_queue FORCE ROW LEVEL SECURITY;

ALTER TABLE public.dead_letter_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_letter_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_worker_jobs_admin_select
  ON public.worker_jobs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_worker_runs_admin_select
  ON public.worker_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_retry_queue_admin_select
  ON public.retry_queue
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_dead_letter_jobs_admin_select
  ON public.dead_letter_jobs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- service_role: enqueue, run, retry, DLQ move, consent-revoke cancel (bypass RLS).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (real admin JWT + service_role — no demo seed)
-- =============================================================================
--
-- T1: Customer JWT — SELECT worker_jobs → 0 rows
-- T2: Agent JWT — SELECT worker_jobs / worker_runs / retry_queue / dead_letter_jobs → 0 rows
-- T3: Admin JWT — SELECT all four tables → OK
-- T4: service_role — INSERT worker_jobs (document_ingest, source_ref=document_uuid) → OK
-- T5: Duplicate (customer_id, job_type, source_ref) while pending → unique violation / skip enqueue
-- T6: Consent revoke handler — pending/queued/retrying → cancelled; running left to worker abort
-- T7: retry_count >= max_retries → status dead_letter + dead_letter_jobs row (application)
-- T8: invalid job_type / status → CHECK fails
-- T9: Repo — no demo worker seed files
--
-- STATUS FLOW (worker_jobs.status):
--   pending → queued → running → completed
--   running → failed → retrying → queued (via retry_queue.next_attempt_at)
--   retrying → running (attempt) | failed → dead_letter (max_retries)
--   any → cancelled (consent revoke on pending|queued|retrying, or admin)
--
