-- =============================================================================
-- LIFEGUARD Core — 024_claude_performance_optimization.sql
-- Phase 26 Step 2B: Claude result cache + performance logs
-- Requires: 023
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.claude_result_cache (
  customer_id               UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  memory_version            INTEGER NOT NULL,
  question_hash             TEXT NOT NULL,
  analysis_cache_version    TEXT NOT NULL,
  question_text             TEXT NOT NULL,
  explanation_text          TEXT NOT NULL,
  explanation_mode          TEXT NOT NULL DEFAULT 'short',
  prompt_chars              INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_chars              INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens   INTEGER NOT NULL DEFAULT 0,
  claude_time_ms            INTEGER NOT NULL DEFAULT 0,
  model_name                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, memory_version, question_hash, analysis_cache_version)
);

COMMENT ON TABLE public.claude_result_cache IS
  'Cached final Claude explanations keyed by customer, memory version, question, and analysis fingerprint.';

CREATE INDEX IF NOT EXISTS claude_result_cache_customer_updated_idx
  ON public.claude_result_cache (customer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.claude_performance_logs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id               UUID REFERENCES public.customer_profiles (id) ON DELETE SET NULL,
  endpoint                  TEXT NOT NULL,
  prompt_chars              INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_chars              INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens   INTEGER NOT NULL DEFAULT 0,
  claude_time_ms            INTEGER NOT NULL DEFAULT 0,
  cache_hit                 BOOLEAN NOT NULL DEFAULT FALSE,
  model_name                TEXT,
  analysis_job_id           UUID REFERENCES public.analysis_jobs (id) ON DELETE SET NULL,
  metadata_json             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.claude_performance_logs IS
  'Per-call Claude performance telemetry for audit and optimization.';

CREATE INDEX IF NOT EXISTS claude_performance_logs_customer_created_idx
  ON public.claude_performance_logs (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS claude_performance_logs_endpoint_created_idx
  ON public.claude_performance_logs (endpoint, created_at DESC);

ALTER TABLE public.claude_result_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_result_cache FORCE ROW LEVEL SECURITY;

ALTER TABLE public.claude_performance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_performance_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY lg_claude_result_cache_customer_select_own
  ON public.claude_result_cache
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_claude_result_cache_admin_select
  ON public.claude_result_cache
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

CREATE POLICY lg_claude_performance_logs_customer_select_own
  ON public.claude_performance_logs
  FOR SELECT TO authenticated
  USING (customer_id IS NULL OR public.lifeguard_is_own_customer(customer_id));

CREATE POLICY lg_claude_performance_logs_admin_select
  ON public.claude_performance_logs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

COMMIT;
