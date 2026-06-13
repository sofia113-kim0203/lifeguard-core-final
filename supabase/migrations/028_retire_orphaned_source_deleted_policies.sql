-- =============================================================================
-- LIFEGUARD Core — 028_retire_orphaned_source_deleted_policies.sql
-- PR-D1-CLEANUP: Maintenance RPC to retire active profile_insurance_policies rows
-- whose coverage_summary.source_document_id points at a soft-deleted customer_document.
-- All customers; idempotent; retire only (no hard delete). Manual invocation only.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lifeguard_retire_orphaned_source_deleted_policies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retired_at TEXT;
  v_count      INTEGER;
BEGIN
  v_retired_at := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  UPDATE public.profile_insurance_policies AS p
  SET
    is_active = FALSE,
    coverage_summary = COALESCE(p.coverage_summary, '{}'::jsonb)
      || jsonb_build_object(
           'retired_at', v_retired_at,
           'retired_reason', 'source_document_deleted_backfill'
         ),
    updated_at = NOW()
  FROM public.customer_documents AS d
  WHERE p.deleted_at IS NULL
    AND p.is_active IS DISTINCT FROM FALSE
    AND p.coverage_summary ? 'source_document_id'
    AND d.id::text = p.coverage_summary->>'source_document_id'
    AND p.customer_id = d.customer_id
    AND d.deleted_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_retire_orphaned_source_deleted_policies() IS
  'Maintenance backfill: retire active policies linked to soft-deleted source documents (all customers). Manual invoke only; returns retired row count.';

REVOKE ALL ON FUNCTION public.lifeguard_retire_orphaned_source_deleted_policies() FROM PUBLIC;

COMMIT;
