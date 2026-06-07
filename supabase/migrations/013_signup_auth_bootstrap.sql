-- =============================================================================
-- LIFEGUARD Core — 013_signup_auth_bootstrap.sql
-- Signup persistence: auth.users → public.users + customer bootstrap.
-- Requires: 001–012 applied. Does NOT weaken RLS on tenant tables.
-- Apply to lifeguard-core-final (or any dedicated LIFEGUARD project).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared bootstrap logic (SECURITY DEFINER — bypasses RLS for provisioning)
-- ---------------------------------------------------------------------------
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
  v_customer_id       UUID;
  v_profile_created   BOOLEAN := FALSE;
  v_health_created    BOOLEAN := FALSE;
  v_consents_inserted INTEGER := 0;
  v_consent_version   TEXT;
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

  GET DIAGNOSTICS v_health_created = ROW_COUNT;
  v_health_created := v_health_created > 0;

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

-- ---------------------------------------------------------------------------
-- Auth trigger — runs on every auth.users INSERT (incl. email-confirm path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signup_complete   BOOLEAN;
  v_display_name      TEXT;
  v_consent_version   TEXT;
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'customer')
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.users.email)
  WHERE public.users.email IS DISTINCT FROM EXCLUDED.email;

  v_signup_complete := COALESCE(
    (NEW.raw_user_meta_data ->> 'signup_complete')::BOOLEAN,
    lower(COALESCE(NEW.raw_user_meta_data ->> 'signup_complete', '')) = 'true',
    FALSE
  );

  IF NOT v_signup_complete THEN
    RETURN NEW;
  END IF;

  v_display_name := NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), '');
  v_consent_version := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'signup_consent_version'), ''),
    '2026-01-01-ko'
  );

  PERFORM public.lifeguard_provision_customer_signup(
    NEW.id,
    NEW.email,
    v_display_name,
    v_consent_version
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lifeguard_on_auth_user_created() IS
  'After auth.users INSERT: create public.users; bootstrap profile/health/consents when signup_complete metadata is set.';

DROP TRIGGER IF EXISTS lifeguard_on_auth_user_created ON auth.users;

CREATE TRIGGER lifeguard_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_on_auth_user_created();

REVOKE ALL ON FUNCTION public.lifeguard_on_auth_user_created() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeguard_on_auth_user_created() TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Authenticated RPC — idempotent fallback when client has an active session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_bootstrap_customer_signup(
  p_display_name     TEXT DEFAULT NULL,
  p_consent_version  TEXT DEFAULT '2026-01-01-ko'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_email   TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT u.email
  INTO v_email
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users pu
    WHERE pu.id = v_user_id
      AND pu.role = 'customer'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN public.lifeguard_provision_customer_signup(
    v_user_id,
    v_email,
    p_display_name,
    p_consent_version
  );
END;
$$;

COMMENT ON FUNCTION public.lifeguard_bootstrap_customer_signup(TEXT, TEXT) IS
  'Customer signup bootstrap: profile, profile_health, required consents. Idempotent.';

REVOKE ALL ON FUNCTION public.lifeguard_bootstrap_customer_signup(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeguard_bootstrap_customer_signup(TEXT, TEXT) TO authenticated;

COMMIT;
