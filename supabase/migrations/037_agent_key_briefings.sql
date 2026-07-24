-- =============================================================================
-- LIFEGUARD — 037_agent_key_briefings.sql
-- C2-A: Append-only store for agent KEY briefings (one row per successful ask).
-- Does NOT open API, AgentDesk, KEY calls, or seeds.
-- Requires: 001 (agent_assignments, users, customer_profiles),
--           002 (role helpers), 004 (customer_consents), 036 (agent_assignment_consents).
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock rows.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. agent_key_briefings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_key_briefings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id          UUID NOT NULL
    REFERENCES public.agent_assignments (id) ON DELETE RESTRICT,
  assignment_consent_id  UUID NOT NULL
    REFERENCES public.agent_assignment_consents (id) ON DELETE RESTRICT,
  agent_user_id          UUID NOT NULL
    REFERENCES public.users (id) ON DELETE RESTRICT,
  customer_id            UUID NOT NULL
    REFERENCES public.customer_profiles (id) ON DELETE RESTRICT,
  purpose                TEXT NOT NULL,
  question               TEXT NOT NULL,
  briefing_text          TEXT NOT NULL,
  key_event              TEXT NOT NULL DEFAULT 'question',
  key_trace_id           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_key_briefings_purpose_len_chk CHECK (
    char_length(btrim(purpose)) BETWEEN 1 AND 200
  ),
  CONSTRAINT agent_key_briefings_question_len_chk CHECK (
    char_length(btrim(question)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT agent_key_briefings_briefing_text_chk CHECK (
    char_length(btrim(briefing_text)) >= 1
  ),
  CONSTRAINT agent_key_briefings_key_event_chk CHECK (
    key_event = 'question'
  )
);

COMMENT ON TABLE public.agent_key_briefings IS
  'C2-A append-only agent KEY briefing ledger. '
  'Not customer_conversations. No product UPDATE/DELETE path. '
  'Legal purge only via approved session GUC (see deny-mutation trigger).';

COMMENT ON COLUMN public.agent_key_briefings.assignment_consent_id IS
  'Live agent_assignment_consents binding used at briefing time.';

COMMENT ON COLUMN public.agent_key_briefings.briefing_text IS
  'Sealed KEY customerText returned to the agent (already finalized).';

COMMENT ON COLUMN public.agent_key_briefings.key_trace_id IS
  'Optional opaque KEY turn / trace id for ops correlation; no PII.';

CREATE INDEX IF NOT EXISTS agent_key_briefings_agent_created_idx
  ON public.agent_key_briefings (agent_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_key_briefings_assignment_created_idx
  ON public.agent_key_briefings (assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_key_briefings_customer_created_idx
  ON public.agent_key_briefings (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_key_briefings_consent_idx
  ON public.agent_key_briefings (assignment_consent_id);

-- ---------------------------------------------------------------------------
-- 2. Integrity — INSERT only (active assignment + live binding + agent_sharing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_agent_key_briefing_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_assignment_agent_id    UUID;
  v_assignment_customer_id UUID;
  v_assignment_status      TEXT;
  v_assignment_deleted_at  TIMESTAMPTZ;
  v_binding_assignment_id  UUID;
  v_binding_revoked_at     TIMESTAMPTZ;
  v_consent_id             UUID;
  v_consent_type           TEXT;
  v_consent_granted        BOOLEAN;
  v_consent_revoked_at     TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'agent_key_briefings: integrity trigger is INSERT-only';
  END IF;

  SELECT
    aa.agent_user_id,
    aa.customer_id,
    aa.status,
    aa.deleted_at
  INTO
    v_assignment_agent_id,
    v_assignment_customer_id,
    v_assignment_status,
    v_assignment_deleted_at
  FROM public.agent_assignments aa
  WHERE aa.id = NEW.assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_key_briefings: assignment not found: %', NEW.assignment_id;
  END IF;

  IF v_assignment_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent_key_briefings: assignment is deleted: %', NEW.assignment_id;
  END IF;

  IF v_assignment_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'agent_key_briefings: assignment status must be active, got: %',
      v_assignment_status;
  END IF;

  IF NEW.agent_user_id IS DISTINCT FROM v_assignment_agent_id THEN
    RAISE EXCEPTION
      'agent_key_briefings: agent_user_id (%) <> assignment.agent_user_id (%)',
      NEW.agent_user_id, v_assignment_agent_id;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM v_assignment_customer_id THEN
    RAISE EXCEPTION
      'agent_key_briefings: customer_id (%) <> assignment.customer_id (%)',
      NEW.customer_id, v_assignment_customer_id;
  END IF;

  SELECT
    aac.assignment_id,
    aac.revoked_at,
    aac.customer_consent_id
  INTO
    v_binding_assignment_id,
    v_binding_revoked_at,
    v_consent_id
  FROM public.agent_assignment_consents aac
  WHERE aac.id = NEW.assignment_consent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'agent_key_briefings: assignment_consent not found: %',
      NEW.assignment_consent_id;
  END IF;

  IF v_binding_assignment_id IS DISTINCT FROM NEW.assignment_id THEN
    RAISE EXCEPTION
      'agent_key_briefings: assignment_consent_id not bound to assignment_id';
  END IF;

  IF v_binding_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent_key_briefings: assignment_consent binding is revoked';
  END IF;

  SELECT
    cc.consent_type,
    cc.granted,
    cc.revoked_at
  INTO
    v_consent_type,
    v_consent_granted,
    v_consent_revoked_at
  FROM public.customer_consents cc
  WHERE cc.id = v_consent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_key_briefings: customer_consent missing for binding';
  END IF;

  IF v_consent_type IS DISTINCT FROM 'agent_sharing' THEN
    RAISE EXCEPTION
      'agent_key_briefings: consent_type must be agent_sharing, got: %',
      v_consent_type;
  END IF;

  IF v_consent_granted IS NOT TRUE THEN
    RAISE EXCEPTION 'agent_key_briefings: customer_consent.granted must be true';
  END IF;

  IF v_consent_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent_key_briefings: customer_consent is revoked';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_agent_key_briefing_integrity() IS
  'BEFORE INSERT: active assignment, matching agent/customer, live binding, live agent_sharing.';

DROP TRIGGER IF EXISTS agent_key_briefings_integrity ON public.agent_key_briefings;
CREATE TRIGGER agent_key_briefings_integrity
  BEFORE INSERT ON public.agent_key_briefings
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_agent_key_briefing_integrity();

-- ---------------------------------------------------------------------------
-- 3. Append-only defense (RLS bypass / service_role accidental mutation)
-- Legal DELETE only when session GUC is explicitly enabled:
--   SET LOCAL lifeguard.agent_key_briefings_legal_purge = 'on';
-- UPDATE is never allowed via this trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_agent_key_briefings_deny_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'agent_key_briefings is append-only: UPDATE forbidden';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('lifeguard.agent_key_briefings_legal_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'agent_key_briefings is append-only: DELETE forbidden '
        '(legal purge requires SET LOCAL lifeguard.agent_key_briefings_legal_purge = ''on'')';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_agent_key_briefings_deny_mutation() IS
  'Blocks UPDATE always; blocks DELETE unless approved legal-purge GUC is on.';

DROP TRIGGER IF EXISTS agent_key_briefings_deny_mutation ON public.agent_key_briefings;
CREATE TRIGGER agent_key_briefings_deny_mutation
  BEFORE UPDATE OR DELETE ON public.agent_key_briefings
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_agent_key_briefings_deny_mutation();

-- Table privileges: no product UPDATE/DELETE grants.
REVOKE ALL ON TABLE public.agent_key_briefings FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_key_briefings FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.agent_key_briefings FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.agent_key_briefings FROM service_role;
GRANT SELECT ON TABLE public.agent_key_briefings TO authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_key_briefings TO service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS — SELECT only for agent (own) / admin (audit)
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_key_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_key_briefings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_agent_key_briefings_agent_select_mine
  ON public.agent_key_briefings;
CREATE POLICY lg_agent_key_briefings_agent_select_mine
  ON public.agent_key_briefings
  FOR SELECT
  TO authenticated
  USING (
    public.lifeguard_is_agent()
    AND agent_user_id = auth.uid()
  );

DROP POLICY IF EXISTS lg_agent_key_briefings_admin_select_audit
  ON public.agent_key_briefings;
CREATE POLICY lg_agent_key_briefings_admin_select_audit
  ON public.agent_key_briefings
  FOR SELECT
  TO authenticated
  USING (public.lifeguard_is_admin());

-- No customer policies. No INSERT/UPDATE/DELETE policies for authenticated.

COMMIT;
