-- =============================================================================
-- LIFEGUARD Core — 023_conversational_background_analysis.sql
-- Phase 26 Step 2A: Conversational Background Analysis jobs + analysis cache
-- Requires: 016, 022
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lifeguard_analysis_job_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['queued', 'processing', 'completed', 'failed']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_analysis_job_stages()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'coverage_gap',
    'underwriting_risk',
    'recommendation',
    'insurance_design',
    'result_claude'
  ]::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- customer_analysis_cache — per-customer analysis result cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_analysis_cache (
  customer_id             UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  cache_type              TEXT NOT NULL,
  source_memory_version   INTEGER NOT NULL,
  cache_data              JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customer_analysis_cache_type_chk CHECK (
    cache_type IN ('coverage_gap', 'underwriting_risk', 'recommendation', 'insurance_design')
  ),
  PRIMARY KEY (customer_id, cache_type)
);

COMMENT ON TABLE public.customer_analysis_cache IS
  'Per-customer analysis cache keyed by memory version; used by background analysis runner.';

CREATE INDEX IF NOT EXISTS customer_analysis_cache_customer_updated_idx
  ON public.customer_analysis_cache (customer_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- analysis_jobs — conversational background analysis job queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  conversation_message_id UUID REFERENCES public.customer_conversations (id) ON DELETE SET NULL,
  question                TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'queued',
  current_step            TEXT,
  stages_completed        JSONB NOT NULL DEFAULT '[]'::JSONB,
  result_json             JSONB NOT NULL DEFAULT '{}'::JSONB,
  timing_metrics          JSONB NOT NULL DEFAULT '{}'::JSONB,
  fast_response_text      TEXT,
  final_response_text     TEXT,
  error_message           TEXT,
  source_memory_version   INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,

  CONSTRAINT analysis_jobs_status_chk CHECK (
    status = ANY (public.lifeguard_analysis_job_statuses())
  ),
  CONSTRAINT analysis_jobs_current_step_chk CHECK (
    current_step IS NULL OR current_step = ANY (public.lifeguard_analysis_job_stages())
  )
);

COMMENT ON TABLE public.analysis_jobs IS
  'Background analysis jobs triggered by customer conversational questions.';

CREATE INDEX IF NOT EXISTS analysis_jobs_customer_created_idx
  ON public.analysis_jobs (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analysis_jobs_customer_status_idx
  ON public.analysis_jobs (customer_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_analysis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_analysis_cache FORCE ROW LEVEL SECURITY;

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_customer_analysis_cache_customer_select_own
  ON public.customer_analysis_cache
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_customer_analysis_cache_admin_select
  ON public.customer_analysis_cache
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_analysis_jobs_customer_select_own
  ON public.analysis_jobs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_analysis_jobs_admin_select
  ON public.analysis_jobs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

COMMIT;
