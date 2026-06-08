-- =============================================================================
-- LIFEGUARD Core — 018_lockdown_customer_document_match_rpc.sql
-- Phase 22D Step 1A: RAG RPC security lockdown (caller ownership gate)
-- Requires: 001, 002, 004, 005
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
--
-- Problem:
--   match_customer_document_chunks is SECURITY DEFINER and bypasses chunk RLS.
--   Without a caller ownership check, any authenticated JWT could pass another
--   customer's UUID in p_customer_id and retrieve embedded OCR chunk text.
--
-- Fix:
--   • authenticated callers: p_customer_id MUST equal lifeguard_auth_customer_id()
--   • service_role JWT (orchestrator/worker): may query any p_customer_id
--   • Preserve existing RAG filters, cosine ordering, and return shape
--
-- Explicitly out of scope:
--   • Embedding generation, orchestrator, frontend, OCR/CLOVA, upload/delete
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- match_customer_document_chunks — tenant-safe SECURITY DEFINER RAG RPC
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id_required'
      USING ERRCODE = '22023',
            HINT = 'p_customer_id is mandatory for per-customer RAG.';
  END IF;

  -- Caller ownership gate (Phase 22D Step 1A):
  -- SECURITY DEFINER functions must not trust client-supplied tenant ids blindly.
  -- This closes cross-customer RAG leakage before embeddings are populated.
  -- service_role JWT (consultation orchestrator / server workers) is exempt so
  -- server-side RAG can run on behalf of a validated customer session.
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    IF public.lifeguard_auth_customer_id() IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              HINT = 'p_customer_id must match the authenticated customer.';
    END IF;
  END IF;

  RETURN QUERY
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
END;
$$;

COMMENT ON FUNCTION public.match_customer_document_chunks IS
  'Per-customer RAG (SECURITY DEFINER). Phase 22D Step 1A: authenticated callers must own p_customer_id; service_role JWT exempt for orchestrator. Requires ready ingest_status, document_analysis consent, embedding IS NOT NULL. Prevents cross-tenant chunk text leakage.';

-- ---------------------------------------------------------------------------
-- Grants: keep authenticated EXECUTE (Option A) with in-function ownership gate
-- ---------------------------------------------------------------------------
-- match_case_knowledge revokes browser access entirely; customer RAG may be
-- invoked from a future customer-facing flow, so we retain authenticated EXECUTE
-- but enforce lifeguard_auth_customer_id() = p_customer_id inside the function.
REVOKE ALL ON FUNCTION public.match_customer_document_chunks(UUID, VECTOR, FLOAT, INT)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.match_customer_document_chunks(UUID, VECTOR, FLOAT, INT)
  FROM anon;

GRANT EXECUTE ON FUNCTION public.match_customer_document_chunks(UUID, VECTOR, FLOAT, INT)
  TO authenticated;

-- service_role uses JWT role claim; no GRANT to authenticated required for workers.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual — real customer JWT + service_role)
-- =============================================================================
--
-- T1: Customer A JWT — SELECT * FROM match_customer_document_chunks(A_id, embedding, ...)
--     -- expect rows only for A (when embeddings exist)
-- T2: Customer A JWT — pass B_id as p_customer_id
--     -- expect ERROR 42501 forbidden
-- T3: service_role — pass B_id as p_customer_id
--     -- expect OK (or 0 rows if no embeddings/consent)
-- T4: anon — RPC call
--     -- expect permission denied (no EXECUTE grant)
-- T5: embedding IS NULL chunks still excluded (unchanged)
--
