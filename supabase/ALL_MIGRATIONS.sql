-- =============================================================================
-- LIFEGUARD Core — 001_initial_schema.sql
-- Dedicated database for lifeguard-core ONLY.
-- Do NOT apply to INSUX / INSUX2 / insux-pro-ai Supabase projects.
-- =============================================================================
-- Tables (14):
--   users, customer_profiles, profile_health, profile_insurance_policies,
--   customer_memory_facts, consultations, consultation_messages,
--   customer_documents, customer_document_chunks,
--   rule_packs, rule_pack_versions, consultation_traces,
--   outbox_events, agent_assignments
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- Helpers: updated_at + auth → customer_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Maps auth.uid() → customer_profiles.id (the canonical customer_id)
CREATE OR REPLACE FUNCTION public.lifeguard_auth_customer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.id
  FROM public.customer_profiles cp
  WHERE cp.user_id = auth.uid()
    AND cp.deleted_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.lifeguard_auth_customer_id() IS
  'Returns LIFEGUARD customer_profiles.id for the logged-in user. Used in RLS.';

-- ---------------------------------------------------------------------------
-- 1. users
-- Why: App identity row linked to Supabase Auth; roles for future agent/admin.
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id            UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email         TEXT,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'agent', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS
  'LIFEGUARD application user; id matches auth.users. Not INSUX users.';

CREATE INDEX users_role_idx ON public.users (role);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. customer_profiles
-- Why: One canonical customer_id per person; demographics + memory versioning.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES public.users (id) ON DELETE CASCADE,
  display_name    TEXT,
  birth_date      DATE,
  gender          TEXT,
  job_category    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'suspended')),
  memory_version  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.customer_profiles IS
  'Canonical customer root; customer_id in all other tables references this id.';

CREATE INDEX customer_profiles_user_id_idx ON public.customer_profiles (user_id);
CREATE INDEX customer_profiles_status_idx ON public.customer_profiles (status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER customer_profiles_set_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. profile_health
-- Why: Separated PII/sensitive health disclosures from generic profile row.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profile_health (
  customer_id           UUID PRIMARY KEY REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  smoking               TEXT,
  drinking              TEXT,
  hospital_5y           TEXT,
  surgery_5y            TEXT,
  medication            TEXT,
  outpatient            TEXT,
  family_history        TEXT,
  details_json          JSONB NOT NULL DEFAULT '{}'::JSONB,
  source                TEXT NOT NULL DEFAULT 'signup'
                        CHECK (source IN ('signup', 'update', 'import')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profile_health IS
  'Health & medical disclosure fields; isolated for consent and access policy.';

CREATE TRIGGER profile_health_set_updated_at
  BEFORE UPDATE ON public.profile_health
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. profile_insurance_policies
-- Why: Structured in-force / known policies; feeds memory builder & prompts.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profile_insurance_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  insurer_name      TEXT,
  product_name      TEXT,
  policy_type       TEXT,
  monthly_premium   NUMERIC(14, 2),
  coverage_summary  JSONB NOT NULL DEFAULT '{}'::JSONB,
  effective_from    DATE,
  source            TEXT NOT NULL DEFAULT 'signup'
                    CHECK (source IN ('signup', 'upload_extract', 'manual', 'import')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.profile_insurance_policies IS
  'Per-customer insurance contracts summary; distinct from RAG document text.';

CREATE INDEX profile_insurance_policies_customer_idx
  ON public.profile_insurance_policies (customer_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER profile_insurance_policies_set_updated_at
  BEFORE UPDATE ON public.profile_insurance_policies
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. customer_memory_facts
-- Why: AI-facing canonical memory (not raw chat); versioned via superseded_at.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_memory_facts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  fact_key         TEXT NOT NULL,
  fact_value       TEXT NOT NULL,
  confidence       NUMERIC(4, 3) NOT NULL DEFAULT 1.000
                   CHECK (confidence >= 0 AND confidence <= 1),
  provenance_type  TEXT NOT NULL DEFAULT 'profile'
                   CHECK (provenance_type IN ('profile', 'document', 'operator', 'system')),
  provenance_ref   UUID,
  effective_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.customer_memory_facts IS
  'Normalized customer memory for prompts; one active row per fact_key per customer.';

CREATE UNIQUE INDEX customer_memory_facts_active_key_uq
  ON public.customer_memory_facts (customer_id, fact_key)
  WHERE superseded_at IS NULL;

CREATE INDEX customer_memory_facts_customer_idx
  ON public.customer_memory_facts (customer_id);

CREATE TRIGGER customer_memory_facts_set_updated_at
  BEFORE UPDATE ON public.customer_memory_facts
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. consultations
-- Why: Chat thread container; default post-login surface is consultation list/open.
-- ---------------------------------------------------------------------------
CREATE TABLE public.consultations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  title         TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE public.consultations IS
  'AI consultation session (chat room) per customer.';

CREATE INDEX consultations_customer_idx
  ON public.consultations (customer_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER consultations_set_updated_at
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. consultation_messages
-- Why: User/assistant turns; stores answer text and citation payload.
-- ---------------------------------------------------------------------------
CREATE TABLE public.consultation_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id   UUID NOT NULL REFERENCES public.consultations (id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT NOT NULL,
  sources_json      JSONB NOT NULL DEFAULT '{}'::JSONB,
  model             TEXT,
  latency_ms        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.consultation_messages IS
  'Messages in a consultation; customer_id duplicated for RLS without joins.';

CREATE INDEX consultation_messages_consultation_idx
  ON public.consultation_messages (consultation_id, created_at);

CREATE INDEX consultation_messages_customer_idx
  ON public.consultation_messages (customer_id, created_at DESC);

CREATE TRIGGER consultation_messages_set_updated_at
  BEFORE UPDATE ON public.consultation_messages
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- Keep consultation_messages.customer_id aligned with parent consultation
CREATE OR REPLACE FUNCTION public.lifeguard_sync_message_customer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  SELECT c.customer_id INTO v_customer_id
  FROM public.consultations c
  WHERE c.id = NEW.consultation_id;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'consultation not found: %', NEW.consultation_id;
  END IF;
  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultation_messages_sync_customer
  BEFORE INSERT OR UPDATE OF consultation_id ON public.consultation_messages
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_sync_message_customer_id();

-- ---------------------------------------------------------------------------
-- 8. customer_documents
-- Why: Uploaded PDF/image metadata + ingest pipeline state per customer.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  storage_path       TEXT NOT NULL,
  mime_type          TEXT,
  original_filename  TEXT,
  doc_class          TEXT NOT NULL DEFAULT 'other'
                     CHECK (doc_class IN (
                       'policy_certificate', 'terms', 'claim', 'medical', 'other'
                     )),
  ingest_status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (ingest_status IN ('pending', 'processing', 'ready', 'failed')),
  page_count         INTEGER,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

COMMENT ON TABLE public.customer_documents IS
  'Per-customer document cabinet entry (object storage pointer).';

CREATE INDEX customer_documents_customer_idx
  ON public.customer_documents (customer_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER customer_documents_set_updated_at
  BEFORE UPDATE ON public.customer_documents
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. customer_document_chunks
-- Why: Per-customer RAG index; retrieval MUST filter by customer_id.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_document_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  document_id      UUID NOT NULL REFERENCES public.customer_documents (id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  content          TEXT NOT NULL,
  content_tsv      TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
  embedding        VECTOR(1536),
  embedding_model  TEXT,
  doc_title        TEXT,
  section          TEXT,
  page             INTEGER,
  metadata         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT customer_document_chunks_doc_chunk_uq UNIQUE (document_id, chunk_index)
);

COMMENT ON TABLE public.customer_document_chunks IS
  'Vector + FTS chunks scoped to one customer; never searched cross-customer.';

CREATE INDEX customer_document_chunks_customer_idx
  ON public.customer_document_chunks (customer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX customer_document_chunks_document_idx
  ON public.customer_document_chunks (document_id);

CREATE INDEX customer_document_chunks_tsv_idx
  ON public.customer_document_chunks USING GIN (content_tsv);

-- IVFFlat index: create after seeding data in deployment; listed here for design completeness.
-- Run manually when row count > 1000: lists = sqrt(n)
CREATE INDEX customer_document_chunks_embedding_idx
  ON public.customer_document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

CREATE TRIGGER customer_document_chunks_set_updated_at
  BEFORE UPDATE ON public.customer_document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-customer vector search (mandatory customer_id filter)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_customer_document_chunks(
  p_customer_id       UUID,
  p_query_embedding   VECTOR(1536),
  p_match_threshold   FLOAT DEFAULT 0.5,
  p_match_count       INT DEFAULT 8
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  doc_title   TEXT,
  section     TEXT,
  page        INTEGER,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.doc_title,
    c.section,
    c.page,
    c.content,
    (1 - (c.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.customer_document_chunks c
  WHERE c.customer_id = p_customer_id
    AND c.deleted_at IS NULL
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT LEAST(p_match_count, 32);
$$;

COMMENT ON FUNCTION public.match_customer_document_chunks IS
  'RAG retrieval; p_customer_id is required — prevents cross-tenant leakage.';

-- ---------------------------------------------------------------------------
-- 10. rule_packs
-- Why: Catalog of insurance judgment rule collections (global, not per customer).
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rule_packs IS
  'Insurance rules catalog; shared across customers, versioned separately.';

CREATE TRIGGER rule_packs_set_updated_at
  BEFORE UPDATE ON public.rule_packs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 11. rule_pack_versions
-- Why: Versioned rule bodies for prompt injection and audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_pack_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_pack_id  UUID NOT NULL REFERENCES public.rule_packs (id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  topic_tags    TEXT[] NOT NULL DEFAULT '{}',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rule_pack_versions_pack_version_uq UNIQUE (rule_pack_id, version)
);

COMMENT ON TABLE public.rule_pack_versions IS
  'Immutable-style rule content revisions; consultation_traces references version id.';

CREATE INDEX rule_pack_versions_active_idx
  ON public.rule_pack_versions (rule_pack_id)
  WHERE is_active = TRUE;

CREATE TRIGGER rule_pack_versions_set_updated_at
  BEFORE UPDATE ON public.rule_pack_versions
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. consultation_traces
-- Why: Compliance/debug log of what memory/chunks/rules were used per answer.
-- ---------------------------------------------------------------------------
CREATE TABLE public.consultation_traces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  message_id            UUID NOT NULL UNIQUE REFERENCES public.consultation_messages (id) ON DELETE CASCADE,
  memory_version        INTEGER,
  chunk_ids             UUID[] NOT NULL DEFAULT '{}',
  rule_pack_version_id  UUID REFERENCES public.rule_pack_versions (id) ON DELETE SET NULL,
  retrieval_scores      JSONB NOT NULL DEFAULT '{}'::JSONB,
  prompt_token_estimate INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.consultation_traces IS
  'Provenance for each assistant message: retrieval ids, scores, rule version.';

CREATE INDEX consultation_traces_customer_idx
  ON public.consultation_traces (customer_id, created_at DESC);

CREATE TRIGGER consultation_traces_set_updated_at
  BEFORE UPDATE ON public.consultation_traces
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 13. outbox_events
-- Why: Async extension bus for notifications, rebalancing, webhooks (future).
-- ---------------------------------------------------------------------------
CREATE TABLE public.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.outbox_events IS
  'Transactional outbox for future notification/rebalancing/agent workers.';

CREATE INDEX outbox_events_pending_idx
  ON public.outbox_events (status, created_at)
  WHERE status = 'pending';

CREATE INDEX outbox_events_customer_idx
  ON public.outbox_events (customer_id, created_at DESC);

CREATE TRIGGER outbox_events_set_updated_at
  BEFORE UPDATE ON public.outbox_events
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- 14. agent_assignments
-- Why: Future designer handoff; links customer to agent user without UI now.
-- ---------------------------------------------------------------------------
CREATE TABLE public.agent_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  agent_user_id   UUID REFERENCES public.users (id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'unassigned'
                  CHECK (status IN ('unassigned', 'pending', 'active', 'closed')),
  notes           TEXT,
  assigned_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.agent_assignments IS
  'Designer/agent routing stub; extensible for handoff packets later.';

CREATE INDEX agent_assignments_customer_idx
  ON public.agent_assignments (customer_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER agent_assignments_set_updated_at
  BEFORE UPDATE ON public.agent_assignments
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_pack_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assignments ENABLE ROW LEVEL SECURITY;

-- users: self only
CREATE POLICY users_select_self ON public.users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (id = auth.uid());

-- customer_profiles: own row
CREATE POLICY customer_profiles_select_own ON public.customer_profiles
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY customer_profiles_insert_own ON public.customer_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY customer_profiles_update_own ON public.customer_profiles
  FOR UPDATE USING (user_id = auth.uid());

-- Generic customer-owned tables: customer_id = lifeguard_auth_customer_id()
CREATE POLICY profile_health_all_own ON public.profile_health
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY profile_insurance_policies_all_own ON public.profile_insurance_policies
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY customer_memory_facts_all_own ON public.customer_memory_facts
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY consultations_all_own ON public.consultations
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY consultation_messages_all_own ON public.consultation_messages
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY customer_documents_all_own ON public.customer_documents
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY customer_document_chunks_all_own ON public.customer_document_chunks
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY consultation_traces_all_own ON public.consultation_traces
  FOR ALL USING (customer_id = public.lifeguard_auth_customer_id())
  WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY outbox_events_select_own ON public.outbox_events
  FOR SELECT USING (customer_id = public.lifeguard_auth_customer_id());

-- Inserts to outbox from client optional; workers use service_role
CREATE POLICY outbox_events_insert_own ON public.outbox_events
  FOR INSERT WITH CHECK (customer_id = public.lifeguard_auth_customer_id());

CREATE POLICY agent_assignments_select_own ON public.agent_assignments
  FOR SELECT USING (customer_id = public.lifeguard_auth_customer_id());

-- rule packs: read-only for authenticated users
CREATE POLICY rule_packs_select_auth ON public.rule_packs
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY rule_pack_versions_select_auth ON public.rule_pack_versions
  FOR SELECT TO authenticated USING (TRUE);

-- Service role bypasses RLS (Supabase default) for ingest workers and memory builder.

COMMIT;

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

-- =============================================================================
-- LIFEGUARD Core — 003_seed_rule_packs.sql
-- Seed default rule_packs / rule_pack_versions for consultation orchestration.
-- Requires 001_initial_schema.sql applied first.
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- =============================================================================
-- Adds structured columns to rule_pack_versions (001 file unchanged; applied here).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extend rule_pack_versions for structured seed (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rule_pack_versions
  ADD COLUMN IF NOT EXISTS title               TEXT,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS rule_body           JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS prompt_guidelines   TEXT,
  ADD COLUMN IF NOT EXISTS safety_guidelines   TEXT,
  ADD COLUMN IF NOT EXISTS output_schema       JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'retired'));

COMMENT ON COLUMN public.rule_pack_versions.rule_body IS
  'Machine-readable rules; used with customer memory + document RAG.';
COMMENT ON COLUMN public.rule_pack_versions.output_schema IS
  'Expected response shape labels for guard + UI (future).';

-- Keep status ↔ is_active aligned on seed rows
UPDATE public.rule_pack_versions SET is_active = (status = 'active') WHERE status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helper: upsert pack + version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_seed_rule_pack_version(
  p_slug              TEXT,
  p_pack_title        TEXT,
  p_version           TEXT,
  p_version_title     TEXT,
  p_description       TEXT,
  p_body_markdown     TEXT,
  p_rule_body         JSONB,
  p_prompt_guidelines TEXT,
  p_safety_guidelines TEXT,
  p_output_schema     JSONB,
  p_tags              TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_pack_id UUID;
BEGIN
  INSERT INTO public.rule_packs (slug, title)
  VALUES (p_slug, p_pack_title)
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
  RETURNING id INTO v_pack_id;

  IF v_pack_id IS NULL THEN
    SELECT id INTO v_pack_id FROM public.rule_packs WHERE slug = p_slug;
  END IF;

  INSERT INTO public.rule_pack_versions (
    rule_pack_id,
    version,
    title,
    body_markdown,
    topic_tags,
    is_active,
    status,
    description,
    rule_body,
    prompt_guidelines,
    safety_guidelines,
    output_schema
  )
  VALUES (
    v_pack_id,
    p_version,
    p_version_title,
    p_body_markdown,
    p_tags,
    TRUE,
    'active',
    p_description,
    p_rule_body,
    p_prompt_guidelines,
    p_safety_guidelines,
    p_output_schema
  )
  ON CONFLICT (rule_pack_id, version) DO UPDATE SET
    title             = EXCLUDED.title,
    body_markdown     = EXCLUDED.body_markdown,
    topic_tags        = EXCLUDED.topic_tags,
    is_active         = TRUE,
    status            = 'active',
    description       = EXCLUDED.description,
    rule_body         = EXCLUDED.rule_body,
    prompt_guidelines = EXCLUDED.prompt_guidelines,
    safety_guidelines = EXCLUDED.safety_guidelines,
    output_schema     = EXCLUDED.output_schema,
    updated_at        = NOW();
END;
$$;

-- =============================================================================
-- 1. disclosure_check_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'disclosure_check_basic',
  '고지 의무·병력 이력 검토 (기본)',
  '1.0.0',
  '고지 가능성 분류 — 기본',
  '고객 건강정보(profile_health, memory)와 업로드 문서를 함께 참고하여 병력·복용약·수술·입원·검사·치료 고지 필요성을 **가능성** 수준으로 분류합니다.',
  E'## 요약\n병력·복용·수술·입원·검사·치료 이력의 **고지 가능성**을 판단합니다. 법적 확정·인수 거절 단정 금지.\n\n## 입력 우선순위\n1. customer_memory_facts (건강)\n2. profile_health\n3. customer_document_chunks (진단서·처방·입원기록 등)\n\n## 출력 라벨\n- 고지 가능성 있음 (추가 확인 필요)\n- 고지 가능성 낮음 (자료상 근거 부족)\n- 전문가(담당 설계사) 확인 필요',
  jsonb_build_object(
    'pack_slug', 'disclosure_check_basic',
    'inputs_required', jsonb_build_array('profile_health', 'customer_memory_facts', 'customer_document_chunks'),
    'checklist', jsonb_build_array(
      jsonb_build_object('key', 'medication_history', 'label', '복용약·처방'),
      jsonb_build_object('key', 'surgery_history', 'label', '수술 이력'),
      jsonb_build_object('key', 'hospitalization', 'label', '입원·응급'),
      jsonb_build_object('key', 'diagnosis_exam', 'label', '진단·검사'),
      jsonb_build_object('key', 'ongoing_treatment', 'label', '현재 치료')
    ),
    'decision_labels', jsonb_build_array(
      'disclosure_likely_needs_review',
      'disclosure_unlikely_insufficient_data',
      'requires_agent_review'
    ),
    'forbidden_phrases', jsonb_build_array('반드시 고지해야 합니다', '인수 거절 확정', '보험금 지급 확정')
  ),
  E'- 고객 기억·건강 프로필·업로드 문서에 **명시된 사실만** 인용한다.\n- 문서와 기억이 충돌하면 “추가 확인 필요”로 통일한다.\n- 답변 말미: 참고한 기억 키, 문서명(D#), 본 규칙 팩 버전.\n- 라벨은 반드시: 고지 가능성/추가 확인 필요/전문가 확인 필요 중 하나를 대표값으로 제시.',
  E'- 법적 확정·행정처분 단정 금지.\n- “가입 불가”“해지 필요” 권유 금지.\n- 주민등록번호 등 민감정보 반복·저장 요구 금지.\n- 자료 없으면: “등록된 자료에서 확인할 수 없습니다.”',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'rationale', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '고지 가능성 있음 (추가 확인 필요)',
          '고지 가능성 낮음 (자료 부족)',
          '전문가(담당 설계사) 확인 필요'
        )
      ),
      'checklist_findings', jsonb_build_object('type', 'array'),
      'rationale', jsonb_build_object('type', 'string'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['disclosure', 'health', 'underwriting', 'memory', 'documents']
);

-- =============================================================================
-- 2. claim_possibility_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'claim_possibility_basic',
  '보험금 청구 가능성 (기본)',
  '1.0.0',
  '청구 가능성 분류 — 기본',
  '진단서·영수증·세부내역서·약관(문서 RAG)과 고객 기억을 바탕으로 실손/진단비/수술비/입원비/통원비 **청구 가능성**을 분류합니다. 지급 확정 금지.',
  E'## 요약\n청구 **가능성**만 평가합니다. 지급액·지급 확정 표현 금지.\n\n## 담보 구분\n- 실손의료비\n- 진단비\n- 수술비\n- 입원비\n- 통원·외래\n\n## 출력 라벨\n- 청구 가능성 높음 / 중간 / 낮음 / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'claim_possibility_basic',
    'inputs_required', jsonb_build_array('customer_document_chunks', 'customer_memory_facts', 'profile_insurance_policies'),
    'document_types', jsonb_build_array('diagnosis', 'receipt', 'detail_statement', 'policy_terms'),
    'coverage_lines', jsonb_build_array('indemnity_medical', 'diagnosis_lump_sum', 'surgery', 'hospitalization', 'outpatient'),
    'decision_labels', jsonb_build_array(
      'claim_possibility_high',
      'claim_possibility_medium',
      'claim_possibility_low',
      'insufficient_documents'
    ),
    'forbidden_phrases', jsonb_build_array('지급 확정', '반드시 지급', '청구 불가 확정')
  ),
  E'- 약관·진단서·영수증·세부내역서 청크를 우선 인용.\n- 보종별로 가능성을 **분리** 서술 후 대표 라벨 1개 제시.\n- 자료 부족 시 필요 서류 목록만 제안 (법적 강제 표현 없음).',
  E'- 보험금 지급액·지급일 단정 금지.\n- 보험사 최종 심사 대체 표현 금지.\n- 분쟁·소송 조언 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'by_coverage_line', 'missing_documents', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array('청구 가능성 높음', '청구 가능성 중간', '청구 가능성 낮음', '자료 부족')
      ),
      'by_coverage_line', jsonb_build_object('type', 'array'),
      'missing_documents', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['claim', 'documents', 'terms', 'indemnity', 'diagnosis']
);

-- =============================================================================
-- 3. coverage_gap_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'coverage_gap_basic',
  '보장 공백 분석 (기본)',
  '1.0.0',
  '보장 공백 — 기본',
  '암/뇌/심장/실손/수술/입원/사망/후유/운전자/배상 등 **공백 가능성**을 portfolio·나이·가족·직업·기억과 함께 검토합니다.',
  E'## 요약\n보장 **부족 가능성**을 제시합니다. 상품 가입·해지 권유 금지.\n\n## 보장 축\n암, 뇌혈관, 심장, 실손, 수술, 입원, 사망, 후유장해, 운전자, 배상책임\n\n## 출력\n- 공백 가능성 있음 / 검토 필요 / 현 자료상 양호 / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'coverage_gap_basic',
    'inputs_required', jsonb_build_array(
      'profile_insurance_policies', 'customer_memory_facts', 'customer_profiles',
      'customer_document_chunks'
    ),
    'coverage_axes', jsonb_build_array(
      'cancer', 'brain', 'heart', 'indemnity', 'surgery', 'hospitalization',
      'death', 'disability', 'driver', 'liability'
    ),
    'decision_labels', jsonb_build_array(
      'gap_likely',
      'gap_review_needed',
      'adequate_on_available_data',
      'insufficient_data'
    ),
    'forbidden_phrases', jsonb_build_array('반드시 가입', '즉시 해지', '부족 확정')
  ),
  E'- 기존 가입 내역은 policy·memory·문서에서 확인된 범위만 사용.\n- 나이·직업·가족은 profile·memory에서 인용.\n- 축별 “가능한 공백”과 “검토 필요”를 구분.\n- 개선은 방향만 (예: “실손 한도 검토 필요”).',
  E'- 특정 상품명·보험사 가입 권유 금지.\n- 공백을 확정적으로 단정하지 말 것 (“가능성”“검토 필요”).',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'gaps_by_axis', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '보장 공백 가능성 있음',
          '검토 필요',
          '현 자료상 양호',
          '자료 부족'
        )
      ),
      'gaps_by_axis', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['coverage', 'gap', 'portfolio', 'family', 'memory']
);

-- =============================================================================
-- 4. duplicate_coverage_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'duplicate_coverage_basic',
  '중복 보장·과다 보험료 검토 (기본)',
  '1.0.0',
  '중복 보장 — 기본',
  '중복 보장·과다 보험료·갱신형 부담 **가능성**만 판단. 해지·축소 **권유 금지**, “검토 필요” 표현만 사용.',
  E'## 요약\n중복·과다 **가능성** 진단. 해지/감액 지시 금지.\n\n## 검토 항목\n- 동일 담보 중복 (진단/수술/실손 등)\n- 보험료 부담 대비 겹침\n- 갱신형 보험료 상승 부담 가능성\n\n## 출력\n- 중복 가능성 높음 / 검토 필요 / 특이사항 없음(자료 범위) / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'duplicate_coverage_basic',
    'inputs_required', jsonb_build_array('profile_insurance_policies', 'customer_document_chunks', 'customer_memory_facts'),
    'review_topics', jsonb_build_array('duplicate_rider', 'premium_burden', 'renewal_premium_risk'),
    'decision_labels', jsonb_build_array(
      'duplicate_likely',
      'review_needed',
      'no_signal_in_data',
      'insufficient_data'
    ),
    'forbidden_actions', jsonb_build_array('cancel_policy', 'reduce_coverage', 'switch_insurer'),
    'allowed_phrases', jsonb_build_array('검토 필요', '담당 설계사와 정리 권장', '가능성')
  ),
  E'- 계약별 겹침 후보만 나열.\n- “해지하세요”“줄이세요” 대신 “중복 여부 **검토 필요**”.\n- 보험료 수치는 자료에 있을 때만 인용.',
  E'- 해지·가입·전환 강권 절대 금지.\n- 특정 회사 비방·비교 우위 단정 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'overlap_candidates', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '중복 가능성 높음 (검토 필요)',
          '검토 필요',
          '현 자료 범위 내 특이사항 없음',
          '자료 부족'
        )
      ),
      'overlap_candidates', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['duplicate', 'premium', 'renewal', 'portfolio']
);

-- =============================================================================
-- 5. rebalancing_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'rebalancing_basic',
  '리밸런싱 필요성 (기본)',
  '1.0.0',
  '리밸런싱 방향 — 기본',
  '보험료 부담·갱신 예정·보장 부족·가족 변화를 바탕으로 **리밸런싱 필요성**만 제시. 상품 추천·가입 권유 금지.',
  E'## 요약\n개선 **방향**만 제시 (우선순위·검토 축). 특정 상품 추천 금지.\n\n## 신호\n- 보험료 부담 (memory/프로필)\n- 갱신 예정\n- coverage_gap 신호와 연계 가능\n- 가족 구성 변화\n\n## 출력\n- 리밸런싱 검토 권장 / 선택적 검토 / 현 상태 유지(자료상) / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'rebalancing_basic',
    'inputs_required', jsonb_build_array(
      'customer_memory_facts', 'profile_insurance_policies', 'customer_profiles', 'customer_document_chunks'
    ),
    'signals', jsonb_build_array('premium_stress', 'renewal_upcoming', 'coverage_gap', 'family_change'),
    'decision_labels', jsonb_build_array(
      'rebalancing_recommended',
      'optional_review',
      'maintain_on_data',
      'insufficient_data'
    ),
    'output_style', 'direction_only',
    'forbidden_phrases', jsonb_build_array('이 상품에 가입', '지금 해지', '최고의 상품')
  ),
  E'- 3개 이내 개선 방향 bullet (예: “실손 한도 점검”, “진단비 중복 정리 검토”).\n- outbox `rebalancing.review.suggested` 이벤트는 서버가 선택 발행 (규칙은 제안만).\n- 상품명·보험사명 나열은 “검토 대상” 수준만.',
  E'- 가입·해지·전환 유도 금지.\n- 수익률·세무 확정 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'directions', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '리밸런싱 검토 권장',
          '선택적 검토',
          '현 자료상 유지',
          '자료 부족'
        )
      ),
      'directions', jsonb_build_object('type', 'array', 'maxItems', 3),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['rebalancing', 'renewal', 'premium', 'family', 'coverage']
);

-- =============================================================================
-- 6. agent_escalation_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'agent_escalation_basic',
  '설계사 연계·AI 한계 (기본)',
  '1.0.0',
  'AI 단독 답변 금지 트리거 — 기본',
  '계약 해지·고지 확정·지급 확정·세무/법률 단정·고액 변경 등 **AI 단독 답변 금지** 조건을 정의하고, 충족 시 `agent.escalation.requested` outbox 이벤트 발행을 **서버**에 권고합니다.',
  E'## 요약\n아래 트리거 시 AI는 요약만 제공하고 **담당 설계사 연결**을 안내.\n\n## AI 단독 답변 금지 예시\n- 계약 해지/해지환급 확정 요청\n- 고지 의무 위반 여부 확정\n- 보험금 지급 확정\n- 세무·법률 결론\n- 고액 계약 변경·구조 변경\n\n## outbox (서버)\n`event_type`: agent.escalation.requested',
  jsonb_build_object(
    'pack_slug', 'agent_escalation_basic',
    'triggers', jsonb_build_array(
      jsonb_build_object('code', 'cancellation_decision', 'label', '해지·해지환급 확정'),
      jsonb_build_object('code', 'disclosure_final', 'label', '고지 위반 확정'),
      jsonb_build_object('code', 'claim_payment_final', 'label', '보험금 지급 확정'),
      jsonb_build_object('code', 'tax_legal_certainty', 'label', '세무·법률 단정'),
      jsonb_build_object('code', 'high_value_contract_change', 'label', '고액·구조 변경')
    ),
    'ai_allowed', jsonb_build_array('summarize_documents', 'list_review_points', 'explain_process'),
    'outbox_event', jsonb_build_object(
      'event_type', 'agent.escalation.requested',
      'payload_keys', jsonb_build_array('customer_id', 'consultation_id', 'trigger_codes', 'summary')
    ),
    'decision_labels', jsonb_build_array('escalate_required', 'escalate_recommended', 'ai_can_continue')
  ),
  E'- 트리거 충족 시: “AI 단독 확정 불가 → 담당 설계사 확인” 문구 필수.\n- trigger_codes 배열로 이유 명시.\n- 서버가 outbox_events INSERT (클라이언트 직접 INSERT 불필요).\n- agent_assignments.status 가 unassigned 이면 “배정 대기” 안내.',
  E'- AI가 확정·법률자문·지급 약속 금지.\n- 설계사 비방·회사 내부정보 노출 금지.\n- 고객 불안 조성 표현 자제.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'trigger_codes', 'customer_message', 'emit_outbox'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '설계사 연결 필요',
          '설계사 연결 권장',
          'AI 계속 가능 (트리거 없음)'
        )
      ),
      'trigger_codes', jsonb_build_object('type', 'array'),
      'emit_outbox', jsonb_build_object('type', 'boolean'),
      'outbox_event_type', jsonb_build_object('const', 'agent.escalation.requested')
    )
  ),
  ARRAY['agent', 'escalation', 'safety', 'outbox', 'compliance']
);

-- Drop seed helper (optional — keep for re-run migrations in dev)
-- DROP FUNCTION public.lifeguard_seed_rule_pack_version;

COMMIT;

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

-- =============================================================================
-- LIFEGUARD Core — 005_document_ingest_extend.sql
-- Extends document ingest schema per DOCUMENT_INGEST.md
-- Requires: 001, 002, 004 (consent helpers for RAG gate)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample document rows.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical enums (CHECK helpers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_ingest_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'uploaded',
    'queued',
    'processing',
    'ready',
    'failed',
    'analysis_blocked_by_consent',
    -- legacy 001 values kept for backward compatibility during transition
    'pending',
    'deleted'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_document_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'insurance_policy_pdf',
    'insurance_certificate',
    'insurance_terms',
    'diagnosis_certificate',
    'surgery_certificate',
    'hospitalization_record',
    'medical_receipt',
    'medical_statement',
    'health_checkup',
    'tax_or_finance_document',
    'unknown'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_ingest_statuses() IS
  'Allowed customer_documents.ingest_status values (DOCUMENT_INGEST §4).';

COMMENT ON FUNCTION public.lifeguard_document_types() IS
  'Classifier output document_type (DOCUMENT_INGEST §2).';

-- ---------------------------------------------------------------------------
-- customer_documents — extend columns & ingest_status
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS document_type     TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json     JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS customer_hint_type TEXT,
  ADD COLUMN IF NOT EXISTS classified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingest_job_id    UUID,
  ADD COLUMN IF NOT EXISTS consent_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.customer_documents.document_type IS
  'Detected type from ingest classifier; see lifeguard_document_types().';

COMMENT ON COLUMN public.customer_documents.metadata_json IS
  'OCR avg confidence, low_ocr_confidence flag, structured_extract refs — no raw PII.';

COMMENT ON COLUMN public.customer_documents.customer_hint_type IS
  'Optional type hint at upload; classifier may override document_type.';

COMMENT ON COLUMN public.customer_documents.consent_snapshot IS
  'document_storage / document_analysis consent versions at ingest start.';

-- Drop 001 ingest_status CHECK (name may vary; drop if exists)
ALTER TABLE public.customer_documents
  DROP CONSTRAINT IF EXISTS customer_documents_ingest_status_check;

ALTER TABLE public.customer_documents
  ADD CONSTRAINT customer_documents_ingest_status_check CHECK (
    ingest_status = ANY (public.lifeguard_ingest_statuses())
  );

ALTER TABLE public.customer_documents
  DROP CONSTRAINT IF EXISTS customer_documents_document_type_check;

ALTER TABLE public.customer_documents
  ADD CONSTRAINT customer_documents_document_type_check CHECK (
    document_type IS NULL
    OR document_type = ANY (public.lifeguard_document_types())
  );

-- Map legacy rows: pending → uploaded (idempotent)
UPDATE public.customer_documents
SET ingest_status = 'uploaded'
WHERE ingest_status = 'pending';

-- New default for API uploads
ALTER TABLE public.customer_documents
  ALTER COLUMN ingest_status SET DEFAULT 'uploaded';

CREATE INDEX IF NOT EXISTS customer_documents_ingest_status_idx
  ON public.customer_documents (ingest_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_documents_document_type_idx
  ON public.customer_documents (document_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_documents_ready_idx
  ON public.customer_documents (customer_id, created_at DESC)
  WHERE deleted_at IS NULL AND ingest_status = 'ready';

-- ---------------------------------------------------------------------------
-- customer_document_chunks — metadata conventions (columns unchanged in 001)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.customer_document_chunks.metadata IS
  'Ingest: token_count, ocr_confidence, detected_entities (redacted), consent_version, document_type, consent_snapshot.';

-- ---------------------------------------------------------------------------
-- RAG: only ready documents; consent gate for document_analysis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_customer_document_chunks(
  p_customer_id       UUID,
  p_query_embedding   VECTOR(1536),
  p_match_threshold   FLOAT DEFAULT 0.5,
  p_match_count       INT DEFAULT 8
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  doc_title   TEXT,
  section     TEXT,
  page        INTEGER,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.doc_title,
    c.section,
    c.page,
    c.content,
    (1 - (c.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.customer_document_chunks c
  INNER JOIN public.customer_documents d ON d.id = c.document_id
  WHERE c.customer_id = p_customer_id
    AND d.customer_id = p_customer_id
    AND c.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.ingest_status = 'ready'
    AND c.embedding IS NOT NULL
    AND public.lifeguard_has_consent(p_customer_id, 'document_analysis')
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT LEAST(p_match_count, 32);
$$;

COMMENT ON FUNCTION public.match_customer_document_chunks IS
  'Per-customer RAG; requires ready ingest_status + document_analysis consent.';

-- ---------------------------------------------------------------------------
-- document_upload_events (audit — no customer document content)
-- ---------------------------------------------------------------------------
CREATE TABLE public.document_upload_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES public.customer_documents (id) ON DELETE CASCADE,
  mime_type       TEXT,
  byte_size       BIGINT,
  ip_address_hash TEXT,
  user_agent_hash TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_upload_events IS
  'Upload audit log; metadata only — not INSUX storage.';

CREATE INDEX document_upload_events_customer_idx
  ON public.document_upload_events (customer_id, created_at DESC);

CREATE INDEX document_upload_events_document_idx
  ON public.document_upload_events (document_id);

-- ---------------------------------------------------------------------------
-- document_ingest_traces (audit — step timings, no blob content)
-- ---------------------------------------------------------------------------
CREATE TABLE public.document_ingest_traces (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  document_id        UUID NOT NULL REFERENCES public.customer_documents (id) ON DELETE CASCADE,
  ingest_job_id      UUID,
  status             TEXT NOT NULL DEFAULT 'started'
                     CHECK (status IN ('started', 'completed', 'failed')),
  ocr_confidence_avg NUMERIC(4, 3),
  chunk_count        INTEGER,
  error_code         TEXT,
  steps_json         JSONB NOT NULL DEFAULT '{}'::JSONB,
  consent_snapshot   JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_ingest_traces IS
  'Ingest pipeline audit per document; service_role writes.';

CREATE INDEX document_ingest_traces_document_idx
  ON public.document_ingest_traces (document_id, started_at DESC);

CREATE TRIGGER document_ingest_traces_set_updated_at
  BEFORE UPDATE ON public.document_ingest_traces
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: audit tables — customer own read; insert via service_role (bypass)
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_upload_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ingest_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY lg_document_upload_events_customer_select_own
  ON public.document_upload_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_ingest_traces_customer_select_own
  ON public.document_ingest_traces
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_ingest_traces_admin_select_audit
  ON public.document_ingest_traces
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_document_upload_events_admin_select_audit
  ON public.document_upload_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: no policies — cannot read ingest audit or chunks (002).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual — real customer JWT + service_role worker)
-- =============================================================================
--
-- T1: INSERT customer_documents with ingest_status = uploaded (customer JWT)
-- T2: lifeguard_has_consent false → match_customer_document_chunks returns 0 rows
-- T3: ingest_status = processing → chunks excluded from RAG even if present
-- T4: ingest_status = ready + consent → RAG returns rows for that customer_id only
-- T5: document_type must be in lifeguard_document_types() or NULL
-- T6: pending legacy row migrated to uploaded
-- T7: No demo rows in document_upload_events / document_ingest_traces
--

-- =============================================================================
-- LIFEGUARD Core — 006_case_knowledge.sql
-- Case Knowledge store per CASE_KNOWLEDGE_ENGINE.md + KNOWLEDGE_GOVERNANCE.md
-- Requires: 001, 002 (admin helpers), 004 (consent snapshot pattern)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake case rows.
-- =============================================================================
--
-- PRIVACY (enforced by schema + RLS + application):
--   • case_knowledge_items MUST NOT store customer_id, names, RRN, phone,
--     address, account numbers, or document raw text.
--   • source_customer_id exists ONLY on case_extraction_jobs (admin/service_role).
--   • status = active only after deidentification_passed = true on the item.
--
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enum helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_case_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'claim_case',
    'disclosure_case',
    'coverage_case',
    'rebalancing_case',
    'underwriting_case',
    'consultation_case'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_case_knowledge_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'draft',
    'review',
    'active',
    'deprecated',
    'retired'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_case_types() IS
  'Allowed case_knowledge_items.case_type values.';

-- ---------------------------------------------------------------------------
-- case_knowledge_items — published store has NO customer_id column
-- ---------------------------------------------------------------------------
CREATE TABLE public.case_knowledge_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  title                   TEXT NOT NULL,
  summary                 TEXT NOT NULL,
  pattern_json            JSONB NOT NULL DEFAULT '{}'::JSONB,
  outcome_json            JSONB NOT NULL DEFAULT '{}'::JSONB,
  confidence              NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  trust_tier              TEXT NOT NULL DEFAULT 'C',
  source_count            INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  deidentification_passed BOOLEAN NOT NULL DEFAULT FALSE,
  effective_at            TIMESTAMPTZ,
  retired_at              TIMESTAMPTZ,
  case_extraction_job_id  UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT case_knowledge_items_case_type_chk CHECK (
    case_type = ANY (public.lifeguard_case_types())
  ),

  CONSTRAINT case_knowledge_items_status_chk CHECK (
    status = ANY (public.lifeguard_case_knowledge_statuses())
  ),

  CONSTRAINT case_knowledge_items_confidence_chk CHECK (
    confidence >= 0 AND confidence <= 1
  ),

  CONSTRAINT case_knowledge_items_trust_tier_chk CHECK (
    trust_tier IN ('A', 'B', 'C', 'D')
  ),

  -- de-id must pass before active/deprecated (publish gate)
  CONSTRAINT case_knowledge_items_active_deid_chk CHECK (
    status NOT IN ('active', 'deprecated')
    OR deidentification_passed = TRUE
  ),

  CONSTRAINT case_knowledge_items_active_effective_chk CHECK (
    status != 'active' OR effective_at IS NOT NULL
  )
);

COMMENT ON TABLE public.case_knowledge_items IS
  'De-identified case patterns (Tier C). NO customer_id, PII, or document bodies.';

COMMENT ON COLUMN public.case_knowledge_items.pattern_json IS
  'Structured anonymized pattern only — enums, bands, doc type lists.';

COMMENT ON COLUMN public.case_knowledge_items.outcome_json IS
  'Possibility-level outcome labels — never payout/legal certainty.';

COMMENT ON COLUMN public.case_knowledge_items.deidentification_passed IS
  'Must be true before status active; set after scanner + governance review.';

CREATE INDEX case_knowledge_items_case_type_idx
  ON public.case_knowledge_items (case_type);

CREATE INDEX case_knowledge_items_status_idx
  ON public.case_knowledge_items (status);

CREATE INDEX case_knowledge_items_active_idx
  ON public.case_knowledge_items (case_type, confidence DESC)
  WHERE status = 'active' AND retired_at IS NULL;

CREATE TRIGGER case_knowledge_items_set_updated_at
  BEFORE UPDATE ON public.case_knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- case_extraction_jobs — restricted; holds source_customer_id for audit/DSR
-- ---------------------------------------------------------------------------
CREATE TABLE public.case_extraction_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_customer_id      UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  source_type             TEXT NOT NULL,
  source_ref              UUID NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'processing', 'completed', 'failed', 'blocked'
                          )),
  deidentification_status TEXT NOT NULL DEFAULT 'pending'
                          CHECK (deidentification_status IN (
                            'pending', 'passed', 'failed', 'blocked'
                          )),
  consent_snapshot        JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message           TEXT,
  result_case_knowledge_id UUID REFERENCES public.case_knowledge_items (id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.case_extraction_jobs IS
  'Links extract pipeline to source customer for erasure; NEVER exposed to agents/customers.';

COMMENT ON COLUMN public.case_extraction_jobs.source_customer_id IS
  'Audit/DSR only — not copied to case_knowledge_items.';

CREATE INDEX case_extraction_jobs_customer_idx
  ON public.case_extraction_jobs (source_customer_id, created_at DESC);

CREATE INDEX case_extraction_jobs_source_idx
  ON public.case_extraction_jobs (source_type, source_ref);

CREATE TRIGGER case_extraction_jobs_set_updated_at
  BEFORE UPDATE ON public.case_extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

ALTER TABLE public.case_knowledge_items
  ADD CONSTRAINT case_knowledge_items_extraction_job_fk
  FOREIGN KEY (case_extraction_job_id)
  REFERENCES public.case_extraction_jobs (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Active cases — public-safe columns only (orchestrator reads via RPC, not JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_active_case_knowledge
WITH (security_invoker = true)
AS
SELECT
  id,
  case_type,
  title,
  summary,
  confidence,
  trust_tier,
  source_count,
  effective_at,
  created_at
FROM public.case_knowledge_items
WHERE status = 'active'
  AND retired_at IS NULL;

COMMENT ON VIEW public.lifeguard_active_case_knowledge IS
  'Active anonymized cases only; no pattern_json/outcome_json. No GRANT to authenticated (see RLS).';

-- ---------------------------------------------------------------------------
-- match_case_knowledge — NO p_customer_id; active + not retired only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_case_knowledge(
  p_query_text      TEXT DEFAULT NULL,
  p_case_types      TEXT[] DEFAULT NULL,
  p_min_confidence  NUMERIC DEFAULT 0.55,
  p_match_count     INT DEFAULT 2
)
RETURNS TABLE (
  id          UUID,
  case_type   TEXT,
  title       TEXT,
  summary     TEXT,
  confidence  NUMERIC,
  trust_tier  TEXT,
  rank_score  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.case_type,
    c.title,
    c.summary,
    c.confidence,
    c.trust_tier,
    CASE
      WHEN p_query_text IS NULL OR trim(p_query_text) = '' THEN 1.0::FLOAT
      ELSE similarity(c.summary, p_query_text)::FLOAT
    END AS rank_score
  FROM public.case_knowledge_items c
  WHERE c.status = 'active'
    AND c.retired_at IS NULL
    AND c.deidentification_passed = TRUE
    AND c.confidence >= p_min_confidence
    AND (
      p_case_types IS NULL
      OR cardinality(p_case_types) = 0
      OR c.case_type = ANY (p_case_types)
    )
    AND (
      p_query_text IS NULL
      OR trim(p_query_text) = ''
      OR c.summary ILIKE '%' || replace(replace(trim(p_query_text), '%', ''), '_', '') || '%'
      OR c.title ILIKE '%' || replace(replace(trim(p_query_text), '%', ''), '_', '') || '%'
    )
  ORDER BY rank_score DESC, c.confidence DESC
  LIMIT LEAST(p_match_count, 5);
$$;

COMMENT ON FUNCTION public.match_case_knowledge IS
  'Secondary case RAG; no customer_id param. Server/service_role only — not for browser JWT.';

-- Orchestrator calls with service_role; do not expose to anon/authenticated clients.
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM anon;
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.case_knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_knowledge_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.case_extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_extraction_jobs FORCE ROW LEVEL SECURITY;

-- Customers: NO access to case knowledge or extraction jobs.
-- Agents: NO policies (002 alignment).

CREATE POLICY lg_case_knowledge_items_admin_select ON public.case_knowledge_items
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_insert ON public.case_knowledge_items
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_update ON public.case_knowledge_items
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_delete ON public.case_knowledge_items
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_case_extraction_jobs_admin_all ON public.case_extraction_jobs
  FOR ALL TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

-- service_role bypasses RLS for publish worker after governance approval.

-- View inherits RLS on base table — no extra grants to authenticated.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: SELECT * FROM lifeguard_active_case_knowledge → only status=active, retired_at null
-- T2: UPDATE case SET status=retired, retired_at=now() → excluded from view
-- T3: Customer JWT: SELECT case_knowledge_items → 0 rows
-- T4: Agent JWT: SELECT case_extraction_jobs → 0 rows
-- T5: Admin: can SELECT/INSERT case_knowledge_items
-- T6: \d case_knowledge_items → no customer_id column
-- T7: INSERT active with deidentification_passed=false → CHECK violation
-- T8: INSERT confidence 1.5 → CHECK violation
-- T9: match_case_knowledge(...) as authenticated → permission denied (revoked)
-- T10: service_role: match_case_knowledge returns rows when active cases exist
-- T11: Repo has no demo/mock case seed SQL
--

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

