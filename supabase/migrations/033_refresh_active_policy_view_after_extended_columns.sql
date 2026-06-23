-- ===========================================================================
-- 033_refresh_active_policy_view_after_extended_columns.sql
-- Re-expand active_profile_insurance_policies after 032 ADD COLUMN.
-- PostgreSQL fixes SELECT * column list at view create/replace time;
-- ALTER TABLE alone does not update view metadata / PostgREST catalog.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE VIEW public.active_profile_insurance_policies
WITH (security_invoker = true) AS
SELECT *
FROM public.profile_insurance_policies
WHERE deleted_at IS NULL
  AND is_active IS DISTINCT FROM FALSE;

COMMENT ON VIEW public.active_profile_insurance_policies IS
  'Single source of truth for active (not deleted, not retired) insurance policies. RLS-respecting (security_invoker). Read-only; writers use profile_insurance_policies. Refreshed after 032 extended columns.';

GRANT SELECT ON public.active_profile_insurance_policies TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
