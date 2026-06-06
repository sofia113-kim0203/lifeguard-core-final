# LIFEGUARD Core — Phase 2+ Execution Plan

Operational plan for **actual build kickoff** after design freeze — from Supabase provisioning through minimal chat UI.

> **이 문서는 실행 계획서이다.**
>
> **이번 작업(본 문서 커밋)에서는 다음을 수행하지 않는다:**
>
> - Supabase 생성 없음  
> - DB 변경 없음  
> - migration 실행 없음  
> - 코드 작성 없음  
>
> 아래 Phase 2–14는 **별도 승인·운영 작업**에서만 실행한다.

> **⛔ Never apply LIFEGUARD migrations or `db push` to INSUX, insux-v2, or insux-pro-ai Supabase projects.**

Prerequisites docs: [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md), [PHASE1_SUPABASE_SETUP.md](./PHASE1_SUPABASE_SETUP.md), [PHASE1_PRE_DEPLOY_CHECKLIST.md](./PHASE1_PRE_DEPLOY_CHECKLIST.md), [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md), [API_FINALIZATION.md](./API_FINALIZATION.md), [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md), [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md).

---

## Actual build start conditions (gate)

**실제 구축 시작 조건 — 아래가 모두 충족된 후에만 착수한다.**

| # | Condition (필수) | Status (at plan publish) |
|---|------------------|-------------------------|
| G0-1 | **ARCHITECTURE_REVIEW** 완료 | Done (repo) |
| G0-2 | **설계 Freeze** 완료 (`001`–`012` + 규범 문서) | Done (repo) |
| G0-3 | **PHASE1_SUPABASE_SETUP** 완료 | Done (repo) |
| G0-4 | **PHASE1_PRE_DEPLOY_CHECKLIST** 완료 | Done (repo) |
| G0-5 | **Go 조건** 충족 (§9, 스테이징 증빙) | **Operator — not yet** |
| G0-6 | **No-Go 조건** 없음 (§9) | **Operator — not yet** |

Until G0-5 and G0-6 are evidenced on **staging**, do not start Phase 6+ application code in production-bound pipelines.

---

## Expected implementation order (fixed)

| Phase | Workstream | Deliverable |
|-------|------------|-------------|
| **Phase 2** | Supabase creation | New `lifeguard-core-staging` project, pgvector, Auth, Storage skeleton |
| **Phase 3** | Migration apply | `001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012` |
| **Phase 4** | RLS verification | `002` + `008`–`012` matrix pass |
| **Phase 5** | Consent verification | `004` grant/revoke + `lifeguard_has_consent` |
| **Phase 6** | Auth implementation | `GET /api/me`, signup → `users` + `customer_profiles`, JWT roles |
| **Phase 7** | Memory Builder Worker | `customer_memory_facts`, consent gate, `010` jobs |
| **Phase 8** | Document Ingest Worker | `005` pipeline, storage, chunks, embed |
| **Phase 9** | Customer State Worker | `007` snapshots |
| **Phase 10** | Monitoring Worker | `008` signals, outbox emit |
| **Phase 11** | Outbox Worker | `011` processing, `009` notification_events |
| **Phase 12** | Notification Worker | `012` delivery, `in_app` first |
| **Phase 13** | Consultation Runtime API | `POST .../messages` pipeline |
| **Phase 14** | Minimal Chat UI | Text consult + consent + document upload hooks |

Phases 7–12 may overlap after Phase 6 with separate services; **Phase 3–5 must complete before Phase 6** on staging.

---

## 1. Supabase creation procedure (Phase 2)

| Step | Action | Owner |
|------|--------|-------|
| 2.1 | Verify project name `lifeguard-core-staging` (or local dev ref) | Platform |
| 2.2 | Create project in Supabase Dashboard / org API | Platform |
| 2.3 | Record project ref, region, DB password in secret manager | Platform |
| 2.4 | Confirm **not** INSUX / V2 / insux-pro-ai ref | Security |
| 2.5 | Enable Auth providers for staging | Backend |
| 2.6 | Create **private** storage bucket for documents | Platform |
| 2.7 | Document anon URL + service_role in **internal** vault only | Platform |
| 2.8 | Optional: `supabase link` for operators | DevOps |

See [PHASE1_SUPABASE_SETUP.md](./PHASE1_SUPABASE_SETUP.md) §1–3.

---

## 2. Migration execution procedure (Phase 3)

| Step | Action |
|------|--------|
| 3.1 | Complete [PHASE1_PRE_DEPLOY_CHECKLIST.md](./PHASE1_PRE_DEPLOY_CHECKLIST.md) §1 **before** first SQL |
| 3.2 | Apply **one file per transaction** in order: |

```text
001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012
```

| Step | Action |
|------|--------|
| 3.3 | Save apply log per file (timestamp, success/fail) |
| 3.4 | On failure: **stop** — do not continue chain; invoke rollback §8 |
| 3.5 | Post-apply: verify extensions `pgcrypto`, `vector` |
| 3.6 | Confirm `003` created six rule packs — **no** customer seed rows |

Methods: SQL Editor per file **or** `supabase db push` to **lifeguard ref only**.

---

## 3. RLS verification procedure (Phase 4)

| Step | Action | Reference |
|------|--------|-----------|
| 4.1 | Create test users: customer A, B, agent, admin (manual — not repo seed) | SETUP §6 |
| 4.2 | Run `002` POST-MIGRATION TEST CHECKLIST | `002_rls_service_policies.sql` footer |
| 4.3 | Customer A cannot read B | PRE-DEPLOY §7.3 |
| 4.4 | Agent 0 rows on health, memory, chunks, traces | PRE-DEPLOY §7.6 |
| 4.5 | Customer/agent 0 rows on `worker_jobs`, `outbox_processing_*`, `notification_delivery_*` | PRE-DEPLOY §7.9 |
| 4.6 | Admin SELECT audit tables | PRE-DEPLOY §7.10 |
| 4.7 | Archive JWT test evidence | Ops |

**Pass criterion:** P1-3 / PRE-DEPLOY §13 기술·보안 Go.

---

## 4. Consent verification procedure (Phase 5)

| Step | Action | Reference |
|------|--------|-----------|
| 5.1 | Grant `ai_consultation`, `memory_retention`, `privacy_collection` for customer A | 004 |
| 5.2 | `SELECT lifeguard_has_consent(...)` true/false matrix | 004 POST |
| 5.3 | **Revoke** one type → `lifeguard_has_consent` false | PRE-DEPLOY §8.4 |
| 5.4 | Cross-customer consent SELECT → 0 | 004 |
| 5.5 | Document revoke → worker cancel handler as **Phase 7+ app requirement** | 010 header |

**Pass criterion:** P1-4 / PRE-DEPLOY 동의 Go.

---

## 5. Worker verification procedure (Phases 4–5 overlap / post-012)

Execute after Phase 3 apply; can run with Phase 4–5.

| Step | Action | Reference |
|------|--------|-----------|
| 5w.1 | `service_role` INSERT `worker_jobs` smoke | 010 T4 |
| 5w.2 | Idempotent duplicate enqueue fails/skips | 010 T5 |
| 5w.3 | `outbox_events` INSERT smoke; processing run UNIQUE | 011 T4–T5 |
| 5w.4 | `notification_events` + delivery run UNIQUE | 012 T4–T6 |
| 5w.5 | Customer/agent SELECT worker/outbox/delivery → 0 | 010–012 |

**Pass criterion:** P1-5.

---

## 6. Auth implementation order (Phase 6)

After Phases 3–5 pass on staging.

| Order | Item |
|-------|------|
| 6.1 | Supabase Auth signup / session |
| 6.2 | Bootstrap `public.users` + `customer_profiles` on first login |
| 6.3 | `GET /api/me` — envelope per [API_FINALIZATION.md](./API_FINALIZATION.md) |
| 6.4 | Role checks: `customer`, `agent`, `admin` |
| 6.5 | **Never** accept `customer_id` from body/path for authz |
| 6.6 | Middleware: resolve `lifeguard_auth_customer_id()` |
| 6.7 | Staging smoke tests with real JWT |

**Out of Phase 6:** Runtime LLM, workers, voice, household.

---

## 7. Runtime implementation order (Phase 13)

After Phases 6–9 minimum (memory + state + ingest path for RAG).

| Order | Stage |
|-------|--------|
| 7.1 | `POST /api/consultations`, list/get |
| 7.2 | `POST /api/consultations/:id/messages` — save user message |
| 7.3 | Consent Validation |
| 7.4 | Customer State load |
| 7.5 | Memory load |
| 7.6 | RAG `match_customer_document_chunks` |
| 7.7 | Rule packs + `agent_escalation_basic` |
| 7.8 | Reasoning plan + evidence confidence |
| 7.9 | Communication Engine + Output Guard |
| 7.10 | Save assistant message + `consultation_traces` (**service_role**) |
| 7.11 | Optional `outbox_events` escalation |
| 7.12 | Enqueue `worker_jobs` / outbox — **no inline monitoring** |

See [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md).

---

## 8. Rollback plan

| Scenario | Action |
|----------|--------|
| Failure during Phase 3 (single file) | Stop chain; do not apply later files; **recreate staging project** and restart 001→012 |
| Bad data on staging | Drop/recreate staging; no production customer data yet |
| Schema defect discovered | Forward migration `013+` — **do not** edit `001`–`012` |
| Wrong project targeted | Halt; verify ref; incident review |
| Production | PITR + change window per SETUP §9 |

---

## 9. Go / No-Go

### Go (all required for staging build continuation)

#### 기술

| ID | Condition |
|----|-----------|
| T-G | Phases 2–3 complete; 001–012 apply log clean |
| T-G | Phase 4 RLS pass; Phase 5 consent pass; worker table tests pass |
| T-G | pgvector + RPC smoke OK |

#### 보안

| ID | Condition |
|----|-----------|
| S-G | INSUX / V2 ref **not** used |
| S-G | service_role **not** in client artifacts |
| S-G | Cross-tenant tests pass |

#### 동의

| ID | Condition |
|----|-----------|
| C-G | Revoke test pass (Phase 5) |
| C-G | Consent helpers match CONSENT_ARCHITECTURE |

#### 운영

| ID | Condition |
|----|-----------|
| O-G | P1-1 – P1-6 evidenced ([SETUP](./PHASE1_SUPABASE_SETUP.md)) |
| O-G | PRE-DEPLOY sign-off §14 |
| O-G | G0-1 – G0-4 doc gates complete |
| O-G | No demo/mock/fake seed in staging DB |

### No-Go (any one blocks)

| ID | Condition |
|----|-----------|
| NG-1 | INSUX / V2 Supabase ref detected |
| NG-2 | service_role in client environment |
| NG-3 | RLS tests failed |
| NG-4 | Consent revoke test failed |
| NG-5 | demo / mock / sample / fake seed present |
| NG-6 | Migration out of order or partial apply without recovery plan |
| NG-7 | Customer can read worker/outbox/delivery audit tables |

---

## 10. Risk register (by category)

### 기술 (Technical)

| Risk | Mitigation |
|------|------------|
| Migration mid-chain failure | Stop; recreate staging; PRE-DEPLOY §12 |
| pgvector dimension mismatch | Lock embedding model in ingest worker config |
| Worker queue idempotency bugs | 010 unique indexes; integration tests |
| Runtime latency | Async monitoring only; RAG top-k limits |

### 보안 (Security)

| Risk | Mitigation |
|------|------------|
| Wrong Supabase project | Naming + ref checklist NG-1 |
| service_role leak | Secret manager; NG-2; static scan |
| Cross-tenant read | Phase 4 matrix |
| Trace leak to customer | service_role trace insert; RLS deny |

### 동의 (Consent)

| Risk | Mitigation |
|------|------------|
| Feature without consent | `lifeguard_has_consent` at API + workers |
| Revoke not canceling jobs | Implement 010/011/012 handlers in Phase 7+ |
| Health audio/transcript (v2) | VOICE doc — inactive v1 |

### 운영 (Operations)

| Risk | Mitigation |
|------|------------|
| No rollback runbook | §8 + SETUP |
| Staging treated as prod | Separate refs and keys |
| Operator applies 003 only and skips 002 | Fixed order Phase 3; logs |
| Missing test users | Manual create checklist §4.1 |

---

## 11. Verification sequence (summary)

```text
Pre-deploy checklist (paper) → Phase 2 Supabase → Phase 3 migrations
  → Phase 4 RLS → Phase 5 Consent (+ worker DB tests)
  → Phase 6 Auth → Phases 7–12 workers (parallel possible)
  → Phase 13 Runtime → Phase 14 UI
```

| Gate | Blocks |
|------|--------|
| PRE-DEPLOY Go | Phase 3 start |
| P1-1 – P1-6 | Phase 6 start |
| Runtime integration tests | Phase 14 start |

---

## 12. Out of scope (this execution plan cycle)

| Item | When |
|------|------|
| Voice v2 consents + API | v2 package |
| Household v2 | v2 package |
| Production cutover | After full Go on staging + security review |
| INSUX integration | Never for schema |

---

## 13. Sign-off

| Milestone | Lead | Date |
|-----------|------|------|
| Build start (G0-1 – G0-6) | ☐ | |
| Phase 3 complete | ☐ | |
| Phase 5 + 4 complete | ☐ | |
| Phase 6 Auth staging | ☐ | |
| Phase 13 Runtime staging | ☐ | |

---

*Phase 2+ Execution Plan v1 — planning document only.*
