# LIFEGUARD Core — Implementation Readiness

Pre-implementation checkpoint against migrations **001–012**, [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md), [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md), and [API_FINALIZATION.md](./API_FINALIZATION.md).

**Scope:** Design readiness and recommended build order — **not** code, SQL, UI, or deployment execution in this repository path.

**Target environment:** New dedicated Supabase project for `lifeguard-core` only — never INSUX / insux-v2 / insux-pro-ai databases.

---

## 1. Readiness by domain (design vs implementation)

**Legend:** Design % = specification + SQL draft completeness for v1. Implementation % = production code/workers/API/UI in this product — currently **0%** until Phase 1+.

| Domain | 설계 | 구현 | Evidence (design) |
|--------|------|------|-------------------|
| **Schema** | 100% | 0% | `001`–`012` chain, [migrations/README.md](../supabase/migrations/README.md) |
| **Security** | 100% | 0% | `002` RLS, [API_FINALIZATION.md](./API_FINALIZATION.md) §3, worker/trace exclusion |
| **Consent** | 100% | 0% | `004`, [CONSENT_ARCHITECTURE.md](./CONSENT_ARCHITECTURE.md), revoke handlers in `010`/`011`/`012` comments |
| **Memory** | 100% | 0% | [MEMORY_BUILDER.md](./MEMORY_BUILDER.md), `001` facts |
| **Documents** | 100% | 0% | `005`, [DOCUMENT_INGEST.md](./DOCUMENT_INGEST.md), RAG RPC |
| **State** | 100% | 0% | `007`, [CUSTOMER_STATE_ENGINE.md](./CUSTOMER_STATE_ENGINE.md) |
| **Monitoring** | 100% | 0% | `008`, [LIFEGUARD_MONITORING_ENGINE.md](./LIFEGUARD_MONITORING_ENGINE.md) |
| **Notification** | 100% | 0% | `009`–`012`, [NOTIFICATION_SERVICE.md](./NOTIFICATION_SERVICE.md) |
| **Workers** | 100% | 0% | `010`–`012`, [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md) |
| **Runtime** | 100% | 0% | [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md) |
| **API** | 100% | 0% | [API_FINALIZATION.md](./API_FINALIZATION.md), [OPENAPI_DRAFT.md](./OPENAPI_DRAFT.md) |

**Aggregate:** Design **100%** for v1 specified scope · Implementation **0%** (expected before Phase 1).

**Not design-complete for implementation detail (acceptable deferrals):** OpenAPI YAML export, notification channel adapters (Kakao/SMS/email), Case Knowledge governance UI, signed-upload URL spec edge cases — called out in MVP vs 상용화 below.

---

## 2. Implementation order (phases)

| Phase | Focus | Depends on | Primary artifacts |
|-------|--------|------------|-------------------|
| **1** | Supabase apply `001→012` on **new** project; post-migration JWT tests | — | SQL Editor / CLI |
| **2** | Auth — `users`, `customer_profiles`, roles, `GET /api/me` | Phase 1 | API_FINALIZATION Auth |
| **3** | Memory Builder Worker | 2, 4 (partial) | `customer_memory_facts`, `010` jobs |
| **4** | Document Ingest Worker | 2 | `005`, storage, embed service |
| **5** | Customer State Worker | 3, 4 | `007` snapshots |
| **6** | Monitoring Worker | 5 | `008`, outbox emit |
| **7** | Outbox Worker | 6, 9 (events) | `011`, `001` outbox |
| **8** | Notification Worker | 7 | `009`, `012`, in_app first |
| **9** | Consultation Runtime API | 2–5, rules `003` | `POST .../messages` pipeline |
| **10** | Minimal Chat UI | 9 | Consultation + documents + consent screens only |

Workers **3–8** may run in parallel after Phase 2 once queue contract (`010`) is wired; logical dependency follows WORKER_ARCHITECTURE graph.

---

## 3. Prerequisites before Phase 1

| # | Prerequisite |
|---|--------------|
| 1 | Empty Supabase project provisioned (no INSUX schema) |
| 2 | `service_role` key stored in server secret manager only |
| 3 | Embedding + LLM provider accounts (server-side) |
| 4 | Object storage bucket per tenant path convention (`DOCUMENT_INGEST`) |
| 5 | Legal sign-off on `lifeguard_consent_types()` list (`004`) |
| 6 | Runbook for migration apply order and rollback (forward-only; no prod data yet) |
| 7 | CI job plan: RLS matrix tests from `002` / per-migration POST tests |
| 8 | No demo/mock/sample customer seed in repo |

---

## 4. Implementation risks

| Risk | Mitigation (design already addresses) |
|------|--------------------------------------|
| RLS misconfiguration exposes cross-tenant data | `002` policies; forbid `USING (TRUE)`; API never accepts `customer_id` from client |
| Runtime runs monitoring inline → latency + consent bugs | RUNTIME doc: enqueue only |
| LLM fills gaps when memory/RAG empty | INSUFFICIENT_EVIDENCE + sufficiency caps; CE forbidden phrases |
| `service_role` in frontend | API_FINALIZATION + WORKER_ARCHITECTURE explicit ban |
| Idempotency bugs duplicate notifications/signals | `009`/`010`/`011`/`012` unique indexes + worker comments |

---

## 5. Operational risks

| Risk | Mitigation |
|------|------------|
| Outbox/worker backlog growth | `010` poll indexes; DLQ tables; admin audit routes |
| Consent revoke without canceling jobs | Documented handlers on `010`/`011`/`012` |
| OCR/embed cost spikes | Per-customer rate limits; ingest queue |
| Trace/prompt retention compliance | Admin-only trace access; retention policy TBD at ops |
| Multi-channel notification failures | `012` attempts audit; in_app MVP first |

---

## 6. Performance considerations

| Area | Note |
|------|------|
| Runtime `POST .../messages` | Bound: RAG top-k, memory fact cap, prompt token budget in orchestrator |
| `match_customer_document_chunks` | Index `customer_id`; pgvector limits |
| State rebuild | Per-customer jobs — avoid full-table cron without shard |
| Monitoring batch | Nightly + event-driven per customer, not per message sync |
| Worker poll | Status + `scheduled_at` indexes on `010`/`009`/`011`/`012` |

---

## 7. Security considerations

| Control | Status |
|---------|--------|
| Tenant isolation | `customer_id` from JWT only |
| Agent least privilege | No health/docs/memory/traces HTTP |
| Audit without customer leak | `consultation_traces` admin-only |
| Worker plane isolation | No HTTP for `worker_jobs`, delivery runs, outbox processing |
| Case Knowledge | No `customer_id` on published cases; service_role RPC only |
| Secrets | service_role, LLM keys server-only |

---

## 8. MVP scope

Minimum product to validate **consultation + memory + documents** on real tenants (no fake corpus).

| In MVP | Out of MVP (defer) |
|--------|---------------------|
| Auth / Me, Profile (core fields) | Case extraction worker |
| Consent grant/revoke API | Kakao/SMS/email/push adapters (in_app + queued events OK) |
| Document upload + ingest worker | Full monitoring detector suite |
| Memory builder worker | Agent portal (beyond minimal assignment read) |
| Customer state worker (basic) | Case Knowledge governance UI |
| Consultation Runtime API (`POST .../messages`) | Marketing notifications |
| Rule packs from `003` seeds | Admin rule-pack editor |
| RAG when `document_analysis` + `ready` | External webhooks / integrations |
| `in_app` notifications (optional thin) | 012 provider_ref real providers |
| Minimal Chat UI (Phase 10) | Multi-region DR playbook |

**MVP worker subset:** ingest → memory → state → Runtime API; outbox enqueue stub acceptable; monitoring/notification workers **degraded or manual**.

---

## 9. Pre-production (상용화) scope

Required before general customer launch beyond pilot.

| Area | Requirement |
|------|-------------|
| **Monitoring** | Full `008` detectors + cooldown; no inline Runtime |
| **Notification** | `notification_delivery` gate; `011`→`012` chain; at least one external channel or explicit in_app-only product decision |
| **Agent workflow** | `agent_assignments`, `agent_sharing`, escalation outbox, agent summary views |
| **Case Knowledge governance** | Extraction jobs + human approval ([KNOWLEDGE_GOVERNANCE.md](./KNOWLEDGE_GOVERNANCE.md)) |
| **Operations** | DLQ replay runbook, consent revoke automation, observability on `worker_jobs` / outbox |
| **Compliance** | Trace retention, erasure pipeline hooks, consent version migrations |
| **Load testing** | Runtime p95 under agreed concurrency |
| **Security review** | RLS penetration test, secret rotation |

---

## 10. Top 5 risks (likelihood × impact)

| # | Risk | 발생 가능성 | 영향도 | 완화 전략 |
|---|------|-------------|--------|-----------|
| 1 | Cross-tenant data leak (RLS or API `customer_id` trust) | Medium | Critical | Phase 1 CI RLS matrix; API_FINALIZATION ban; code review on every query |
| 2 | LLM answer without evidence (legal/reputational) | High | High | sufficiency + INSUFFICIENT_EVIDENCE; CE guards; confidence cap; no Case fill-in |
| 3 | `service_role` exposed in client bundle | Low | Critical | Env separation; static scan; no Supabase client with service key |
| 4 | Worker/outbox backlog after consent revoke | Medium | Medium | Implement revoke cancel per `010`/`011`/`012` comments; monitor queue depth |
| 5 | Document ingest cost/latency blocks UX | High | Medium | Async ingest; status polling API; rate limits; MVP doc count caps |

---

## 11. Go / No-Go checklist

### 기술 (Technical)

| # | Check | Go criteria |
|---|-------|-------------|
| T1 | Migrations `001–012` applied on staging Supabase | All succeed in order |
| T2 | Post-migration tests per migration file executed | Pass with real JWT roles |
| T3 | `match_customer_document_chunks` returns only own tenant | Verified |
| T4 | Worker job enqueue + idempotent unique indexes | Verified on staging |
| T5 | Runtime API returns envelope + message schema | Matches API_FINALIZATION |

### 보안 (Security)

| # | Check | Go criteria |
|---|-------|-------------|
| S1 | Customer cannot SELECT `consultation_traces` | 0 rows |
| S2 | Agent cannot SELECT `customer_memory_facts`, chunks, worker/outbox tables | 0 rows |
| S3 | No `customer_id` in public API body/path for authorization | Code + contract review |
| S4 | service_role only on server/worker | Secret scan clean |
| S5 | Admin routes behind `lifeguard_is_admin()` | Verified |

### 동의 (Consent)

| # | Check | Go criteria |
|---|-------|-------------|
| C1 | `ai_consultation` blocks Runtime when missing | CONSENT_REQUIRED |
| C2 | Revoke `document_analysis` stops RAG | Empty retrieval |
| C3 | Revoke `notification_delivery` blocks send | blocked_by_consent / cancelled |
| C4 | `marketing_optional` separate from service alerts | Verified |
| C5 | consent_snapshot on trace | Field populated |

### 운영 (Operations)

| # | Check | Go criteria |
|---|-------|-------------|
| O1 | DLQ / dead_letter admin visibility | Admin SELECT works |
| O2 | Runbook for failed ingest and LLM outage | Documented |
| O3 | No demo seed in production DB | Verified |
| O4 | Backup + PITR on Supabase project | Enabled |
| O5 | Alerting on worker_jobs failed/dead_letter rate | Configured |

**No-Go if any Critical security (S1–S4) or T1/T2 fails.**

---

## 12. Design completion declaration conditions

This section defines when the **design phase** (not production launch) may be declared complete.

| # | Condition | Status |
|---|-----------|--------|
| 1 | [API_FINALIZATION.md](./API_FINALIZATION.md) completed | **Met** |
| 2 | [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md) completed (this document) | **Met** (upon acceptance of this revision) |
| 3 | Migrations **001–012** draft frozen for v1 (no conflicting follow-up edits without version bump) | **Met** (pending team sign-off on freeze) |
| 4 | No unresolved contradictions across Runtime, Workers, Consent, Monitoring, Notification docs | **Met** (Runtime async monitoring; Case secondary only; aligned in RUNTIME + API) |
| 5 | [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md) dependency graph matches `010–012` | **Met** |
| 6 | [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md) aligned with API message contract | **Met** |
| 7 | INSUX / V2 codebase not required for LIFEGUARD v1 design | **Met** |

**설계 기준 완료 선언:** **Yes — conditional on organizational sign-off** to freeze `001–012` and treat OpenAPI YAML export + channel adapters as **implementation-phase** deliverables, not design blockers.

**Production Go:** Requires §11 checklist pass after implementation — design complete ≠ launch ready.

---

## 13. References

| Document | Role |
|----------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System context |
| [DATA_MODEL.md](./DATA_MODEL.md) | Table glossary |
| [OPENAPI_DRAFT.md](./OPENAPI_DRAFT.md) | Route detail superset |
| [API_FINALIZATION.md](./API_FINALIZATION.md) | Normative v1 contract |

---

*Implementation Readiness v1 — LIFEGUARD Core.*
