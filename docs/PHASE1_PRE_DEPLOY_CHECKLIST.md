# LIFEGUARD Core — Phase 1 Pre-Deploy Checklist

Cross-review of migrations **001–012** against design docs — **sign-off gate immediately before** first apply on a **new** Supabase project (typically **staging**).

> **이 문서는 실제 배포 전 체크리스트이며, 이 작업에서는 Supabase 생성, DB 변경, migration 실행, env 생성, config 수정이 없다.**
>
> Checking boxes in git does **not** apply SQL. Operators execute and record evidence in an internal run log.

> **⛔ STOP if target project ref is INSUX, insux-v2, or insux-pro-ai — do not `db push` or run SQL there.**

Related: [PHASE1_SUPABASE_SETUP.md](./PHASE1_SUPABASE_SETUP.md), [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md), [supabase/migrations/README.md](../supabase/migrations/README.md).

**Migration order (fixed):** `001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012`

---

## Phase 1 completion mapping (P1-1 – P1-6)

This checklist supports [PHASE1_SUPABASE_SETUP.md](./PHASE1_SUPABASE_SETUP.md) **definition of done**:

| Phase 1 ID | Criterion | Primary checklist sections |
|------------|-----------|----------------------------|
| **P1-1** | New Supabase project | §1, §2, No-Go (INSUX ref) |
| **P1-2** | 001–012 applied | §1, §7, §13 Go (기술) |
| **P1-3** | RLS tests pass | §7, §13 Go (보안) |
| **P1-4** | Consent tests pass | §8, §13 Go (동의) |
| **P1-5** | Worker / outbox / notification tests | §10, §11, §13 Go (기술/보안) |
| **P1-6** | No demo/mock/fake seed | §1, §9, §13 No-Go |

---

## 1. Pre-migration (before any SQL runs)

| # | Check | Pass | Evidence |
|---|-------|------|----------|
| 1.1 | Target project is **new** `lifeguard-core-*` (not INSUX / V2 / insux-pro-ai) | ☐ | Project ref recorded |
| 1.2 | Design freeze acknowledged — **no edits** to `001`–`012` files in repo | ☐ | Git tag / review sign-off |
| 1.3 | Migration files read end-to-end in order; no local uncommitted patches | ☐ | `git status` clean for migrations |
| 1.4 | Apply method chosen (SQL Editor per file vs CLI `db push` to correct ref only) | ☐ | Runbook step |
| 1.5 | Staging backup/PITR policy confirmed (or disposable staging acceptable) | ☐ | Dashboard |
| 1.6 | **No** demo/mock/sample/fake seed SQL in apply bundle | ☐ | Repo + operator bundle scan |
| 1.7 | `003_seed_rule_packs.sql` understood as **product rule packs only** — not customer fixtures | ☐ | Reviewer sign-off |
| 1.8 | Rollback plan: recreate staging vs forward `013+` only ([SETUP §9](./PHASE1_SUPABASE_SETUP.md)) | ☐ | Runbook |

---

## 2. Supabase project settings

| # | Check | Pass |
|---|-------|------|
| 2.1 | Correct **project ref** double-checked against internal inventory | ☐ |
| 2.2 | Region / latency acceptable for Korea-facing product | ☐ |
| 2.3 | Postgres 15+ (Supabase default) | ☐ |
| 2.4 | Connection pooling mode documented for API (transaction vs session) | ☐ |
| 2.5 | **INSUX / V2 URL** not present in operator clipboard/scripts for this run | ☐ |

---

## 3. Extensions (required by 001)

| # | Extension | Required in | Verify after 001 |
|---|-----------|-------------|------------------|
| 3.1 | `pgcrypto` | `001` | `SELECT * FROM pg_extension WHERE extname = 'pgcrypto';` |
| 3.2 | `vector` | `001` pgvector | `SELECT * FROM pg_extension WHERE extname = 'vector';` |

| # | Check | Pass |
|---|-------|------|
| 3.3 | No missing extension errors in 001 apply log | ☐ |

---

## 4. pgvector & RAG (001)

| # | Check | Pass |
|---|-------|------|
| 4.1 | Table `customer_document_chunks` has `embedding vector(...)` column | ☐ |
| 4.2 | Index `ivfflat` (or successor) on `embedding` exists | ☐ |
| 4.3 | Function `match_customer_document_chunks` exists | ☐ |
| 4.4 | RPC callable with **service_role** test (smoke) — not exposed to anon without wrapper | ☐ |
| 4.5 | Authenticated customer cannot pass another `p_customer_id` successfully (app + RPC policy) | ☐ |

---

## 5. Auth configuration

| # | Check | Pass |
|---|-------|------|
| 5.1 | Supabase Auth enabled for staging sign-in method | ☐ |
| 5.2 | `public.users` bootstrap process defined (trigger or API on signup) | ☐ |
| 5.3 | Test users planned: customer A, customer B, agent, admin — **created at test time, not repo seed** | ☐ |
| 5.4 | `users.role` ∈ `customer`, `agent`, `admin` matches `002` expectations | ☐ |
| 5.5 | `customer_profiles` row per customer test user | ☐ |

---

## 6. Storage configuration

| # | Check | Pass |
|---|-------|------|
| 6.1 | Private bucket for `customer_documents` paths (`DOCUMENT_INGEST`) | ☐ |
| 6.2 | Storage RLS / policy: tenant path includes `customer_id` | ☐ |
| 6.3 | No public bucket for PII documents | ☐ |
| 6.4 | `document_storage` consent checked before upload (app design — smoke after Phase 2) | ☐ |

*Note: 001–012 SQL does not create buckets — operator must configure.*

---

## 7. RLS verification (002 + 008–012)

Apply **after** full `001`–`012`. Use real JWTs per `002` POST checklist.

| # | Check | Pass | Ref |
|---|-------|------|-----|
| 7.1 | `FORCE ROW LEVEL SECURITY` on tenant tables including `010`–`012` | ☐ | 010–012 |
| 7.2 | Customer A: SELECT own `customer_profiles`, memory, documents | ☐ | 002 |
| 7.3 | Customer A: **0 rows** for customer B data | ☐ | 002 |
| 7.4 | Customer: **cannot** INSERT `outbox_events` | ☐ | 002 |
| 7.5 | Customer: **cannot** SELECT `consultation_traces` | ☐ | 002 |
| 7.6 | Agent: **0 rows** on `profile_health`, `customer_memory_facts`, `customer_document_chunks` | ☐ | 002 |
| 7.7 | Agent: assigned customer profile/summary routes only | ☐ | 002, 007 view |
| 7.8 | Admin: audit SELECT on outbox, traces (where policy exists) | ☐ | 002 |
| 7.9 | Customer/agent: **0 rows** on `worker_jobs`, `outbox_processing_*`, `notification_delivery_*` | ☐ | 010–012 T1–T2 |
| 7.10 | Admin: SELECT on `worker_jobs`, `outbox_processing_runs`, `notification_delivery_runs` | ☐ | 010–012 T3 |

---

## 8. Consent verification (004)

| # | Check | Pass | Ref |
|---|-------|------|-----|
| 8.1 | `lifeguard_consent_types()` matches CONSENT_ARCHITECTURE §2 | ☐ | 004 |
| 8.2 | `lifeguard_has_consent(customer_id, type)` returns expected true/false | ☐ | 004 POST |
| 8.3 | Customer INSERT/UPDATE own `customer_consents` | ☐ | 004 RLS |
| 8.4 | **Revoke test:** `revoked_at` set → `lifeguard_has_consent` false | ☐ | P1-4 |
| 8.5 | Cross-customer consent read **0 rows** | ☐ | 004 |

---

## 9. Memory verification (001 + 004)

| # | Check | Pass |
|---|-------|------|
| 9.1 | `service_role` INSERT/UPDATE `customer_memory_facts` smoke | ☐ |
| 9.2 | Customer SELECT own facts only | ☐ |
| 9.3 | `superseded_at` facts excluded from active queries | ☐ |
| 9.4 | No bulk fictional customer facts in DB after apply | ☐ |

---

## 10. Worker verification (010)

| # | Check | Pass | Ref |
|---|-------|------|-----|
| 10.1 | Tables: `worker_jobs`, `worker_runs`, `retry_queue`, `dead_letter_jobs` | ☐ | 010 |
| 10.2 | `lifeguard_worker_job_types()` includes 7 worker slugs | ☐ | 010 |
| 10.3 | Idempotent unique `(customer_id, job_type, source_ref)` active jobs | ☐ | 010 T5 |
| 10.4 | Customer/agent SELECT → 0 rows | ☐ | 010 T1–T2 |
| 10.5 | Admin SELECT OK | ☐ | 010 T3 |
| 10.6 | `service_role` INSERT job smoke | ☐ | 010 T4 |

---

## 11. Notification & outbox verification (001, 009, 011, 012)

| # | Check | Pass | Ref |
|---|-------|------|-----|
| 11.1 | `outbox_events` table + pending index (001) | ☐ | 001 |
| 11.2 | `notification_preferences`, `notification_events`, `notification_templates` (009) | ☐ | 009 |
| 11.3 | Dedup unique on `notification_events` active rows | ☐ | 009 |
| 11.4 | `outbox_processing_runs` UNIQUE `outbox_event_id` (011) | ☐ | 011 T4 |
| 11.5 | `notification_delivery_runs` UNIQUE `notification_event_id` (012) | ☐ | 012 T4 |
| 11.6 | Customer SELECT own `notification_events`; INSERT denied | ☐ | 009 |
| 11.7 | Customer/agent: 0 rows on delivery/processing audit tables | ☐ | 011–012 |
| 11.8 | Monitoring dismiss trigger/customer policy (008) if monitoring tested | ☐ | 008 |

---

## 12. Rollback readiness

| # | Check | Pass |
|---|-------|------|
| 12.1 | Staging **recreate** procedure documented if mid-chain failure | ☐ |
| 12.2 | No plan to edit `001`–`012` in place on failure | ☐ |
| 12.3 | Production PITR window known before prod apply | ☐ |
| 12.4 | Operator has rollback communication channel | ☐ |

---

## 13. Go / No-Go checklist

### Go conditions (all areas must pass for staging apply sign-off)

#### 기술 (Technical)

| # | Go when |
|---|---------|
| T-G1 | §1 pre-migration checks **1.1–1.8** pass |
| T-G2 | §3–4 extensions + pgvector + RPC smoke pass |
| T-G3 | Migrations **001→012** apply log with **zero errors** |
| T-G4 | §7 RLS matrix **7.1–7.10** pass |
| T-G5 | §9 memory **9.1–9.3** pass |
| T-G6 | §10 worker **10.1–10.6** pass |
| T-G7 | §11 notification/outbox **11.1–11.7** pass |

#### 보안 (Security)

| # | Go when |
|---|---------|
| S-G1 | **No** INSUX / V2 / insux-pro-ai project ref in target ([No-Go](#no-go-conditions) clear) |
| S-G2 | **No** `service_role` in client repos, `.env` committed, or frontend env ([No-Go](#no-go-conditions) clear) |
| S-G3 | Customer/agent isolation verified (§7.3, 7.6, 7.9) |
| S-G4 | Forbidden client writes: outbox, traces, worker tables (§7.4, 7.5, 7.9) |
| S-G5 | Admin audit paths only where designed |

#### 동의 (Consent)

| # | Go when |
|---|---------|
| C-G1 | §8 **8.1–8.5** pass including **revoke test** (8.4) |
| C-G2 | `lifeguard_has_consent` behavior matches CONSENT_ARCHITECTURE |
| C-G3 | Revoke documented for future worker cancel handlers (app Phase 3+) |

#### 운영 (Operations)

| # | Go when |
|---|---------|
| O-G1 | **P1-1** project created and inventoried |
| O-G2 | **P1-2** apply evidence archived (logs/screenshots) |
| O-G3 | **P1-6** seed hygiene confirmed |
| O-G4 | Auth + Storage §5–6 configured for next phases |
| O-G5 | Rollback §12 ready |
| O-G6 | PHASE1_SUPABASE_SETUP sign-off table completed |

---

### No-Go conditions

**Any single item below = STOP — do not mark Phase 1 complete.**

| # | No-Go trigger |
|---|----------------|
| NG-1 | **INSUX / V2 / insux-pro-ai Supabase ref** detected for this apply |
| NG-2 | **`service_role` present in client environment** (browser env, mobile config, public repo, Vite `NEXT_PUBLIC_*`) |
| NG-3 | **RLS tests not passed** (any §7 failure) |
| NG-4 | **Consent revoke test not passed** (§8.4 / C-G1 failure) |
| NG-5 | **demo / mock / sample / fake seed** exists in DB or in apply script bundle |
| NG-6 | Migration apply **out of order** or skipped file |
| NG-7 | `vector` / `pgcrypto` extension missing after 001 |
| NG-8 | Cross-tenant read reproduced in testing |
| NG-9 | Customer can SELECT `worker_jobs`, `outbox_processing_runs`, or `notification_delivery_runs` |

---

## 14. Final pre-deploy sign-off (operator)

| Step | Action |
|------|--------|
| 1 | Complete §1–12 with dated evidence |
| 2 | Confirm **no No-Go** triggers |
| 3 | All **Go** rows in §13 (기술·보안·동의·운영) checked |
| 4 | Map to **P1-1 – P1-6** complete |
| 5 | Proceed to Phase 2 (Auth API) per [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md) |

| Role | Pre-deploy approved | Date |
|------|---------------------|------|
| DBA / Platform | ☐ | |
| Backend lead | ☐ | |
| Security | ☐ | |

---

## 15. Per-migration quick reference (cross-review)

| File | Pre-deploy focus |
|------|------------------|
| 001 | Extensions, core tables, pgvector RPC, baseline RLS |
| 002 | Policy replacement — must run after 001 |
| 003 | Rule packs only — verify six slugs |
| 004 | Consent functions + RLS |
| 005 | Document columns + ingest audit tables |
| 006 | Case tables; no customer_id on published case items |
| 007 | State snapshots + views |
| 008 | Signals + dismiss trigger |
| 009 | Notification tables + preference guard |
| 010 | Worker queue + idempotency index |
| 011 | Outbox processing UNIQUE + mapping comments |
| 012 | Delivery runs + 009 status mapping |

---

*Pre-deploy checklist v1 — execute on staging before production schema apply.*
