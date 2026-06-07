-- =============================================================================
-- LIFEGUARD Core — 017_document_ingest_mvp.sql
-- Phase 22A: text-only document ingest foundation (no embeddings / RAG / Memory Builder)
-- Requires: 001, 002, 004, 005, 010
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample document or chunk rows.
--
-- Phase 22A scope (this migration):
--   • coverage_analysis_sheet document_type for 보장분석표
--   • document_analysis consent grant RPC
--   • ingest request RPC (queued | analysis_blocked_by_consent) — no client ingest_status UPDATE
--   • customer_document_chunks write lock (service_role worker only)
--   • lifeguard_soft_delete_customer_document repo parity (production PR #16)
--
-- Explicitly deferred (NOT in this migration):
--   • Embeddings (customer_document_chunks.embedding stays NULL in 22A worker)
--   • RAG (match_customer_document_chunks unchanged; requires embedding IS NOT NULL)
--   • Memory Builder / customer_memory_facts document extract
--   • Edge Function OCR worker (Step 2+)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend lifeguard_document_types() — add coverage_analysis_sheet (보장분석표)
-- ---------------------------------------------------------------------------
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
    'coverage_analysis_sheet',
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

COMMENT ON FUNCTION public.lifeguard_document_types() IS
  'Classifier output document_type (DOCUMENT_INGEST §2). Phase 22A adds coverage_analysis_sheet for 보장분석표.';

-- ---------------------------------------------------------------------------
-- 2. lifeguard_grant_document_analysis_consent()
--    SECURITY DEFINER — customer JWT only; required before OCR / ingest enqueue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_grant_document_analysis_consent(
  p_consent_version TEXT DEFAULT '2026-06-07-ko-doc-analysis'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id   UUID;
  v_granted_at    TIMESTAMPTZ;
  v_version       TEXT;
BEGIN
  v_customer_id := public.lifeguard_auth_customer_id();

  IF v_customer_id IS NULL OR NOT public.lifeguard_is_customer() THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            HINT = 'Customer login required.';
  END IF;

  v_version := NULLIF(trim(p_consent_version), '');
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'consent_version_required'
      USING ERRCODE = '22023';
  END IF;

  IF public.lifeguard_has_consent(v_customer_id, 'document_analysis') THEN
    RETURN jsonb_build_object(
      'customer_id', v_customer_id,
      'consent_type', 'document_analysis',
      'consent_version', v_version,
      'already_granted', TRUE,
      'granted_at', NULL
    );
  END IF;

  v_granted_at := NOW();

  INSERT INTO public.customer_consents (
    customer_id,
    consent_type,
    consent_version,
    consent_scope,
    granted,
    granted_at,
    source,
    purpose,
    required
  ) VALUES (
    v_customer_id,
    'document_analysis',
    v_version,
    jsonb_build_object(
      'purposes', jsonb_build_array('ocr', 'text_extract', 'chunk'),
      'features', jsonb_build_array('document_ingest')
    ),
    TRUE,
    v_granted_at,
    'document_upload',
    '고객 문서 분석(OCR/텍스트 추출)',
    TRUE
  );

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'consent_type', 'document_analysis',
    'consent_version', v_version,
    'already_granted', FALSE,
    'granted_at', v_granted_at
  );
END;
$$;

COMMENT ON FUNCTION public.lifeguard_grant_document_analysis_consent(TEXT) IS
  'Grant document_analysis consent for Phase 22A ingest. Embeddings/RAG/Memory Builder remain deferred.';

-- ---------------------------------------------------------------------------
-- 3. lifeguard_request_customer_document_ingest(p_document_id)
--    SECURITY DEFINER — own document only; never exposes service_role to browser.
--    Sets queued or analysis_blocked_by_consent; worker (service_role) runs OCR later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_request_customer_document_ingest(
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id      UUID;
  v_doc              public.customer_documents;
  v_job_id           UUID;
  v_consent_snapshot JSONB;
  v_analysis_version TEXT;
  v_analysis_granted TIMESTAMPTZ;
BEGIN
  v_customer_id := public.lifeguard_auth_customer_id();

  IF v_customer_id IS NULL OR NOT public.lifeguard_is_customer() THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            HINT = 'Customer login required.';
  END IF;

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'document_id_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_doc
  FROM public.customer_documents
  WHERE id = p_document_id
    AND customer_id = v_customer_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found'
      USING ERRCODE = 'P0002',
            HINT = 'Document not found or not owned by caller.';
  END IF;

  IF v_doc.ingest_status IN ('queued', 'processing') THEN
    RAISE EXCEPTION 'document_ingest_in_progress'
      USING ERRCODE = 'P0001',
            HINT = 'Ingest already queued or processing.';
  END IF;

  IF v_doc.ingest_status = 'ready' THEN
    RAISE EXCEPTION 'document_already_ingested'
      USING ERRCODE = 'P0001',
            HINT = 'Document ingest already completed.';
  END IF;

  IF v_doc.ingest_status NOT IN ('uploaded', 'failed', 'analysis_blocked_by_consent', 'pending') THEN
    RAISE EXCEPTION 'document_ingest_not_allowed'
      USING ERRCODE = 'P0001',
            HINT = format('Cannot enqueue ingest from status: %s', v_doc.ingest_status);
  END IF;

  IF NOT public.lifeguard_has_consent(v_customer_id, 'document_storage') THEN
    RAISE EXCEPTION 'consent_required'
      USING ERRCODE = '42501',
            HINT = 'document_storage consent required.';
  END IF;

  IF NOT public.lifeguard_has_consent(v_customer_id, 'document_analysis') THEN
    UPDATE public.customer_documents
    SET ingest_status = 'analysis_blocked_by_consent',
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_document_id
    RETURNING * INTO v_doc;

    RETURN jsonb_build_object(
      'blocked', TRUE,
      'document_id', v_doc.id,
      'ingest_status', v_doc.ingest_status,
      'ingest_job_id', NULL,
      'message', 'document_analysis consent required'
    );
  END IF;

  SELECT cc.consent_version, cc.granted_at
  INTO v_analysis_version, v_analysis_granted
  FROM public.customer_consents cc
  WHERE cc.customer_id = v_customer_id
    AND cc.consent_type = 'document_analysis'
    AND cc.granted = TRUE
    AND cc.revoked_at IS NULL
  ORDER BY cc.granted_at DESC NULLS LAST
  LIMIT 1;

  v_consent_snapshot := jsonb_build_object(
    'document_analysis', jsonb_build_object(
      'granted', TRUE,
      'consent_version', COALESCE(v_analysis_version, 'unknown'),
      'granted_at', v_analysis_granted
    )
  );

  v_job_id := gen_random_uuid();

  UPDATE public.customer_documents
  SET ingest_status = 'queued',
      ingest_job_id = v_job_id,
      consent_snapshot = v_consent_snapshot,
      error_message = NULL,
      updated_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  RETURN jsonb_build_object(
    'blocked', FALSE,
    'document_id', v_doc.id,
    'ingest_status', v_doc.ingest_status,
    'ingest_job_id', v_job_id,
    'message', 'ingest_queued'
  );
END;
$$;

COMMENT ON FUNCTION public.lifeguard_request_customer_document_ingest(UUID) IS
  'Phase 22A: enqueue text-only ingest (queued). Worker sets processing/ready/failed. Embeddings and RAG deferred.';

-- ---------------------------------------------------------------------------
-- 4. Harden customer_document_chunks RLS — worker/service_role writes only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS lg_document_chunks_customer_insert_own
  ON public.customer_document_chunks;

DROP POLICY IF EXISTS lg_document_chunks_customer_update_own
  ON public.customer_document_chunks;

COMMENT ON TABLE public.customer_document_chunks IS
  'Per-customer document text chunks. Phase 22A: content only (embedding NULL). RAG/Memory Builder deferred. Worker INSERT via service_role.';

-- ---------------------------------------------------------------------------
-- 5. lifeguard_soft_delete_customer_document() — production parity (PR #16)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_soft_delete_customer_document(
  p_document_id UUID
)
RETURNS public.customer_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_row         public.customer_documents;
BEGIN
  v_customer_id := public.lifeguard_auth_customer_id();

  IF v_customer_id IS NULL OR NOT public.lifeguard_is_customer() THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            HINT = 'Customer login required.';
  END IF;

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'document_id_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_row
  FROM public.customer_documents
  WHERE id = p_document_id
    AND customer_id = v_customer_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.customer_documents
  SET deleted_at = NOW(),
      ingest_status = 'deleted',
      updated_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_row;

  UPDATE public.customer_document_chunks
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE document_id = p_document_id
    AND customer_id = v_customer_id
    AND deleted_at IS NULL;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_soft_delete_customer_document(UUID) IS
  'Soft-delete own document + tombstone chunks. SECURITY DEFINER bypasses RLS UPDATE restriction on deleted_at.';

-- ---------------------------------------------------------------------------
-- 6. GRANT EXECUTE on new RPCs to authenticated
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.lifeguard_grant_document_analysis_consent(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.lifeguard_request_customer_document_ingest(UUID)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.lifeguard_soft_delete_customer_document(UUID)
  TO authenticated;

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual — real customer JWT + service_role worker)
-- =============================================================================
--
-- T1: SELECT public.lifeguard_document_types();  -- includes coverage_analysis_sheet
-- T2: Customer JWT: SELECT lifeguard_grant_document_analysis_consent();
--     -- expect granted row in customer_consents
-- T3: Customer JWT without document_analysis:
--     SELECT lifeguard_request_customer_document_ingest('<doc_id>');
--     -- expect blocked=true, ingest_status=analysis_blocked_by_consent
-- T4: Customer JWT with document_analysis:
--     SELECT lifeguard_request_customer_document_ingest('<doc_id>');
--     -- expect blocked=false, ingest_status=queued, ingest_job_id set
-- T5: Customer JWT INSERT into customer_document_chunks → permission denied (42501)
-- T6: service_role INSERT chunk with embedding NULL → success (Phase 22A text-only)
-- T7: match_customer_document_chunks still returns 0 rows when embedding IS NULL (RAG deferred)
-- T8: Customer JWT: SELECT lifeguard_soft_delete_customer_document('<doc_id>');
--     -- expect deleted_at set, chunks tombstoned
-- T9: No demo seed rows inserted by this migration
--
