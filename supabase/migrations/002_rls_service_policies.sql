-- =============================================================================
-- LIFEGUARD Core — 002_rls_service_policies.sql
-- Replaces coarse 001 RLS with role-separated policies (customer / agent / admin).
-- Requires 001_initial_schema.sql applied first.
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- =============================================================================
-- Principles:
--   • customer_id comes from auth.uid() → users → customer_profiles (never client body).
--   • Customers see only lifeguard_auth_customer_id() rows.
--   • Agents see assigned customers only; NO profile_health / documents / chunks / traces / memory.
--   • Admins: audit SELECT; sensitive tables noted for future column masking.
--   • service_role bypasses RLS (Supabase) — workers only on server; NEVER in browser.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER — read users.role for current JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.role FROM public.users u WHERE u.id = auth.uid()),
    'none'
  );
$$;

COMMENT ON FUNCTION public.lifeguard_user_role() IS
  'App role from public.users; not from JWT custom claims alone.';

CREATE OR REPLACE FUNCTION public.lifeguard_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.lifeguard_user_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_is_agent()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.lifeguard_user_role() = 'agent';
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_is_customer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.lifeguard_user_role() = 'customer';
$$;

-- Agent may access a customer only when actively assigned.
CREATE OR REPLACE FUNCTION public.lifeguard_agent_assigned_to_customer(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.lifeguard_is_agent()
    AND EXISTS (
      SELECT 1
      FROM public.agent_assignments aa
      WHERE aa.customer_id = p_customer_id
        AND aa.agent_user_id = auth.uid()
        AND aa.status IN ('pending', 'active')
        AND aa.deleted_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.lifeguard_agent_assigned_to_customer(UUID) IS
  'True when auth user is agent role and assigned to customer_id via agent_assignments.';

-- Customer owns row when customer_id matches JWT-derived profile id.
CREATE OR REPLACE FUNCTION public.lifeguard_is_own_customer(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_customer_id IS NOT NULL
    AND p_customer_id = public.lifeguard_auth_customer_id();
$$;

-- ---------------------------------------------------------------------------
-- Drop 001 default policies (replaced by named policies below)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select_self ON public.users;
DROP POLICY IF EXISTS users_update_self ON public.users;

DROP POLICY IF EXISTS customer_profiles_select_own ON public.customer_profiles;
DROP POLICY IF EXISTS customer_profiles_insert_own ON public.customer_profiles;
DROP POLICY IF EXISTS customer_profiles_update_own ON public.customer_profiles;

DROP POLICY IF EXISTS profile_health_all_own ON public.profile_health;
DROP POLICY IF EXISTS profile_insurance_policies_all_own ON public.profile_insurance_policies;
DROP POLICY IF EXISTS customer_memory_facts_all_own ON public.customer_memory_facts;
DROP POLICY IF EXISTS consultations_all_own ON public.consultations;
DROP POLICY IF EXISTS consultation_messages_all_own ON public.consultation_messages;
DROP POLICY IF EXISTS customer_documents_all_own ON public.customer_documents;
DROP POLICY IF EXISTS customer_document_chunks_all_own ON public.customer_document_chunks;
DROP POLICY IF EXISTS consultation_traces_all_own ON public.consultation_traces;
DROP POLICY IF EXISTS outbox_events_select_own ON public.outbox_events;
DROP POLICY IF EXISTS outbox_events_insert_own ON public.outbox_events;
DROP POLICY IF EXISTS agent_assignments_select_own ON public.agent_assignments;
DROP POLICY IF EXISTS rule_packs_select_auth ON public.rule_packs;
DROP POLICY IF EXISTS rule_pack_versions_select_auth ON public.rule_pack_versions;

-- ---------------------------------------------------------------------------
-- FORCE RLS on high-sensitivity tables (owner/table owner still subject to RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profile_health FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memory_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_document_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_traces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 1. users
-- =============================================================================
CREATE POLICY lg_users_customer_select_self ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY lg_users_customer_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = 'customer');

-- Agents/admins may read their own row; role changes only via service/admin tooling.
CREATE POLICY lg_users_agent_admin_select_self ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    AND public.lifeguard_user_role() IN ('agent', 'admin')
  );

CREATE POLICY lg_users_admin_select_audit ON public.users
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- No DELETE on users via client policies.

-- =============================================================================
-- 2. customer_profiles
-- =============================================================================
CREATE POLICY lg_customer_profiles_customer_select_own ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND deleted_at IS NULL
  );

CREATE POLICY lg_customer_profiles_customer_insert_own ON public.customer_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.lifeguard_is_customer()
  );

CREATE POLICY lg_customer_profiles_customer_update_own ON public.customer_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Agent: limited profile fields for handoff (full row exposed — mask in API layer).
CREATE POLICY lg_customer_profiles_agent_select_assigned ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_agent_assigned_to_customer(id)
  );

CREATE POLICY lg_customer_profiles_admin_select_audit ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 3. profile_health  [PROTECTED — customer only; no agent]
-- =============================================================================
CREATE POLICY lg_profile_health_customer_select_own ON public.profile_health
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_health_customer_insert_own ON public.profile_health
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_health_customer_update_own ON public.profile_health
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- SENSITIVE: Admin audit SELECT — restrict columns in application / future security barrier view.
-- DO NOT expose profile_health to agent policies.
CREATE POLICY lg_profile_health_admin_select_audit ON public.profile_health
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 4. profile_insurance_policies
-- =============================================================================
CREATE POLICY lg_profile_insurance_customer_select_own ON public.profile_insurance_policies
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_insurance_customer_insert_own ON public.profile_insurance_policies
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_insurance_customer_update_own ON public.profile_insurance_policies
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_insurance_customer_delete_own ON public.profile_insurance_policies
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_profile_insurance_agent_select_assigned ON public.profile_insurance_policies
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_agent_assigned_to_customer(customer_id)
  );

CREATE POLICY lg_profile_insurance_admin_select_audit ON public.profile_insurance_policies
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 5. customer_memory_facts  [PROTECTED — customer only; no agent]
-- =============================================================================
CREATE POLICY lg_memory_facts_customer_select_own ON public.customer_memory_facts
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_memory_facts_customer_insert_own ON public.customer_memory_facts
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_memory_facts_customer_update_own ON public.customer_memory_facts
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_memory_facts_customer_delete_own ON public.customer_memory_facts
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_memory_facts_admin_select_audit ON public.customer_memory_facts
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 6. consultations
-- =============================================================================
CREATE POLICY lg_consultations_customer_select_own ON public.consultations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

CREATE POLICY lg_consultations_customer_insert_own ON public.consultations
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_consultations_customer_update_own ON public.consultations
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_consultations_agent_select_assigned ON public.consultations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_agent_assigned_to_customer(customer_id)
  );

CREATE POLICY lg_consultations_admin_select_audit ON public.consultations
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 7. consultation_messages  [PROTECTED cross-tenant]
-- =============================================================================
CREATE POLICY lg_consultation_messages_customer_select_own ON public.consultation_messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

CREATE POLICY lg_consultation_messages_customer_insert_own ON public.consultation_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_consultation_messages_customer_update_own ON public.consultation_messages
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- Agent: read messages for assigned customers (handoff); no document/health RAG via this table.
CREATE POLICY lg_consultation_messages_agent_select_assigned ON public.consultation_messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_agent_assigned_to_customer(customer_id)
  );

CREATE POLICY lg_consultation_messages_admin_select_audit ON public.consultation_messages
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 8. customer_documents  [PROTECTED — customer only; no agent]
-- =============================================================================
CREATE POLICY lg_customer_documents_customer_select_own ON public.customer_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

CREATE POLICY lg_customer_documents_customer_insert_own ON public.customer_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_customer_documents_customer_update_own ON public.customer_documents
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- SENSITIVE: Admin audit only — document binary access via storage policies separately.
CREATE POLICY lg_customer_documents_admin_select_audit ON public.customer_documents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 9. customer_document_chunks  [PROTECTED — customer only; no agent]
-- =============================================================================
CREATE POLICY lg_document_chunks_customer_select_own ON public.customer_document_chunks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

CREATE POLICY lg_document_chunks_customer_insert_own ON public.customer_document_chunks
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_chunks_customer_update_own ON public.customer_document_chunks
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_chunks_admin_select_audit ON public.customer_document_chunks
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Ingest worker: service_role INSERT/UPDATE (RLS bypass). Never use service_role in browser.

-- =============================================================================
-- 10. consultation_traces  [NO customer / NO agent exposure]
-- =============================================================================
CREATE POLICY lg_consultation_traces_admin_select_audit ON public.consultation_traces
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Orchestrator / trace writer: service_role only (bypass RLS).
-- FORBIDDEN: lg_consultation_traces_customer_select (would leak prompt_hash, chunk ids).

-- =============================================================================
-- 11. outbox_events  [customer read-only status; no client writes]
-- =============================================================================
CREATE POLICY lg_outbox_events_customer_select_own ON public.outbox_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- FORBIDDEN: customer INSERT/UPDATE/DELETE on outbox_events.
-- Workers (service_role): INSERT/UPDATE status — server env only.

CREATE POLICY lg_outbox_events_admin_select_audit ON public.outbox_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- =============================================================================
-- 12. agent_assignments
-- =============================================================================
CREATE POLICY lg_agent_assignments_customer_select_own ON public.agent_assignments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

CREATE POLICY lg_agent_assignments_agent_select_mine ON public.agent_assignments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND agent_user_id = auth.uid()
    AND public.lifeguard_is_agent()
  );

CREATE POLICY lg_agent_assignments_agent_update_mine ON public.agent_assignments
  FOR UPDATE TO authenticated
  USING (
    agent_user_id = auth.uid()
    AND public.lifeguard_is_agent()
  )
  WITH CHECK (
    agent_user_id = auth.uid()
    AND public.lifeguard_is_agent()
  );

CREATE POLICY lg_agent_assignments_admin_all ON public.agent_assignments
  FOR ALL TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

-- Assignment creation: service_role or admin (not customer).

-- =============================================================================
-- 13. rule_packs / rule_pack_versions  [authenticated read; admin write]
-- =============================================================================
CREATE POLICY lg_rule_packs_authenticated_select ON public.rule_packs
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY lg_rule_packs_admin_insert ON public.rule_packs
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_rule_packs_admin_update ON public.rule_packs
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_rule_packs_admin_delete ON public.rule_packs
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_rule_pack_versions_authenticated_select ON public.rule_pack_versions
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY lg_rule_pack_versions_admin_insert ON public.rule_pack_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_rule_pack_versions_admin_update ON public.rule_pack_versions
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_rule_pack_versions_admin_delete ON public.rule_pack_versions
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

-- Seed migrations (003) run as service_role or postgres — bypasses RLS.

-- ---------------------------------------------------------------------------
-- service_role / worker usage (documentation — not SQL policies)
-- ---------------------------------------------------------------------------
-- | Worker              | Key            | RLS     | Typical tables                          |
-- |---------------------|----------------|---------|-----------------------------------------|
-- | document_ingest     | service_role   | bypass  | customer_documents, customer_document_chunks |
-- | memory_builder      | service_role   | bypass  | customer_memory_facts, profile_*        |
-- | outbox_processor    | service_role   | bypass  | outbox_events, agent_assignments        |
-- | consultation_orch   | service_role   | bypass  | consultation_traces, outbox_events INSERT |
-- | rebalancing_scheduler | service_role | bypass  | outbox_events (future)                  |
--
-- NEVER embed SUPABASE_SERVICE_ROLE_KEY in browser, mobile, or Vite bundles.
-- API routes must use anon/authenticated JWT for end users.

-- ---------------------------------------------------------------------------
-- FORBIDDEN policy patterns (do not add)
-- ---------------------------------------------------------------------------
-- • USING (TRUE) or WITH CHECK (TRUE) on tenant tables (customer_*, profile_health).
-- • INSERT on outbox_events FOR authenticated customers.
-- • SELECT on consultation_traces FOR customers (prompt provenance leak).
-- • Agent SELECT on profile_health, customer_documents, customer_document_chunks, customer_memory_facts.
-- • Trusting NEW.customer_id from client without lifeguard_auth_customer_id() check.
-- • Exposing service_role key to any client runtime.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TEST CHECKLIST (run manually in SQL Editor / CI)
-- Use Supabase "Set auth" or JWT test users: customer_a, customer_b, agent_1, admin_1.
-- =============================================================================
--
-- --- Setup (service_role or postgres) ---
-- INSERT users + customer_profiles for A and B; agent user; admin user.
-- INSERT agent_assignments (agent_1 → customer_a only, status active).
-- INSERT sample rows per table for A and B.
--
-- --- 1. Customer isolation (A must not see B) ---
-- SET request.jwt.claim.sub = '<customer_a_user_id>';
-- SELECT count(*) FROM customer_memory_facts;          -- expect: only A rows
-- SELECT count(*) FROM customer_memory_facts
--   WHERE customer_id = '<customer_b_id>';           -- expect: 0
-- SELECT count(*) FROM customer_documents
--   WHERE customer_id = '<customer_b_id>';           -- expect: 0
-- SELECT count(*) FROM consultation_messages
--   WHERE customer_id = '<customer_b_id>';           -- expect: 0
--
-- --- 2. Agent unassigned customer blocked ---
-- SET role authenticated; SET request.jwt.claim.sub = '<agent_1_user_id>';
-- SELECT * FROM customer_profiles WHERE id = '<customer_b_id>';  -- expect: 0 rows
-- SELECT * FROM consultations WHERE customer_id = '<customer_b_id>'; -- expect: 0
-- SELECT * FROM profile_health WHERE customer_id = '<customer_a_id>'; -- expect: 0 (agent blocked)
-- SELECT * FROM customer_documents WHERE customer_id = '<customer_a_id>'; -- expect: 0
--
-- --- 3. Agent assigned customer limited access ---
-- SELECT id, display_name FROM customer_profiles WHERE id = '<customer_a_id>'; -- expect: 1 row
-- SELECT id, role, content FROM consultation_messages
--   WHERE customer_id = '<customer_a_id>';           -- expect: A messages
-- SELECT * FROM customer_memory_facts
--   WHERE customer_id = '<customer_a_id>';           -- expect: 0 (agent blocked)
-- SELECT * FROM consultation_traces;                 -- expect: 0 (agent blocked)
--
-- --- 4. consultation_traces hidden from customer ---
-- SET request.jwt.claim.sub = '<customer_a_user_id>';
-- SELECT * FROM consultation_traces;                 -- expect: 0 rows
--
-- --- 5. rule_packs readable by customer ---
-- SELECT count(*) FROM rule_packs;                   -- expect: >= 0 (seed packs)
-- SELECT count(*) FROM rule_pack_versions WHERE is_active; -- expect: >= 0
-- INSERT INTO rule_packs (slug, title) VALUES ('hack', 'x'); -- expect: RLS violation
--
-- --- 6. outbox customer cannot insert ---
-- SET request.jwt.claim.sub = '<customer_a_user_id>';
-- INSERT INTO outbox_events (customer_id, event_type, payload)
--   VALUES ('<customer_a_id>', 'test.evil', '{}');  -- expect: RLS violation
-- SELECT event_type, status FROM outbox_events
--   WHERE customer_id = '<customer_a_id>';           -- expect: OK if worker inserted rows
--
-- --- 7. Admin audit read (optional) ---
-- SET request.jwt.claim.sub = '<admin_user_id>';
-- SELECT count(*) FROM consultation_traces;          -- expect: all rows (audit)
-- SELECT count(*) FROM profile_health;               -- expect: all (use masked API in prod)
--
-- --- 8. service_role smoke (server only) ---
-- Run ingest insert into customer_document_chunks with service_role — expect success.
-- Repeat with anon key — expect failure.
--
-- =============================================================================
