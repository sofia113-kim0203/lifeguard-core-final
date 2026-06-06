-- =============================================================================
-- LIFEGUARD Core — 011_outbox_processing.sql
-- Outbox processing audit per WORKER_ARCHITECTURE.md (outbox-worker)
-- Requires: 001 (outbox_events), 002, 009 (notification_events), 010 (worker_jobs)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake outbox processing rows.
-- =============================================================================
--
-- PIPELINE (service_role — outbox-worker):
--   outbox_events (001)
--     → outbox_processing_runs (this migration)
--     → outbox_delivery_attempts (per target)
--     → notification_events (009) | agent escalation | future integrations
--
-- EVENT_TYPE families (outbox_events.event_type — not enforced on 001; classified here):
--   monitoring.*          e.g. monitoring.signal.detected, monitoring.rebalancing.review
--   consent.*             e.g. consent.reconsent.required, consent.revoked
--   document.ingest.*     e.g. document.ingest.completed, document.ingest.failed
--   agent.escalation.*    e.g. agent.escalation.requested
--   notification.*        future customer/marketing bus events
--
-- -----------------------------------------------------------------------------
-- STATUS MAPPING: outbox_events (001) ↔ outbox_processing_runs (011)
-- Two separate state machines. Worker must update BOTH consistently.
-- -----------------------------------------------------------------------------
--
-- | outbox_events.status (001) | Typical outbox_processing_runs.status (011) | Notes |
-- |----------------------------|---------------------------------------------|-------|
-- | pending                    | pending                                     | Run row created; not yet claimed |
-- | pending                    | processing                                  | Worker claimed; deliveries in flight |
-- | processing                 | processing                                  | 001 row set processing when run starts |
-- | processed                  | completed                                   | All targets done or intentionally skipped |
-- | failed                     | failed                                      | Terminal error; may retry → retrying |
-- | failed                     | dead_letter                                 | Max retries exceeded (mirror worker_jobs DLQ) |
-- | (any)                      | retrying                                    | Backoff before re-attempt; 001 may stay processing or revert pending |
-- | (n/a on 001)               | cancelled                                   | consent revoke or admin cancel on pending/processing/retrying |
--
-- Worker transitions (application):
--   1. Claim: outbox_events.pending → processing; INSERT/UPDATE run → processing
--   2. Success: run → completed; outbox_events → processed; processed_at = now()
--   3. Retryable fail: run → failed → retrying; attempts logged
--   4. Terminal fail: run → dead_letter; outbox_events → failed
--   5. Revoke/cancel: run → cancelled; outbox_events may stay pending or → failed per handler
--
-- -----------------------------------------------------------------------------
-- IDEMPOTENCY
-- -----------------------------------------------------------------------------
--   • One outbox_processing_runs row per outbox_event_id (UNIQUE) — no duplicate processing.
--   • One outbox_delivery_attempts row per (outbox_event_id, target_type, target_ref).
--   • worker_jobs (010): job_type = outbox_processing, source_ref = outbox_event.id::text
--
-- -----------------------------------------------------------------------------
-- CONSENT GATE (service_role — before customer-facing delivery)
-- -----------------------------------------------------------------------------
--   • notification_events path: lifeguard_has_consent(customer_id, 'notification_delivery')
--   • agent escalation / summary path: lifeguard_has_consent(customer_id, 'agent_sharing') when payload exposes memory-derived handoff
--   • marketing.* / notification.promotional: marketing_optional
--   • On consent revoke: UPDATE runs/attempts SET status = cancelled
--       WHERE status IN ('pending', 'processing', 'retrying')
--       AND customer_id = :customer_id (from outbox_events join)
--   • running deliveries: worker re-checks consent; abort and cancel attempts if revoked mid-flight
--
-- RLS: no customer / agent policies. Admin SELECT only. service_role executes (002 bypass).
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_outbox_processing_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'pending',
    'processing',
    'completed',
    'failed',
    'retrying',
    'dead_letter',
    'cancelled'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_outbox_delivery_target_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'notification_event',
    'agent_escalation',
    'integration_hook'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_outbox_processing_statuses() IS
  '011 run/attempt status; distinct from outbox_events.status in 001.';

-- ---------------------------------------------------------------------------
-- outbox_processing_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.outbox_processing_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_job_id    UUID REFERENCES public.worker_jobs (id) ON DELETE SET NULL,
  outbox_event_id  UUID NOT NULL REFERENCES public.outbox_events (id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT outbox_processing_runs_status_chk CHECK (
    status = ANY (public.lifeguard_outbox_processing_statuses())
  ),

  CONSTRAINT outbox_processing_runs_outbox_event_uq UNIQUE (outbox_event_id),

  CONSTRAINT outbox_processing_runs_processing_started_chk CHECK (
    status != 'processing' OR started_at IS NOT NULL
  ),

  CONSTRAINT outbox_processing_runs_terminal_finished_chk CHECK (
    status NOT IN ('completed', 'failed', 'dead_letter', 'cancelled')
    OR finished_at IS NOT NULL
  )
);

COMMENT ON TABLE public.outbox_processing_runs IS
  'One audit run per outbox_event_id; links worker_job and delivery attempts.';

CREATE INDEX outbox_processing_runs_status_idx
  ON public.outbox_processing_runs (status, created_at)
  WHERE status IN ('pending', 'processing', 'retrying');

CREATE INDEX outbox_processing_runs_worker_job_idx
  ON public.outbox_processing_runs (worker_job_id)
  WHERE worker_job_id IS NOT NULL;

CREATE INDEX outbox_processing_runs_event_type_idx
  ON public.outbox_processing_runs (event_type);

CREATE TRIGGER outbox_processing_runs_set_updated_at
  BEFORE UPDATE ON public.outbox_processing_runs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- outbox_delivery_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE public.outbox_delivery_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id  UUID NOT NULL REFERENCES public.outbox_events (id) ON DELETE CASCADE,
  attempt_number   INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  target_type      TEXT NOT NULL,
  target_ref       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT outbox_delivery_attempts_status_chk CHECK (
    status = ANY (public.lifeguard_outbox_processing_statuses())
  ),

  CONSTRAINT outbox_delivery_attempts_target_type_chk CHECK (
    target_type = ANY (public.lifeguard_outbox_delivery_target_types())
  ),

  CONSTRAINT outbox_delivery_attempts_target_uq UNIQUE (
    outbox_event_id,
    target_type,
    target_ref
  )
);

COMMENT ON TABLE public.outbox_delivery_attempts IS
  'Per-target delivery audit: notification_event id, agent_escalation ref, future hooks.';

COMMENT ON COLUMN public.outbox_delivery_attempts.target_ref IS
  'notification_events.id, agent_assignments.id, or external integration key — no PII blob.';

CREATE INDEX outbox_delivery_attempts_outbox_idx
  ON public.outbox_delivery_attempts (outbox_event_id, created_at DESC);

CREATE INDEX outbox_delivery_attempts_active_idx
  ON public.outbox_delivery_attempts (status)
  WHERE status IN ('pending', 'processing', 'retrying');

CREATE TRIGGER outbox_delivery_attempts_set_updated_at
  BEFORE UPDATE ON public.outbox_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — admin SELECT only; customer / agent: no access
-- ---------------------------------------------------------------------------
ALTER TABLE public.outbox_processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_processing_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.outbox_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_outbox_processing_runs_admin_select
  ON public.outbox_processing_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_outbox_delivery_attempts_admin_select
  ON public.outbox_delivery_attempts
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- service_role: outbox-worker INSERT/UPDATE runs and attempts; updates outbox_events.status (001).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (admin JWT + service_role — no demo seed)
-- =============================================================================
--
-- T1: Customer JWT — SELECT outbox_processing_runs → 0 rows
-- T2: Agent JWT — SELECT outbox_delivery_attempts → 0 rows
-- T3: Admin — SELECT both tables → OK
-- T4: service_role — INSERT run for outbox_event_id → OK; duplicate outbox_event_id → UNIQUE violation
-- T5: Duplicate (outbox_event_id, target_type, target_ref) on attempts → UNIQUE violation
-- T6: Consent revoke — pending/processing/retrying runs/attempts → cancelled (application handler)
-- T7: notification path without notification_delivery → attempt cancelled/failed + error_message
-- T8: completed run ↔ outbox_events.processed (mapping table in header)
-- T9: Repo — no demo outbox processing seed
--
