-- =============================================================================
-- LIFEGUARD Core — Apply 014 signup provision always (lifeguard-core-final)
-- Run once in Supabase SQL Editor after 013_signup_auth_bootstrap.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lifeguard_on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name    TEXT;
  v_consent_version TEXT;
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'customer')
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.users.email)
  WHERE public.users.email IS DISTINCT FROM EXCLUDED.email;

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
  'After auth.users INSERT: create public.users and provision profile/health/consents (idempotent).';

COMMIT;
