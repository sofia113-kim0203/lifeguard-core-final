# LIFEGUARD Core — Phase 1: Supabase Setup Plan

**Execution guide** for provisioning a **new, dedicated** Supabase project and applying migrations `001`–`012`.

> **This document does not perform any infrastructure action.**
>
> Creating this file in the repository **does not** create a Supabase project, apply migrations, modify any database, generate `.env` files, or change Supabase CLI config. Operators execute steps manually or via CI **after** approval, using a checklist derived from this plan.

> **⛔ NEVER run `supabase db push`, SQL migrations, or seed scripts against:**
>
> - INSUX Supabase projects  
> - insux-v2 Supabase projects  
> - insux-pro-ai Supabase projects  
>
> LIFEGUARD schema is **only** for a **new** project created under the naming rules below. Mixing projects risks data corruption and regulatory breach.

Related: [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md) Phase 1, [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md), [supabase/migrations/README.md](../supabase/migrations/README.md), `002_rls_service_policies.sql` post-test checklists.

---

## Phase 1 completion criteria (definition of done)

Phase 1 is **complete** when **all** of the following are true on **staging** (production may follow same steps later with stricter change control):

| # | Criterion |
|---|-----------|
| P1-1 | **New** Supabase project exists (not shared with INSUX / V2 / insux-pro-ai) |
| P1-2 | Migrations **001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012** applied successfully on staging |
| P1-3 | **RLS tests** pass (customer / agent / admin matrix per `002` and per-file POST tests) |
| P1-4 | **Consent tests** pass (`lifeguard_has_consent`, grant/revoke, customer policies on `004`) |
| P1-5 | **Worker / outbox / notification** access tests pass (customer & agent **0 rows** on `010`–`012`; admin SELECT; `service_role` smoke) |
| P1-6 | **No** demo / mock / sample / fake seed data in staging DB or repo SQL |

Until P1-1–P1-6 pass, **구현 착수 GO** for Phase 2+ remains **NO-GO** per [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md).

---

## 1. New Supabase project — creation order

Execute in order (operators / platform team):

| Step | Action |
|------|--------|
| 1.1 | Confirm **greenfield** project — no existing INSUX-linked schema |
| 1.2 | Create Supabase organization project (Dashboard or org API) |
| 1.3 | Record **project ref**, region, Postgres version (15+; match Supabase default) |
| 1.4 | Enable **Row Level Security** default mindset — all tenant tables use RLS from `001`/`002` |
| 1.5 | Enable **pgvector** extension (required by `001` for `customer_document_chunks`) |
| 1.6 | Create **storage bucket(s)** for document ingest (name TBD in implementation; not in 001–012 SQL) |
| 1.7 | Configure **Auth** providers needed for staging (email magic link / password — product choice) |
| 1.8 | Store credentials in secret manager — **not** in git |
| 1.9 | Link local CLI: `supabase link --project-ref <ref>` (optional, on operator machine only) |
| 1.10 | Document connection strings in **internal** runbook only (no committed `.env`) |

**Do not** clone or fork an INSUX project snapshot.

---

## 2. Project naming rules

| Environment | Pattern | Example |
|-------------|---------|---------|
| **local** | `lifeguard-core-local-<developer>` or CLI linked to disposable branch DB | `lifeguard-core-local-dev1` |
| **staging** | `lifeguard-core-staging` | `lifeguard-core-staging` |
| **production** | `lifeguard-core-prod` | `lifeguard-core-prod` |

| Rule | Detail |
|------|--------|
| Prefix | Always `lifeguard-core-` |
| Suffix | Environment slug; no `insux` / `insux2` in name |
| Ref IDs | Record in internal inventory spreadsheet |
| Keys | Separate anon + service_role per environment |

---

## 3. Environment separation policy

| Environment | Purpose | Data | Migrations |
|-------------|---------|------|------------|
| **local** | Developer schema check, optional `supabase start` | Synthetic test users created ad hoc — **not** committed fixtures | Apply 001–012 on branch DB or linked dev project |
| **staging** | CI RLS tests, integration, Phase 1 **Done** target | Realistic test accounts — **no** demo marketing narratives; no bulk fake policies | 001–012; forward-only |
| **production** | Live customers | Production data only | Same order; change window + backup |

| Policy | Rule |
|--------|------|
| Isolation | **Never** point staging/prod API at INSUX Supabase URL |
| Promotion | Schema changes only via new migration files `013+`, not editing `001`–`012` |
| Data | No copy-paste of INSUX customer rows into LIFEGUARD |
| Keys | Staging keys must not work against production ref |

---

## 4. `service_role` security principles

| # | Rule |
|---|------|
| SR-1 | Used **only** on server runtime, background workers, CI migration job (if approved) |
| SR-2 | **Never** embed in web, mobile, Electron, or Vite bundles |
| SR-3 | **Never** expose via customer-facing API responses or logs |
| SR-4 | Bypasses RLS — code must enforce `customer_id` in application logic |
| SR-5 | Rotate on compromise; separate key per environment |
| SR-6 | Workers: memory, ingest, state, monitoring, outbox, notification per [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md) |

---

## 5. `anon` key security principles

| # | Rule |
|---|------|
| AN-1 | Used in browser/app with **authenticated user JWT** (Supabase Auth session) |
| AN-2 | All customer data access goes through **RLS** — not service_role |
| AN-3 | **Forbidden:** client INSERT on `outbox_events`, `worker_jobs`, `consultation_traces`, `010`–`012` tables |
| AN-4 | **Forbidden:** client direct calls that impersonate another `customer_id` |
| AN-5 | Prefer Edge/API layer for orchestration that needs service_role |

---

## 6. JWT and role structure

| Layer | Source |
|-------|--------|
| Auth identity | `auth.users.id` = `public.users.id` |
| App role | `public.users.role` ∈ `customer`, `agent`, `admin` (`001`) |
| Tenant | `customer_profiles.user_id` → `customer_profiles.id` = `customer_id` everywhere |
| Helpers | `lifeguard_auth_customer_id()`, `lifeguard_is_admin()`, `lifeguard_is_agent()`, `lifeguard_is_own_customer()` (`002`) |

| Role | Staging test users (create manually — **not** repo seed) |
|------|-----------------------------------------------------------|
| `customer` | At least two profiles A/B for cross-tenant RLS |
| `agent` | One agent assigned to A only |
| `admin` | One admin for audit SELECT on worker/outbox/delivery |

JWT custom claims are **optional** in v1; role is read from `users` table per `002` design.

---

## 7. Migration apply order (fixed)

Apply **exactly** this sequence on each new environment:

```text
001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012
```

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Core 14 tables, pgvector, baseline RLS |
| `002_rls_service_policies.sql` | Customer/agent/admin policies |
| `003_seed_rule_packs.sql` | Six rule packs (normative product seed — not fake customers) |
| `004_customer_consents.sql` | Consents + `lifeguard_has_consent` |
| `005_document_ingest_extend.sql` | Ingest statuses, audit tables |
| `006_case_knowledge.sql` | Case knowledge + extraction jobs |
| `007_customer_state_snapshots.sql` | State snapshots + views |
| `008_monitoring_signals.sql` | Monitoring signals + runs |
| `009_notification_service.sql` | Notification preferences/events/templates |
| `010_worker_jobs.sql` | Worker queue |
| `011_outbox_processing.sql` | Outbox processing audit |
| `012_notification_delivery.sql` | Notification delivery audit |

**Methods (operator choice):**

- Supabase SQL Editor: run each file end-to-end in order, or  
- `supabase db push` **only** against the **lifeguard-core-*** project ref, or  
- CI pipeline applying concatenated migration with transaction per file.

**Do not** skip, reorder, or merge files without a new engineering change request.

---

## 8. Post-apply verification order

Run after **full** 001–012 apply on staging.

### 8.1 Schema

| Check | How |
|-------|-----|
| Tables exist | `\dt public.*` — include `customer_consents`, `worker_jobs`, `outbox_processing_runs`, `notification_delivery_runs` |
| Extensions | `vector` enabled |
| Functions | `lifeguard_has_consent`, `lifeguard_worker_job_types`, etc. |
| Indexes | Pending outbox index, worker poll indexes |

### 8.2 RLS

| Check | Reference |
|-------|-----------|
| Customer A cannot read B rows | `002` POST checklist |
| Agent blocked on health, memory, chunks, traces | `002` FORBIDDEN patterns |
| Force RLS on tenant tables | `010`–`012` FORCE RLS |

### 8.3 Consent

| Check | Reference |
|-------|-----------|
| Grant + `lifeguard_has_consent` true | `004` POST tests |
| Revoke blocks feature | CONSENT_ARCHITECTURE §6 |
| Customer cannot INSERT foreign consent | RLS |

### 8.4 Memory

| Check | Reference |
|-------|-----------|
| service_role can upsert facts | MEMORY_BUILDER (smoke) |
| Customer SELECT own facts only | `002` |
| Superseded facts excluded | `superseded_at` |

### 8.5 Worker / outbox / notification

| Check | Reference |
|-------|-----------|
| Customer/agent SELECT `worker_jobs` → 0 | `010` T1–T2 |
| Admin SELECT OK | `010` T3 |
| `outbox_processing_runs` idempotent unique | `011` T4–T5 |
| `notification_delivery_runs` customer 0 rows | `012` T1–T2 |
| service_role INSERT smoke | `010` T4, `011`/`012` comments |

### 8.6 Seed hygiene

| Check | How |
|-------|-----|
| Only `003` rule packs in DB | No customer/document/message demo rows |
| Repo scan | No `demo`/`mock`/`sample` SQL seed files added |

---

## 9. Rollback strategy

| Scenario | Strategy |
|----------|----------|
| **Failed mid-migration** | Do not leave partial manual state undocumented. Prefer: **reset staging project** (destroy + recreate) and re-apply 001→012 from clean slate |
| **Bad migration already committed** | Forward-fix with **`013_*.sql`** — **do not** edit `001`–`012` files (design freeze) |
| **Staging data pollution** | Truncate or recreate project; no production customer data in staging yet |
| **Production incident** | Supabase PITR (if enabled); restore to pre-migration timestamp; runbook escalation |
| **Wrong project targeted** | Immediate stop; verify project ref; never run against INSUX |

| Anti-pattern | Why |
|--------------|-----|
| Revert by editing old migration files | Breaks freeze and replay |
| `DROP DATABASE` on shared INSUX | Catastrophic — use project isolation |

---

## 10. Security checklist (Phase 1 gate)

| # | Item | Pass |
|---|------|------|
| S1 | Project name matches `lifeguard-core-*` | ☐ |
| S2 | INSUX/V2/insux-pro-ai URL not in any LIFEGUARD config | ☐ |
| S3 | service_role not in client repo | ☐ |
| S4 | anon key only in client with RLS | ☐ |
| S5 | RLS tests P1-3 | ☐ |
| S6 | Consent tests P1-4 | ☐ |
| S7 | Worker/outbox/notification tests P1-5 | ☐ |
| S8 | No demo seed P1-6 | ☐ |
| S9 | `003` rule packs present; no fictional customer bulk load | ☐ |
| S10 | Migration order 001→012 verified in apply log | ☐ |

---

## 11. What Phase 1 does **not** include

| Out of scope | Phase |
|--------------|-------|
| Application server / API implementation | Phase 2+ |
| Worker process deployment | Phase 3–8 |
| Runtime `POST .../messages` | Phase 9 |
| UI | Phase 10 |
| Voice / Household v2 migrations | v2 package |
| Production launch | After full readiness Go/No-Go |

---

## 12. Sign-off

| Role | Phase 1 complete (P1-1–P1-6) |
|------|------------------------------|
| Platform / DBA | ☐ |
| Backend lead | ☐ |
| Security | ☐ |

---

*Phase 1 Supabase Setup Plan — execution guide only; no infra changes from documentation commit.*
