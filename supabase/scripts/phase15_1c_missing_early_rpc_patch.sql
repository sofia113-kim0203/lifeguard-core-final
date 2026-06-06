-- =============================================================================
-- LIFEGUARD Core — Phase 15-1C Missing early RPC patch (ONE-TIME)
-- Run after Phase 11–14 foundation scripts and phase15_1a_production_blocker_fix.sql.
-- Patches missing RPCs only. No new tables. CREATE OR REPLACE FUNCTION only.
--
-- Source scripts:
--   phase11_policy_rag_foundation.sql (branch: phase11-policy-rag-foundation-6853)
--   phase14_real_policy_knowledge_ingestion_foundation.sql (branch: phase14-real-policy-knowledge-ingestion-foundation-6853)
--   phase14_real_policy_pdf_upload_storage_foundation.sql (branch: phase14-real-policy-pdf-upload-storage-foundation-6853)
--   phase14_real_policy_text_extraction_execution_foundation.sql (branch: phase14-real-policy-text-extraction-execution-foundation-6853)
-- =============================================================================


CREATE OR REPLACE FUNCTION public.lifeguard_register_real_policy_source(
  p_carrier_id            UUID,
  p_product_id            UUID DEFAULT NULL,
  p_source_name           TEXT DEFAULT '',
  p_source_type           TEXT DEFAULT '',
  p_source_file_reference TEXT DEFAULT '',
  p_source_version        TEXT DEFAULT '',
  p_source_notes          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_register_real_policy_source$
DECLARE
  v_source_id      UUID;
  v_review_id      UUID;
  v_user_id        UUID;
  v_missing        JSONB := '[]'::JSONB;
  v_source_status  TEXT := 'registered';
  v_name_trim      TEXT;
  v_type_trim      TEXT;
  v_file_ref_trim  TEXT;
  v_version_trim   TEXT;
  v_notes_trim     TEXT;
  v_file_exists    BOOLEAN := FALSE;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_id_required';
  END IF;

  v_name_trim := COALESCE(trim(p_source_name), '');
  v_type_trim := COALESCE(trim(p_source_type), '');
  v_file_ref_trim := COALESCE(trim(p_source_file_reference), '');
  v_version_trim := COALESCE(trim(p_source_version), '');
  v_notes_trim := NULLIF(trim(p_source_notes), '');

  IF length(v_name_trim) = 0 THEN
    RAISE EXCEPTION 'source_name_required';
  END IF;

  IF length(v_type_trim) = 0 THEN
    RAISE EXCEPTION 'source_type_required';
  END IF;

  IF NOT (v_type_trim = ANY (public.lifeguard_real_policy_knowledge_source_types())) THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;

  IF length(v_file_ref_trim) = 0 THEN
    RAISE EXCEPTION 'source_file_reference_required';
  END IF;

  IF length(v_version_trim) = 0 THEN
    RAISE EXCEPTION 'source_version_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.carrier_registry cr
    WHERE cr.id = p_carrier_id AND cr.is_active = TRUE
  ) THEN
    v_missing := v_missing || jsonb_build_array('carrier_not_found');
    RAISE EXCEPTION 'carrier_not_found';
  END IF;

  IF p_product_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.carrier_product_registry pr
      WHERE pr.id = p_product_id
        AND pr.carrier_id = p_carrier_id
        AND pr.is_active = TRUE
    ) THEN
      v_missing := v_missing || jsonb_build_array('product_not_found');
      RAISE EXCEPTION 'product_not_found';
    END IF;
  ELSE
    v_missing := v_missing || jsonb_build_array('product_not_specified');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'policy_pdf_storage_items'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.policy_pdf_storage_items psi
      WHERE psi.storage_path = v_file_ref_trim
         OR psi.file_name = v_file_ref_trim
    ) INTO v_file_exists;
  END IF;

  IF NOT v_file_exists AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'policy_pdf_ingestion_runs'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.policy_pdf_ingestion_runs pir
      WHERE pir.storage_path = v_file_ref_trim
         OR pir.original_filename = v_file_ref_trim
         OR pir.source_reference = v_file_ref_trim
    ) INTO v_file_exists;
  END IF;

  IF NOT v_file_exists THEN
    v_missing := v_missing || jsonb_build_array('source_file_not_linked');
    v_source_status := 'uploaded';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.real_policy_knowledge_sources s
    WHERE s.carrier_id = p_carrier_id
      AND COALESCE(s.product_id, '00000000-0000-0000-0000-000000000000'::UUID)
        = COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND s.source_file_reference = v_file_ref_trim
      AND s.source_version = v_version_trim
      AND s.source_status <> 'rejected'
  ) THEN
    v_missing := v_missing || jsonb_build_array('duplicate_source_reference');
    RAISE EXCEPTION 'duplicate_source_reference';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO public.real_policy_knowledge_sources (
    carrier_id,
    product_id,
    source_name,
    source_type,
    source_file_reference,
    source_version,
    source_status,
    source_notes,
    uploaded_by
  )
  VALUES (
    p_carrier_id,
    p_product_id,
    v_name_trim,
    v_type_trim,
    v_file_ref_trim,
    v_version_trim,
    v_source_status,
    v_notes_trim,
    v_user_id
  )
  RETURNING id INTO v_source_id;

  INSERT INTO public.real_policy_knowledge_review_queue (
    policy_source_id,
    review_status
  )
  VALUES (v_source_id, 'pending')
  RETURNING id INTO v_review_id;

  UPDATE public.real_policy_knowledge_sources
  SET source_status = 'pending_review'
  WHERE id = v_source_id;

  RETURN jsonb_build_object(
    'policy_source_id', v_source_id,
    'review_id', v_review_id,
    'source_status', 'pending_review',
    'missing_information', v_missing,
    'registration_only', TRUE,
    'no_ocr', TRUE,
    'no_embeddings', TRUE,
    'no_claude_execution', TRUE,
    'no_fake_policy_knowledge', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_register_real_policy_source$;

COMMENT ON FUNCTION public.lifeguard_register_real_policy_source IS
  'Admin: register real policy knowledge source file reference only — no OCR or embeddings.';


CREATE OR REPLACE FUNCTION public.lifeguard_register_real_policy_pdf(
  p_policy_source_id UUID,
  p_carrier_id       UUID,
  p_product_id       UUID DEFAULT NULL,
  p_file_name        TEXT DEFAULT '',
  p_file_size        BIGINT DEFAULT NULL,
  p_file_type        TEXT DEFAULT 'application/pdf',
  p_storage_path     TEXT DEFAULT '',
  p_file_version     TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_register_real_policy_pdf$
DECLARE
  v_pdf_id         UUID;
  v_user_id        UUID;
  v_missing        JSONB := '[]'::JSONB;
  v_upload_status  TEXT := 'uploaded';
  v_name_trim      TEXT;
  v_type_trim      TEXT;
  v_path_trim      TEXT;
  v_version_trim   TEXT;
  v_source_carrier UUID;
  v_source_product UUID;
  v_source_status  TEXT;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_policy_source_id IS NULL THEN
    RAISE EXCEPTION 'policy_source_id_required';
  END IF;

  IF p_carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_id_required';
  END IF;

  v_name_trim := COALESCE(trim(p_file_name), '');
  v_type_trim := COALESCE(trim(p_file_type), 'application/pdf');
  v_path_trim := COALESCE(trim(p_storage_path), '');
  v_version_trim := COALESCE(trim(p_file_version), '');

  IF length(v_name_trim) = 0 THEN
    RAISE EXCEPTION 'file_name_required';
  END IF;

  IF length(v_path_trim) = 0 THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;

  IF length(v_version_trim) = 0 THEN
    RAISE EXCEPTION 'file_version_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.carrier_registry cr
    WHERE cr.id = p_carrier_id AND cr.is_active = TRUE
  ) THEN
    v_missing := v_missing || jsonb_build_array('carrier_not_found');
    RAISE EXCEPTION 'carrier_not_found';
  END IF;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.carrier_product_registry pr
    WHERE pr.id = p_product_id
      AND pr.carrier_id = p_carrier_id
      AND pr.is_active = TRUE
  ) THEN
    v_missing := v_missing || jsonb_build_array('product_not_found');
    RAISE EXCEPTION 'product_not_found';
  END IF;

  SELECT s.carrier_id, s.product_id, s.source_status
  INTO v_source_carrier, v_source_product, v_source_status
  FROM public.real_policy_knowledge_sources s
  WHERE s.id = p_policy_source_id;

  IF v_source_carrier IS NULL THEN
    v_missing := v_missing || jsonb_build_array('policy_source_not_found');
    RAISE EXCEPTION 'policy_source_not_found';
  END IF;

  IF v_source_carrier <> p_carrier_id THEN
    v_missing := v_missing || jsonb_build_array('carrier_source_mismatch');
  END IF;

  IF v_source_product IS NOT NULL
     AND p_product_id IS NOT NULL
     AND v_source_product <> p_product_id THEN
    v_missing := v_missing || jsonb_build_array('product_source_mismatch');
  END IF;

  IF v_source_status = 'rejected' THEN
    v_missing := v_missing || jsonb_build_array('policy_source_rejected');
    v_upload_status := 'failed';
  END IF;

  IF v_type_trim NOT IN ('application/pdf', 'application/x-pdf') THEN
    v_missing := v_missing || jsonb_build_array('unexpected_file_type');
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 THEN
    v_missing := v_missing || jsonb_build_array('file_size_missing');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.real_policy_pdf_registry r
    WHERE r.carrier_id = p_carrier_id
      AND COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::UUID)
        = COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND r.storage_path = v_path_trim
      AND r.file_version = v_version_trim
      AND r.upload_status <> 'failed'
  ) THEN
    v_missing := v_missing || jsonb_build_array('duplicate_storage_reference');
    RAISE EXCEPTION 'duplicate_storage_reference';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO public.real_policy_pdf_registry (
    policy_source_id,
    carrier_id,
    product_id,
    file_name,
    file_size,
    file_type,
    storage_path,
    file_version,
    upload_status,
    uploaded_by
  )
  VALUES (
    p_policy_source_id,
    p_carrier_id,
    p_product_id,
    v_name_trim,
    p_file_size,
    v_type_trim,
    v_path_trim,
    v_version_trim,
    v_upload_status,
    v_user_id
  )
  RETURNING id INTO v_pdf_id;

  RETURN jsonb_build_object(
    'policy_pdf_id', v_pdf_id,
    'upload_status', v_upload_status,
    'missing_information', v_missing,
    'registration_only', TRUE,
    'no_ocr', TRUE,
    'no_text_extraction', TRUE,
    'no_embeddings', TRUE,
    'no_claude_execution', TRUE,
    'no_fake_pdfs', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_register_real_policy_pdf$;

COMMENT ON FUNCTION public.lifeguard_register_real_policy_pdf IS
  'Admin: register real policy PDF storage metadata only — no OCR or parsing.';

-- ---------------------------------------------------------------------------
-- Validate real policy PDF (metadata only)

CREATE OR REPLACE FUNCTION public.lifeguard_store_real_policy_extracted_text(
  p_text_extraction_run_id UUID,
  p_policy_pdf_id          UUID,
  p_page_number            INTEGER,
  p_extracted_text         TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_store_real_policy_extracted_text$
DECLARE
  v_page_id             UUID;
  v_missing             JSONB := '[]'::JSONB;
  v_text_status         TEXT := 'extracted';
  v_text_trim           TEXT;
  v_run_status          TEXT;
  v_extraction_run_id   UUID;
  v_expected_count      INTEGER := 0;
  v_extracted_count     INTEGER := 0;
  v_run_extraction_status TEXT;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_text_extraction_run_id IS NULL THEN
    RAISE EXCEPTION 'text_extraction_run_id_required';
  END IF;

  IF p_policy_pdf_id IS NULL THEN
    RAISE EXCEPTION 'policy_pdf_id_required';
  END IF;

  IF p_page_number IS NULL OR p_page_number <= 0 THEN
    RAISE EXCEPTION 'page_number_required';
  END IF;

  v_text_trim := COALESCE(trim(p_extracted_text), '');

  IF length(v_text_trim) = 0 THEN
    v_missing := v_missing || jsonb_build_array('extracted_text_required');
    RAISE EXCEPTION 'extracted_text_required';
  END IF;

  SELECT
    tr.extraction_run_id,
    tr.extraction_status,
    COALESCE((tr.extraction_context ->> 'expected_page_count')::INTEGER, 0)
  INTO v_extraction_run_id, v_run_extraction_status, v_expected_count
  FROM public.real_policy_text_extraction_runs tr
  WHERE tr.id = p_text_extraction_run_id
    AND tr.policy_pdf_id = p_policy_pdf_id;

  IF v_extraction_run_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('text_extraction_run_not_found');
    RAISE EXCEPTION 'text_extraction_run_not_found';
  END IF;

  IF v_run_extraction_status IN ('completed', 'failed') THEN
    v_missing := v_missing || jsonb_build_array('text_extraction_run_not_active');
    RAISE EXCEPTION 'text_extraction_run_not_active';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.real_policy_pdf_page_registry pr
    WHERE pr.extraction_run_id = v_extraction_run_id
      AND pr.policy_pdf_id = p_policy_pdf_id
      AND pr.page_number = p_page_number
  ) THEN
    v_missing := v_missing || jsonb_build_array('page_not_registered');
    RAISE EXCEPTION 'page_not_registered';
  END IF;

  INSERT INTO public.real_policy_extracted_text_pages (
    text_extraction_run_id,
    policy_pdf_id,
    page_number,
    extracted_text,
    text_status
  )
  VALUES (
    p_text_extraction_run_id,
    p_policy_pdf_id,
    p_page_number,
    v_text_trim,
    v_text_status
  )
  ON CONFLICT (text_extraction_run_id, page_number) DO UPDATE
  SET extracted_text = EXCLUDED.extracted_text,
      text_status = EXCLUDED.text_status
  RETURNING id INTO v_page_id;

  UPDATE public.real_policy_pdf_page_registry
  SET page_status = 'processed'
  WHERE extraction_run_id = v_extraction_run_id
    AND policy_pdf_id = p_policy_pdf_id
    AND page_number = p_page_number
    AND page_status <> 'failed';

  SELECT COUNT(*)::INTEGER INTO v_extracted_count
  FROM public.real_policy_extracted_text_pages etp
  WHERE etp.text_extraction_run_id = p_text_extraction_run_id
    AND etp.text_status = 'extracted';

  IF v_expected_count > 0 AND v_extracted_count >= v_expected_count THEN
    v_run_status := 'completed';
  ELSIF v_extracted_count > 0 THEN
    v_run_status := 'processing';
  ELSE
    v_run_status := 'pending';
  END IF;

  UPDATE public.real_policy_text_extraction_runs
  SET extraction_status = v_run_status,
      extracted_page_count = v_extracted_count,
      extraction_context = extraction_context || jsonb_build_object(
        'extracted_page_count', v_extracted_count,
        'last_page_number', p_page_number,
        'stored_only', TRUE,
        'no_fake_text', TRUE,
        'no_chunk_generation', TRUE,
        'no_embeddings', TRUE,
        'stored_at', NOW()
      ),
      completed_at = CASE WHEN v_run_status = 'completed' THEN NOW() ELSE completed_at END
  WHERE id = p_text_extraction_run_id;

  RETURN jsonb_build_object(
    'extracted_page_id', v_page_id,
    'text_extraction_run_id', p_text_extraction_run_id,
    'text_status', v_text_status,
    'page_number', p_page_number,
    'extraction_status', v_run_status,
    'extracted_page_count', v_extracted_count,
    'missing_information', v_missing,
    'stored_only', TRUE,
    'no_ocr', TRUE,
    'no_chunk_generation', TRUE,
    'no_embeddings', TRUE,
    'stored_at', NOW()
  );
END;
$lifeguard_store_real_policy_extracted_text$;

COMMENT ON FUNCTION public.lifeguard_store_real_policy_extracted_text IS
  'Admin: store real extracted page text only — no OCR, chunking, or embeddings.';


CREATE OR REPLACE FUNCTION public.lifeguard_register_policy_rag_source(
  p_source_type      TEXT,
  p_source_id        UUID,
  p_carrier_id       UUID,
  p_product_id       UUID DEFAULT NULL,
  p_source_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_register_policy_rag_source$
DECLARE
  v_rag_source_id      UUID;
  v_processing_run_id  UUID;
  v_user_id            UUID;
  v_missing            JSONB := '[]'::JSONB;
  v_source_status      TEXT := 'registered';
  v_processing_status  TEXT := 'pending';
  v_processing_context JSONB := '{}'::JSONB;
  v_chunk_count        INTEGER := 0;
  v_embedded_count     INTEGER := 0;
  v_source_reference   TEXT;
  v_source_exists      BOOLEAN := FALSE;
  v_has_manual         BOOLEAN;
  v_has_policy_doc     BOOLEAN;
  v_has_carrier_know   BOOLEAN;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_source_type IS NULL OR length(trim(p_source_type)) = 0 THEN
    RAISE EXCEPTION 'source_type_required';
  END IF;

  IF NOT (trim(p_source_type) = ANY (public.lifeguard_policy_rag_source_types())) THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'source_id_required';
  END IF;

  IF p_carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_id_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.carrier_registry cr
    WHERE cr.id = p_carrier_id AND cr.is_active = TRUE
  ) THEN
    v_missing := v_missing || jsonb_build_array('carrier_not_found');
    RAISE EXCEPTION 'carrier_not_found';
  END IF;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.carrier_product_registry pr
    WHERE pr.id = p_product_id AND pr.carrier_id = p_carrier_id AND pr.is_active = TRUE
  ) THEN
    v_missing := v_missing || jsonb_build_array('product_not_found');
    RAISE EXCEPTION 'product_not_found';
  END IF;

  v_user_id := auth.uid();
  v_source_reference := COALESCE(NULLIF(trim(p_source_reference), ''), p_source_type || ':' || p_source_id::TEXT);

  IF trim(p_source_type) = 'manual_knowledge' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.manual_knowledge_entries e
      INNER JOIN public.manual_knowledge_review_queue rq
        ON rq.manual_entry_id = e.id AND rq.review_status = 'approved_for_rag'
      WHERE e.id = p_source_id
        AND e.carrier_id = p_carrier_id
        AND e.entry_status = 'active'
        AND (p_product_id IS NULL OR e.product_id = p_product_id)
    ) INTO v_source_exists;

    IF NOT v_source_exists THEN
      SELECT EXISTS (
        SELECT 1 FROM public.manual_knowledge_entries e
        WHERE e.id = p_source_id AND e.carrier_id = p_carrier_id AND e.entry_status = 'active'
      ) INTO v_has_manual;

      IF v_has_manual THEN
        v_missing := v_missing || jsonb_build_array('manual_not_approved_for_rag');
      ELSE
        v_missing := v_missing || jsonb_build_array('manual_entry_not_found');
      END IF;
      RAISE EXCEPTION 'source_not_found';
    END IF;

  ELSIF trim(p_source_type) = 'policy_document' THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'real_policy_pdf_registry'
    ) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.real_policy_pdf_registry pdf
        WHERE pdf.id = p_source_id
          AND pdf.carrier_id = p_carrier_id
          AND (p_product_id IS NULL OR pdf.product_id = p_product_id)
      ) INTO v_source_exists;
    END IF;

    IF NOT v_source_exists AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'real_policy_knowledge_sources'
    ) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.real_policy_knowledge_sources s
        WHERE s.id = p_source_id
          AND s.carrier_id = p_carrier_id
          AND (p_product_id IS NULL OR s.product_id = p_product_id)
          AND s.source_status NOT IN ('rejected')
      ) INTO v_source_exists;
    END IF;

    IF NOT v_source_exists THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'policy_knowledge_documents'
      ) INTO v_has_policy_doc;

      IF NOT v_has_policy_doc THEN
        v_missing := v_missing || jsonb_build_array('no_policy_documents_table');
        RAISE EXCEPTION 'no_policy_documents_table';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.policy_knowledge_documents d
        WHERE d.id = p_source_id AND d.deleted_at IS NULL
      ) INTO v_source_exists;

      IF NOT v_source_exists THEN
        v_missing := v_missing || jsonb_build_array('policy_document_not_found');
        RAISE EXCEPTION 'source_not_found';
      END IF;

      SELECT COUNT(*)::INTEGER INTO v_chunk_count
      FROM public.policy_knowledge_chunks c
      WHERE c.document_id = p_source_id
        AND c.deleted_at IS NULL
        AND c.chunk_text IS NOT NULL
        AND length(trim(c.chunk_text)) > 0;

      SELECT COUNT(*)::INTEGER INTO v_embedded_count
      FROM public.policy_knowledge_chunks c
      WHERE c.document_id = p_source_id
        AND c.deleted_at IS NULL
        AND c.embedding IS NOT NULL;

      IF v_chunk_count > 0 THEN
        v_source_status := 'chunked';
      END IF;
      IF v_embedded_count > 0 THEN
        v_source_status := 'embedded';
      END IF;
    END IF;

  ELSIF trim(p_source_type) = 'carrier_knowledge' THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'carrier_underwriting_knowledge_library'
    ) INTO v_has_carrier_know;

    IF NOT v_has_carrier_know THEN
      v_missing := v_missing || jsonb_build_array('no_carrier_knowledge_table');
      RAISE EXCEPTION 'no_carrier_knowledge_table';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.carrier_underwriting_knowledge_library lib
      WHERE lib.id = p_source_id
        AND lib.carrier_id = p_carrier_id
        AND lib.deleted_at IS NULL
        AND (p_product_id IS NULL OR lib.product_id = p_product_id)
    ) INTO v_source_exists;

    IF NOT v_source_exists THEN
      v_missing := v_missing || jsonb_build_array('carrier_knowledge_not_found');
      RAISE EXCEPTION 'source_not_found';
    END IF;

  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.manual_knowledge_entries e
      INNER JOIN public.manual_knowledge_review_queue rq
        ON rq.manual_entry_id = e.id AND rq.review_status = 'approved_for_rag'
      WHERE e.id = p_source_id
        AND e.carrier_id = p_carrier_id
        AND e.entry_status = 'active'
        AND (
          (trim(p_source_type) = 'underwriting_manual' AND e.entry_type = 'underwriting_manual')
          OR (trim(p_source_type) = 'product_brochure' AND e.entry_type = 'product_brochure')
          OR (trim(p_source_type) = 'claim_case' AND e.entry_type = 'claim_case')
          OR (trim(p_source_type) = 'special_clause' AND e.entry_type = 'policy_terms')
        )
        AND (p_product_id IS NULL OR e.product_id = p_product_id)
    ) INTO v_source_exists;

    IF NOT v_source_exists THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'policy_knowledge_documents'
      ) INTO v_has_policy_doc;

      IF v_has_policy_doc THEN
        SELECT EXISTS (
          SELECT 1 FROM public.policy_knowledge_documents d
          WHERE d.id = p_source_id
            AND d.deleted_at IS NULL
            AND (
              (trim(p_source_type) = 'underwriting_manual' AND d.document_type = 'underwriting_guide')
              OR (trim(p_source_type) = 'product_brochure' AND d.document_type = 'product_brochure')
              OR (trim(p_source_type) = 'claim_case' AND d.document_type = 'claim_case')
              OR (trim(p_source_type) = 'special_clause' AND d.document_type = 'policy_terms')
            )
        ) INTO v_source_exists;
      END IF;
    END IF;

    IF NOT v_source_exists THEN
      v_missing := v_missing || jsonb_build_array('typed_source_not_found');
      RAISE EXCEPTION 'source_not_found';
    END IF;
  END IF;

  INSERT INTO public.policy_rag_source_registry (
    source_type,
    source_id,
    carrier_id,
    product_id,
    source_status,
    source_reference,
    initiated_by
  )
  VALUES (
    trim(p_source_type),
    p_source_id,
    p_carrier_id,
    p_product_id,
    v_source_status,
    v_source_reference,
    v_user_id
  )
  ON CONFLICT (source_type, source_id) DO UPDATE
  SET carrier_id = EXCLUDED.carrier_id,
      product_id = EXCLUDED.product_id,
      source_status = EXCLUDED.source_status,
      source_reference = EXCLUDED.source_reference
  RETURNING id INTO v_rag_source_id;

  v_processing_status := 'completed';
  v_processing_context := jsonb_build_object(
    'rag_source_id', v_rag_source_id,
    'source_type', trim(p_source_type),
    'source_id', p_source_id,
    'source_status', v_source_status,
    'chunk_count', v_chunk_count,
    'embedded_count', v_embedded_count,
    'rag_structure_only', TRUE,
    'registered_at', NOW()
  );

  INSERT INTO public.policy_rag_processing_runs (
    rag_source_id,
    processing_status,
    processing_context,
    missing_information,
    initiated_by
  )
  VALUES (
    v_rag_source_id,
    v_processing_status,
    v_processing_context,
    v_missing,
    v_user_id
  )
  RETURNING id INTO v_processing_run_id;

  RETURN jsonb_build_object(
    'rag_source_id', v_rag_source_id,
    'rag_processing_run_id', v_processing_run_id,
    'source_status', v_source_status,
    'missing_information', v_missing,
    'processing_context', v_processing_context,
    'created_at', NOW()
  );
END;
$lifeguard_register_policy_rag_source$;

COMMENT ON FUNCTION public.lifeguard_register_policy_rag_source IS
  'Admin: register policy RAG source from existing stored data only.';
