-- LIFEGUARD Core — 009_notification_service.sql
-- Notification preferences, events, templates per NOTIFICATION_SERVICE.md
-- Requires: 001, 002, 004 (consent helpers)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake notification rows or templates.
-- =============================================================================
--
-- OUTBOX → notification_events (outbox-worker, service_role):
--   • monitoring.signal.detected, monitoring.rebalancing.review, monitoring.coverage.review,
--     monitoring.claim.documents_ready, monitoring.disclosure.review
--   • consent.reconsent.required
--   • document.ingest.completed, document.ingest.failed
--   Before INSERT notification_events:
--     1. lifeguard_has_consent(customer_id, 'notification_delivery') OR status blocked_by_consent
--     2. marketing event_type → lifeguard_has_consent(customer_id, 'marketing_optional')
--     3. agent-facing copy paths → lifeguard_has_consent(customer_id, 'agent_sharing') when applicable
--   notification-worker (service_role): channel adapters → sent | failed (no external provider in repo)
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_notification_channels()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'in_app',
    'email',
    'kakao_alimtalk',
    'sms',
    'push'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_notification_event_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'queued',
    'scheduled',
    'sending',
    'sent',
    'failed',
    'cancelled',
    'blocked_by_consent',
    'blocked_by_preference'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_notification_priorities()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['critical', 'high', 'medium', 'low']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_notification_event_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'renewal_risk',
    'premium_burden',
    'coverage_gap',
    'claim_opportunity',
    'disclosure_risk',
    'agent_escalation_needed',
    'consent_reconsent',
    'document_ingest_completed',
    'document_ingest_failed',
    'marketing_promotional'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_notification_source_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'outbox_event',
    'monitoring_signal',
    'customer_document',
    'customer_consent',
    'system'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_notification_template_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['draft', 'active', 'retired']::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- notification_templates (admin-managed; no seed rows in this migration)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key          TEXT NOT NULL,
  channel               TEXT NOT NULL,
  title_template        TEXT NOT NULL,
  body_template         TEXT NOT NULL,
  required_consent_type TEXT,
  status                TEXT NOT NULL DEFAULT 'draft',
  version               TEXT NOT NULL DEFAULT '1.0.0',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_templates_channel_chk CHECK (
    channel = ANY (public.lifeguard_notification_channels())
  ),

  CONSTRAINT notification_templates_status_chk CHECK (
    status = ANY (public.lifeguard_notification_template_statuses())
  ),

  CONSTRAINT notification_templates_consent_chk CHECK (
    required_consent_type IS NULL
    OR required_consent_type = ANY (public.lifeguard_consent_types())
  ),

  CONSTRAINT notification_templates_key_channel_version_uq UNIQUE (
    template_key,
    channel,
    version
  )
);

COMMENT ON TABLE public.notification_templates IS
  'Channel templates; body must follow COMMUNICATION_ENGINE.md. No demo rows shipped.';

CREATE INDEX notification_templates_active_idx
  ON public.notification_templates (template_key, channel)
  WHERE status = 'active';

CREATE TRIGGER notification_templates_set_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_preferences (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  channel              TEXT NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_json     JSONB NOT NULL DEFAULT '{}'::JSONB,
  frequency_limit_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_preferences_channel_chk CHECK (
    channel = ANY (public.lifeguard_notification_channels())
  ),

  CONSTRAINT notification_preferences_customer_channel_uq UNIQUE (customer_id, channel)
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-customer channel toggles and quiet hours / frequency caps.';

CREATE INDEX notification_preferences_customer_id_idx
  ON public.notification_preferences (customer_id);

CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_events
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  channel           TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  priority          TEXT NOT NULL DEFAULT 'medium',
  source_type       TEXT NOT NULL,
  source_ref        TEXT NOT NULL,
  consent_snapshot  JSONB NOT NULL DEFAULT '{}'::JSONB,
  scheduled_at      TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_events_type_chk CHECK (
    event_type = ANY (public.lifeguard_notification_event_types())
  ),

  CONSTRAINT notification_events_channel_chk CHECK (
    channel = ANY (public.lifeguard_notification_channels())
  ),

  CONSTRAINT notification_events_status_chk CHECK (
    status = ANY (public.lifeguard_notification_event_statuses())
  ),

  CONSTRAINT notification_events_priority_chk CHECK (
    priority = ANY (public.lifeguard_notification_priorities())
  ),

  CONSTRAINT notification_events_source_type_chk CHECK (
    source_type = ANY (public.lifeguard_notification_source_types())
  ),

  CONSTRAINT notification_events_sent_chk CHECK (
    status != 'sent' OR sent_at IS NOT NULL
  ),

  CONSTRAINT notification_events_failed_chk CHECK (
    status != 'failed' OR failed_at IS NOT NULL
  ),

  CONSTRAINT notification_events_scheduled_chk CHECK (
    status != 'scheduled' OR scheduled_at IS NOT NULL
  )
);

COMMENT ON TABLE public.notification_events IS
  'Delivery queue; created by outbox-worker (service_role). Customers read own rows only.';

CREATE INDEX notification_events_customer_created_idx
  ON public.notification_events (customer_id, created_at DESC);

CREATE INDEX notification_events_status_scheduled_idx
  ON public.notification_events (status, scheduled_at)
  WHERE status IN ('queued', 'scheduled', 'sending');

CREATE INDEX notification_events_priority_idx
  ON public.notification_events (priority, created_at DESC);

-- Dedup: same source_ref + event_type + channel while still actionable
CREATE UNIQUE INDEX notification_events_dedup_active_uq
  ON public.notification_events (customer_id, event_type, channel, source_ref)
  WHERE status NOT IN (
    'cancelled',
    'failed',
    'blocked_by_consent',
    'blocked_by_preference',
    'sent'
  );

CREATE TRIGGER notification_events_set_updated_at
  BEFORE UPDATE ON public.notification_events
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- Customer preference update guard (enabled + JSON only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_customer_notification_preference_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.lifeguard_is_customer()
     AND NOT public.lifeguard_is_admin() THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'customers may only update notification preference fields'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_notification_preference_only
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_customer_notification_preference_only();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates FORCE ROW LEVEL SECURITY;

-- Customer: preferences SELECT + UPDATE (+ INSERT own row for channel setup)
CREATE POLICY lg_notification_preferences_customer_select_own
  ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_notification_preferences_customer_insert_own
  ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
  );

CREATE POLICY lg_notification_preferences_customer_update_own
  ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
  )
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- Customer: events SELECT own only; no INSERT/UPDATE
CREATE POLICY lg_notification_events_customer_select_own
  ON public.notification_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- Agents: no policies on notification_events / preferences — no raw notification body access.

-- Admin
CREATE POLICY lg_notification_preferences_admin_select
  ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_notification_events_admin_select
  ON public.notification_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_notification_events_admin_update
  ON public.notification_events
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_notification_templates_admin_select
  ON public.notification_templates
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_notification_templates_admin_insert
  ON public.notification_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_notification_templates_admin_update
  ON public.notification_templates
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

-- service_role: outbox-worker INSERT events; notification-worker UPDATE status/sent_at.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (real JWT + service_role — no demo seed)
-- =============================================================================
--
-- T1: Customer A — SELECT notification_events → own rows only
-- T2: Customer A — SELECT WHERE customer_id = B → 0 rows
-- T3: Customer A — INSERT notification_events → RLS violation
-- T4: service_role — INSERT event without notification_delivery consent → worker sets blocked_by_consent
-- T5: Customer A — preference enabled=false for email → new email event → blocked_by_preference
-- T6: Duplicate (customer_id, event_type, channel, source_ref) while queued → unique violation
-- T7: Agent JWT — SELECT notification_events → 0 rows
-- T8: critical priority event — in_app may send when push disabled (worker policy in NOTIFICATION_SERVICE.md)
-- T9: marketing_promotional without marketing_optional → blocked_by_consent
-- T10: Admin — SELECT events + templates
-- T11: Repo — no demo notification seed SQL files
--

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

