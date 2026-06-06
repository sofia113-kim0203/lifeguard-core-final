-- =============================================================================
-- LIFEGUARD Core — 008_monitoring_signals.sql
-- Monitoring signals + detection runs per LIFEGUARD_MONITORING_ENGINE.md
-- Requires: 001, 002, 004, 007 (optional source_state_snapshot_id FK)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake monitoring rows.
-- =============================================================================
--
-- OUTBOX (application / service_role after signal publish):
--   1. Check lifeguard_has_consent(customer_id, 'notification_delivery') before push.
--   2. INSERT outbox_events e.g. monitoring.signal.detected, monitoring.rebalancing.review,
--      monitoring.coverage.review, monitoring.claim.documents_ready, monitoring.disclosure.review.
--   3. signal_type = agent_escalation_needed → may also emit agent.escalation.requested
--      (payload: customer_id, signal_id, trigger_codes — no PII blob).
--   4. Customers cannot INSERT outbox rows (002).
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_signal_types()
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
    'family_change',
    'agent_escalation_needed',
    'consent_expiry'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_severities()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['critical', 'high', 'medium', 'low']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_signal_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'open',
    'notified',
    'resolved',
    'dismissed',
    'expired'
  ]::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- monitoring_detection_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.monitoring_detection_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type        TEXT NOT NULL
                  CHECK (run_type IN ('scheduled', 'event', 'single_customer')),
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  customer_count  INTEGER NOT NULL DEFAULT 0 CHECK (customer_count >= 0),
  signal_count    INTEGER NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  error_message   TEXT,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.monitoring_detection_runs IS
  'Batch or per-customer detector run audit; service_role writes.';

CREATE INDEX monitoring_detection_runs_started_at_idx
  ON public.monitoring_detection_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- customer_monitoring_signals
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_monitoring_signals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  signal_type              TEXT NOT NULL,
  severity                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open',
  title                    TEXT NOT NULL,
  summary                  TEXT NOT NULL,
  evidence_refs            JSONB NOT NULL DEFAULT '[]'::JSONB,
  confidence               NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  source_state_snapshot_id UUID REFERENCES public.customer_state_snapshots (id) ON DELETE SET NULL,
  detection_run_id         UUID REFERENCES public.monitoring_detection_runs (id) ON DELETE SET NULL,
  consent_snapshot         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ,
  dismissed_at             TIMESTAMPTZ,

  CONSTRAINT customer_monitoring_signals_type_chk CHECK (
    signal_type = ANY (public.lifeguard_monitoring_signal_types())
  ),

  CONSTRAINT customer_monitoring_signals_severity_chk CHECK (
    severity = ANY (public.lifeguard_monitoring_severities())
  ),

  CONSTRAINT customer_monitoring_signals_status_chk CHECK (
    status = ANY (public.lifeguard_monitoring_signal_statuses())
  ),

  CONSTRAINT customer_monitoring_signals_confidence_chk CHECK (
    confidence >= 0 AND confidence <= 1
  ),

  CONSTRAINT customer_monitoring_signals_dismissed_chk CHECK (
    status != 'dismissed' OR dismissed_at IS NOT NULL
  ),

  CONSTRAINT customer_monitoring_signals_resolved_chk CHECK (
    status != 'resolved' OR resolved_at IS NOT NULL
  )
);

COMMENT ON TABLE public.customer_monitoring_signals IS
  'Proactive customer signals from grounded detectors; evidence_refs only — no inference.';

CREATE INDEX customer_monitoring_signals_customer_id_idx
  ON public.customer_monitoring_signals (customer_id);

CREATE INDEX customer_monitoring_signals_customer_created_idx
  ON public.customer_monitoring_signals (customer_id, created_at DESC);

CREATE INDEX customer_monitoring_signals_type_idx
  ON public.customer_monitoring_signals (signal_type);

CREATE INDEX customer_monitoring_signals_status_idx
  ON public.customer_monitoring_signals (status);

CREATE INDEX customer_monitoring_signals_open_idx
  ON public.customer_monitoring_signals (customer_id, severity)
  WHERE status IN ('open', 'notified');

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_open_customer_monitoring_signals
WITH (security_invoker = true)
AS
SELECT
  id,
  customer_id,
  signal_type,
  severity,
  status,
  title,
  summary,
  confidence,
  evidence_refs,
  created_at
FROM public.customer_monitoring_signals
WHERE status IN ('open', 'notified')
  AND dismissed_at IS NULL
  AND resolved_at IS NULL;

COMMENT ON VIEW public.lifeguard_open_customer_monitoring_signals IS
  'Open actionable signals; RLS applies for customer own rows.';

CREATE OR REPLACE VIEW public.lifeguard_agent_monitoring_signal_summary AS
SELECT
  s.id,
  s.customer_id,
  s.signal_type,
  s.severity,
  s.status,
  s.title,
  s.summary,
  s.confidence,
  s.created_at
FROM public.customer_monitoring_signals s
WHERE s.severity IN ('critical', 'high')
  AND s.status IN ('open', 'notified')
  AND s.dismissed_at IS NULL
  AND s.resolved_at IS NULL
  AND public.lifeguard_is_agent()
  AND public.lifeguard_agent_assigned_to_customer(s.customer_id);

COMMENT ON VIEW public.lifeguard_agent_monitoring_signal_summary IS
  'Assigned customers: high/critical open signals only; no evidence_refs dump to agents via API policy.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_monitoring_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_monitoring_signals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.monitoring_detection_runs ENABLE ROW LEVEL SECURITY;

-- Customer: SELECT own
CREATE POLICY lg_monitoring_signals_customer_select_own
  ON public.customer_monitoring_signals
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- Customer: dismiss only (status + dismissed_at)
CREATE POLICY lg_monitoring_signals_customer_dismiss_own
  ON public.customer_monitoring_signals
  FOR UPDATE TO authenticated
  USING (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
  )
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND status = 'dismissed'
    AND dismissed_at IS NOT NULL
  );

-- No customer INSERT on signals or runs.

CREATE OR REPLACE FUNCTION public.lifeguard_customer_monitoring_dismiss_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.lifeguard_is_customer()
     AND NOT public.lifeguard_is_admin() THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
       OR NEW.severity IS DISTINCT FROM OLD.severity
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
       OR NEW.confidence IS DISTINCT FROM OLD.confidence
       OR NEW.source_state_snapshot_id IS DISTINCT FROM OLD.source_state_snapshot_id
       OR NEW.detection_run_id IS DISTINCT FROM OLD.detection_run_id
       OR NEW.consent_snapshot IS DISTINCT FROM OLD.consent_snapshot
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.status IS DISTINCT FROM 'dismissed'
       OR NEW.dismissed_at IS NULL
    THEN
      RAISE EXCEPTION 'customers may only dismiss own monitoring signals'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_monitoring_dismiss_only
  BEFORE UPDATE ON public.customer_monitoring_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_customer_monitoring_dismiss_only();

-- Admin
CREATE POLICY lg_monitoring_signals_admin_select
  ON public.customer_monitoring_signals
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_monitoring_signals_admin_update
  ON public.customer_monitoring_signals
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_monitoring_detection_runs_admin_select
  ON public.monitoring_detection_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: no direct table SELECT — use lifeguard_agent_monitoring_signal_summary.

-- service_role: detector INSERT signals + runs; outbox worker.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: Customer A — SELECT open signals → own rows only
-- T2: Customer A — SELECT customer_id = B → 0
-- T3: Customer A — INSERT signal → RLS violation
-- T4: Customer A — UPDATE status=dismissed, dismissed_at=now() on own row → OK
-- T5: Customer A — UPDATE title on signal → trigger 42501 (dismiss-only)
-- T6: Agent assigned — SELECT lifeguard_agent_monitoring_signal_summary → high/critical only
-- T7: Agent — SELECT customer_monitoring_signals table → 0 rows
-- T8: confidence 1.2 → CHECK fails
-- T9: Admin — SELECT/UPDATE signals
-- T10: service_role INSERT signal + optional outbox monitoring.signal.detected
-- T11: Repo — no demo monitoring seed
--
