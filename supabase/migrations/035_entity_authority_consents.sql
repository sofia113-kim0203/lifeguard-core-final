-- =============================================================================
-- LIFEGUARD — 035_entity_authority_consents.sql
-- Corporate authority / consent / delegation ledger (Slice 2).
-- Separate from personal customer_consents. Membership ≠ ≠ legal consent.
-- Requires: public.entities, auth.users
-- Preview-only apply until Tom GO for Production.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.entity_authority_consents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           UUID NOT NULL REFERENCES public.entities (id) ON DELETE RESTRICT,
  -- Acting user who may exercise this grant (representative / manager / employee).
  holder_user_id      UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Whose materials are covered. NULL = entity-level corporate materials (not a person).
  subject_user_id     UUID REFERENCES auth.users (id) ON DELETE CASCADE,
  granted_by_user_id  UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  authority_type      TEXT NOT NULL,
  consent_scope       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  source              TEXT,
  evidence_id         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT entity_authority_consents_type_chk CHECK (
    authority_type IN ('representative', 'delegated_manager', 'employee_self')
  ),
  CONSTRAINT entity_authority_consents_scope_chk CHECK (
    consent_scope IN (
      'corporate_profile',
      'corporate_documents',
      'insurance_consultation',
      'claim_support'
    )
  ),
  CONSTRAINT entity_authority_consents_status_chk CHECK (
    status IN ('active', 'revoked', 'expired')
  ),
  CONSTRAINT entity_authority_consents_revoke_chk CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked')
  ),
  CONSTRAINT entity_authority_consents_expire_order_chk CHECK (
    expires_at IS NULL OR expires_at >= granted_at
  )
);

COMMENT ON TABLE public.entity_authority_consents IS
  'Corporate authority/consent/delegation ledger. Not personal customer_consents. Membership alone is not consent.';

COMMENT ON COLUMN public.entity_authority_consents.subject_user_id IS
  'NULL = entity-level corporate materials. Set = that person''s materials within the entity.';

CREATE INDEX IF NOT EXISTS entity_authority_consents_holder_active_idx
  ON public.entity_authority_consents (entity_id, holder_user_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS entity_authority_consents_subject_active_idx
  ON public.entity_authority_consents (entity_id, subject_user_id, status)
  WHERE status = 'active' AND subject_user_id IS NOT NULL;

ALTER TABLE public.entity_authority_consents ENABLE ROW LEVEL SECURITY;

-- Holders may read their own grants (fail-closed for others).
DROP POLICY IF EXISTS lg_entity_authority_consents_holder_select ON public.entity_authority_consents;
CREATE POLICY lg_entity_authority_consents_holder_select
  ON public.entity_authority_consents
  FOR SELECT
  TO authenticated
  USING (holder_user_id = auth.uid());

-- Grantors may read grants they issued.
DROP POLICY IF EXISTS lg_entity_authority_consents_grantor_select ON public.entity_authority_consents;
CREATE POLICY lg_entity_authority_consents_grantor_select
  ON public.entity_authority_consents
  FOR SELECT
  TO authenticated
  USING (granted_by_user_id = auth.uid());

COMMIT;
