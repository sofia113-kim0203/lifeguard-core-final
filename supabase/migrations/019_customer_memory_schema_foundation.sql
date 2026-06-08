-- =============================================================================
-- LIFEGUARD Core — 019_customer_memory_schema_foundation.sql
-- Phase 23 Step 1A: Customer Memory schema foundation
-- Requires: 001, 002, 004
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
--
-- Adds first-class columns on customer_memory_facts for Memory Builder:
--   metadata_json, fact_type, importance, source_table
--
-- Explicitly out of scope (later steps):
--   • RLS hardening (Step 1B)
--   • memory-builder worker / extractors (Step 1C+)
--   • customer_memory_registry bridge or deprecation
--   • OCR chunk → fact copy, Claude answer → fact, claims/diagnosis codes
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- customer_memory_facts — extend columns for Memory Builder foundation
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_memory_facts
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS fact_type TEXT,
  ADD COLUMN IF NOT EXISTS importance TEXT,
  ADD COLUMN IF NOT EXISTS source_table TEXT;

COMMENT ON COLUMN public.customer_memory_facts.metadata_json IS
  'Consent metadata (consent_type, consent_version, granted_at), extractor version, and non-PII evidence summary. Required for customer-sourced facts per MEMORY_BUILDER §2.4.';

COMMENT ON COLUMN public.customer_memory_facts.fact_type IS
  'Logical grouping for prompt composition: identity, health, insurance, family, finance, claim, risk, preference, agent, system. See MEMORY_BUILDER §6.';

COMMENT ON COLUMN public.customer_memory_facts.importance IS
  'Prompt inclusion priority: critical (always), high, medium, low (trim first). See MEMORY_BUILDER §7.';

COMMENT ON COLUMN public.customer_memory_facts.source_table IS
  'Origin table name for provenance (e.g. profile_health, customer_documents). Pairs with provenance_ref (source row id).';

COMMENT ON COLUMN public.customer_memory_facts.provenance_ref IS
  'Source row UUID; use together with source_table for auditable fact lineage.';

-- importance allowed values
ALTER TABLE public.customer_memory_facts
  DROP CONSTRAINT IF EXISTS customer_memory_facts_importance_check;

ALTER TABLE public.customer_memory_facts
  ADD CONSTRAINT customer_memory_facts_importance_check CHECK (
    importance IS NULL
    OR importance IN ('critical', 'high', 'medium', 'low')
  );

-- optional fact_type taxonomy (nullable for legacy rows)
ALTER TABLE public.customer_memory_facts
  DROP CONSTRAINT IF EXISTS customer_memory_facts_fact_type_check;

ALTER TABLE public.customer_memory_facts
  ADD CONSTRAINT customer_memory_facts_fact_type_check CHECK (
    fact_type IS NULL
    OR fact_type IN (
      'identity',
      'health',
      'insurance',
      'family',
      'finance',
      'claim',
      'risk',
      'preference',
      'agent',
      'system'
    )
  );

-- ---------------------------------------------------------------------------
-- Indexes — tenant-scoped lookups for Memory Builder + orchestrator snapshot
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS customer_memory_facts_customer_fact_type_idx
  ON public.customer_memory_facts (customer_id, fact_type)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_memory_facts_customer_importance_idx
  ON public.customer_memory_facts (customer_id, importance)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_memory_facts_customer_source_table_idx
  ON public.customer_memory_facts (customer_id, source_table)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_memory_facts_metadata_json_gin_idx
  ON public.customer_memory_facts
  USING GIN (metadata_json)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE public.customer_memory_facts IS
  'Normalized customer memory for prompts; one active row per fact_key per customer. Phase 23 Step 1A: metadata_json, fact_type, importance, source_table for consent and provenance tracking.';

COMMIT;

-- =============================================================================
-- POST-MIGRATION CHECKS (manual — SQL Editor)
-- =============================================================================
--
-- T1: SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--     WHERE table_name = 'customer_memory_facts'
--       AND column_name IN ('metadata_json', 'fact_type', 'importance', 'source_table');
--     -- expect 4 rows
--
-- T2: INSERT with importance = 'invalid' → CHECK violation
--
-- T3: INSERT with fact_type = 'health', importance = 'high', metadata_json = '{"consent_type":"sensitive_health_processing"}'
--     → OK (service_role or existing RLS path)
--
-- T4: Existing rows remain valid (new columns NULL or metadata_json default '{}')
--
-- T5: \d customer_memory_facts — expect 4 new indexes on active facts
--
