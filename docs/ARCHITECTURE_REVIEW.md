# LIFEGUARD Core — Architecture Review

Cross-review of the **completed v1 design package** (migrations `001`–`012` and listed engine documents). Read-only audit — no schema or narrative doc edits in this pass.

**Review date:** Design package as frozen in repository. **Reviewer role:** Consolidated checklist for program sign-off.

**Scope documents:**

| Area | Artifacts |
|------|-----------|
| Schema | `001`–`012` ([migrations/README.md](../supabase/migrations/README.md)) |
| Memory / consent / ingest | [MEMORY_BUILDER.md](./MEMORY_BUILDER.md), [CONSENT_ARCHITECTURE.md](./CONSENT_ARCHITECTURE.md), [DOCUMENT_INGEST.md](./DOCUMENT_INGEST.md) |
| State / case / governance | [CUSTOMER_STATE_ENGINE.md](./CUSTOMER_STATE_ENGINE.md), [CASE_KNOWLEDGE_ENGINE.md](./CASE_KNOWLEDGE_ENGINE.md), [KNOWLEDGE_GOVERNANCE.md](./KNOWLEDGE_GOVERNANCE.md) |
| Async | [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md), [LIFEGUARD_MONITORING_ENGINE.md](./LIFEGUARD_MONITORING_ENGINE.md), [NOTIFICATION_SERVICE.md](./NOTIFICATION_SERVICE.md) |
| Runtime / API | [CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md), [CONSULTATION_ORCHESTRATOR.md](./CONSULTATION_ORCHESTRATOR.md), [LIFEGUARD_REASONING_ENGINE.md](./LIFEGUARD_REASONING_ENGINE.md), [API_FINALIZATION.md](./API_FINALIZATION.md), [OPENAPI_DRAFT.md](./OPENAPI_DRAFT.md) |
| Readiness / extensions | [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md), [VOICE_CONVERSATION.md](./VOICE_CONVERSATION.md), [FAMILY_ARCHITECTURE.md](./FAMILY_ARCHITECTURE.md), [COMMUNICATION_ENGINE.md](./COMMUNICATION_ENGINE.md) |

**Out of scope for this review:** INSUX / insux-v2 / insux-pro-ai codebases, running Supabase projects, implemented services.

---

## 1. Design conflict check (4-tier)

| Severity | Definition |
|----------|------------|
| **없음** | Aligned or explicitly layered (v1 vs v2) |
| **경미** | Wording, index doc drift, duplicate narrative — no wrong behavior if implementers follow normative docs |
| **중요** | Two normative docs disagree; implementer could build wrong path without clarification |
| **치명적** | Security/tenant/consent contradiction — must fix before freeze |

### Findings

| ID | Topic | Severity | Resolution |
|----|-------|----------|------------|
| C1 | Runtime **must not** run monitoring inline vs MONITORING/WORKER async | **없음** | RUNTIME §2.2 + MONITORING + WORKER agree: enqueue only |
| C2 | `outbox_events.status` (001) vs `outbox_processing_runs.status` (011) | **없음** | 011 mapping table; distinct state machines |
| C3 | `notification_events.status` (009) vs `notification_delivery_runs.status` (012) | **없음** | 012 mapping table |
| C4 | Voice / Household active in MVP vs DB | **없음** | VOICE + FAMILY state **v1 inactive**, v2 migration |
| C5 | Case Knowledge vs customer memory | **없음** | CASE + FAMILY §10 + RUNTIME: separate planes |
| C6 | Customer JWT on worker/outbox/delivery tables | **없음** | 010–012 no customer policies; API_FINALIZATION §15 |
| C7 | [OPENAPI_DRAFT.md](./OPENAPI_DRAFT.md) vs [API_FINALIZATION.md](./API_FINALIZATION.md) envelope | **경미** | FINALIZATION is normative; OPENAPI is superset draft |
| C8 | [DATA_MODEL.md](./DATA_MODEL.md) / [ARCHITECTURE.md](./ARCHITECTURE.md) omit `007`–`012` | **경미** | migrations README + IMPLEMENTATION_READINESS are current; risk if team reads only DATA_MODEL |
| C9 | [CONSULTATION_ORCHESTRATOR.md](./CONSULTATION_ORCHESTRATOR.md) inline sequence vs RUNTIME 9-stage | **경미** | Same pipeline, different granularity — RUNTIME + FINALIZATION win for v1 build |
| C10 | `consents` alias in DATA_MODEL ER vs `customer_consents` (004) | **경미** | Table name is `customer_consents` in SQL |
| C11 | `knowledge_sources` “future table” vs 006 case tables | **없음** | Governance doc defers registry; case path defined in 006 |

**Conflict summary:** **0 치명적**, **0 중요**, **4 경미**, remainder **없음**.

---

## 2. Design gap check (v1 vs v2)

### v1 scope gaps (should be closed before or during Phase 1–9 implementation)

| ID | Gap | Severity | Mitigation |
|----|-----|----------|------------|
| G1 | `DATA_MODEL.md` / `ARCHITECTURE.md` not updated for `004`–`012` | Doc | Point implementers to migrations README + FINALIZATION (no SQL change required) |
| G2 | OpenAPI YAML export | Process | Track as implementation deliverable ([API_FINALIZATION.md](./API_FINALIZATION.md) §17) |
| G3 | `notification_templates` empty at deploy — no operational seed | Ops | Admin/bootstrap procedure (not demo data) |
| G4 | Consent revoke → cancel `worker_jobs` / 011 / 012 — **comments only**, no DB trigger | Impl | Application handler required ([010](../supabase/migrations/010_worker_jobs.sql) header) |
| G5 | `consultation_traces` lacks dedicated columns for `prompt_hash`, `response_hash`, `state_version`, voice audit | Impl | Store in `retrieval_scores` JSON per CONSENT §9 / VOICE §10 until optional migration |
| G6 | Case Knowledge governance UI / `knowledge_sources` table | Product | Out of v1 MVP per IMPLEMENTATION_READINESS |
| G7 | Signed upload URL spec for documents | API | OPENAPI mentions future; FINALIZATION documents core routes |

**v1 gap verdict:** **No blocking schema gap** for single-customer MVP if migrations `001`–`012` apply cleanly. **Process gaps** (G1, G2, G4, G5) are implementation tasks, not design holes.

### v2 scope gaps (explicitly deferred — not v1 defects)

| ID | Gap | Documented in |
|----|-----|---------------|
| V1 | `voice_*` consent types | [VOICE_CONVERSATION.md](./VOICE_CONVERSATION.md) |
| V2 | `households`, `household_members`, household consents | [FAMILY_ARCHITECTURE.md](./FAMILY_ARCHITECTURE.md) |
| V3 | `knowledge_sources`, full governance registry | [KNOWLEDGE_GOVERNANCE.md](./KNOWLEDGE_GOVERNANCE.md) |
| V4 | External notification providers (Kakao/SMS/email) | [NOTIFICATION_SERVICE.md](./NOTIFICATION_SERVICE.md), `012` |
| V5 | `POST .../voice-messages`, `/api/households/*` | VOICE, FAMILY, API_FINALIZATION (proposal only) |
| V6 | `voice_recording_retention` / original audio storage | VOICE §3.3 |

**v2 gap verdict:** Intentionally open; tracked in extension docs.

---

## 3. Design duplication check

| Duplication | Assessment | Canonical source |
|-------------|------------|------------------|
| OPENAPI_DRAFT vs API_FINALIZATION | Acceptable — draft vs final contract | **API_FINALIZATION** |
| REASONING 9 stages vs RUNTIME pipeline | Overlap by design | **RUNTIME** for ops; REASONING for stage rules |
| CONSULTATION_ORCHESTRATOR vs RUNTIME | Orchestrator = API + steps; Runtime = consolidated | **RUNTIME** + **FINALIZATION** |
| Consent revoke flows in CONSENT, 010, 011, 012 headers | Repeated for worker safety | **CONSENT_ARCHITECTURE** §6 |
| Monitoring §7–8 vs NOTIFICATION §8 | Outbox mapping repeated | **NOTIFICATION_SERVICE** + **011** comments |
| IMPLEMENTATION_READINESS vs this review | Readiness = plan; Review = cross-check | Both kept |

**Duplication verdict:** **Manageable** — no contradictory duplicates; index drift (DATA_MODEL) is the main confusion risk.

---

## 4. Runtime ↔ Worker consistency

| Check | Status |
|-------|--------|
| Runtime ends with trace + optional outbox + **worker_jobs enqueue** | OK ([CONSULTATION_RUNTIME_ARCHITECTURE.md](./CONSULTATION_RUNTIME_ARCHITECTURE.md)) |
| WORKER graph: ingest → memory → state → monitoring → outbox → notification | OK |
| `010` `job_type` values match WORKER names | OK |
| `011` consumes `outbox_events`, produces `notification_events` | OK |
| `012` consumes `notification_events` | OK |
| Case extraction branch isolated | OK |
| service_role only for workers | OK |

**Verdict:** **Aligned.**

---

## 5. Consent ↔ Memory consistency

| Check | Status |
|-------|--------|
| `lifeguard_consent_types()` in 004 matches CONSENT_ARCHITECTURE §2 | OK |
| MEMORY_BUILDER §7.1 source matrix uses same types | OK |
| Revoke → supersede facts (MEMORY + CONSENT §6) | OK |
| RAG gated on `document_analysis` (005 + DOCUMENT_INGEST) | OK |
| No memory from audio binary (VOICE) | OK |
| Household: no auto memory share (FAMILY) | OK |

**Verdict:** **Aligned.**

---

## 6. Household ↔ Privacy consistency

| Check | Status |
|-------|--------|
| v1 single `customer_id` RLS (001–002) | OK |
| FAMILY: members independent subjects; summary vs memory | OK |
| No household tables in 001–012 | OK |
| API does not expose cross-member reads in v1 | OK |
| Case Knowledge not mixed with household (FAMILY §10) | OK |

**Verdict:** **Aligned** for v1; v2 requires new RLS design when implemented.

---

## 7. Monitoring ↔ Notification consistency

| Check | Status |
|-------|--------|
| Monitoring emits `monitoring.*` + optional `agent.escalation.requested` | OK |
| `notification_delivery` checked before customer push (009, MONITORING §7) | OK |
| Internal outbox without customer notification when consent off | OK (MONITORING §7) |
| 011 → 009 event creation; 012 delivery audit | OK |
| Dedup: signal cooldown + notification_events unique + outbox run unique | OK |
| `family_change` per member only (FAMILY + MONITORING) | OK |

**Verdict:** **Aligned.**

---

## 8. API ↔ Schema consistency

| API (FINALIZATION) | Schema / RLS | Status |
|--------------------|--------------|--------|
| `POST .../messages` | consultations, messages, traces, outbox | OK |
| Documents CRUD + ingest | 001, 005 | OK |
| Consents | 004 | OK |
| `GET me/state` | 007 views | OK |
| Monitoring dismiss | 008 | OK |
| Notifications / preferences | 009 | OK |
| No public worker/outbox/delivery APIs | 010–012 admin SELECT only | OK |
| Envelope + error codes | App layer | OK |
| Voice / household routes | Not in v1 DB | OK (deferred) |

**Verdict:** **Aligned** for v1 customer API surface.

---

## 9. Top risks

| Risk | 발생 가능성 | 영향도 | 현재 대응 상태 |
|------|-------------|--------|----------------|
| Cross-tenant leak via API trusting body `customer_id` | Medium | Critical | Documented forbidden in API_FINALIZATION + RUNTIME; **needs code enforcement** |
| Implementers use stale DATA_MODEL / ARCHITECTURE and miss 010–012 | Medium | High | **경미 conflict C8** — mitigated by migrations README; recommend onboarding pointer |
| Consent revoke not canceling queued jobs | Medium | High | Documented in 010/011/012 SQL comments; **implementation pending** |
| LLM answers without evidence | High | High | sufficiency + INSUFFICIENT_EVIDENCE + CE; **needs Output Guard in build** |
| service_role exposed to client | Low | Critical | Repeated bans in WORKER, API, READINESS; **needs secret hygiene** |
| STT low confidence entering Runtime (v2 voice) | Medium | Medium | VOICE §5 gate — **design complete, not active v1** |
| Household aggregate exposing member health (v2) | Medium | Critical | FAMILY prohibitions — **design complete, not active v1** |

---

## 10. GO / NO-GO (two decisions)

### 10.1 설계 기준 GO / NO-GO

| Criterion | Result |
|-----------|--------|
| Migrations 001–012 internally consistent chain | **Pass** |
| Normative Runtime + API + Worker docs align | **Pass** |
| No 치명적 / 중요 conflict | **Pass** |
| v2 extensions explicitly bounded (voice, household) | **Pass** |
| IMPLEMENTATION_READINESS + API_FINALIZATION complete | **Pass** |

**설계 기준:** **GO**

### 10.2 구현 착수 GO / NO-GO

| Criterion | Result |
|-----------|--------|
| SQL applied on staging Supabase | **Not done** (0% implementation) |
| RLS post-migration tests | **Not done** |
| Server runtime / workers / API code | **Not done** |
| Operational templates + revoke handlers | **Not done** |

**구현 착수:** **NO-GO** (expected — proceed to Phase 1 per [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md))

---

## 11. Design freeze recommendation

| Question | Recommendation |
|----------|----------------|
| Freeze migrations `001`–`012` as v1.0 design baseline? | **Yes**, with change control via new migration files only (no retroactive edit of 001–012) |
| Freeze normative docs set (RUNTIME, FINALIZATION, WORKER, CONSENT, 004–012 mapping docs)? | **Yes** |
| Allow editorial fixes to ARCHITECTURE.md / DATA_MODEL.md? | **Optional v1.0.1 doc pass** — not blocking freeze if team uses migrations README |
| OpenAPI YAML | **Not part of freeze** — implementation artifact |

**설계 Freeze 권고:** **권고함 (Recommended)** — subject to program sign-off on v2 roadmap (voice, household) as **separate v2.0 design packages**, not edits to frozen v1 SQL.

---

## 12. Final conclusion (explicit judgments)

| Statement | Judgment |
|-----------|----------|
| **현재 LIFEGUARD Core는 설계 완료** | **예 (Yes)** — for **v1 single-customer** scope: schema draft 001–012, engines, runtime, API contract, workers, readiness, and v2 extension designs (voice, household) documented as non-active. |
| **설계 Freeze 가능** | **예 (Yes)** — **권고 조건부**: formal freeze of 001–012 + normative doc list; track 경미 doc drift (DATA_MODEL/ARCHITECTURE) in onboarding; v2 features via new migrations only. |
| **구현 단계 진입 가능** | **예 (Yes) for starting Phase 1** — **아니오 (No) for production launch** — implementation remains 0%; 구현 착수 GO is **NO-GO** until Phase 1 staging migration + RLS tests pass, then Phases 2–9 per readiness plan. |

**One-line summary:** Design package is **coherent and complete enough to freeze**; **implementation has not started** and must not skip staging verification or consent-revoke job handlers.

---

## 13. Sign-off checklist (optional)

| Role | Design freeze | Implementation Phase 1 |
|------|---------------|-------------------------|
| Engineering lead | ☐ | ☐ |
| Security / privacy | ☐ | ☐ |
| Legal (consent list) | ☐ | ☐ |

---

*Architecture Review v1 — LIFEGUARD Core cross-check.*
