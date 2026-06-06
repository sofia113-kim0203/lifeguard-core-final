-- =============================================================================
-- LIFEGUARD Core — Phase 14-8 Real policy vector search integration (ONE-TIME)
-- Thin wrappers connecting real-policy lineage to existing vector search / grounding.
-- Run after phase14_real_policy_embedding_execution_integration.sql. Does NOT modify 001–012.
-- Reuses policy_vector_search_*, policy_grounding_context_*, customer_grounded_conversation_*.
-- No duplicate vector search engine, registry, or grounding tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Search real policy vectors (delegates to lifeguard_search_policy_vectors)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_search_real_policy_vectors(
  p_policy_pdf_id UUID DEFAULT NULL,
  p_carrier_id    UUID DEFAULT NULL,
  p_product_id    UUID DEFAULT NULL,
  p_query         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_search_real_policy_vectors$
DECLARE
  v_missing           JSONB := '[]'::JSONB;
  v_search_result     JSONB;
  v_results           JSONB := '[]'::JSONB;
  v_result_elem       JSONB;
  v_enriched          JSONB;
  v_carrier_id        UUID;
  v_product_id        UUID;
  v_file_name         TEXT;
  v_file_version      TEXT;
  v_result_count      INTEGER := 0;
  v_chunk_registry_id UUID;
  v_lineage_rec       RECORD;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_query');
    RAISE EXCEPTION 'query_required';
  END IF;

  v_carrier_id := p_carrier_id;
  v_product_id := p_product_id;

  IF p_policy_pdf_id IS NOT NULL THEN
    SELECT
      pdf.carrier_id,
      pdf.product_id,
      pdf.file_name,
      pdf.file_version
    INTO v_carrier_id, v_product_id, v_file_name, v_file_version
    FROM public.real_policy_pdf_registry pdf
    WHERE pdf.id = p_policy_pdf_id;

    IF v_carrier_id IS NULL AND v_file_name IS NULL THEN
      v_missing := v_missing || jsonb_build_array('policy_pdf_not_found');
      RAISE EXCEPTION 'policy_pdf_not_found';
    END IF;

    IF p_carrier_id IS NOT NULL AND v_carrier_id IS DISTINCT FROM p_carrier_id THEN
      v_missing := v_missing || jsonb_build_array('carrier_scope_mismatch');
    END IF;

    IF p_product_id IS NOT NULL AND v_product_id IS DISTINCT FROM p_product_id THEN
      v_missing := v_missing || jsonb_build_array('product_scope_mismatch');
    END IF;

    IF p_carrier_id IS NOT NULL THEN
      v_carrier_id := p_carrier_id;
    END IF;

    IF p_product_id IS NOT NULL THEN
      v_product_id := p_product_id;
    END IF;
  END IF;

  v_search_result := public.lifeguard_search_policy_vectors(
    trim(p_query),
    v_carrier_id,
    v_product_id
  );

  IF v_search_result IS NULL THEN
    v_missing := v_missing || jsonb_build_array('vector_search_failed');
    RETURN jsonb_build_object(
      'policy_pdf_id', p_policy_pdf_id,
      'carrier_id', v_carrier_id,
      'product_id', v_product_id,
      'results', '[]'::JSONB,
      'result_count', 0,
      'missing_information', v_missing,
      'integration_only', TRUE,
      'created_at', NOW()
    );
  END IF;

  IF v_search_result ? 'missing_information' THEN
    v_missing := v_missing || COALESCE(v_search_result->'missing_information', '[]'::JSONB);
  END IF;

  FOR v_result_elem IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_search_result->'results', '[]'::JSONB))
  LOOP
    v_chunk_registry_id := NULLIF(v_result_elem->>'chunk_registry_id', '')::UUID;

    IF v_chunk_registry_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      rci.id AS real_policy_chunk_item_id,
      rci.policy_pdf_id,
      rci.source_reference,
      pdf.file_name,
      pdf.file_version
    INTO v_lineage_rec
    FROM public.real_policy_chunk_items rci
    INNER JOIN public.real_policy_pdf_registry pdf
      ON pdf.id = rci.policy_pdf_id
    WHERE rci.chunk_registry_id = v_chunk_registry_id
    ORDER BY rci.created_at DESC
    LIMIT 1;

    IF p_policy_pdf_id IS NOT NULL THEN
      IF v_lineage_rec.policy_pdf_id IS NULL OR v_lineage_rec.policy_pdf_id IS DISTINCT FROM p_policy_pdf_id THEN
        CONTINUE;
      END IF;
    END IF;

    v_enriched := v_result_elem || jsonb_build_object(
      'real_policy_chunk_item_id', v_lineage_rec.real_policy_chunk_item_id,
      'policy_pdf_id', COALESCE(v_lineage_rec.policy_pdf_id, p_policy_pdf_id),
      'file_name', COALESCE(v_lineage_rec.file_name, v_file_name),
      'file_version', COALESCE(v_lineage_rec.file_version, v_file_version),
      'source_reference', COALESCE(v_result_elem->>'source_reference', v_lineage_rec.source_reference),
      'chunk_registry_id', v_chunk_registry_id,
      'vector_reference', v_result_elem->>'vector_reference'
    );

    v_results := v_results || jsonb_build_array(v_enriched);
    v_result_count := v_result_count + 1;
  END LOOP;

  IF p_policy_pdf_id IS NOT NULL AND v_result_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_matching_real_policy_chunks');
  END IF;

  RETURN jsonb_build_object(
    'vector_search_run_id', v_search_result->'vector_search_run_id',
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'results', v_results,
    'result_count', v_result_count,
    'search_status', v_search_result->'search_status',
    'search_context', COALESCE(v_search_result->'search_context', '{}'::JSONB) || jsonb_build_object(
      'real_policy_integration', TRUE,
      'policy_pdf_id', p_policy_pdf_id,
      'scoped_by_pdf', p_policy_pdf_id IS NOT NULL
    ),
    'missing_information', v_missing,
    'integration_only', TRUE,
    'no_fake_ranking', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_search_real_policy_vectors$;

COMMENT ON FUNCTION public.lifeguard_search_real_policy_vectors IS
  'Admin: search real policy vectors via generic delegate with PDF lineage — no new search engine.';

-- ---------------------------------------------------------------------------
-- Prepare real policy grounding context (delegates to lifeguard_prepare_grounding_context)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_prepare_real_policy_grounding_context(
  p_policy_pdf_id UUID DEFAULT NULL,
  p_carrier_id    UUID DEFAULT NULL,
  p_product_id    UUID DEFAULT NULL,
  p_query         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_prepare_real_policy_grounding_context$
DECLARE
  v_missing              JSONB := '[]'::JSONB;
  v_grounding_result     JSONB;
  v_carrier_id           UUID;
  v_product_id           UUID;
  v_file_name            TEXT;
  v_file_version         TEXT;
  v_grounding_context    JSONB;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_query');
    RAISE EXCEPTION 'query_required';
  END IF;

  v_carrier_id := p_carrier_id;
  v_product_id := p_product_id;

  IF p_policy_pdf_id IS NOT NULL THEN
    SELECT
      pdf.carrier_id,
      pdf.product_id,
      pdf.file_name,
      pdf.file_version
    INTO v_carrier_id, v_product_id, v_file_name, v_file_version
    FROM public.real_policy_pdf_registry pdf
    WHERE pdf.id = p_policy_pdf_id;

    IF v_carrier_id IS NULL AND v_file_name IS NULL THEN
      v_missing := v_missing || jsonb_build_array('policy_pdf_not_found');
      RAISE EXCEPTION 'policy_pdf_not_found';
    END IF;

    IF p_carrier_id IS NOT NULL AND v_carrier_id IS DISTINCT FROM p_carrier_id THEN
      v_missing := v_missing || jsonb_build_array('carrier_scope_mismatch');
    END IF;

    IF p_product_id IS NOT NULL AND v_product_id IS DISTINCT FROM p_product_id THEN
      v_missing := v_missing || jsonb_build_array('product_scope_mismatch');
    END IF;

    IF p_carrier_id IS NOT NULL THEN
      v_carrier_id := p_carrier_id;
    END IF;

    IF p_product_id IS NOT NULL THEN
      v_product_id := p_product_id;
    END IF;
  END IF;

  v_grounding_result := public.lifeguard_prepare_grounding_context(
    trim(p_query),
    v_carrier_id,
    v_product_id
  );

  IF v_grounding_result IS NULL THEN
    v_missing := v_missing || jsonb_build_array('grounding_context_failed');
    RETURN jsonb_build_object(
      'policy_pdf_id', p_policy_pdf_id,
      'carrier_id', v_carrier_id,
      'product_id', v_product_id,
      'source_count', 0,
      'grounding_context', '{}'::JSONB,
      'missing_information', v_missing,
      'integration_only', TRUE,
      'created_at', NOW()
    );
  END IF;

  IF v_grounding_result ? 'missing_information' THEN
    v_missing := v_missing || COALESCE(v_grounding_result->'missing_information', '[]'::JSONB);
  END IF;

  v_grounding_context := COALESCE(v_grounding_result->'grounding_context', '{}'::JSONB) || jsonb_build_object(
    'real_policy_integration', TRUE,
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'scoped_by_pdf', p_policy_pdf_id IS NOT NULL
  );

  RETURN jsonb_build_object(
    'grounding_context_run_id', v_grounding_result->'grounding_context_run_id',
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'source_count', COALESCE((v_grounding_result->>'source_count')::INTEGER, 0),
    'grounding_status', v_grounding_result->'grounding_status',
    'grounding_context', v_grounding_context,
    'source_references', COALESCE(v_grounding_result->'source_references', '[]'::JSONB),
    'missing_information', v_missing,
    'integration_only', TRUE,
    'no_claude_call', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_prepare_real_policy_grounding_context$;

COMMENT ON FUNCTION public.lifeguard_prepare_real_policy_grounding_context IS
  'Admin: prepare scoped real policy grounding via generic delegate — no Claude.';

-- ---------------------------------------------------------------------------
-- Prepare customer real policy grounded conversation (scoped)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_prepare_customer_real_policy_grounded_conversation(
  p_customer_id      UUID,
  p_conversation_id  UUID,
  p_policy_pdf_id    UUID DEFAULT NULL,
  p_carrier_id       UUID DEFAULT NULL,
  p_product_id       UUID DEFAULT NULL,
  p_query            TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_prepare_customer_real_policy_grounded_conversation$
DECLARE
  v_missing                    JSONB := '[]'::JSONB;
  v_run_id                     UUID;
  v_user_id                    UUID;
  v_run_status                 TEXT := 'processing';
  v_query_trim                 TEXT;
  v_memory_result              JSONB;
  v_conversation_result        JSONB;
  v_grounding_result           JSONB;
  v_memory_count               INTEGER := 0;
  v_conversation_memory_count  INTEGER := 0;
  v_grounding_source_count     INTEGER := 0;
  v_claude_grounding_ready     BOOLEAN := FALSE;
  v_context_summary            JSONB := '{}'::JSONB;
  v_carrier_id                 UUID;
  v_product_id                 UUID;
  v_file_name                  TEXT;
  v_file_version               TEXT;
  v_grounding_context_run_id   UUID;
  v_selected_sources           INTEGER := 0;
  v_rec                        RECORD;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id_required';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id_required';
  END IF;

  v_query_trim := COALESCE(trim(p_query), '');

  IF length(v_query_trim) = 0 THEN
    RAISE EXCEPTION 'query_required';
  END IF;

  IF p_policy_pdf_id IS NULL AND p_carrier_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('missing_policy_scope');
    RETURN jsonb_build_object(
      'grounded_conversation_run_id', NULL,
      'memory_count', 0,
      'conversation_memory_count', 0,
      'grounding_source_count', 0,
      'claude_grounding_ready', FALSE,
      'context_summary', '{}'::JSONB,
      'missing_information', v_missing,
      'run_status', 'failed',
      'integration_only', TRUE,
      'created_at', NOW()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_profiles cp
    WHERE cp.id = p_customer_id
      AND cp.deleted_at IS NULL
  ) THEN
    v_missing := v_missing || jsonb_build_array('customer_not_found');
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  v_user_id := auth.uid();
  v_carrier_id := p_carrier_id;
  v_product_id := p_product_id;

  IF p_policy_pdf_id IS NOT NULL THEN
    SELECT
      pdf.carrier_id,
      pdf.product_id,
      pdf.file_name,
      pdf.file_version
    INTO v_carrier_id, v_product_id, v_file_name, v_file_version
    FROM public.real_policy_pdf_registry pdf
    WHERE pdf.id = p_policy_pdf_id;

    IF v_carrier_id IS NULL AND v_file_name IS NULL THEN
      v_missing := v_missing || jsonb_build_array('policy_pdf_not_found');
      RAISE EXCEPTION 'policy_pdf_not_found';
    END IF;

    IF p_carrier_id IS NOT NULL THEN
      v_carrier_id := p_carrier_id;
    END IF;

    IF p_product_id IS NOT NULL THEN
      v_product_id := p_product_id;
    END IF;
  END IF;

  INSERT INTO public.customer_grounded_conversation_runs (
    customer_id,
    conversation_id,
    query,
    run_status,
    initiated_by
  )
  VALUES (p_customer_id, p_conversation_id, v_query_trim, 'processing', v_user_id)
  RETURNING id INTO v_run_id;

  BEGIN
    v_memory_result := public.lifeguard_prepare_customer_memory_context(p_customer_id);
    v_memory_count := COALESCE((v_memory_result->>'memory_count')::INTEGER, 0);
    v_grounding_source_count := v_grounding_source_count
      + COALESCE((v_memory_result->>'grounding_source_count')::INTEGER, 0);

    IF v_memory_result ? 'missing_information' THEN
      v_missing := v_missing || COALESCE(v_memory_result->'missing_information', '[]'::JSONB);
    END IF;

    FOR v_rec IN
      SELECT cm.id, cm.memory_type, cm.memory_title
      FROM public.customer_memory_registry cm
      WHERE cm.customer_id = p_customer_id
        AND cm.memory_status = 'active'
      ORDER BY cm.created_at ASC
      LIMIT 50
    LOOP
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (
        v_run_id,
        'customer_memory',
        COALESCE(v_rec.memory_title, v_rec.id::TEXT),
        'selected'
      );
      v_selected_sources := v_selected_sources + 1;
    END LOOP;

    IF v_memory_count = 0 THEN
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'customer_memory', 'none', 'missing');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_missing := v_missing || jsonb_build_array('customer_memory_context_failed');
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'customer_memory', 'error', 'missing');
  END;

  BEGIN
    v_conversation_result := public.lifeguard_prepare_customer_conversation_memory_context(
      p_customer_id,
      p_conversation_id
    );
    v_conversation_memory_count := COALESCE((v_conversation_result->>'message_count')::INTEGER, 0);

    IF v_conversation_result ? 'missing_information' THEN
      v_missing := v_missing || COALESCE(v_conversation_result->'missing_information', '[]'::JSONB);
    END IF;

    FOR v_rec IN
      SELECT cmi.id, cmi.memory_title, cmi.message_role
      FROM public.customer_conversation_memory_items cmi
      WHERE cmi.customer_id = p_customer_id
        AND cmi.conversation_id = p_conversation_id
        AND cmi.memory_status = 'stored'
      ORDER BY cmi.created_at ASC
      LIMIT 50
    LOOP
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (
        v_run_id,
        'conversation_memory',
        COALESCE(v_rec.memory_title, v_rec.id::TEXT) || ':' || v_rec.message_role,
        'selected'
      );
      v_selected_sources := v_selected_sources + 1;
    END LOOP;

    IF v_conversation_memory_count = 0 THEN
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'conversation_memory', 'none', 'missing');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_missing := v_missing || jsonb_build_array('conversation_memory_context_failed');
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'conversation_memory', 'error', 'missing');
  END;

  BEGIN
    v_grounding_result := public.lifeguard_prepare_real_policy_grounding_context(
      p_policy_pdf_id,
      v_carrier_id,
      v_product_id,
      v_query_trim
    );

    v_grounding_context_run_id := (v_grounding_result->>'grounding_context_run_id')::UUID;
    v_grounding_source_count := v_grounding_source_count
      + COALESCE((v_grounding_result->>'source_count')::INTEGER, 0);

    IF v_grounding_result ? 'missing_information' THEN
      v_missing := v_missing || COALESCE(v_grounding_result->'missing_information', '[]'::JSONB);
    END IF;

    IF v_grounding_context_run_id IS NOT NULL THEN
      FOR v_rec IN
        SELECT gs.source_reference, gs.source_type, gs.rag_source_id
        FROM public.policy_grounding_context_sources gs
        WHERE gs.grounding_context_run_id = v_grounding_context_run_id
        ORDER BY gs.created_at ASC
        LIMIT 50
      LOOP
        INSERT INTO public.customer_grounded_conversation_sources (
          grounded_conversation_run_id, source_type, source_reference, source_status
        )
        VALUES (
          v_run_id,
          'policy_grounding',
          COALESCE(v_rec.source_reference, 'policy_grounding'),
          'selected'
        );
        v_selected_sources := v_selected_sources + 1;

        IF v_rec.rag_source_id IS NOT NULL THEN
          INSERT INTO public.customer_grounded_conversation_sources (
            grounded_conversation_run_id, source_type, source_reference, source_status
          )
          VALUES (v_run_id, 'rag_source', v_rec.rag_source_id::TEXT, 'selected');
          v_selected_sources := v_selected_sources + 1;
        END IF;
      END LOOP;
    END IF;

    IF COALESCE((v_grounding_result->>'source_count')::INTEGER, 0) = 0 THEN
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'policy_grounding', 'none', 'missing');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_missing := v_missing || jsonb_build_array('grounding_context_failed');
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (v_run_id, 'policy_grounding', 'error', 'missing');
  END;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'policy_vector_search_runs'
  ) THEN
    FOR v_rec IN
      SELECT vsr.id, vsr.result_count
      FROM public.policy_vector_search_runs vsr
      WHERE vsr.query = v_query_trim
        AND vsr.search_status = 'completed'
        AND (v_carrier_id IS NULL OR vsr.carrier_id IS NOT DISTINCT FROM v_carrier_id)
        AND (v_product_id IS NULL OR vsr.product_id IS NOT DISTINCT FROM v_product_id)
      ORDER BY vsr.created_at DESC
      LIMIT 5
    LOOP
      INSERT INTO public.customer_grounded_conversation_sources (
        grounded_conversation_run_id, source_type, source_reference, source_status
      )
      VALUES (
        v_run_id,
        'vector_search',
        v_rec.id::TEXT,
        CASE WHEN COALESCE(v_rec.result_count, 0) > 0 THEN 'selected' ELSE 'skipped' END
      );
      IF COALESCE(v_rec.result_count, 0) > 0 THEN
        v_selected_sources := v_selected_sources + 1;
      END IF;
    END LOOP;
  END IF;

  v_context_summary := jsonb_build_object(
    'customer_id', p_customer_id,
    'conversation_id', p_conversation_id,
    'query', v_query_trim,
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'memory_count', v_memory_count,
    'conversation_memory_count', v_conversation_memory_count,
    'grounding_source_count', v_grounding_source_count,
    'selected_source_count', v_selected_sources,
    'claude_grounding_ready', v_claude_grounding_ready,
    'grounding_context_run_id', v_grounding_context_run_id,
    'customer_memory_context', v_memory_result,
    'conversation_memory_context', v_conversation_result,
    'grounding_context', v_grounding_result,
    'real_policy_integration', TRUE,
    'scoped_search', TRUE,
    'context_only', TRUE,
    'no_claude_call', TRUE,
    'prepared_at', NOW()
  );

  IF v_grounding_source_count > 0 OR v_memory_count > 0 OR v_conversation_memory_count > 0 THEN
    v_run_status := 'completed';
    v_claude_grounding_ready := v_grounding_source_count > 0;
  ELSIF v_memory_count = 0
     AND v_conversation_memory_count = 0
     AND v_grounding_source_count = 0 THEN
    v_run_status := 'insufficient_context';
    v_missing := v_missing || jsonb_build_array('insufficient_context');
  ELSE
    v_run_status := 'failed';
  END IF;

  UPDATE public.customer_grounded_conversation_runs
  SET run_status = v_run_status,
      memory_count = v_memory_count,
      conversation_memory_count = v_conversation_memory_count,
      grounding_source_count = v_grounding_source_count,
      claude_grounding_ready = v_claude_grounding_ready,
      context_summary = v_context_summary,
      missing_information = v_missing,
      completed_at = CASE WHEN v_run_status IN ('completed', 'insufficient_context', 'failed') THEN NOW() ELSE NULL END
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'grounded_conversation_run_id', v_run_id,
    'memory_count', v_memory_count,
    'conversation_memory_count', v_conversation_memory_count,
    'grounding_source_count', v_grounding_source_count,
    'claude_grounding_ready', v_claude_grounding_ready,
    'context_summary', v_context_summary,
    'missing_information', v_missing,
    'run_status', v_run_status,
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'integration_only', TRUE,
    'no_claude_call', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_prepare_customer_real_policy_grounded_conversation$;

COMMENT ON FUNCTION public.lifeguard_prepare_customer_real_policy_grounded_conversation IS
  'Admin: prepare scoped customer grounded conversation with real policy grounding — no Claude.';
