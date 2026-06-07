# LIFEGUARD Core — Supabase migrations

Apply only to a **new** Supabase project dedicated to `lifeguard-core`.

```bash
# Example (Supabase CLI)
supabase db push
# or run 001_initial_schema.sql in SQL Editor
```

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Full initial schema: 14 tables, pgvector, RLS, `match_customer_document_chunks` |
| `002_rls_service_policies.sql` | Role-separated RLS (customer / agent / admin); replaces 001 coarse policies |
| `003_seed_rule_packs.sql` | Six default rule packs (v1.0.0, active); extends `rule_pack_versions` with structured fields |
| `004_customer_consents.sql` | `customer_consents` ledger, `lifeguard_has_consent`, feature consent helpers, RLS |
| `005_document_ingest_extend.sql` | Ingest statuses, `document_type`, audit tables, RAG `ready` + consent gate |
| `006_case_knowledge.sql` | `case_knowledge_items`, `case_extraction_jobs`, `match_case_knowledge` |
| `007_customer_state_snapshots.sql` | `customer_state_snapshots`, latest + agent summary views |
| `008_monitoring_signals.sql` | `customer_monitoring_signals`, `monitoring_detection_runs`, open/agent views, dismiss-only trigger, outbox comments |
| `009_notification_service.sql` | `notification_preferences`, `notification_events`, `notification_templates`, dedup index, RLS |
| `010_worker_jobs.sql` | `worker_jobs`, `worker_runs`, `retry_queue`, `dead_letter_jobs`, idempotency + consent-revoke comments |
| `011_outbox_processing.sql` | `outbox_processing_runs`, `outbox_delivery_attempts`, 001↔011 status mapping, consent/idempotency comments |
| `012_notification_delivery.sql` | `notification_delivery_runs`, `notification_delivery_attempts`, 009↔012 status mapping |

| `013_signup_auth_bootstrap.sql` | Auth trigger + signup RPC: `public.users`, `customer_profiles`, `profile_health`, `customer_consents` |

Apply in order: **001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013**.

`008` post-migration tests (SQL Editor, real JWTs — no demo seed): customer own SELECT; cross-customer 0 rows; INSERT denied; dismiss-only UPDATE; agent summary high/critical; confidence CHECK; `service_role` INSERT.

`009` post-migration tests: `notification_delivery` → `blocked_by_consent` when revoked; customer INSERT events denied; preference `enabled=false` → `blocked_by_preference`; dedup unique index; agent 0 rows on events; no demo seed.

`010` post-migration tests: customer/agent SELECT → 0 rows; admin SELECT OK; service_role enqueue; idempotent `(customer_id, job_type, source_ref)` active unique; consent revoke cancels `pending`/`queued`/`retrying`; no demo seed.

`011` post-migration tests: customer/agent SELECT → 0 rows; admin SELECT OK; UNIQUE `outbox_event_id` on runs; UNIQUE delivery target triple; consent revoke cancels `pending`/`processing`/`retrying`; no demo seed.

`012` post-migration tests: customer/agent SELECT → 0 rows; admin SELECT OK; UNIQUE `notification_event_id` (+ channel); retry via `attempt_number`; consent revoke cancels `pending`/`sending`/`retrying`; no demo seed.

**Do not** run against INSUX / insux-pro-ai databases.
