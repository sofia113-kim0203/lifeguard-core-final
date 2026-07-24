-- =============================================================================
-- LIFEGUARD — 036_agent_assignment_consents.sql
-- C1: Bind customer_consents.agent_sharing to a specific agent_assignments row.
-- Does NOT open agent briefing, customer data access, or KEY APIs.
-- Official product state after this file: AGENT_NOT_CONNECTED.
-- Requires: 001 (agent_assignments), 002 (role helpers), 004 (customer_consents).
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock rows.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. agent_assignment_consents
-- Binding only: assignment + customer_consent ids. No duplicated PII / ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_assignment_consents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id        UUID NOT NULL REFERENCES public.agent_assignments (id) ON DELETE RESTRICT,
  customer_consent_id  UUID NOT NULL REFERENCES public.customer_consents (id) ON DELETE RESTRICT,
  granted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_assignment_consents_revoke_order_chk CHECK (
    revoked_at IS NULL OR revoked_at >= granted_at
  )
);

COMMENT ON TABLE public.agent_assignment_consents IS
  'C1 binding: one live agent_sharing consent per agent_assignment. '
  'customer_id / agent_user_id derived from assignment; consent type from customer_consents. '
  'Does not grant KEY briefing or customer data APIs by itself (AGENT_NOT_CONNECTED).';

COMMENT ON COLUMN public.agent_assignment_consents.assignment_id IS
  'FK to agent_assignments; source of agent_user_id + customer_id.';

COMMENT ON COLUMN public.agent_assignment_consents.customer_consent_id IS
  'FK to customer_consents; must be agent_sharing for same customer_id as assignment.';

COMMENT ON COLUMN public.agent_assignment_consents.revoked_at IS
  'NULL = live binding. Past revoked rows may be retained for audit.';

-- At most one live (non-revoked) binding per assignment.
CREATE UNIQUE INDEX IF NOT EXISTS agent_assignment_consents_live_assignment_uq
  ON public.agent_assignment_consents (assignment_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_assignment_consents_consent_idx
  ON public.agent_assignment_consents (customer_consent_id);

CREATE INDEX IF NOT EXISTS agent_assignment_consents_live_idx
  ON public.agent_assignment_consents (assignment_id)
  WHERE revoked_at IS NULL;

CREATE TRIGGER agent_assignment_consents_set_updated_at
  BEFORE UPDATE ON public.agent_assignment_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Integrity trigger — DB-enforced match (not app-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_agent_assignment_consent_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_assignment_customer_id UUID;
  v_assignment_deleted_at  TIMESTAMPTZ;
  v_consent_customer_id    UUID;
  v_consent_type           TEXT;
  v_consent_granted        BOOLEAN;
  v_consent_revoked_at     TIMESTAMPTZ;
BEGIN
  SELECT aa.customer_id, aa.deleted_at
    INTO v_assignment_customer_id, v_assignment_deleted_at
  FROM public.agent_assignments aa
  WHERE aa.id = NEW.assignment_id;

  IF v_assignment_customer_id IS NULL THEN
    RAISE EXCEPTION 'agent_assignment_consents: assignment not found: %', NEW.assignment_id;
  END IF;

  IF v_assignment_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent_assignment_consents: assignment is deleted: %', NEW.assignment_id;
  END IF;

  SELECT cc.customer_id, cc.consent_type, cc.granted, cc.revoked_at
    INTO v_consent_customer_id, v_consent_type, v_consent_granted, v_consent_revoked_at
  FROM public.customer_consents cc
  WHERE cc.id = NEW.customer_consent_id;

  IF v_consent_customer_id IS NULL THEN
    RAISE EXCEPTION 'agent_assignment_consents: customer_consent not found: %', NEW.customer_consent_id;
  END IF;

  IF v_assignment_customer_id IS DISTINCT FROM v_consent_customer_id THEN
    RAISE EXCEPTION
      'agent_assignment_consents: assignment.customer_id (%) <> consent.customer_id (%)',
      v_assignment_customer_id, v_consent_customer_id;
  END IF;

  IF v_consent_type IS DISTINCT FROM 'agent_sharing' THEN
    RAISE EXCEPTION
      'agent_assignment_consents: consent_type must be agent_sharing, got: %',
      v_consent_type;
  END IF;

  IF v_consent_granted IS NOT TRUE THEN
    RAISE EXCEPTION 'agent_assignment_consents: customer_consent.granted must be true';
  END IF;

  -- Creating or keeping a live binding requires an active (non-revoked) consent.
  -- Revoking a binding (setting revoked_at) may retain history even if consent later changes.
  IF NEW.revoked_at IS NULL THEN
    IF v_consent_revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'agent_assignment_consents: customer_consent is revoked; cannot create live binding';
    END IF;
  END IF;

  IF NEW.revoked_at IS NOT NULL AND NEW.revoked_at < NEW.granted_at THEN
    RAISE EXCEPTION 'agent_assignment_consents: revoked_at must be >= granted_at';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_agent_assignment_consent_integrity() IS
  'BEFORE INSERT/UPDATE: assignment↔consent customer match, agent_sharing, granted, live-consent rules.';

DROP TRIGGER IF EXISTS agent_assignment_consents_integrity
  ON public.agent_assignment_consents;
CREATE TRIGGER agent_assignment_consents_integrity
  BEFORE INSERT OR UPDATE ON public.agent_assignment_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_agent_assignment_consent_integrity();

-- ---------------------------------------------------------------------------
-- 2b. Consent revoke sync — free live binding slot when agent_sharing is revoked
-- Only NULL → NOT NULL on customer_consents.revoked_at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_sync_assignment_consent_on_consent_revoke()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Revoke transition only (was live, now revoked).
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.consent_type IS DISTINCT FROM 'agent_sharing' THEN
    RETURN NEW;
  END IF;

  UPDATE public.agent_assignment_consents aac
  SET
    revoked_at = GREATEST(NEW.revoked_at, aac.granted_at),
    updated_at = NOW()
  WHERE aac.customer_consent_id = NEW.id
    AND aac.revoked_at IS NULL;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_sync_assignment_consent_on_consent_revoke() IS
  'On agent_sharing consent revoke (revoked_at NULL→NOT NULL): revoke live '
  'agent_assignment_consents for that customer_consent_id so partial UNIQUE frees the slot.';

DROP TRIGGER IF EXISTS customer_consents_sync_assignment_binding_revoke
  ON public.customer_consents;
CREATE TRIGGER customer_consents_sync_assignment_binding_revoke
  AFTER UPDATE OF revoked_at ON public.customer_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_sync_assignment_consent_on_consent_revoke();

-- ---------------------------------------------------------------------------
-- 3. Access helper (C2 reuse) — active assignment + live binding + live consent
-- Does NOT return customer payload. pending/closed/deleted → FALSE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_agent_has_active_assignment_consent(
  p_customer_id UUID,
  p_agent_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_customer_id IS NOT NULL
    AND (
      -- Authenticated agents may only evaluate themselves (auth.uid()).
      -- service_role may pass an explicit agent id for controlled server checks.
      (
        auth.role() = 'service_role'
        AND COALESCE(p_agent_user_id, auth.uid()) IS NOT NULL
      )
      OR (
        auth.role() IS DISTINCT FROM 'service_role'
        AND public.lifeguard_is_agent()
        AND auth.uid() IS NOT NULL
        AND (p_agent_user_id IS NULL OR p_agent_user_id = auth.uid())
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.agent_assignments aa
      INNER JOIN public.agent_assignment_consents aac
        ON aac.assignment_id = aa.id
       AND aac.revoked_at IS NULL
      INNER JOIN public.customer_consents cc
        ON cc.id = aac.customer_consent_id
      WHERE aa.customer_id = p_customer_id
        AND aa.agent_user_id = CASE
          WHEN auth.role() = 'service_role'
            THEN COALESCE(p_agent_user_id, auth.uid())
          ELSE auth.uid()
        END
        AND aa.status = 'active'
        AND aa.deleted_at IS NULL
        AND cc.consent_type = 'agent_sharing'
        AND cc.granted = TRUE
        AND cc.revoked_at IS NULL
        AND cc.customer_id = aa.customer_id
    );
$$;

COMMENT ON FUNCTION public.lifeguard_agent_has_active_assignment_consent(UUID, UUID) IS
  'TRUE only when agent has active (not deleted) assignment to customer AND a live '
  'agent_assignment_consents binding to a live agent_sharing customer_consent. '
  'Authenticated: agent = auth.uid() only. service_role: optional p_agent_user_id. '
  'pending/closed/deleted → FALSE. C2 reuse; opens no customer-data API.';

REVOKE ALL ON FUNCTION public.lifeguard_agent_has_active_assignment_consent(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_agent_has_active_assignment_consent(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.lifeguard_agent_has_active_assignment_consent(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lifeguard_agent_has_active_assignment_consent(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS — fail-closed writes for customer/agent; minimal SELECT
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_assignment_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assignment_consents FORCE ROW LEVEL SECURITY;

-- No INSERT / UPDATE / DELETE policies for authenticated → denied by default.
-- service_role bypasses RLS (workers / controlled server paths only).

DROP POLICY IF EXISTS lg_agent_assignment_consents_agent_select_mine
  ON public.agent_assignment_consents;
CREATE POLICY lg_agent_assignment_consents_agent_select_mine
  ON public.agent_assignment_consents
  FOR SELECT
  TO authenticated
  USING (
    public.lifeguard_is_agent()
    AND EXISTS (
      SELECT 1
      FROM public.agent_assignments aa
      WHERE aa.id = assignment_id
        AND aa.agent_user_id = auth.uid()
        AND aa.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS lg_agent_assignment_consents_customer_select_own
  ON public.agent_assignment_consents;
CREATE POLICY lg_agent_assignment_consents_customer_select_own
  ON public.agent_assignment_consents
  FOR SELECT
  TO authenticated
  USING (
    public.lifeguard_is_customer()
    AND EXISTS (
      SELECT 1
      FROM public.agent_assignments aa
      WHERE aa.id = assignment_id
        AND public.lifeguard_is_own_customer(aa.customer_id)
        AND aa.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS lg_agent_assignment_consents_admin_select_audit
  ON public.agent_assignment_consents;
CREATE POLICY lg_agent_assignment_consents_admin_select_audit
  ON public.agent_assignment_consents
  FOR SELECT
  TO authenticated
  USING (public.lifeguard_is_admin());

COMMIT;
