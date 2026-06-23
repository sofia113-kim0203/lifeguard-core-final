-- ===========================================================================
-- 032_profile_insurance_policies_extended_columns.sql
-- Extend profile_insurance_policies for code paths expecting premium/status/date
-- columns on active_profile_insurance_policies (view 029 = SELECT *).
-- ===========================================================================

BEGIN;

ALTER TABLE public.profile_insurance_policies
  ADD COLUMN IF NOT EXISTS premium_amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS policy_status TEXT,
  ADD COLUMN IF NOT EXISTS contract_date DATE;

COMMENT ON COLUMN public.profile_insurance_policies.premium_amount IS
  'Optional monthly premium alternate; resolvePolicyPremium reads after monthly_premium.';

COMMENT ON COLUMN public.profile_insurance_policies.policy_status IS
  'Human-readable contract status label (e.g. 유지); complements is_active.';

COMMENT ON COLUMN public.profile_insurance_policies.contract_date IS
  'Contract effective date fallback when effective_from is unset.';

COMMIT;
