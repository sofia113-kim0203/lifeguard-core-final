-- =============================================================================
-- E-2-2 — staging storage.objects policies (customer-documents + policy-pdfs)
-- Apply via scripts/e2-2-staging-storage-buckets.mjs on staging ref ONLY.
-- Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY.
-- Requires: storage.buckets rows exist (private), 002 RLS helpers applied.
-- Does NOT: claim-evidence, public buckets, customer access to policy-pdfs.
-- =============================================================================

-- customer-documents — customer owns first path segment = lifeguard_auth_customer_id()
DROP POLICY IF EXISTS lg_storage_customer_documents_select_own ON storage.objects;
CREATE POLICY lg_storage_customer_documents_select_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND (storage.foldername(name))[1] = public.lifeguard_auth_customer_id()::text
  );

DROP POLICY IF EXISTS lg_storage_customer_documents_insert_own ON storage.objects;
CREATE POLICY lg_storage_customer_documents_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND (storage.foldername(name))[1] = public.lifeguard_auth_customer_id()::text
  );

DROP POLICY IF EXISTS lg_storage_customer_documents_update_own ON storage.objects;
CREATE POLICY lg_storage_customer_documents_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND (storage.foldername(name))[1] = public.lifeguard_auth_customer_id()::text
  )
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND (storage.foldername(name))[1] = public.lifeguard_auth_customer_id()::text
  );

DROP POLICY IF EXISTS lg_storage_customer_documents_delete_own ON storage.objects;
CREATE POLICY lg_storage_customer_documents_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND (storage.foldername(name))[1] = public.lifeguard_auth_customer_id()::text
  );

DROP POLICY IF EXISTS lg_storage_customer_documents_admin_select ON storage.objects;
CREATE POLICY lg_storage_customer_documents_admin_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND public.lifeguard_is_admin()
  );

-- policy-pdfs — admin authenticated only; service_role bypasses RLS for workers
DROP POLICY IF EXISTS lg_storage_policy_pdfs_admin_all ON storage.objects;
CREATE POLICY lg_storage_policy_pdfs_admin_all
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'policy-pdfs'
    AND public.lifeguard_is_admin()
  )
  WITH CHECK (
    bucket_id = 'policy-pdfs'
    AND public.lifeguard_is_admin()
  );
