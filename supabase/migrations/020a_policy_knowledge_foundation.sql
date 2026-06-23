-- =============================================================================
-- LIFEGUARD Core — 020a_policy_knowledge_foundation.sql
-- Shared policy knowledge store (Phase 11 policy RAG foundation tables).
-- Greenfield replay: creates tables required by 021_policy_knowledge_vector_search.
-- Idempotent: CREATE TABLE IF NOT EXISTS; preserves existing rows; no destructive DDL.
-- Requires: 001 (vector extension, lifeguard_set_updated_at), 002 (admin RLS helpers)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Enum helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_policy_knowledge_document_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'policy_terms',
    'underwriting_guide',
    'product_brochure',
    'claim_case'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_policy_knowledge_document_types() IS
  'Allowed policy_knowledge_documents.document_type values (shared policy RAG).';

-- ---------------------------------------------------------------------------
-- policy_knowledge_documents — shared insurer/product policy corpus (no customer_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_knowledge_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type   TEXT NOT NULL,
  title           TEXT NOT NULL,
  insurer_name    TEXT,
  product_name    TEXT,
  version         TEXT,
  storage_path    TEXT,
  ingest_status   TEXT NOT NULL DEFAULT 'uploaded',
  metadata_json   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT policy_knowledge_documents_document_type_chk CHECK (
    document_type = ANY (public.lifeguard_policy_knowledge_document_types())
  )
);

COMMENT ON TABLE public.policy_knowledge_documents IS
  'Shared policy knowledge documents for insurer-wide RAG; not scoped to a single customer.';

CREATE INDEX IF NOT EXISTS policy_knowledge_documents_active_created_idx
  ON public.policy_knowledge_documents (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS policy_knowledge_documents_metadata_json_gin_idx
  ON public.policy_knowledge_documents
  USING GIN (metadata_json);

DROP TRIGGER IF EXISTS policy_knowledge_documents_set_updated_at
  ON public.policy_knowledge_documents;

CREATE TRIGGER policy_knowledge_documents_set_updated_at
  BEFORE UPDATE ON public.policy_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- policy_knowledge_chunks — vector chunks for shared policy knowledge
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_knowledge_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES public.policy_knowledge_documents (id) ON DELETE CASCADE,
  chunk_order      INTEGER NOT NULL CHECK (chunk_order > 0),
  chunk_text       TEXT NOT NULL,
  embedding        VECTOR(1536),
  embedding_model  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT policy_knowledge_chunks_doc_order_uq UNIQUE (document_id, chunk_order)
);

COMMENT ON TABLE public.policy_knowledge_chunks IS
  'Shared policy knowledge vector chunks; searched via match_policy_knowledge_chunks (021).';

CREATE INDEX IF NOT EXISTS policy_knowledge_chunks_document_id_idx
  ON public.policy_knowledge_chunks (document_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS policy_knowledge_chunks_set_updated_at
  ON public.policy_knowledge_chunks;

CREATE TRIGGER policy_knowledge_chunks_set_updated_at
  BEFORE UPDATE ON public.policy_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — admin audit + service_role worker writes (002 bypass pattern)
-- Customers/agents: no direct table access; RPC in 021 is SECURITY DEFINER.
-- ---------------------------------------------------------------------------
ALTER TABLE public.policy_knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_knowledge_documents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.policy_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_knowledge_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_policy_knowledge_documents_admin_select
  ON public.policy_knowledge_documents;
CREATE POLICY lg_policy_knowledge_documents_admin_select
  ON public.policy_knowledge_documents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_policy_knowledge_documents_admin_insert
  ON public.policy_knowledge_documents;
CREATE POLICY lg_policy_knowledge_documents_admin_insert
  ON public.policy_knowledge_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_policy_knowledge_documents_admin_update
  ON public.policy_knowledge_documents;
CREATE POLICY lg_policy_knowledge_documents_admin_update
  ON public.policy_knowledge_documents
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_policy_knowledge_chunks_admin_select
  ON public.policy_knowledge_chunks;
CREATE POLICY lg_policy_knowledge_chunks_admin_select
  ON public.policy_knowledge_chunks
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_policy_knowledge_chunks_admin_insert
  ON public.policy_knowledge_chunks;
CREATE POLICY lg_policy_knowledge_chunks_admin_insert
  ON public.policy_knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_policy_knowledge_chunks_admin_update
  ON public.policy_knowledge_chunks;
CREATE POLICY lg_policy_knowledge_chunks_admin_update
  ON public.policy_knowledge_chunks
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

COMMIT;
