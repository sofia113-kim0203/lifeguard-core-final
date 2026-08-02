-- =============================================================================
-- LIFEGUARD Core — 034_key_document_memory_commits.sql
-- KEY official latest-document memory commits (SSOT for same-session follow-up)
-- Requires: 001_initial_schema.sql, 002_rls_service_policies.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.key_document_memory_commits (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version            TEXT NOT NULL DEFAULT 'key_latest_document_context_v1',
  customer_id               UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  session_id                TEXT NOT NULL,
  source_turn_id            TEXT NOT NULL,
  source_message_id         TEXT NULL,
  source_turn_ord           BIGINT NULL,
  memory_commit_id          UUID NOT NULL,
  idempotency_key           TEXT NOT NULL,
  commit_status             TEXT NOT NULL,
  memory_version            BIGINT NULL,
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at              TIMESTAMPTZ NULL,
  document_ids              UUID[] NOT NULL,
  primary_document_id       UUID NOT NULL,
  read_status               TEXT NOT NULL,
  focus_status              TEXT NOT NULL DEFAULT 'active',
  superseded_by_commit_id   UUID NULL,
  confirmation_source       TEXT NOT NULL DEFAULT 'key_claude_original_document',
  contracts                 JSONB NOT NULL DEFAULT '[]'::JSONB,
  rejected_fact_count       INTEGER NOT NULL DEFAULT 0,
  failure_code              TEXT NULL,
  failure_stage             TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT key_document_memory_commits_schema_chk
    CHECK (schema_version = 'key_latest_document_context_v1'),
  CONSTRAINT key_document_memory_commits_status_chk
    CHECK (commit_status IN ('preparing', 'committed', 'failed')),
  CONSTRAINT key_document_memory_commits_read_status_chk
    CHECK (read_status IN (
      'confirmed_facts',
      'no_confirmable_facts',
      'partial',
      'unreadable',
      'extraction_failed'
    )),
  CONSTRAINT key_document_memory_commits_focus_chk
    CHECK (focus_status IN ('active', 'superseded', 'closed')),
  CONSTRAINT key_document_memory_commits_confirmation_chk
    CHECK (confirmation_source = 'key_claude_original_document'),
  CONSTRAINT key_document_memory_commits_contracts_array_chk
    CHECK (jsonb_typeof(contracts) = 'array'),
  CONSTRAINT key_document_memory_commits_idempotency_uq
    UNIQUE (customer_id, idempotency_key),
  CONSTRAINT key_document_memory_commits_commit_id_uq
    UNIQUE (customer_id, memory_commit_id)
);

-- One committed version per customer (preparing/failed keep memory_version NULL).
CREATE UNIQUE INDEX IF NOT EXISTS key_document_memory_commits_version_uq
  ON public.key_document_memory_commits (customer_id, memory_version)
  WHERE memory_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS key_document_memory_commits_session_active_idx
  ON public.key_document_memory_commits (customer_id, session_id, commit_status, focus_status);

CREATE INDEX IF NOT EXISTS key_document_memory_commits_version_desc_idx
  ON public.key_document_memory_commits (customer_id, memory_version DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS key_document_memory_commits_source_turn_idx
  ON public.key_document_memory_commits (customer_id, source_turn_id);

CREATE INDEX IF NOT EXISTS key_document_memory_commits_primary_doc_idx
  ON public.key_document_memory_commits (primary_document_id);

CREATE INDEX IF NOT EXISTS key_document_memory_commits_idempotency_idx
  ON public.key_document_memory_commits (idempotency_key);

COMMENT ON TABLE public.key_document_memory_commits IS
  'KEY official document-read memory commits; SSOT for same-session follow-up without re-attach.';

ALTER TABLE public.key_document_memory_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_document_memory_commits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_key_document_memory_commits_select_own
  ON public.key_document_memory_commits;
CREATE POLICY lg_key_document_memory_commits_select_own
  ON public.key_document_memory_commits
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

DROP POLICY IF EXISTS lg_key_document_memory_commits_insert_own
  ON public.key_document_memory_commits;
CREATE POLICY lg_key_document_memory_commits_insert_own
  ON public.key_document_memory_commits
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
    AND customer_id = public.lifeguard_auth_customer_id()
  );

DROP POLICY IF EXISTS lg_key_document_memory_commits_update_own
  ON public.key_document_memory_commits;
CREATE POLICY lg_key_document_memory_commits_update_own
  ON public.key_document_memory_commits
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

DROP POLICY IF EXISTS lg_key_document_memory_commits_admin_select
  ON public.key_document_memory_commits;
CREATE POLICY lg_key_document_memory_commits_admin_select
  ON public.key_document_memory_commits
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Atomic commit: lock customer, assign version, supersede prior active, mark committed.
CREATE OR REPLACE FUNCTION public.lifeguard_commit_key_document_memory(
  p_customer_id UUID,
  p_memory_commit_id UUID,
  p_contracts JSONB DEFAULT '[]'::JSONB,
  p_read_status TEXT DEFAULT 'no_confirmable_facts',
  p_rejected_fact_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  ok BOOLEAN,
  memory_commit_id UUID,
  memory_version BIGINT,
  commit_status TEXT,
  already_committed BOOLEAN,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.key_document_memory_commits%ROWTYPE;
  v_next BIGINT;
  v_lock_key BIGINT;
BEGIN
  IF p_customer_id IS NULL OR p_memory_commit_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, FALSE, 'missing_ids'::TEXT;
    RETURN;
  END IF;
  IF NOT public.lifeguard_is_own_customer(p_customer_id) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, FALSE, 'ownership_denied'::TEXT;
    RETURN;
  END IF;
  IF p_read_status IS NULL OR p_read_status NOT IN (
    'confirmed_facts', 'no_confirmable_facts', 'partial', 'unreadable', 'extraction_failed'
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, FALSE, 'invalid_read_status'::TEXT;
    RETURN;
  END IF;
  IF p_contracts IS NULL OR jsonb_typeof(p_contracts) <> 'array' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, FALSE, 'invalid_contracts'::TEXT;
    RETURN;
  END IF;

  v_lock_key := hashtext(p_customer_id::TEXT)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row
  FROM public.key_document_memory_commits c
  WHERE c.customer_id = p_customer_id
    AND c.memory_commit_id = p_memory_commit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, FALSE, 'commit_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_row.commit_status = 'committed' THEN
    RETURN QUERY SELECT
      TRUE,
      v_row.memory_commit_id,
      v_row.memory_version,
      v_row.commit_status,
      TRUE,
      'already_committed'::TEXT;
    RETURN;
  END IF;

  IF v_row.commit_status = 'failed' THEN
    -- Allow retry from failed → preparing path handled by app; reject direct commit.
    NULL;
  END IF;

  SELECT COALESCE(MAX(c.memory_version), 0) + 1 INTO v_next
  FROM public.key_document_memory_commits c
  WHERE c.customer_id = p_customer_id
    AND c.memory_version IS NOT NULL;

  UPDATE public.key_document_memory_commits c
  SET
    focus_status = 'superseded',
    superseded_by_commit_id = p_memory_commit_id,
    updated_at = NOW()
  WHERE c.customer_id = p_customer_id
    AND c.session_id = v_row.session_id
    AND c.commit_status = 'committed'
    AND c.focus_status = 'active'
    AND c.memory_commit_id <> p_memory_commit_id;

  UPDATE public.key_document_memory_commits c
  SET
    commit_status = 'committed',
    memory_version = v_next,
    committed_at = NOW(),
    contracts = p_contracts,
    read_status = p_read_status,
    rejected_fact_count = GREATEST(0, COALESCE(p_rejected_fact_count, 0)),
    focus_status = 'active',
    failure_code = NULL,
    failure_stage = NULL,
    updated_at = NOW()
  WHERE c.customer_id = p_customer_id
    AND c.memory_commit_id = p_memory_commit_id;

  RETURN QUERY SELECT
    TRUE,
    p_memory_commit_id,
    v_next,
    'committed'::TEXT,
    FALSE,
    NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.lifeguard_commit_key_document_memory(UUID, UUID, JSONB, TEXT, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeguard_commit_key_document_memory(UUID, UUID, JSONB, TEXT, INTEGER)
  TO authenticated;

COMMIT;
