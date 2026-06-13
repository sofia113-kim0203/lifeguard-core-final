-- =============================================================================
-- LIFEGUARD Core — 027_document_delete_source_policy_retire.sql
-- PR-D1: On customer document soft-delete, retire extracted profile_insurance_policies
-- rows where coverage_summary.source_document_id matches the deleted document.
-- Atomic with document + chunk tombstone (same RPC transaction).
-- =============================================================================

BEGIN;

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
  v_retired_at  TEXT;
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

  v_retired_at := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  UPDATE public.profile_insurance_policies AS p
  SET
    is_active = FALSE,
    coverage_summary = COALESCE(p.coverage_summary, '{}'::jsonb)
      || jsonb_build_object(
           'retired_at', v_retired_at,
           'retired_reason', 'source_document_deleted'
         ),
    updated_at = NOW()
  WHERE p.customer_id = v_customer_id
    AND p.deleted_at IS NULL
    AND p.is_active IS DISTINCT FROM FALSE
    AND p.coverage_summary->>'source_document_id' = p_document_id::text;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_soft_delete_customer_document(UUID) IS
  'Soft-delete own document, tombstone chunks, and retire active policies linked via coverage_summary.source_document_id (PR-D1).';

COMMIT;
