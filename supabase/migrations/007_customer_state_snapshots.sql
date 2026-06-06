-- =============================================================================
-- LIFEGUARD Core — 007_customer_state_snapshots.sql
-- Persisted Customer State per CUSTOMER_STATE_ENGINE.md
-- Requires: 001, 002 (agent/admin helpers), 004 (consent helpers)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake state rows.
-- =============================================================================
--
-- state_json SHOULD contain nine domain objects (each with status, summary,
-- evidence_refs, sufficiency, confidence, as_of):
--   identity_state, consent_state, health_state, insurance_state, claim_state,
--   disclosure_state, document_state, monitoring_state, advisor_state
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- customer_state_snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_state_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  state_version     TEXT NOT NULL,
  state_json        JSONB NOT NULL DEFAULT '{}'::JSONB,
  global_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.000,
  sufficiency       TEXT NOT NULL DEFAULT 'insufficient',
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::JSONB,
  consent_snapshot  JSONB NOT NULL DEFAULT '{}'::JSONB,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stale_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_state_snapshots_global_confidence_chk CHECK (
    global_confidence >= 0 AND global_confidence <= 1
  ),

  CONSTRAINT customer_state_snapshots_sufficiency_chk CHECK (
    sufficiency IN ('sufficient', 'partial', 'insufficient')
  )
);

COMMENT ON TABLE public.customer_state_snapshots IS
  'Point-in-time Customer State; canonical data remains source tables.';

COMMENT ON COLUMN public.customer_state_snapshots.state_version IS
  'Hash or semver of domain as_of timestamps + customer_profiles.memory_version.';

COMMENT ON COLUMN public.customer_state_snapshots.state_json IS
  'Nine domains — no raw document text, chunk bodies, or national IDs.';

COMMENT ON COLUMN public.customer_state_snapshots.stale_at IS
  'Set when superseded by newer snapshot or source change detected.';

CREATE INDEX customer_state_snapshots_customer_id_idx
  ON public.customer_state_snapshots (customer_id);

CREATE INDEX customer_state_snapshots_customer_calculated_idx
  ON public.customer_state_snapshots (customer_id, calculated_at DESC);

CREATE INDEX customer_state_snapshots_state_version_idx
  ON public.customer_state_snapshots (state_version);

CREATE INDEX customer_state_snapshots_stale_at_idx
  ON public.customer_state_snapshots (stale_at)
  WHERE stale_at IS NOT NULL;

CREATE INDEX customer_state_snapshots_latest_lookup_idx
  ON public.customer_state_snapshots (customer_id, calculated_at DESC)
  WHERE stale_at IS NULL;

-- ---------------------------------------------------------------------------
-- lifeguard_latest_customer_state — customer / admin (via RLS on base table)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_latest_customer_state
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (customer_id)
  id,
  customer_id,
  state_version,
  state_json,
  global_confidence,
  sufficiency,
  evidence_refs,
  consent_snapshot,
  calculated_at,
  stale_at,
  created_at
FROM public.customer_state_snapshots
WHERE stale_at IS NULL
ORDER BY customer_id, calculated_at DESC;

COMMENT ON VIEW public.lifeguard_latest_customer_state IS
  'Latest non-stale snapshot per customer; RLS applies (security_invoker).';

-- ---------------------------------------------------------------------------
-- lifeguard_agent_customer_state_summary — no health raw / document bodies
-- View runs as owner; filters by auth.uid() assignment + agent_sharing consent.
-- Agents must use this view — no SELECT policy on full state_json for agents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_agent_customer_state_summary AS
SELECT
  s.customer_id,
  s.state_version,
  s.global_confidence,
  s.sufficiency,
  s.calculated_at,
  (s.state_json -> 'identity_state' -> 'summary')   AS identity_summary,
  (s.state_json -> 'insurance_state' -> 'summary')  AS insurance_summary,
  (s.state_json -> 'document_state' -> 'summary')   AS document_summary,
  (s.state_json -> 'monitoring_state' -> 'summary') AS monitoring_summary,
  (s.state_json -> 'advisor_state' -> 'summary')    AS advisor_summary,
  (s.state_json -> 'consent_state' -> 'summary')    AS consent_summary
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    state_version,
    state_json,
    global_confidence,
    sufficiency,
    calculated_at
  FROM public.customer_state_snapshots
  WHERE stale_at IS NULL
  ORDER BY customer_id, calculated_at DESC
) s
WHERE public.lifeguard_is_agent()
  AND public.lifeguard_agent_assigned_to_customer(s.customer_id)
  AND public.lifeguard_has_consent(s.customer_id, 'agent_sharing');

COMMENT ON VIEW public.lifeguard_agent_customer_state_summary IS
  'Agent-safe subset only; excludes health_state detail and document/chunk content.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_state_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_state_snapshots FORCE ROW LEVEL SECURITY;

-- Customer: read own snapshots (latest via view recommended)
CREATE POLICY lg_customer_state_snapshots_customer_select_own
  ON public.customer_state_snapshots
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- Admin: audit all
CREATE POLICY lg_customer_state_snapshots_admin_select
  ON public.customer_state_snapshots
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_insert
  ON public.customer_state_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_update
  ON public.customer_state_snapshots
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_delete
  ON public.customer_state_snapshots
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: NO direct table access — use lifeguard_agent_customer_state_summary view.
-- Customers: NO access to agent view (agent_assigned_to_customer fails for customers).

-- service_role: buildCustomerState worker INSERT (bypass RLS).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: Customer A JWT — SELECT * FROM lifeguard_latest_customer_state → A rows only
-- T2: Customer A — SELECT WHERE customer_id = B → 0 rows
-- T3: Agent unassigned — SELECT * FROM lifeguard_agent_customer_state_summary → 0
-- T4: Agent assigned + agent_sharing — view returns summary columns only (no state_json)
-- T5: Agent — SELECT * FROM customer_state_snapshots → 0 rows (no agent policy)
-- T6: INSERT global_confidence = 1.5 → CHECK fails
-- T7: INSERT sufficiency = 'unknown' → CHECK fails
-- T8: Admin — SELECT all customers
-- T9: service_role INSERT snapshot for customer A → success
-- T10: Repo — no demo/mock state seed files
--
