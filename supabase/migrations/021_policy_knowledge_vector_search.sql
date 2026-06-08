-- =============================================================================
-- LIFEGUARD Core — 021_policy_knowledge_vector_search.sql
-- Phase 25 Step 1I: policy_knowledge_chunks pgvector search with ingest_status ready gate.
-- Idempotent: preserves existing rows; does not delete vectors/chunks/text.
-- Replaces legacy gate (processing_status=embedded) that blocked Hanwha 1798 vectors.
-- Adds scoped overload for policy_pdf_id / carrier / product filters.
-- Compatible with future unified real-policy-ingest-worker (same tables/columns).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- ingest_status helpers (shared policy knowledge lifecycle)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_policy_knowledge_ingest_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['uploaded', 'queued', 'processing', 'ready', 'failed']::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_policy_knowledge_ingest_statuses IS
  'Allowed policy_knowledge_documents.ingest_status values (Phase 25 shared policy ingest).';

DO $policy_knowledge_ingest_status_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'policy_knowledge_documents'
      AND column_name = 'ingest_status'
  ) THEN
    ALTER TABLE public.policy_knowledge_documents
      DROP CONSTRAINT IF EXISTS policy_knowledge_documents_ingest_status_check;

    ALTER TABLE public.policy_knowledge_documents
      ADD CONSTRAINT policy_knowledge_documents_ingest_status_check CHECK (
        ingest_status = ANY (public.lifeguard_policy_knowledge_ingest_statuses())
      );
  END IF;
END;
$policy_knowledge_ingest_status_check$;

CREATE INDEX IF NOT EXISTS policy_knowledge_documents_ingest_status_idx
  ON public.policy_knowledge_documents (ingest_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS policy_knowledge_chunks_document_id_embedding_idx
  ON public.policy_knowledge_chunks (document_id)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- match_policy_knowledge_chunks (default) — backward-compatible 4-arg signature
-- Gate: ingest_status = ready + embedding IS NOT NULL (not embedding_status)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_policy_knowledge_chunks(
  p_query_embedding   VECTOR(1536),
  p_match_threshold   DOUBLE PRECISION DEFAULT 0.3,
  p_match_count       INTEGER DEFAULT 8,
  p_document_types    TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id          UUID,
  document_id       UUID,
  document_type     TEXT,
  insurer_name      TEXT,
  product_name      TEXT,
  version           TEXT,
  chunk_order       INTEGER,
  chunk_text        TEXT,
  similarity_score  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.document_type,
    d.insurer_name,
    d.product_name,
    d.version,
    c.chunk_order,
    c.chunk_text,
    (1 - (c.embedding <=> p_query_embedding))::DOUBLE PRECISION AS similarity_score
  FROM public.policy_knowledge_chunks c
  INNER JOIN public.policy_knowledge_documents d ON d.id = c.document_id
  WHERE c.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.ingest_status = 'ready'
    AND c.embedding IS NOT NULL
    AND length(trim(c.chunk_text)) > 0
    AND (p_document_types IS NULL OR d.document_type = ANY (p_document_types))
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_match_count, 1), 32);
$$;

COMMENT ON FUNCTION public.match_policy_knowledge_chunks(VECTOR, DOUBLE PRECISION, INTEGER, TEXT[]) IS
  'Shared policy RAG (default). Requires policy_knowledge_documents.ingest_status=ready.';

-- ---------------------------------------------------------------------------
-- match_policy_knowledge_chunks (scoped) — Step 1I Hanwha / future ingest worker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_policy_knowledge_chunks(
  p_query_embedding        VECTOR(1536),
  p_knowledge_document_id UUID,
  p_policy_pdf_id          UUID,
  p_carrier_id             UUID,
  p_product_id             UUID,
  p_match_threshold        DOUBLE PRECISION DEFAULT 0.3,
  p_match_count            INTEGER DEFAULT 8
)
RETURNS TABLE (
  id                    UUID,
  document_id           UUID,
  knowledge_document_id UUID,
  document_title        TEXT,
  document_type         TEXT,
  policy_pdf_id         UUID,
  carrier_id            UUID,
  product_id            UUID,
  chunk_order           INTEGER,
  chunk_text            TEXT,
  embedding_model       TEXT,
  similarity            DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $match_policy_knowledge_chunks_scoped$
BEGIN
  IF p_query_embedding IS NULL THEN
    RAISE EXCEPTION 'query_embedding_required'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
     AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    d.id AS knowledge_document_id,
    d.title AS document_title,
    d.document_type,
    NULLIF(d.metadata_json ->> 'policy_pdf_id', '')::UUID AS policy_pdf_id,
    NULLIF(d.metadata_json ->> 'carrier_id', '')::UUID AS carrier_id,
    NULLIF(d.metadata_json ->> 'product_id', '')::UUID AS product_id,
    c.chunk_order,
    c.chunk_text,
    c.embedding_model,
    (1 - (c.embedding <=> p_query_embedding))::DOUBLE PRECISION AS similarity
  FROM public.policy_knowledge_chunks c
  INNER JOIN public.policy_knowledge_documents d ON d.id = c.document_id
  WHERE c.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.ingest_status = 'ready'
    AND c.embedding IS NOT NULL
    AND length(trim(c.chunk_text)) > 0
    AND (p_knowledge_document_id IS NULL OR d.id = p_knowledge_document_id)
    AND (
      p_policy_pdf_id IS NULL
      OR NULLIF(d.metadata_json ->> 'policy_pdf_id', '')::UUID = p_policy_pdf_id
    )
    AND (
      p_carrier_id IS NULL
      OR NULLIF(d.metadata_json ->> 'carrier_id', '')::UUID = p_carrier_id
    )
    AND (
      p_product_id IS NULL
      OR NULLIF(d.metadata_json ->> 'product_id', '')::UUID = p_product_id
    )
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_match_count, 1), 32);
END;
$match_policy_knowledge_chunks_scoped$;

COMMENT ON FUNCTION public.match_policy_knowledge_chunks(VECTOR, UUID, UUID, UUID, UUID, DOUBLE PRECISION, INTEGER) IS
  'Scoped shared policy RAG; requires ingest_status=ready. Used by Step 1I and future ingest worker.';

GRANT EXECUTE ON FUNCTION public.match_policy_knowledge_chunks(VECTOR, DOUBLE PRECISION, INTEGER, TEXT[])
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.match_policy_knowledge_chunks(VECTOR, UUID, UUID, UUID, UUID, DOUBLE PRECISION, INTEGER)
  TO authenticated, service_role;

COMMIT;
