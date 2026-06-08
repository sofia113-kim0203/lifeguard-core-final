-- =============================================================================
-- LIFEGUARD Core — 020_customer_memory_write_lockdown.sql
-- Phase 23 Step 1B: Customer Memory write lockdown
-- Requires: 001, 002, 004, 019
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
--
-- Problem:
--   customer_memory_facts allowed authenticated customers to INSERT/UPDATE/DELETE
--   own rows (002). Self-written facts enable memory self-poisoning and bypass
--   evidence-based Memory Builder provenance controls.
--
-- Fix:
--   • Drop customer INSERT / UPDATE / DELETE policies
--   • Keep customer SELECT own (active facts only: superseded_at IS NULL)
--   • Keep admin audit SELECT
--   • service_role (Memory Builder worker) continues to bypass RLS — no new
--     authenticated write policy
--
-- Explicitly out of scope:
--   • memory-builder worker implementation (Step 1C)
--   • customer_memory_registry bridge
--   • OCR / RAG / Claude / frontend changes
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- customer_memory_facts — remove customer write policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS lg_memory_facts_customer_insert_own
  ON public.customer_memory_facts;

DROP POLICY IF EXISTS lg_memory_facts_customer_update_own
  ON public.customer_memory_facts;

DROP POLICY IF EXISTS lg_memory_facts_customer_delete_own
  ON public.customer_memory_facts;

-- Narrow customer read to own active (non-superseded) facts only
DROP POLICY IF EXISTS lg_memory_facts_customer_select_own
  ON public.customer_memory_facts;

CREATE POLICY lg_memory_facts_customer_select_own ON public.customer_memory_facts
  FOR SELECT TO authenticated
  USING (
    superseded_at IS NULL
    AND public.lifeguard_is_own_customer(customer_id)
  );

-- Admin audit SELECT unchanged (includes superseded rows for investigation)
-- lg_memory_facts_admin_select_audit — retained from 002

COMMENT ON TABLE public.customer_memory_facts IS
  'Normalized customer memory for prompts; one active row per fact_key per customer. Phase 23 Step 1B: customer read-only (active facts); writes reserved for service_role Memory Builder. Facts are evidence-based — customers cannot self-write to prevent memory poisoning.';

COMMENT ON POLICY lg_memory_facts_customer_select_own ON public.customer_memory_facts IS
  'Customer may read own active memory facts (superseded_at IS NULL). No INSERT/UPDATE/DELETE — Memory Builder (service_role) writes only.';

COMMIT;

-- =============================================================================
-- POST-MIGRATION CHECKS (manual — customer JWT + service_role)
-- =============================================================================
--
-- T1: Customer A JWT — SELECT own facts where superseded_at IS NULL → OK
-- T2: Customer A JWT — SELECT superseded facts → 0 rows (hidden by policy)
-- T3: Customer A JWT — INSERT into customer_memory_facts → permission denied (42501)
-- T4: Customer A JWT — UPDATE own fact → permission denied (42501)
-- T5: Customer A JWT — DELETE own fact → permission denied (42501)
-- T6: service_role — INSERT/UPDATE customer_memory_facts for customer A → OK (RLS bypass)
-- T7: Agent JWT — SELECT customer_memory_facts → 0 rows (no agent policy)
-- T8: Admin JWT — SELECT all facts including superseded → OK
-- T9: Cross-customer SELECT → 0 rows
--
