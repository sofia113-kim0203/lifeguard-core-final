-- =============================================================================
-- LIFEGUARD Core — Phase 15-1C Minimal admin E2E seed check (READ-ONLY)
-- Run in Supabase SQL Editor after phase15_1c_missing_early_rpc_patch.sql.
-- Checks carrier/product/customer prerequisites. Does not modify data by default.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed readiness check (returns one row)
-- ---------------------------------------------------------------------------
SELECT
  jsonb_build_object(
    'carrier_active_count', COALESCE(carrier_stats.active_count, 0),
    'product_active_count', COALESCE(product_stats.active_count, 0),
    'customer_active_count', COALESCE(customer_stats.active_count, 0),
    'ready_for_admin_e2e_start', (
      COALESCE(carrier_stats.active_count, 0) > 0
      AND COALESCE(product_stats.active_count, 0) > 0
      AND COALESCE(customer_stats.active_count, 0) > 0
    ),
    'missing_information',
      COALESCE(
        (
          SELECT jsonb_agg(missing_code ORDER BY missing_code)
          FROM (
            SELECT 'no_active_carrier' AS missing_code
            WHERE COALESCE(carrier_stats.active_count, 0) = 0
            UNION ALL
            SELECT 'no_active_product'
            WHERE COALESCE(product_stats.active_count, 0) = 0
            UNION ALL
            SELECT 'no_active_customer'
            WHERE COALESCE(customer_stats.active_count, 0) = 0
          ) missing_rows
        ),
        '[]'::JSONB
      ),
    'check_only', TRUE,
    'no_auto_seed', TRUE,
    'checked_at', NOW()
  ) AS minimal_admin_e2e_seed_check
FROM (
  SELECT COUNT(*)::INTEGER AS active_count
  FROM public.carrier_registry
  WHERE is_active = TRUE
) carrier_stats
CROSS JOIN (
  SELECT COUNT(*)::INTEGER AS active_count
  FROM public.carrier_product_registry
  WHERE is_active = TRUE
) product_stats
CROSS JOIN (
  SELECT COUNT(*)::INTEGER AS active_count
  FROM public.customer_profiles
  WHERE deleted_at IS NULL
    AND status = 'active'
) customer_stats;

-- ---------------------------------------------------------------------------
-- OPTIONAL test seed (DISABLED BY DEFAULT)
-- Uncomment only in non-production admin test environments.
-- Requires existing auth.users rows for customer seed.
-- ---------------------------------------------------------------------------
/*
-- Example carrier (disabled):
-- INSERT INTO public.carrier_registry (carrier_name, carrier_type, is_active)
-- VALUES ('E2E Test Carrier', 'life', TRUE)
-- ON CONFLICT DO NOTHING;

-- Example product (disabled — set carrier_id after carrier insert):
-- INSERT INTO public.carrier_product_registry (carrier_id, product_name, product_type, is_active)
-- VALUES ('<carrier_uuid>', 'E2E Test Product', 'term_life', TRUE)
-- ON CONFLICT DO NOTHING;

-- Example customer profile (disabled — requires users.id):
-- INSERT INTO public.customer_profiles (user_id, display_name, status)
-- VALUES ('<user_uuid>', 'E2E Test Customer', 'active')
-- ON CONFLICT DO NOTHING;
*/
