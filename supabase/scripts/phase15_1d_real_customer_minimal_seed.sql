-- =============================================================================
-- LIFEGUARD Core — Phase 15-1D Real customer minimal seed
-- Run in Supabase SQL Editor after:
--   • 001_initial_schema.sql (customer_profiles, profile_health, users)
--   • phase8_carrier_rule_foundation.sql (carrier_registry)
--   • phase9_carrier_knowledge_foundation.sql (carrier_product_registry)
--   • phase15_1c_missing_early_rpc_patch.sql (optional; early RPCs)
--
-- Real customer: 김진우 / 1970-03-14 / Male / Hypertension disclosure
-- Real carriers (insurance analysis reference): 메리츠화재, 한화손해보험, 삼성화재,
--   현대해상, DB손해보험, 한화생명
--
-- No new tables. No new engines. Minimum rows only.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. carrier_registry — six real insurers from insurance analysis
-- ---------------------------------------------------------------------------
INSERT INTO public.carrier_registry (carrier_name, carrier_type, is_active)
VALUES
  ('메리츠화재',   'non_life_insurance', TRUE),
  ('한화손해보험', 'non_life_insurance', TRUE),
  ('삼성화재',     'non_life_insurance', TRUE),
  ('현대해상',     'non_life_insurance', TRUE),
  ('DB손해보험',   'non_life_insurance', TRUE),
  ('한화생명',     'life_insurance',     TRUE)
ON CONFLICT (carrier_name) DO UPDATE
SET
  carrier_type = EXCLUDED.carrier_type,
  is_active    = TRUE;

-- ---------------------------------------------------------------------------
-- 2. carrier_product_registry — minimum one active product (E2E gate)
--    Product names from insurance analysis images are not in repo/OCR yet.
--    Replace product_name values after analysis OCR confirms contract names.
-- ---------------------------------------------------------------------------
INSERT INTO public.carrier_product_registry (
  carrier_id,
  product_name,
  product_type,
  underwriting_program,
  is_active,
  metadata_json
)
SELECT
  cr.id,
  'PENDING_OCR_FROM_ANALYSIS',
  NULL,
  'Standard',
  TRUE,
  jsonb_build_object(
    'seed_phase', '15-1D',
    'seed_note', 'Replace after insurance analysis image OCR confirms product name',
    'source_reference', 'insurance_analysis_images'
  )
FROM public.carrier_registry cr
WHERE cr.carrier_name = '메리츠화재'
  AND cr.is_active = TRUE
ON CONFLICT (carrier_id, product_name, underwriting_program) DO UPDATE
SET
  is_active     = TRUE,
  metadata_json = EXCLUDED.metadata_json;

-- ---------------------------------------------------------------------------
-- 3. users + customer_profiles — real test customer 김진우
-- ---------------------------------------------------------------------------
DO $seed_customer$
DECLARE
  -- Replace with existing auth.users.id for customer 김진우 before running.
  v_auth_user_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
  v_customer_id  UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_user_id) THEN
    RAISE EXCEPTION 'auth_user_not_found: create auth.users row for 김진우 first, then set customer_auth_user_id';
  END IF;

  INSERT INTO public.users (id, role)
  VALUES (v_auth_user_id, 'customer')
  ON CONFLICT (id) DO UPDATE
  SET role = 'customer';

  INSERT INTO public.customer_profiles (
    user_id,
    display_name,
    birth_date,
    gender,
    status
  )
  VALUES (
    v_auth_user_id,
    '김진우',
    DATE '1970-03-14',
    'Male',
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    birth_date   = EXCLUDED.birth_date,
    gender       = EXCLUDED.gender,
    status       = 'active',
    deleted_at   = NULL,
    updated_at   = NOW()
  RETURNING id INTO v_customer_id;

  IF v_customer_id IS NULL THEN
    SELECT cp.id INTO v_customer_id
    FROM public.customer_profiles cp
    WHERE cp.user_id = v_auth_user_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. profile_health — known disclosure: Hypertension
  -- -------------------------------------------------------------------------
  INSERT INTO public.profile_health (
    customer_id,
    medication,
    details_json,
    source
  )
  VALUES (
    v_customer_id,
    'Hypertension',
    jsonb_build_object(
      'disclosures', jsonb_build_array('Hypertension'),
      'hypertension', TRUE,
      'seed_phase', '15-1D',
      'source_reference', 'insurance_analysis_images'
    ),
    'import'
  )
  ON CONFLICT (customer_id) DO UPDATE
  SET
    medication   = EXCLUDED.medication,
    details_json = EXCLUDED.details_json,
    source       = EXCLUDED.source,
    updated_at   = NOW();
END
$seed_customer$;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Post-seed verification (read-only)
-- ---------------------------------------------------------------------------
SELECT
  jsonb_build_object(
    'carrier_active_count', (
      SELECT COUNT(*)::INTEGER FROM public.carrier_registry WHERE is_active = TRUE
    ),
    'product_active_count', (
      SELECT COUNT(*)::INTEGER FROM public.carrier_product_registry WHERE is_active = TRUE
    ),
    'customer_active_count', (
      SELECT COUNT(*)::INTEGER
      FROM public.customer_profiles
      WHERE deleted_at IS NULL AND status = 'active'
    ),
    'customer_kim_jinwoo', (
      SELECT jsonb_build_object(
        'display_name', cp.display_name,
        'birth_date', cp.birth_date,
        'gender', cp.gender,
        'status', cp.status,
        'hypertension_disclosure', ph.medication
      )
      FROM public.customer_profiles cp
      LEFT JOIN public.profile_health ph ON ph.customer_id = cp.id
      WHERE cp.display_name = '김진우'
        AND cp.birth_date = DATE '1970-03-14'
        AND cp.deleted_at IS NULL
      LIMIT 1
    ),
    'carriers_from_analysis', (
      SELECT jsonb_agg(jsonb_build_object(
        'carrier_name', cr.carrier_name,
        'carrier_type', cr.carrier_type,
        'is_active', cr.is_active
      ) ORDER BY cr.carrier_name)
      FROM public.carrier_registry cr
      WHERE cr.carrier_name IN (
        '메리츠화재', '한화손해보험', '삼성화재',
        '현대해상', 'DB손해보험', '한화생명'
      )
    ),
    'ready_for_admin_e2e_start', (
      (SELECT COUNT(*) FROM public.carrier_registry WHERE is_active = TRUE) > 0
      AND (SELECT COUNT(*) FROM public.carrier_product_registry WHERE is_active = TRUE) > 0
      AND (
        SELECT COUNT(*)
        FROM public.customer_profiles
        WHERE deleted_at IS NULL AND status = 'active'
      ) > 0
    ),
    'seed_phase', '15-1D',
    'seeded_at', NOW()
  ) AS phase15_1d_real_customer_minimal_seed_check;
