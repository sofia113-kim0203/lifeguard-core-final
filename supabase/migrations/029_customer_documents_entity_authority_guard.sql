-- Staging-only migration. Do not apply manually to production.
-- Corporate documents require both active membership and a live corporate_documents consent.

BEGIN;

ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES public.entities(id);

CREATE OR REPLACE FUNCTION public.lifeguard_guard_customer_document_entity_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_role TEXT := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Approved workers use service_role and must keep existing ingest/finalize paths.
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'entity_document_actor_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entity_memberships membership
    WHERE membership.entity_id = NEW.entity_id
      AND membership.user_id = v_actor_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'entity_document_membership_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entity_authority_consents consent
    WHERE consent.entity_id = NEW.entity_id
      AND consent.holder_user_id = v_actor_id
      AND consent.consent_scope = 'corporate_documents'
      AND consent.status = 'active'
      AND consent.subject_user_id IS NULL
      AND consent.revoked_at IS NULL
      AND (consent.expires_at IS NULL OR consent.expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'entity_document_consent_required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_documents_entity_authority_guard ON public.customer_documents;
CREATE TRIGGER customer_documents_entity_authority_guard
  BEFORE INSERT OR UPDATE ON public.customer_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_guard_customer_document_entity_authority();

COMMIT;
