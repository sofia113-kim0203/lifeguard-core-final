-- =============================================================================
-- LIFEGUARD Core — 004_customer_consents.sql
-- Legal consent ledger per CONSENT_ARCHITECTURE.md
-- Requires: 001_initial_schema.sql, 002_rls_service_policies.sql
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake consent rows in this file.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical consent_type values (CHECK — not a separate enum type for portability)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_consent_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'service_terms',
    'privacy_collection',
    'sensitive_health_processing',
    'insurance_data_processing',
    'document_storage',
    'document_analysis',
    'ai_consultation',
    'memory_retention',
    'agent_sharing',
    'notification_delivery',
    'marketing_optional'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_consent_types() IS
  'Canonical consent_type list; must match CONSENT_ARCHITECTURE.md §2.';

-- ---------------------------------------------------------------------------
-- customer_consents
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  consent_type      TEXT NOT NULL,
  consent_version   TEXT NOT NULL,
  consent_scope     JSONB NOT NULL DEFAULT '{}'::JSONB,
  granted           BOOLEAN NOT NULL,
  granted_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  source            TEXT,
  purpose           TEXT,
  required          BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address_hash   TEXT,
  user_agent_hash   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_consents_type_chk CHECK (
    consent_type = ANY (public.lifeguard_consent_types())
  ),

  CONSTRAINT customer_consents_granted_at_chk CHECK (
    (granted = TRUE AND granted_at IS NOT NULL)
    OR (granted = FALSE)
  ),

  CONSTRAINT customer_consents_revoked_order_chk CHECK (
    revoked_at IS NULL
    OR granted_at IS NULL
    OR revoked_at >= granted_at
  ),

  CONSTRAINT customer_consents_customer_type_version_uq UNIQUE (
    customer_id,
    consent_type,
    consent_version
  )
);

COMMENT ON TABLE public.customer_consents IS
  'Per-customer legal consent grants; append-style ledger. Active = granted true AND revoked_at null.';

COMMENT ON COLUMN public.customer_consents.consent_scope IS
  'JSON purpose scope: tables, features, purposes array per CONSENT_ARCHITECTURE.';

COMMENT ON COLUMN public.customer_consents.purpose IS
  'Human-readable processing purpose label at capture time (optional).';

COMMENT ON COLUMN public.customer_consents.required IS
  'True if consent was marked required in UX at grant time (audit).';

COMMENT ON COLUMN public.customer_consents.ip_address_hash IS
  'SHA-256(ip + server salt); never store raw IP.';

COMMENT ON COLUMN public.customer_consents.source IS
  'Capture channel: signup, profile, document_upload, consultation_start, agent_connect, settings, admin.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX customer_consents_customer_id_idx
  ON public.customer_consents (customer_id);

CREATE INDEX customer_consents_consent_type_idx
  ON public.customer_consents (consent_type);

CREATE INDEX customer_consents_customer_type_idx
  ON public.customer_consents (customer_id, consent_type);

CREATE INDEX customer_consents_granted_idx
  ON public.customer_consents (granted)
  WHERE granted = TRUE;

CREATE INDEX customer_consents_revoked_at_idx
  ON public.customer_consents (revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX customer_consents_created_at_idx
  ON public.customer_consents (created_at DESC);

CREATE INDEX customer_consents_active_lookup_idx
  ON public.customer_consents (customer_id, consent_type)
  WHERE granted = TRUE AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER customer_consents_set_updated_at
  BEFORE UPDATE ON public.customer_consents
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_has_consent(
  p_customer_id   UUID,
  p_consent_type  TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_customer_id IS NOT NULL
    AND p_consent_type = ANY (public.lifeguard_consent_types())
    AND EXISTS (
      SELECT 1
      FROM public.customer_consents cc
      WHERE cc.customer_id = p_customer_id
        AND cc.consent_type = p_consent_type
        AND cc.granted = TRUE
        AND cc.revoked_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.lifeguard_has_consent(UUID, TEXT) IS
  'True when customer has at least one active grant for consent_type (granted, not revoked).';

CREATE OR REPLACE FUNCTION public.lifeguard_required_consents_for_feature(p_feature TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(trim(p_feature))
    WHEN 'memory_builder' THEN ARRAY[
      'privacy_collection',
      'sensitive_health_processing',
      'insurance_data_processing',
      'document_storage',
      'document_analysis',
      'ai_consultation',
      'memory_retention'
    ]::TEXT[]
    WHEN 'document_ingest' THEN ARRAY[
      'document_storage',
      'document_analysis'
    ]::TEXT[]
    WHEN 'rag_search' THEN ARRAY[
      'document_storage',
      'document_analysis'
    ]::TEXT[]
    WHEN 'ai_consultation' THEN ARRAY[
      'ai_consultation',
      'memory_retention',
      'privacy_collection'
    ]::TEXT[]
    WHEN 'agent_sharing' THEN ARRAY[
      'agent_sharing'
    ]::TEXT[]
    WHEN 'notification_delivery' THEN ARRAY[
      'notification_delivery'
    ]::TEXT[]
    WHEN 'marketing_optional' THEN ARRAY[
      'marketing_optional'
    ]::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;
$$;

COMMENT ON FUNCTION public.lifeguard_required_consents_for_feature(TEXT) IS
  'Feature-level consent checklist; Memory Builder still checks per-source via CONSENT_ARCHITECTURE §7.1.';

-- Optional convenience: all active consents for a customer (RLS applies to callers)
CREATE OR REPLACE VIEW public.lifeguard_active_customer_consents
WITH (security_invoker = true)
AS
SELECT
  cc.id,
  cc.customer_id,
  cc.consent_type,
  cc.consent_version,
  cc.consent_scope,
  cc.granted_at,
  cc.source,
  cc.purpose,
  cc.required,
  cc.created_at
FROM public.customer_consents cc
WHERE cc.granted = TRUE
  AND cc.revoked_at IS NULL;

COMMENT ON VIEW public.lifeguard_active_customer_consents IS
  'Active grants only; underlying table RLS still enforced for authenticated roles.';

-- ---------------------------------------------------------------------------
-- Future: consent_audit_logs (design note — not created in 004)
-- ---------------------------------------------------------------------------
-- Retain immutable append-only audit rows on every grant/revoke/scope change:
--   consent_audit_logs(id, customer_consent_id, customer_id, event, payload, created_at)
-- Enables legal hold and admin replay without mutating customer_consents history.
-- customer_consents rows are never hard-deleted by customers; revoke = revoked_at only.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_customer_consents_customer_select_own ON public.customer_consents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_customer_consents_customer_insert_own ON public.customer_consents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
    AND customer_id = public.lifeguard_auth_customer_id()
  );

CREATE POLICY lg_customer_consents_customer_update_own ON public.customer_consents
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- No agent SELECT/INSERT/UPDATE — designers must not read consent ledger directly.

CREATE POLICY lg_customer_consents_admin_select_audit ON public.customer_consents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- service_role bypasses RLS for Memory Builder, revoke jobs, outbox (server env only).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual / CI — use real auth users, no demo fixtures in repo)
-- =============================================================================
--
-- --- Setup (service_role): create customer A, B; grant A sensitive_health_processing ---
-- INSERT INTO customer_consents (
--   customer_id, consent_type, consent_version, granted, granted_at, source
-- ) VALUES (
--   '<customer_a_id>', 'sensitive_health_processing', '2026-01-15-ko', true, now(), 'signup'
-- );
--
-- --- T1: Customer A reads own consents (authenticated as A) ---
-- SELECT count(*) FROM customer_consents WHERE customer_id = '<customer_a_id>';
-- -- expect >= 1
--
-- --- T2: Customer A cannot read B (authenticated as A) ---
-- SELECT count(*) FROM customer_consents WHERE customer_id = '<customer_b_id>';
-- -- expect 0
--
-- --- T3: lifeguard_has_consent without health consent (customer B) ---
-- SELECT public.lifeguard_has_consent('<customer_b_id>', 'sensitive_health_processing');
-- -- expect false
--
-- --- T4: Active grant ---
-- SELECT public.lifeguard_has_consent('<customer_a_id>', 'sensitive_health_processing');
-- -- expect true when granted=true AND revoked_at IS NULL
--
-- --- T5: Revoked grant ---
-- UPDATE customer_consents SET revoked_at = now() WHERE customer_id = '<customer_a_id>'
--   AND consent_type = 'sensitive_health_processing';
-- SELECT public.lifeguard_has_consent('<customer_a_id>', 'sensitive_health_processing');
-- -- expect false
--
-- --- T6: Agent cannot SELECT (authenticated as agent) ---
-- SELECT count(*) FROM customer_consents;
-- -- expect 0
--
-- --- T7: Admin can SELECT (authenticated as admin) ---
-- SELECT count(*) FROM customer_consents;
-- -- expect >= 0 (audit)
--
-- --- T8: Constraint — granted true requires granted_at ---
-- INSERT INTO customer_consents (customer_id, consent_type, consent_version, granted)
-- VALUES ('<customer_a_id>', 'privacy_collection', '2026-01-15-ko', true);
-- -- expect CHECK violation
--
-- --- T9: Constraint — revoked_at before granted_at ---
-- INSERT INTO customer_consents (
--   customer_id, consent_type, consent_version, granted, granted_at, revoked_at
-- ) VALUES (
--   '<customer_a_id>', 'privacy_collection', '2026-01-16-ko', true,
--   now(), now() - interval '1 day'
-- );
-- -- expect CHECK violation on revoked_order
--
-- --- T10: Feature helper ---
-- SELECT public.lifeguard_required_consents_for_feature('rag_search');
-- -- expect {document_storage, document_analysis}
--
