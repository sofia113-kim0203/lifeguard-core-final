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
