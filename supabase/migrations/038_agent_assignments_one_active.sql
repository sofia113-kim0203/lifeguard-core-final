-- =============================================================================
-- LIFEGUARD — 038_agent_assignments_one_active.sql
-- Enforce at most one live active agent assignment per customer.
-- Does NOT open signup UI, KEY chat consent, AgentDesk, or Preview seeds.
-- Requires: 001 (agent_assignments).
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- No seed / demo / mock rows.
-- =============================================================================

BEGIN;

-- One non-deleted active assignment per customer (admin engine + race safety).
CREATE UNIQUE INDEX IF NOT EXISTS agent_assignments_one_active_per_customer_uq
  ON public.agent_assignments (customer_id)
  WHERE status = 'active'
    AND deleted_at IS NULL;

COMMENT ON INDEX public.agent_assignments_one_active_per_customer_uq IS
  'At most one live active designer assignment per customer. '
  'pending/closed may coexist; activate must close prior active first.';

COMMIT;
