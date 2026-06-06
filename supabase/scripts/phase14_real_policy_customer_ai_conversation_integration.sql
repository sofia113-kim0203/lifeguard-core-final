-- =============================================================================
-- LIFEGUARD Core — Phase 14-9 Real policy customer AI conversation integration (ONE-TIME)
-- Thin wrapper connecting Phase 14-8 scoped grounding to existing customer AI + Claude flow.
-- Run after phase14_real_policy_vector_search_integration.sql. Does NOT modify 001–012.
-- Reuses customer_ai_conversation_*, claude_grounding_*, claude_execution_* — no duplicate engines.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Prepare customer real policy AI conversation (scoped integration wrapper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_prepare_customer_real_policy_ai_conversation(
  p_customer_id     UUID,
  p_conversation_id UUID,
  p_policy_pdf_id   UUID DEFAULT NULL,
  p_carrier_id      UUID DEFAULT NULL,
  p_product_id      UUID DEFAULT NULL,
  p_query           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_prepare_customer_real_policy_ai_conversation$
DECLARE
  v_run_id                       UUID;
  v_user_id                      UUID;
  v_missing                      JSONB := '[]'::JSONB;
  v_execution_status             TEXT := 'preparing';
  v_query_trim                   TEXT;
  v_grounded_result              JSONB;
  v_grounding_request_result     JSONB;
  v_execution_result             JSONB;
  v_grounded_conversation_run_id UUID;
  v_claude_grounding_run_id      UUID;
  v_claude_execution_run_id      UUID;
  v_grounded_run_status          TEXT;
  v_claude_grounding_ready       BOOLEAN := FALSE;
  v_grounding_source_count       INTEGER := 0;
  v_execution_prep_status        TEXT;
  v_carrier_id                   UUID;
  v_product_id                   UUID;
  v_file_name                    TEXT;
  v_file_version                 TEXT;
  v_default_model                TEXT := 'claude-sonnet-4-20250514';
  v_scope_enrichment             JSONB;
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
      'customer_ai_conversation_run_id', NULL,
      'grounded_conversation_run_id', NULL,
      'claude_grounding_run_id', NULL,
      'claude_execution_run_id', NULL,
      'grounding_source_count', 0,
      'claude_grounding_ready', FALSE,
      'missing_information', v_missing,
      'execution_status', 'failed',
      'integration_only', TRUE,
      'created_at', NOW()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_profiles cp
    WHERE cp.id = p_customer_id AND cp.deleted_at IS NULL
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

  IF v_carrier_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('missing_policy_scope');
    RETURN jsonb_build_object(
      'customer_ai_conversation_run_id', NULL,
      'grounded_conversation_run_id', NULL,
      'claude_grounding_run_id', NULL,
      'claude_execution_run_id', NULL,
      'grounding_source_count', 0,
      'claude_grounding_ready', FALSE,
      'missing_information', v_missing,
      'execution_status', 'failed',
      'integration_only', TRUE,
      'created_at', NOW()
    );
  END IF;

  INSERT INTO public.customer_ai_conversation_runs (
    customer_id,
    conversation_id,
    query,
    execution_status,
    response_status,
    initiated_by
  )
  VALUES (p_customer_id, p_conversation_id, v_query_trim, 'preparing', 'pending', v_user_id)
  RETURNING id INTO v_run_id;

  v_scope_enrichment := jsonb_build_object(
    'real_policy_integration', TRUE,
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'scoped_search', TRUE
  );

  -- Step 1: scoped real-policy grounded conversation
  BEGIN
    v_grounded_result := public.lifeguard_prepare_customer_real_policy_grounded_conversation(
      p_customer_id,
      p_conversation_id,
      p_policy_pdf_id,
      v_carrier_id,
      v_product_id,
      v_query_trim
    );

    v_grounded_conversation_run_id := (v_grounded_result ->> 'grounded_conversation_run_id')::UUID;
    v_grounded_run_status := v_grounded_result ->> 'run_status';
    v_grounding_source_count := COALESCE((v_grounded_result ->> 'grounding_source_count')::INTEGER, 0);
    v_file_name := COALESCE(v_file_name, v_grounded_result -> 'context_summary' ->> 'file_name');
    v_file_version := COALESCE(v_file_version, v_grounded_result -> 'context_summary' ->> 'file_version');

    IF v_grounded_result ? 'missing_information' THEN
      v_missing := v_missing || COALESCE(v_grounded_result -> 'missing_information', '[]'::JSONB);
    END IF;

    IF v_grounded_run_status IN ('failed', 'insufficient_context') THEN
      v_missing := v_missing || jsonb_build_array('grounded_conversation_' || v_grounded_run_status);
    END IF;

    v_scope_enrichment := v_scope_enrichment || jsonb_build_object(
      'grounded_conversation_run_id', v_grounded_conversation_run_id,
      'grounding_source_count', v_grounding_source_count
    );
  EXCEPTION WHEN OTHERS THEN
    v_missing := v_missing || jsonb_build_array('grounded_conversation_failed');
    v_execution_status := 'failed';
  END;

  -- Step 3: scoped Claude grounding request (never NULL,NULL)
  IF v_execution_status <> 'failed' THEN
    BEGIN
      v_grounding_request_result := public.lifeguard_prepare_claude_grounding_request(
        p_customer_id,
        v_query_trim,
        v_carrier_id,
        v_product_id
      );

      v_claude_grounding_run_id := (v_grounding_request_result ->> 'claude_grounding_run_id')::UUID;
      v_claude_grounding_ready := (v_grounding_request_result ->> 'response_status') = 'ready_for_claude';
      v_grounding_source_count := v_grounding_source_count
        + COALESCE((v_grounding_request_result ->> 'source_count')::INTEGER, 0);

      IF v_grounding_request_result ? 'missing_information' THEN
        v_missing := v_missing || COALESCE(v_grounding_request_result -> 'missing_information', '[]'::JSONB);
      END IF;

      IF v_claude_grounding_run_id IS NOT NULL THEN
        UPDATE public.claude_grounding_runs
        SET request_context = COALESCE(request_context, '{}'::JSONB) || v_scope_enrichment || jsonb_build_object(
          'grounded_conversation_run_id', v_grounded_conversation_run_id,
          'claude_grounding_ready', v_claude_grounding_ready,
          'enriched_at', NOW()
        )
        WHERE id = v_claude_grounding_run_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_missing := v_missing || jsonb_build_array('claude_grounding_request_failed');
      v_claude_grounding_ready := FALSE;
    END;
  END IF;

  -- Step 4: Claude execution preparation
  IF v_claude_grounding_run_id IS NOT NULL AND v_execution_status <> 'failed' THEN
    BEGIN
      v_execution_result := public.lifeguard_prepare_claude_execution(
        v_claude_grounding_run_id,
        v_default_model
      );

      v_claude_execution_run_id := (v_execution_result ->> 'claude_execution_run_id')::UUID;
      v_execution_prep_status := v_execution_result ->> 'execution_status';

      IF v_execution_result ? 'missing_information' THEN
        v_missing := v_missing || COALESCE(v_execution_result -> 'missing_information', '[]'::JSONB);
      END IF;

      IF v_claude_execution_run_id IS NOT NULL THEN
        UPDATE public.claude_execution_runs
        SET request_context = COALESCE(request_context, '{}'::JSONB) || v_scope_enrichment || jsonb_build_object(
          'claude_grounding_run_id', v_claude_grounding_run_id,
          'enriched_at', NOW()
        )
        WHERE id = v_claude_execution_run_id;
      END IF;

      IF v_execution_prep_status = 'ready' THEN
        v_execution_status := 'ready';
      ELSIF v_execution_prep_status = 'failed' THEN
        v_execution_status := 'failed';
        v_missing := v_missing || jsonb_build_array('claude_execution_prep_failed');
      ELSE
        v_execution_status := 'preparing';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_missing := v_missing || jsonb_build_array('claude_execution_prep_failed');
      v_execution_status := 'failed';
    END;
  ELSIF v_execution_status <> 'failed' THEN
    v_missing := v_missing || jsonb_build_array('claude_grounding_run_missing');
    v_execution_status := 'failed';
  END IF;

  -- Step 5: update customer_ai_conversation_runs
  UPDATE public.customer_ai_conversation_runs
  SET execution_status = v_execution_status,
      grounded_conversation_run_id = v_grounded_conversation_run_id,
      claude_execution_run_id = v_claude_execution_run_id,
      missing_information = v_missing,
      response_status = CASE
        WHEN v_execution_status = 'ready' THEN 'prepared'
        WHEN v_execution_status = 'failed' THEN 'failed'
        ELSE 'pending'
      END,
      error_message = CASE WHEN v_execution_status = 'failed' THEN 'real_policy_ai_conversation_preparation_failed' ELSE NULL END,
      completed_at = CASE WHEN v_execution_status IN ('ready', 'failed') THEN NOW() ELSE NULL END
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'customer_ai_conversation_run_id', v_run_id,
    'grounded_conversation_run_id', v_grounded_conversation_run_id,
    'claude_grounding_run_id', v_claude_grounding_run_id,
    'claude_execution_run_id', v_claude_execution_run_id,
    'grounding_source_count', v_grounding_source_count,
    'claude_grounding_ready', v_claude_grounding_ready,
    'execution_status', v_execution_status,
    'policy_pdf_id', p_policy_pdf_id,
    'carrier_id', v_carrier_id,
    'product_id', v_product_id,
    'file_name', v_file_name,
    'file_version', v_file_version,
    'missing_information', v_missing,
    'grounded_conversation_result', v_grounded_result,
    'claude_grounding_request_result', v_grounding_request_result,
    'claude_execution_result', v_execution_result,
    'integration_only', TRUE,
    'no_claude_execution', TRUE,
    'scoped_carrier_product', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_prepare_customer_real_policy_ai_conversation$;

COMMENT ON FUNCTION public.lifeguard_prepare_customer_real_policy_ai_conversation IS
  'Admin: prepare scoped real policy customer AI conversation via existing grounded + Claude infra — no API call.';
