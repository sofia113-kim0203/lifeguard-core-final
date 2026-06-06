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
