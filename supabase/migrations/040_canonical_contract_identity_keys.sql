-- ===========================================================================
-- 040_canonical_contract_identity_keys.sql
-- Canonical contract SSOT lineage: document SHA + policy fact/identity keys.
-- Staging only in this GO. Production apply forbidden without separate GO.
-- ===========================================================================

BEGIN;

ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

COMMENT ON COLUMN public.customer_documents.content_sha256 IS
  'SHA-256 hex of original file bytes; lineage for vault/policy facts. Never log full value to customers.';

ALTER TABLE public.profile_insurance_policies
  ADD COLUMN IF NOT EXISTS source_content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS source_fact_key TEXT,
  ADD COLUMN IF NOT EXISTS contract_identity_key TEXT;

COMMENT ON COLUMN public.profile_insurance_policies.source_content_sha256 IS
  'Original content SHA when known; mirrors coverage_summary when present.';

COMMENT ON COLUMN public.profile_insurance_policies.source_fact_key IS
  'Idempotent extract fact key (same original + same fact). Null when weak.';

COMMENT ON COLUMN public.profile_insurance_policies.contract_identity_key IS
  'Strong contract identity only. Null when weak — never insurer+product+premium alone.';

-- Partial uniques: apply after exact-duplicate soft-delete on contaminated rows.
CREATE UNIQUE INDEX IF NOT EXISTS profile_insurance_policies_customer_source_fact_uidx
  ON public.profile_insurance_policies (customer_id, source_fact_key)
  WHERE source_fact_key IS NOT NULL
    AND deleted_at IS NULL
    AND is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS profile_insurance_policies_customer_contract_identity_uidx
  ON public.profile_insurance_policies (customer_id, contract_identity_key)
  WHERE contract_identity_key IS NOT NULL
    AND deleted_at IS NULL
    AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS customer_documents_content_sha256_idx
  ON public.customer_documents (customer_id, content_sha256)
  WHERE content_sha256 IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
