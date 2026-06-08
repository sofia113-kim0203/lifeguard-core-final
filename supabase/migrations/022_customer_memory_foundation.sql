-- =============================================================================
-- LIFEGUARD Core — 022_customer_memory_foundation.sql
-- Phase 26 Step 1A: Customer Memory foundation profile fields
-- Requires: 019, 020
-- =============================================================================

BEGIN;

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS family_composition TEXT,
  ADD COLUMN IF NOT EXISTS insurance_goal TEXT,
  ADD COLUMN IF NOT EXISTS monthly_insurance_budget NUMERIC(14, 2);

COMMENT ON COLUMN public.customer_profiles.marital_status IS
  'Customer marital status for memory profile (e.g. married, single).';

COMMENT ON COLUMN public.customer_profiles.family_composition IS
  'Family composition summary for memory profile (e.g. spouse + 2 children).';

COMMENT ON COLUMN public.customer_profiles.insurance_goal IS
  'Primary insurance planning goal stated by customer.';

COMMENT ON COLUMN public.customer_profiles.monthly_insurance_budget IS
  'Monthly insurance budget in KRW stated by customer.';

COMMIT;
