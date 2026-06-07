-- =============================================================================
-- LIFEGUARD Core — Apply 015 ROW_COUNT fix (lifeguard-core-final)
-- Run once in Supabase SQL Editor after 013/014 signup migrations.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lifeguard_provision_customer_signup(
  p_user_id          UUID,
  p_email            TEXT DEFAULT NULL,
  p_display_name     TEXT DEFAULT NULL,
  p_consent_version  TEXT DEFAULT '2026-01-01-ko'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id         UUID;
  v_profile_created     BOOLEAN := FALSE;
  v_health_created      BOOLEAN := FALSE;
  v_health_row_count    INTEGER := 0;
  v_consents_inserted   INTEGER := 0;
  v_consent_version     TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required';
  END IF;

  v_consent_version := COALESCE(NULLIF(trim(p_consent_version), ''), '2026-01-01-ko');

  INSERT INTO public.users (id, email, role)
  VALUES (p_user_id, p_email, 'customer')
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.users.email)
  WHERE public.users.email IS DISTINCT FROM EXCLUDED.email;

  INSERT INTO public.customer_profiles (user_id, display_name, status)
  VALUES (p_user_id, NULLIF(trim(p_display_name), ''), 'active')
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(
          NULLIF(trim(EXCLUDED.display_name), ''),
          public.customer_profiles.display_name
        ),
        status = 'active'
  WHERE public.customer_profiles.deleted_at IS NULL
  RETURNING id INTO v_customer_id;

  IF v_customer_id IS NULL THEN
    SELECT cp.id
    INTO v_customer_id
    FROM public.customer_profiles cp
    WHERE cp.user_id = p_user_id
      AND cp.deleted_at IS NULL
    LIMIT 1;
  ELSE
    v_profile_created := TRUE;
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_profile_provision_failed';
  END IF;

  INSERT INTO public.profile_health (customer_id, source)
  VALUES (v_customer_id, 'signup')
  ON CONFLICT (customer_id) DO NOTHING;

  GET DIAGNOSTICS v_health_row_count = ROW_COUNT;
  v_health_created := v_health_row_count > 0;

  INSERT INTO public.customer_consents (
    customer_id,
    consent_type,
    consent_version,
    granted,
    granted_at,
    source,
    purpose,
    required
  )
  VALUES
    (
      v_customer_id,
      'privacy_collection',
      v_consent_version,
      TRUE,
      NOW(),
      'signup',
      '개인정보 수집 및 이용 동의',
      TRUE
    ),
    (
      v_customer_id,
      'sensitive_health_processing',
      v_consent_version,
      TRUE,
      NOW(),
      'signup',
      '민감정보/건강정보 수집 및 이용 동의',
      TRUE
    ),
    (
      v_customer_id,
      'ai_consultation',
      v_consent_version,
      TRUE,
      NOW(),
      'signup',
      '보험분석 및 AI 상담 목적 이용 동의',
      TRUE
    )
  ON CONFLICT (customer_id, consent_type, consent_version) DO NOTHING;

  GET DIAGNOSTICS v_consents_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'customer_id', v_customer_id,
    'profile_created', v_profile_created,
    'health_created', v_health_created,
    'consents_inserted', v_consents_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.lifeguard_provision_customer_signup(UUID, TEXT, TEXT, TEXT) IS
  'Internal: provision public.users, customer_profiles, profile_health, signup consents.';

REVOKE ALL ON FUNCTION public.lifeguard_provision_customer_signup(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lifeguard_provision_customer_signup(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.lifeguard_provision_customer_signup(UUID, TEXT, TEXT, TEXT) FROM authenticated;

COMMIT;
