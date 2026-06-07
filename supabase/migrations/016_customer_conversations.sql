-- =============================================================================
-- LIFEGUARD Core — 016_customer_conversations.sql
-- Phase 18: per-customer AI conversation memory (message ledger)
-- Requires: 001_initial_schema.sql, 002_rls_service_policies.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  message         TEXT NOT NULL,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_conversations_role_chk CHECK (
    role IN ('user', 'assistant', 'system')
  )
);

COMMENT ON TABLE public.customer_conversations IS
  'Per-customer AI conversation messages; customer-scoped via RLS.';

CREATE INDEX IF NOT EXISTS customer_conversations_customer_created_idx
  ON public.customer_conversations (customer_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_customer_conversations_customer_select_own
  ON public.customer_conversations
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_customer_conversations_customer_insert_own
  ON public.customer_conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
    AND customer_id = public.lifeguard_auth_customer_id()
  );

CREATE POLICY lg_customer_conversations_admin_select
  ON public.customer_conversations
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

COMMIT;
