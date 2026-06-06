-- =============================================================================
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
