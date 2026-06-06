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
