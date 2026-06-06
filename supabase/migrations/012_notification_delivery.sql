-- =============================================================================
-- LIFEGUARD Core — 012_notification_delivery.sql
-- Notification delivery execution audit per NOTIFICATION_SERVICE.md
-- Requires: 002, 009 (notification_events), 010 (worker_jobs)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake delivery rows.
-- No Kakao/SMS/email provider SDK — provider_ref is audit placeholder only.
-- =============================================================================
--
-- PIPELINE (service_role — notification-worker):
--   notification_events (009)
--     → notification_delivery_runs (this migration)
--     → notification_delivery_attempts (per provider try)
--     → UPDATE notification_events.status → sending | sent | failed
--
-- -----------------------------------------------------------------------------
-- STATUS MAPPING: notification_events (009) ↔ notification_delivery_runs (012)
-- Separate state machines. Worker must update BOTH consistently.
-- -----------------------------------------------------------------------------
--
-- | notification_events.status (009)     | notification_delivery_runs.status (012) | Notes |
-- |--------------------------------------|-------------------------------------------|-------|
-- | queued                               | pending                                   | Run created; not yet sending |
-- | scheduled                            | pending                                   | scheduled_at in future; run may wait |
-- | sending                              | sending                                   | Worker claimed delivery |
-- | sent                                 | sent                                      | Terminal success |
-- | failed                               | failed                                    | Terminal failure |
-- | failed                               | dead_letter                               | Max retries on attempts exceeded |
-- | (n/a on 009)                         | retrying                                  | Backoff before next attempt_number |
-- | cancelled                            | cancelled                                 | consent revoke / admin / blocked path |
-- | blocked_by_consent                   | cancelled (or no run)                     | Prefer no run INSERT; event stays blocked |
-- | blocked_by_preference                | cancelled (or no run)                     | Same — outbox-worker should not enqueue send |
--
-- Worker transitions (application):
--   1. Claim: notification_events.queued|scheduled → sending; run → sending; started_at = now()
--   2. in_app: attempt → sent without external API; run → sent; event → sent; sent_at = now()
--   3. email/kakao/sms/push: attempt provider_ref NULL or adapter_not_configured until integrated
--   4. Retry: run → retrying → sending; new attempt row with attempt_number + 1
--   5. Terminal: run → dead_letter; event → failed; failed_at = now()
--
-- -----------------------------------------------------------------------------
-- IDEMPOTENCY
-- -----------------------------------------------------------------------------
--   • UNIQUE (notification_event_id) on notification_delivery_runs — one run per event.
--   • UNIQUE (notification_event_id, channel) on runs — no duplicate channel dispatch per event.
--   • Retries: same run; notification_delivery_attempts.attempt_number increments (UNIQUE per event+attempt).
--   • worker_jobs (010): job_type = notification_delivery, source_ref = notification_event.id::text
--
-- -----------------------------------------------------------------------------
-- CONSENT GATE
-- -----------------------------------------------------------------------------
--   • All channels: lifeguard_has_consent(customer_id, 'notification_delivery') before sending.
--   • event_type = marketing_promotional: also lifeguard_has_consent(customer_id, 'marketing_optional').
--   • On consent revoke: UPDATE runs/attempts SET status = cancelled, error_message = 'cancelled:consent_revoked'
--       WHERE status IN ('pending', 'sending', 'retrying')
--       AND notification_event_id IN (SELECT id FROM notification_events WHERE customer_id = :id).
--   • Mid-flight sending: worker re-checks consent; abort → cancelled attempts + event failed if needed.
--
-- RLS: customer / agent — no policies (zero rows). Admin SELECT only. service_role executes (002 bypass).
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_notification_delivery_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'pending',
    'sending',
    'sent',
    'failed',
    'retrying',
    'dead_letter',
    'cancelled'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_notification_delivery_statuses() IS
  '012 delivery run/attempt status; distinct from notification_events.status in 009.';

-- ---------------------------------------------------------------------------
-- notification_delivery_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_delivery_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_job_id         UUID REFERENCES public.worker_jobs (id) ON DELETE SET NULL,
  notification_event_id UUID NOT NULL REFERENCES public.notification_events (id) ON DELETE CASCADE,
  channel               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_delivery_runs_channel_chk CHECK (
    channel = ANY (public.lifeguard_notification_channels())
  ),

  CONSTRAINT notification_delivery_runs_status_chk CHECK (
    status = ANY (public.lifeguard_notification_delivery_statuses())
  ),

  CONSTRAINT notification_delivery_runs_event_uq UNIQUE (notification_event_id),

  CONSTRAINT notification_delivery_runs_event_channel_uq UNIQUE (
    notification_event_id,
    channel
  ),

  CONSTRAINT notification_delivery_runs_sending_started_chk CHECK (
    status != 'sending' OR started_at IS NOT NULL
  ),

  CONSTRAINT notification_delivery_runs_terminal_finished_chk CHECK (
    status NOT IN ('sent', 'failed', 'dead_letter', 'cancelled')
    OR finished_at IS NOT NULL
  )
);

COMMENT ON TABLE public.notification_delivery_runs IS
  'One delivery run per notification_event_id; notification-worker (service_role) only.';

CREATE INDEX notification_delivery_runs_status_idx
  ON public.notification_delivery_runs (status, created_at)
  WHERE status IN ('pending', 'sending', 'retrying');

CREATE INDEX notification_delivery_runs_worker_job_idx
  ON public.notification_delivery_runs (worker_job_id)
  WHERE worker_job_id IS NOT NULL;

CREATE TRIGGER notification_delivery_runs_set_updated_at
  BEFORE UPDATE ON public.notification_delivery_runs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_delivery_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_delivery_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id UUID NOT NULL REFERENCES public.notification_events (id) ON DELETE CASCADE,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number >= 1),
  channel               TEXT NOT NULL,
  provider_ref          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_delivery_attempts_channel_chk CHECK (
    channel = ANY (public.lifeguard_notification_channels())
  ),

  CONSTRAINT notification_delivery_attempts_status_chk CHECK (
    status = ANY (public.lifeguard_notification_delivery_statuses())
  ),

  CONSTRAINT notification_delivery_attempts_event_attempt_uq UNIQUE (
    notification_event_id,
    attempt_number
  ),

  CONSTRAINT notification_delivery_attempts_sent_provider_chk CHECK (
    status != 'sent' OR channel = 'in_app' OR provider_ref IS NOT NULL
  )
);

COMMENT ON TABLE public.notification_delivery_attempts IS
  'Per-attempt provider audit; retries increment attempt_number on same event/run.';

COMMENT ON COLUMN public.notification_delivery_attempts.provider_ref IS
  'External message id when adapter exists; NULL for in_app or not yet integrated.';

CREATE INDEX notification_delivery_attempts_event_idx
  ON public.notification_delivery_attempts (notification_event_id, attempt_number DESC);

CREATE INDEX notification_delivery_attempts_active_idx
  ON public.notification_delivery_attempts (status)
  WHERE status IN ('pending', 'sending', 'retrying');

CREATE TRIGGER notification_delivery_attempts_set_updated_at
  BEFORE UPDATE ON public.notification_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — admin SELECT only; customer / agent: no access
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_delivery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_notification_delivery_runs_admin_select
  ON public.notification_delivery_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_notification_delivery_attempts_admin_select
  ON public.notification_delivery_attempts
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- service_role: notification-worker INSERT/UPDATE runs and attempts; sync notification_events.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (admin JWT + service_role — no demo seed)
-- =============================================================================
--
-- T1: Customer JWT — SELECT notification_delivery_runs → 0 rows
-- T2: Agent JWT — SELECT notification_delivery_attempts → 0 rows
-- T3: Admin — SELECT both tables → OK
-- T4: service_role — INSERT run for notification_event_id → OK; duplicate event_id → UNIQUE violation
-- T5: Duplicate (notification_event_id, channel) on runs → UNIQUE violation
-- T6: Retry — second attempt_number=2 on same event → OK; duplicate attempt_number → UNIQUE violation
-- T7: Consent revoke — pending/sending/retrying → cancelled
-- T8: marketing_promotional without marketing_optional — worker must not send (consent gate)
-- T9: in_app sent without provider_ref → OK; email sent without provider_ref → CHECK fails
-- T10: Repo — no demo notification delivery seed
--
