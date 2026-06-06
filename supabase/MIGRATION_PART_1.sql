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
