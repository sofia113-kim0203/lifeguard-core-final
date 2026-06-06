-- LIFEGUARD Core — 004_customer_consents.sql
-- Legal consent ledger per CONSENT_ARCHITECTURE.md
-- Requires: 001_initial_schema.sql, 002_rls_service_policies.sql
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake consent rows in this file.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical consent_type values (CHECK — not a separate enum type for portability)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_consent_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'service_terms',
    'privacy_collection',
    'sensitive_health_processing',
    'insurance_data_processing',
    'document_storage',
    'document_analysis',
    'ai_consultation',
    'memory_retention',
    'agent_sharing',
    'notification_delivery',
    'marketing_optional'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_consent_types() IS
  'Canonical consent_type list; must match CONSENT_ARCHITECTURE.md §2.';

-- ---------------------------------------------------------------------------
-- customer_consents
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  consent_type      TEXT NOT NULL,
  consent_version   TEXT NOT NULL,
  consent_scope     JSONB NOT NULL DEFAULT '{}'::JSONB,
  granted           BOOLEAN NOT NULL,
  granted_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  source            TEXT,
  purpose           TEXT,
  required          BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address_hash   TEXT,
  user_agent_hash   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_consents_type_chk CHECK (
    consent_type = ANY (public.lifeguard_consent_types())
  ),

  CONSTRAINT customer_consents_granted_at_chk CHECK (
    (granted = TRUE AND granted_at IS NOT NULL)
    OR (granted = FALSE)
  ),

  CONSTRAINT customer_consents_revoked_order_chk CHECK (
    revoked_at IS NULL
    OR granted_at IS NULL
    OR revoked_at >= granted_at
  ),

  CONSTRAINT customer_consents_customer_type_version_uq UNIQUE (
    customer_id,
    consent_type,
    consent_version
  )
);

COMMENT ON TABLE public.customer_consents IS
  'Per-customer legal consent grants; append-style ledger. Active = granted true AND revoked_at null.';

COMMENT ON COLUMN public.customer_consents.consent_scope IS
  'JSON purpose scope: tables, features, purposes array per CONSENT_ARCHITECTURE.';

COMMENT ON COLUMN public.customer_consents.purpose IS
  'Human-readable processing purpose label at capture time (optional).';

COMMENT ON COLUMN public.customer_consents.required IS
  'True if consent was marked required in UX at grant time (audit).';

COMMENT ON COLUMN public.customer_consents.ip_address_hash IS
  'SHA-256(ip + server salt); never store raw IP.';

COMMENT ON COLUMN public.customer_consents.source IS
  'Capture channel: signup, profile, document_upload, consultation_start, agent_connect, settings, admin.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX customer_consents_customer_id_idx
  ON public.customer_consents (customer_id);

CREATE INDEX customer_consents_consent_type_idx
  ON public.customer_consents (consent_type);

CREATE INDEX customer_consents_customer_type_idx
  ON public.customer_consents (customer_id, consent_type);

CREATE INDEX customer_consents_granted_idx
  ON public.customer_consents (granted)
  WHERE granted = TRUE;

CREATE INDEX customer_consents_revoked_at_idx
  ON public.customer_consents (revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX customer_consents_created_at_idx
  ON public.customer_consents (created_at DESC);

CREATE INDEX customer_consents_active_lookup_idx
  ON public.customer_consents (customer_id, consent_type)
  WHERE granted = TRUE AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER customer_consents_set_updated_at
  BEFORE UPDATE ON public.customer_consents
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_has_consent(
  p_customer_id   UUID,
  p_consent_type  TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_customer_id IS NOT NULL
    AND p_consent_type = ANY (public.lifeguard_consent_types())
    AND EXISTS (
      SELECT 1
      FROM public.customer_consents cc
      WHERE cc.customer_id = p_customer_id
        AND cc.consent_type = p_consent_type
        AND cc.granted = TRUE
        AND cc.revoked_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.lifeguard_has_consent(UUID, TEXT) IS
  'True when customer has at least one active grant for consent_type (granted, not revoked).';

CREATE OR REPLACE FUNCTION public.lifeguard_required_consents_for_feature(p_feature TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(trim(p_feature))
    WHEN 'memory_builder' THEN ARRAY[
      'privacy_collection',
      'sensitive_health_processing',
      'insurance_data_processing',
      'document_storage',
      'document_analysis',
      'ai_consultation',
      'memory_retention'
    ]::TEXT[]
    WHEN 'document_ingest' THEN ARRAY[
      'document_storage',
      'document_analysis'
    ]::TEXT[]
    WHEN 'rag_search' THEN ARRAY[
      'document_storage',
      'document_analysis'
    ]::TEXT[]
    WHEN 'ai_consultation' THEN ARRAY[
      'ai_consultation',
      'memory_retention',
      'privacy_collection'
    ]::TEXT[]
    WHEN 'agent_sharing' THEN ARRAY[
      'agent_sharing'
    ]::TEXT[]
    WHEN 'notification_delivery' THEN ARRAY[
      'notification_delivery'
    ]::TEXT[]
    WHEN 'marketing_optional' THEN ARRAY[
      'marketing_optional'
    ]::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;
$$;

COMMENT ON FUNCTION public.lifeguard_required_consents_for_feature(TEXT) IS
  'Feature-level consent checklist; Memory Builder still checks per-source via CONSENT_ARCHITECTURE §7.1.';

-- Optional convenience: all active consents for a customer (RLS applies to callers)
CREATE OR REPLACE VIEW public.lifeguard_active_customer_consents
WITH (security_invoker = true)
AS
SELECT
  cc.id,
  cc.customer_id,
  cc.consent_type,
  cc.consent_version,
  cc.consent_scope,
  cc.granted_at,
  cc.source,
  cc.purpose,
  cc.required,
  cc.created_at
FROM public.customer_consents cc
WHERE cc.granted = TRUE
  AND cc.revoked_at IS NULL;

COMMENT ON VIEW public.lifeguard_active_customer_consents IS
  'Active grants only; underlying table RLS still enforced for authenticated roles.';

-- ---------------------------------------------------------------------------
-- Future: consent_audit_logs (design note — not created in 004)
-- ---------------------------------------------------------------------------
-- Retain immutable append-only audit rows on every grant/revoke/scope change:
--   consent_audit_logs(id, customer_consent_id, customer_id, event, payload, created_at)
-- Enables legal hold and admin replay without mutating customer_consents history.
-- customer_consents rows are never hard-deleted by customers; revoke = revoked_at only.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_customer_consents_customer_select_own ON public.customer_consents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_customer_consents_customer_insert_own ON public.customer_consents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
    AND customer_id = public.lifeguard_auth_customer_id()
  );

CREATE POLICY lg_customer_consents_customer_update_own ON public.customer_consents
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id))
  WITH CHECK (public.lifeguard_is_own_customer(customer_id));

-- No agent SELECT/INSERT/UPDATE — designers must not read consent ledger directly.

CREATE POLICY lg_customer_consents_admin_select_audit ON public.customer_consents
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- service_role bypasses RLS for Memory Builder, revoke jobs, outbox (server env only).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual / CI — use real auth users, no demo fixtures in repo)
-- =============================================================================
--
-- --- Setup (service_role): create customer A, B; grant A sensitive_health_processing ---
-- INSERT INTO customer_consents (
--   customer_id, consent_type, consent_version, granted, granted_at, source
-- ) VALUES (
--   '<customer_a_id>', 'sensitive_health_processing', '2026-01-15-ko', true, now(), 'signup'
-- );
--
-- --- T1: Customer A reads own consents (authenticated as A) ---
-- SELECT count(*) FROM customer_consents WHERE customer_id = '<customer_a_id>';
-- -- expect >= 1
--
-- --- T2: Customer A cannot read B (authenticated as A) ---
-- SELECT count(*) FROM customer_consents WHERE customer_id = '<customer_b_id>';
-- -- expect 0
--
-- --- T3: lifeguard_has_consent without health consent (customer B) ---
-- SELECT public.lifeguard_has_consent('<customer_b_id>', 'sensitive_health_processing');
-- -- expect false
--
-- --- T4: Active grant ---
-- SELECT public.lifeguard_has_consent('<customer_a_id>', 'sensitive_health_processing');
-- -- expect true when granted=true AND revoked_at IS NULL
--
-- --- T5: Revoked grant ---
-- UPDATE customer_consents SET revoked_at = now() WHERE customer_id = '<customer_a_id>'
--   AND consent_type = 'sensitive_health_processing';
-- SELECT public.lifeguard_has_consent('<customer_a_id>', 'sensitive_health_processing');
-- -- expect false
--
-- --- T6: Agent cannot SELECT (authenticated as agent) ---
-- SELECT count(*) FROM customer_consents;
-- -- expect 0
--
-- --- T7: Admin can SELECT (authenticated as admin) ---
-- SELECT count(*) FROM customer_consents;
-- -- expect >= 0 (audit)
--
-- --- T8: Constraint — granted true requires granted_at ---
-- INSERT INTO customer_consents (customer_id, consent_type, consent_version, granted)
-- VALUES ('<customer_a_id>', 'privacy_collection', '2026-01-15-ko', true);
-- -- expect CHECK violation
--
-- --- T9: Constraint — revoked_at before granted_at ---
-- INSERT INTO customer_consents (
--   customer_id, consent_type, consent_version, granted, granted_at, revoked_at
-- ) VALUES (
--   '<customer_a_id>', 'privacy_collection', '2026-01-16-ko', true,
--   now(), now() - interval '1 day'
-- );
-- -- expect CHECK violation on revoked_order
--
-- --- T10: Feature helper ---
-- SELECT public.lifeguard_required_consents_for_feature('rag_search');
-- -- expect {document_storage, document_analysis}
--

-- =============================================================================
-- LIFEGUARD Core — 005_document_ingest_extend.sql
-- Extends document ingest schema per DOCUMENT_INGEST.md
-- Requires: 001, 002, 004 (consent helpers for RAG gate)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample document rows.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical enums (CHECK helpers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_ingest_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'uploaded',
    'queued',
    'processing',
    'ready',
    'failed',
    'analysis_blocked_by_consent',
    -- legacy 001 values kept for backward compatibility during transition
    'pending',
    'deleted'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_document_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'insurance_policy_pdf',
    'insurance_certificate',
    'insurance_terms',
    'diagnosis_certificate',
    'surgery_certificate',
    'hospitalization_record',
    'medical_receipt',
    'medical_statement',
    'health_checkup',
    'tax_or_finance_document',
    'unknown'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_ingest_statuses() IS
  'Allowed customer_documents.ingest_status values (DOCUMENT_INGEST §4).';

COMMENT ON FUNCTION public.lifeguard_document_types() IS
  'Classifier output document_type (DOCUMENT_INGEST §2).';

-- ---------------------------------------------------------------------------
-- customer_documents — extend columns & ingest_status
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS document_type     TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json     JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS customer_hint_type TEXT,
  ADD COLUMN IF NOT EXISTS classified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingest_job_id    UUID,
  ADD COLUMN IF NOT EXISTS consent_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.customer_documents.document_type IS
  'Detected type from ingest classifier; see lifeguard_document_types().';

COMMENT ON COLUMN public.customer_documents.metadata_json IS
  'OCR avg confidence, low_ocr_confidence flag, structured_extract refs — no raw PII.';

COMMENT ON COLUMN public.customer_documents.customer_hint_type IS
  'Optional type hint at upload; classifier may override document_type.';

COMMENT ON COLUMN public.customer_documents.consent_snapshot IS
  'document_storage / document_analysis consent versions at ingest start.';

-- Drop 001 ingest_status CHECK (name may vary; drop if exists)
ALTER TABLE public.customer_documents
  DROP CONSTRAINT IF EXISTS customer_documents_ingest_status_check;

ALTER TABLE public.customer_documents
  ADD CONSTRAINT customer_documents_ingest_status_check CHECK (
    ingest_status = ANY (public.lifeguard_ingest_statuses())
  );

ALTER TABLE public.customer_documents
  DROP CONSTRAINT IF EXISTS customer_documents_document_type_check;

ALTER TABLE public.customer_documents
  ADD CONSTRAINT customer_documents_document_type_check CHECK (
    document_type IS NULL
    OR document_type = ANY (public.lifeguard_document_types())
  );

-- Map legacy rows: pending → uploaded (idempotent)
UPDATE public.customer_documents
SET ingest_status = 'uploaded'
WHERE ingest_status = 'pending';

-- New default for API uploads
ALTER TABLE public.customer_documents
  ALTER COLUMN ingest_status SET DEFAULT 'uploaded';

CREATE INDEX IF NOT EXISTS customer_documents_ingest_status_idx
  ON public.customer_documents (ingest_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_documents_document_type_idx
  ON public.customer_documents (document_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_documents_ready_idx
  ON public.customer_documents (customer_id, created_at DESC)
  WHERE deleted_at IS NULL AND ingest_status = 'ready';

-- ---------------------------------------------------------------------------
-- customer_document_chunks — metadata conventions (columns unchanged in 001)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.customer_document_chunks.metadata IS
  'Ingest: token_count, ocr_confidence, detected_entities (redacted), consent_version, document_type, consent_snapshot.';

-- ---------------------------------------------------------------------------
-- RAG: only ready documents; consent gate for document_analysis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_customer_document_chunks(
  p_customer_id       UUID,
  p_query_embedding   VECTOR(1536),
  p_match_threshold   FLOAT DEFAULT 0.5,
  p_match_count       INT DEFAULT 8
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  doc_title   TEXT,
  section     TEXT,
  page        INTEGER,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.doc_title,
    c.section,
    c.page,
    c.content,
    (1 - (c.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.customer_document_chunks c
  INNER JOIN public.customer_documents d ON d.id = c.document_id
  WHERE c.customer_id = p_customer_id
    AND d.customer_id = p_customer_id
    AND c.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.ingest_status = 'ready'
    AND c.embedding IS NOT NULL
    AND public.lifeguard_has_consent(p_customer_id, 'document_analysis')
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT LEAST(p_match_count, 32);
$$;

COMMENT ON FUNCTION public.match_customer_document_chunks IS
  'Per-customer RAG; requires ready ingest_status + document_analysis consent.';

-- ---------------------------------------------------------------------------
-- document_upload_events (audit — no customer document content)
-- ---------------------------------------------------------------------------
CREATE TABLE public.document_upload_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES public.customer_documents (id) ON DELETE CASCADE,
  mime_type       TEXT,
  byte_size       BIGINT,
  ip_address_hash TEXT,
  user_agent_hash TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_upload_events IS
  'Upload audit log; metadata only — not INSUX storage.';

CREATE INDEX document_upload_events_customer_idx
  ON public.document_upload_events (customer_id, created_at DESC);

CREATE INDEX document_upload_events_document_idx
  ON public.document_upload_events (document_id);

-- ---------------------------------------------------------------------------
-- document_ingest_traces (audit — step timings, no blob content)
-- ---------------------------------------------------------------------------
CREATE TABLE public.document_ingest_traces (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  document_id        UUID NOT NULL REFERENCES public.customer_documents (id) ON DELETE CASCADE,
  ingest_job_id      UUID,
  status             TEXT NOT NULL DEFAULT 'started'
                     CHECK (status IN ('started', 'completed', 'failed')),
  ocr_confidence_avg NUMERIC(4, 3),
  chunk_count        INTEGER,
  error_code         TEXT,
  steps_json         JSONB NOT NULL DEFAULT '{}'::JSONB,
  consent_snapshot   JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_ingest_traces IS
  'Ingest pipeline audit per document; service_role writes.';

CREATE INDEX document_ingest_traces_document_idx
  ON public.document_ingest_traces (document_id, started_at DESC);

CREATE TRIGGER document_ingest_traces_set_updated_at
  BEFORE UPDATE ON public.document_ingest_traces
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: audit tables — customer own read; insert via service_role (bypass)
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_upload_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ingest_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY lg_document_upload_events_customer_select_own
  ON public.document_upload_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_ingest_traces_customer_select_own
  ON public.document_ingest_traces
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_document_ingest_traces_admin_select_audit
  ON public.document_ingest_traces
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_document_upload_events_admin_select_audit
  ON public.document_upload_events
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: no policies — cannot read ingest audit or chunks (002).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS (manual — real customer JWT + service_role worker)
-- =============================================================================
--
-- T1: INSERT customer_documents with ingest_status = uploaded (customer JWT)
-- T2: lifeguard_has_consent false → match_customer_document_chunks returns 0 rows
-- T3: ingest_status = processing → chunks excluded from RAG even if present
-- T4: ingest_status = ready + consent → RAG returns rows for that customer_id only
-- T5: document_type must be in lifeguard_document_types() or NULL
-- T6: pending legacy row migrated to uploaded
-- T7: No demo rows in document_upload_events / document_ingest_traces
--

-- =============================================================================
-- LIFEGUARD Core — 006_case_knowledge.sql
-- Case Knowledge store per CASE_KNOWLEDGE_ENGINE.md + KNOWLEDGE_GOVERNANCE.md
-- Requires: 001, 002 (admin helpers), 004 (consent snapshot pattern)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake case rows.
-- =============================================================================
--
-- PRIVACY (enforced by schema + RLS + application):
--   • case_knowledge_items MUST NOT store customer_id, names, RRN, phone,
--     address, account numbers, or document raw text.
--   • source_customer_id exists ONLY on case_extraction_jobs (admin/service_role).
--   • status = active only after deidentification_passed = true on the item.
--
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enum helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_case_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'claim_case',
    'disclosure_case',
    'coverage_case',
    'rebalancing_case',
    'underwriting_case',
    'consultation_case'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_case_knowledge_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'draft',
    'review',
    'active',
    'deprecated',
    'retired'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.lifeguard_case_types() IS
  'Allowed case_knowledge_items.case_type values.';

-- ---------------------------------------------------------------------------
-- case_knowledge_items — published store has NO customer_id column
-- ---------------------------------------------------------------------------
CREATE TABLE public.case_knowledge_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  title                   TEXT NOT NULL,
  summary                 TEXT NOT NULL,
  pattern_json            JSONB NOT NULL DEFAULT '{}'::JSONB,
  outcome_json            JSONB NOT NULL DEFAULT '{}'::JSONB,
  confidence              NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  trust_tier              TEXT NOT NULL DEFAULT 'C',
  source_count            INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  deidentification_passed BOOLEAN NOT NULL DEFAULT FALSE,
  effective_at            TIMESTAMPTZ,
  retired_at              TIMESTAMPTZ,
  case_extraction_job_id  UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT case_knowledge_items_case_type_chk CHECK (
    case_type = ANY (public.lifeguard_case_types())
  ),

  CONSTRAINT case_knowledge_items_status_chk CHECK (
    status = ANY (public.lifeguard_case_knowledge_statuses())
  ),

  CONSTRAINT case_knowledge_items_confidence_chk CHECK (
    confidence >= 0 AND confidence <= 1
  ),

  CONSTRAINT case_knowledge_items_trust_tier_chk CHECK (
    trust_tier IN ('A', 'B', 'C', 'D')
  ),

  -- de-id must pass before active/deprecated (publish gate)
  CONSTRAINT case_knowledge_items_active_deid_chk CHECK (
    status NOT IN ('active', 'deprecated')
    OR deidentification_passed = TRUE
  ),

  CONSTRAINT case_knowledge_items_active_effective_chk CHECK (
    status != 'active' OR effective_at IS NOT NULL
  )
);

COMMENT ON TABLE public.case_knowledge_items IS
  'De-identified case patterns (Tier C). NO customer_id, PII, or document bodies.';

COMMENT ON COLUMN public.case_knowledge_items.pattern_json IS
  'Structured anonymized pattern only — enums, bands, doc type lists.';

COMMENT ON COLUMN public.case_knowledge_items.outcome_json IS
  'Possibility-level outcome labels — never payout/legal certainty.';

COMMENT ON COLUMN public.case_knowledge_items.deidentification_passed IS
  'Must be true before status active; set after scanner + governance review.';

CREATE INDEX case_knowledge_items_case_type_idx
  ON public.case_knowledge_items (case_type);

CREATE INDEX case_knowledge_items_status_idx
  ON public.case_knowledge_items (status);

CREATE INDEX case_knowledge_items_active_idx
  ON public.case_knowledge_items (case_type, confidence DESC)
  WHERE status = 'active' AND retired_at IS NULL;

CREATE TRIGGER case_knowledge_items_set_updated_at
  BEFORE UPDATE ON public.case_knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

-- ---------------------------------------------------------------------------
-- case_extraction_jobs — restricted; holds source_customer_id for audit/DSR
-- ---------------------------------------------------------------------------
CREATE TABLE public.case_extraction_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_customer_id      UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  source_type             TEXT NOT NULL,
  source_ref              UUID NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'processing', 'completed', 'failed', 'blocked'
                          )),
  deidentification_status TEXT NOT NULL DEFAULT 'pending'
                          CHECK (deidentification_status IN (
                            'pending', 'passed', 'failed', 'blocked'
                          )),
  consent_snapshot        JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message           TEXT,
  result_case_knowledge_id UUID REFERENCES public.case_knowledge_items (id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.case_extraction_jobs IS
  'Links extract pipeline to source customer for erasure; NEVER exposed to agents/customers.';

COMMENT ON COLUMN public.case_extraction_jobs.source_customer_id IS
  'Audit/DSR only — not copied to case_knowledge_items.';

CREATE INDEX case_extraction_jobs_customer_idx
  ON public.case_extraction_jobs (source_customer_id, created_at DESC);

CREATE INDEX case_extraction_jobs_source_idx
  ON public.case_extraction_jobs (source_type, source_ref);

CREATE TRIGGER case_extraction_jobs_set_updated_at
  BEFORE UPDATE ON public.case_extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.lifeguard_set_updated_at();

ALTER TABLE public.case_knowledge_items
  ADD CONSTRAINT case_knowledge_items_extraction_job_fk
  FOREIGN KEY (case_extraction_job_id)
  REFERENCES public.case_extraction_jobs (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Active cases — public-safe columns only (orchestrator reads via RPC, not JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_active_case_knowledge
WITH (security_invoker = true)
AS
SELECT
  id,
  case_type,
  title,
  summary,
  confidence,
  trust_tier,
  source_count,
  effective_at,
  created_at
FROM public.case_knowledge_items
WHERE status = 'active'
  AND retired_at IS NULL;

COMMENT ON VIEW public.lifeguard_active_case_knowledge IS
  'Active anonymized cases only; no pattern_json/outcome_json. No GRANT to authenticated (see RLS).';

-- ---------------------------------------------------------------------------
-- match_case_knowledge — NO p_customer_id; active + not retired only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_case_knowledge(
  p_query_text      TEXT DEFAULT NULL,
  p_case_types      TEXT[] DEFAULT NULL,
  p_min_confidence  NUMERIC DEFAULT 0.55,
  p_match_count     INT DEFAULT 2
)
RETURNS TABLE (
  id          UUID,
  case_type   TEXT,
  title       TEXT,
  summary     TEXT,
  confidence  NUMERIC,
  trust_tier  TEXT,
  rank_score  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.case_type,
    c.title,
    c.summary,
    c.confidence,
    c.trust_tier,
    CASE
      WHEN p_query_text IS NULL OR trim(p_query_text) = '' THEN 1.0::FLOAT
      ELSE similarity(c.summary, p_query_text)::FLOAT
    END AS rank_score
  FROM public.case_knowledge_items c
  WHERE c.status = 'active'
    AND c.retired_at IS NULL
    AND c.deidentification_passed = TRUE
    AND c.confidence >= p_min_confidence
    AND (
      p_case_types IS NULL
      OR cardinality(p_case_types) = 0
      OR c.case_type = ANY (p_case_types)
    )
    AND (
      p_query_text IS NULL
      OR trim(p_query_text) = ''
      OR c.summary ILIKE '%' || replace(replace(trim(p_query_text), '%', ''), '_', '') || '%'
      OR c.title ILIKE '%' || replace(replace(trim(p_query_text), '%', ''), '_', '') || '%'
    )
  ORDER BY rank_score DESC, c.confidence DESC
  LIMIT LEAST(p_match_count, 5);
$$;

COMMENT ON FUNCTION public.match_case_knowledge IS
  'Secondary case RAG; no customer_id param. Server/service_role only — not for browser JWT.';

-- Orchestrator calls with service_role; do not expose to anon/authenticated clients.
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM anon;
REVOKE ALL ON FUNCTION public.match_case_knowledge(TEXT, TEXT[], NUMERIC, INT) FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.case_knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_knowledge_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.case_extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_extraction_jobs FORCE ROW LEVEL SECURITY;

-- Customers: NO access to case knowledge or extraction jobs.
-- Agents: NO policies (002 alignment).

CREATE POLICY lg_case_knowledge_items_admin_select ON public.case_knowledge_items
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_insert ON public.case_knowledge_items
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_update ON public.case_knowledge_items
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_case_knowledge_items_admin_delete ON public.case_knowledge_items
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_case_extraction_jobs_admin_all ON public.case_extraction_jobs
  FOR ALL TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

-- service_role bypasses RLS for publish worker after governance approval.

-- View inherits RLS on base table — no extra grants to authenticated.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: SELECT * FROM lifeguard_active_case_knowledge → only status=active, retired_at null
-- T2: UPDATE case SET status=retired, retired_at=now() → excluded from view
-- T3: Customer JWT: SELECT case_knowledge_items → 0 rows
-- T4: Agent JWT: SELECT case_extraction_jobs → 0 rows
-- T5: Admin: can SELECT/INSERT case_knowledge_items
-- T6: \d case_knowledge_items → no customer_id column
-- T7: INSERT active with deidentification_passed=false → CHECK violation
-- T8: INSERT confidence 1.5 → CHECK violation
-- T9: match_case_knowledge(...) as authenticated → permission denied (revoked)
-- T10: service_role: match_case_knowledge returns rows when active cases exist
-- T11: Repo has no demo/mock case seed SQL
--

-- =============================================================================
-- LIFEGUARD Core — 007_customer_state_snapshots.sql
-- Persisted Customer State per CUSTOMER_STATE_ENGINE.md
-- Requires: 001, 002 (agent/admin helpers), 004 (consent helpers)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake state rows.
-- =============================================================================
--
-- state_json SHOULD contain nine domain objects (each with status, summary,
-- evidence_refs, sufficiency, confidence, as_of):
--   identity_state, consent_state, health_state, insurance_state, claim_state,
--   disclosure_state, document_state, monitoring_state, advisor_state
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- customer_state_snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_state_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  state_version     TEXT NOT NULL,
  state_json        JSONB NOT NULL DEFAULT '{}'::JSONB,
  global_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.000,
  sufficiency       TEXT NOT NULL DEFAULT 'insufficient',
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::JSONB,
  consent_snapshot  JSONB NOT NULL DEFAULT '{}'::JSONB,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stale_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_state_snapshots_global_confidence_chk CHECK (
    global_confidence >= 0 AND global_confidence <= 1
  ),

  CONSTRAINT customer_state_snapshots_sufficiency_chk CHECK (
    sufficiency IN ('sufficient', 'partial', 'insufficient')
  )
);

COMMENT ON TABLE public.customer_state_snapshots IS
  'Point-in-time Customer State; canonical data remains source tables.';

COMMENT ON COLUMN public.customer_state_snapshots.state_version IS
  'Hash or semver of domain as_of timestamps + customer_profiles.memory_version.';

COMMENT ON COLUMN public.customer_state_snapshots.state_json IS
  'Nine domains — no raw document text, chunk bodies, or national IDs.';

COMMENT ON COLUMN public.customer_state_snapshots.stale_at IS
  'Set when superseded by newer snapshot or source change detected.';

CREATE INDEX customer_state_snapshots_customer_id_idx
  ON public.customer_state_snapshots (customer_id);

CREATE INDEX customer_state_snapshots_customer_calculated_idx
  ON public.customer_state_snapshots (customer_id, calculated_at DESC);

CREATE INDEX customer_state_snapshots_state_version_idx
  ON public.customer_state_snapshots (state_version);

CREATE INDEX customer_state_snapshots_stale_at_idx
  ON public.customer_state_snapshots (stale_at)
  WHERE stale_at IS NOT NULL;

CREATE INDEX customer_state_snapshots_latest_lookup_idx
  ON public.customer_state_snapshots (customer_id, calculated_at DESC)
  WHERE stale_at IS NULL;

-- ---------------------------------------------------------------------------
-- lifeguard_latest_customer_state — customer / admin (via RLS on base table)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_latest_customer_state
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (customer_id)
  id,
  customer_id,
  state_version,
  state_json,
  global_confidence,
  sufficiency,
  evidence_refs,
  consent_snapshot,
  calculated_at,
  stale_at,
  created_at
FROM public.customer_state_snapshots
WHERE stale_at IS NULL
ORDER BY customer_id, calculated_at DESC;

COMMENT ON VIEW public.lifeguard_latest_customer_state IS
  'Latest non-stale snapshot per customer; RLS applies (security_invoker).';

-- ---------------------------------------------------------------------------
-- lifeguard_agent_customer_state_summary — no health raw / document bodies
-- View runs as owner; filters by auth.uid() assignment + agent_sharing consent.
-- Agents must use this view — no SELECT policy on full state_json for agents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_agent_customer_state_summary AS
SELECT
  s.customer_id,
  s.state_version,
  s.global_confidence,
  s.sufficiency,
  s.calculated_at,
  (s.state_json -> 'identity_state' -> 'summary')   AS identity_summary,
  (s.state_json -> 'insurance_state' -> 'summary')  AS insurance_summary,
  (s.state_json -> 'document_state' -> 'summary')   AS document_summary,
  (s.state_json -> 'monitoring_state' -> 'summary') AS monitoring_summary,
  (s.state_json -> 'advisor_state' -> 'summary')    AS advisor_summary,
  (s.state_json -> 'consent_state' -> 'summary')    AS consent_summary
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    state_version,
    state_json,
    global_confidence,
    sufficiency,
    calculated_at
  FROM public.customer_state_snapshots
  WHERE stale_at IS NULL
  ORDER BY customer_id, calculated_at DESC
) s
WHERE public.lifeguard_is_agent()
  AND public.lifeguard_agent_assigned_to_customer(s.customer_id)
  AND public.lifeguard_has_consent(s.customer_id, 'agent_sharing');

COMMENT ON VIEW public.lifeguard_agent_customer_state_summary IS
  'Agent-safe subset only; excludes health_state detail and document/chunk content.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_state_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_state_snapshots FORCE ROW LEVEL SECURITY;

-- Customer: read own snapshots (latest via view recommended)
CREATE POLICY lg_customer_state_snapshots_customer_select_own
  ON public.customer_state_snapshots
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- Admin: audit all
CREATE POLICY lg_customer_state_snapshots_admin_select
  ON public.customer_state_snapshots
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_insert
  ON public.customer_state_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_update
  ON public.customer_state_snapshots
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_customer_state_snapshots_admin_delete
  ON public.customer_state_snapshots
  FOR DELETE TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: NO direct table access — use lifeguard_agent_customer_state_summary view.
-- Customers: NO access to agent view (agent_assigned_to_customer fails for customers).

-- service_role: buildCustomerState worker INSERT (bypass RLS).

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: Customer A JWT — SELECT * FROM lifeguard_latest_customer_state → A rows only
-- T2: Customer A — SELECT WHERE customer_id = B → 0 rows
-- T3: Agent unassigned — SELECT * FROM lifeguard_agent_customer_state_summary → 0
-- T4: Agent assigned + agent_sharing — view returns summary columns only (no state_json)
-- T5: Agent — SELECT * FROM customer_state_snapshots → 0 rows (no agent policy)
-- T6: INSERT global_confidence = 1.5 → CHECK fails
-- T7: INSERT sufficiency = 'unknown' → CHECK fails
-- T8: Admin — SELECT all customers
-- T9: service_role INSERT snapshot for customer A → success
-- T10: Repo — no demo/mock state seed files
--

-- =============================================================================
-- LIFEGUARD Core — 008_monitoring_signals.sql
-- Monitoring signals + detection runs per LIFEGUARD_MONITORING_ENGINE.md
-- Requires: 001, 002, 004, 007 (optional source_state_snapshot_id FK)
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock / sample / fake monitoring rows.
-- =============================================================================
--
-- OUTBOX (application / service_role after signal publish):
--   1. Check lifeguard_has_consent(customer_id, 'notification_delivery') before push.
--   2. INSERT outbox_events e.g. monitoring.signal.detected, monitoring.rebalancing.review,
--      monitoring.coverage.review, monitoring.claim.documents_ready, monitoring.disclosure.review.
--   3. signal_type = agent_escalation_needed → may also emit agent.escalation.requested
--      (payload: customer_id, signal_id, trigger_codes — no PII blob).
--   4. Customers cannot INSERT outbox rows (002).
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_signal_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'renewal_risk',
    'premium_burden',
    'coverage_gap',
    'claim_opportunity',
    'disclosure_risk',
    'family_change',
    'agent_escalation_needed',
    'consent_expiry'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_severities()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['critical', 'high', 'medium', 'low']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_monitoring_signal_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'open',
    'notified',
    'resolved',
    'dismissed',
    'expired'
  ]::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- monitoring_detection_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.monitoring_detection_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type        TEXT NOT NULL
                  CHECK (run_type IN ('scheduled', 'event', 'single_customer')),
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  customer_count  INTEGER NOT NULL DEFAULT 0 CHECK (customer_count >= 0),
  signal_count    INTEGER NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  error_message   TEXT,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.monitoring_detection_runs IS
  'Batch or per-customer detector run audit; service_role writes.';

CREATE INDEX monitoring_detection_runs_started_at_idx
  ON public.monitoring_detection_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- customer_monitoring_signals
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_monitoring_signals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  signal_type              TEXT NOT NULL,
  severity                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open',
  title                    TEXT NOT NULL,
  summary                  TEXT NOT NULL,
  evidence_refs            JSONB NOT NULL DEFAULT '[]'::JSONB,
  confidence               NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  source_state_snapshot_id UUID REFERENCES public.customer_state_snapshots (id) ON DELETE SET NULL,
  detection_run_id         UUID REFERENCES public.monitoring_detection_runs (id) ON DELETE SET NULL,
  consent_snapshot         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ,
  dismissed_at             TIMESTAMPTZ,

  CONSTRAINT customer_monitoring_signals_type_chk CHECK (
    signal_type = ANY (public.lifeguard_monitoring_signal_types())
  ),

  CONSTRAINT customer_monitoring_signals_severity_chk CHECK (
    severity = ANY (public.lifeguard_monitoring_severities())
  ),

  CONSTRAINT customer_monitoring_signals_status_chk CHECK (
    status = ANY (public.lifeguard_monitoring_signal_statuses())
  ),

  CONSTRAINT customer_monitoring_signals_confidence_chk CHECK (
    confidence >= 0 AND confidence <= 1
  ),

  CONSTRAINT customer_monitoring_signals_dismissed_chk CHECK (
    status != 'dismissed' OR dismissed_at IS NOT NULL
  ),

  CONSTRAINT customer_monitoring_signals_resolved_chk CHECK (
    status != 'resolved' OR resolved_at IS NOT NULL
  )
);

COMMENT ON TABLE public.customer_monitoring_signals IS
  'Proactive customer signals from grounded detectors; evidence_refs only — no inference.';

CREATE INDEX customer_monitoring_signals_customer_id_idx
  ON public.customer_monitoring_signals (customer_id);

CREATE INDEX customer_monitoring_signals_customer_created_idx
  ON public.customer_monitoring_signals (customer_id, created_at DESC);

CREATE INDEX customer_monitoring_signals_type_idx
  ON public.customer_monitoring_signals (signal_type);

CREATE INDEX customer_monitoring_signals_status_idx
  ON public.customer_monitoring_signals (status);

CREATE INDEX customer_monitoring_signals_open_idx
  ON public.customer_monitoring_signals (customer_id, severity)
  WHERE status IN ('open', 'notified');

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.lifeguard_open_customer_monitoring_signals
WITH (security_invoker = true)
AS
SELECT
  id,
  customer_id,
  signal_type,
  severity,
  status,
  title,
  summary,
  confidence,
  evidence_refs,
  created_at
FROM public.customer_monitoring_signals
WHERE status IN ('open', 'notified')
  AND dismissed_at IS NULL
  AND resolved_at IS NULL;

COMMENT ON VIEW public.lifeguard_open_customer_monitoring_signals IS
  'Open actionable signals; RLS applies for customer own rows.';

CREATE OR REPLACE VIEW public.lifeguard_agent_monitoring_signal_summary AS
SELECT
  s.id,
  s.customer_id,
  s.signal_type,
  s.severity,
  s.status,
  s.title,
  s.summary,
  s.confidence,
  s.created_at
FROM public.customer_monitoring_signals s
WHERE s.severity IN ('critical', 'high')
  AND s.status IN ('open', 'notified')
  AND s.dismissed_at IS NULL
  AND s.resolved_at IS NULL
  AND public.lifeguard_is_agent()
  AND public.lifeguard_agent_assigned_to_customer(s.customer_id);

COMMENT ON VIEW public.lifeguard_agent_monitoring_signal_summary IS
  'Assigned customers: high/critical open signals only; no evidence_refs dump to agents via API policy.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_monitoring_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_monitoring_signals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.monitoring_detection_runs ENABLE ROW LEVEL SECURITY;

-- Customer: SELECT own
CREATE POLICY lg_monitoring_signals_customer_select_own
  ON public.customer_monitoring_signals
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

-- Customer: dismiss only (status + dismissed_at)
CREATE POLICY lg_monitoring_signals_customer_dismiss_own
  ON public.customer_monitoring_signals
  FOR UPDATE TO authenticated
  USING (
    public.lifeguard_is_own_customer(customer_id)
    AND public.lifeguard_is_customer()
  )
  WITH CHECK (
    public.lifeguard_is_own_customer(customer_id)
    AND status = 'dismissed'
    AND dismissed_at IS NOT NULL
  );

-- No customer INSERT on signals or runs.

CREATE OR REPLACE FUNCTION public.lifeguard_customer_monitoring_dismiss_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.lifeguard_is_customer()
     AND NOT public.lifeguard_is_admin() THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
       OR NEW.severity IS DISTINCT FROM OLD.severity
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
       OR NEW.confidence IS DISTINCT FROM OLD.confidence
       OR NEW.source_state_snapshot_id IS DISTINCT FROM OLD.source_state_snapshot_id
       OR NEW.detection_run_id IS DISTINCT FROM OLD.detection_run_id
       OR NEW.consent_snapshot IS DISTINCT FROM OLD.consent_snapshot
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.status IS DISTINCT FROM 'dismissed'
       OR NEW.dismissed_at IS NULL
    THEN
      RAISE EXCEPTION 'customers may only dismiss own monitoring signals'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_monitoring_dismiss_only
  BEFORE UPDATE ON public.customer_monitoring_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.lifeguard_customer_monitoring_dismiss_only();

-- Admin
CREATE POLICY lg_monitoring_signals_admin_select
  ON public.customer_monitoring_signals
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_monitoring_signals_admin_update
  ON public.customer_monitoring_signals
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

CREATE POLICY lg_monitoring_detection_runs_admin_select
  ON public.monitoring_detection_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

-- Agents: no direct table SELECT — use lifeguard_agent_monitoring_signal_summary.

-- service_role: detector INSERT signals + runs; outbox worker.

COMMIT;

-- =============================================================================
-- POST-MIGRATION TESTS
-- =============================================================================
--
-- T1: Customer A — SELECT open signals → own rows only
-- T2: Customer A — SELECT customer_id = B → 0
-- T3: Customer A — INSERT signal → RLS violation
-- T4: Customer A — UPDATE status=dismissed, dismissed_at=now() on own row → OK
-- T5: Customer A — UPDATE title on signal → trigger 42501 (dismiss-only)
-- T6: Agent assigned — SELECT lifeguard_agent_monitoring_signal_summary → high/critical only
-- T7: Agent — SELECT customer_monitoring_signals table → 0 rows
-- T8: confidence 1.2 → CHECK fails
-- T9: Admin — SELECT/UPDATE signals
-- T10: service_role INSERT signal + optional outbox monitoring.signal.detected
-- T11: Repo — no demo monitoring seed
--

-- =============================================================================
