-- =============================================================================
-- LIFEGUARD — 039_key_qa_turn_traces.sql
-- Surgery 0: Preview QA temporary turn traces (service_role INSERT only).
-- Preview/staging Supabase only — never apply to production project.
-- TTL managed via expires_at + purge script (default 72h).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.key_qa_turn_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_trace_id text NOT NULL,
  schema_version text NOT NULL DEFAULT 'key-qa-turn-trace-v0',
  customer_id_hash text,
  session_id_hash text,
  vercel_env text,
  git_commit_sha text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  CONSTRAINT key_qa_turn_traces_turn_trace_id_uq UNIQUE (turn_trace_id)
);

CREATE INDEX IF NOT EXISTS key_qa_turn_traces_expires_at_idx
  ON public.key_qa_turn_traces (expires_at);

CREATE INDEX IF NOT EXISTS key_qa_turn_traces_customer_id_hash_idx
  ON public.key_qa_turn_traces (customer_id_hash);

COMMENT ON TABLE public.key_qa_turn_traces IS
  'Preview QA temporary turn recorder. service_role only. TTL via expires_at.';

ALTER TABLE public.key_qa_turn_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_qa_turn_traces FORCE ROW LEVEL SECURITY;

-- Deny-all for anon/authenticated. service_role bypasses RLS.
DROP POLICY IF EXISTS key_qa_turn_traces_deny_all ON public.key_qa_turn_traces;
CREATE POLICY key_qa_turn_traces_deny_all
  ON public.key_qa_turn_traces
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.key_qa_turn_traces FROM anon, authenticated;
GRANT ALL ON TABLE public.key_qa_turn_traces TO service_role;

COMMIT;
