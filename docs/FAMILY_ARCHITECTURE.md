# LIFEGUARD Core — Family & Household Architecture

Design for **household-level insurance analysis** (spouse, children, parents) while preserving **per-person tenant isolation** under today’s `customer_id` model.

Aligned with [CONSENT_ARCHITECTURE.md](./CONSENT_ARCHITECTURE.md), [MEMORY_BUILDER.md](./MEMORY_BUILDER.md), [CUSTOMER_STATE_ENGINE.md](./CUSTOMER_STATE_ENGINE.md), [LIFEGUARD_MONITORING_ENGINE.md](./LIFEGUARD_MONITORING_ENGINE.md), [NOTIFICATION_SERVICE.md](./NOTIFICATION_SERVICE.md), [CASE_KNOWLEDGE_ENGINE.md](./CASE_KNOWLEDGE_ENGINE.md), and migrations **001–012**.

**Not in scope:** SQL, migrations, server/UI code, demo/mock/sample/fake household fixtures.

---

## v1 MVP status (read first)

> **Household is inactive in v1 MVP.**
>
> Migrations **001–012** contain **no** `households`, `household_members`, or household RLS policies. All tenant data remains scoped to **`customer_profiles.id`** (`customer_id`).
>
> **This document is a v2 extension design** only. v1 products continue **single-customer** consultation, memory, RAG, monitoring, and notifications per [API_FINALIZATION.md](./API_FINALIZATION.md) and [IMPLEMENTATION_READINESS.md](./IMPLEMENTATION_READINESS.md).
>
> Do not enable household APIs or cross-member reads until v2 schema + consent types are migrated and tested.

---

## 1. Household concept

| Term | Definition |
|------|------------|
| **Household** | Logical insurance family unit: one or more **members** linked for **aggregated summaries** (premium burden, coverage gaps at household level) — not a replacement for individual `customer_id`. |
| **Primary member** | The customer who owns the login (`users` → `customer_profiles`) and may invite/link dependents (v2). |
| **Dependant member** | Spouse, child, or parent represented by their **own** `customer_profiles` row (or v2 `household_member` link to an existing profile). |
| **Household summary** | Derived, **non-PII-heavy** rollups (counts, flags, totals) — never a dump of another member’s memory or health rows. |

```text
household (v2)
  ├── primary_customer_id
  ├── household_members[]
  │     ├── member_customer_id
  │     ├── relationship: self | spouse | child | parent
  │     └── link_status: pending | active | revoked
  └── household_consents (v2) — household-level agreements only where explicitly defined
```

---

## 2. Family member structure

| `relationship` | Typical use | Login |
|----------------|-------------|-------|
| `self` | Primary account holder | Yes |
| `spouse` | 배우자 | Optional own login or linked profile only |
| `child` | 자녀 | Usually dependant profile; adult child may have own login |
| `parent` | 부모 | Often linked profile; separate consent for health/insurance data |

**Each member is a separate data subject:**

- Own `customer_consents` ledger (004 pattern).
- Own `customer_memory_facts`, documents, consultations, monitoring signals.
- **Household membership does not imply access** to another member’s data.

---

## 3. Customer ↔ Family relationship

| Rule | v1 (current) | v2 (proposed) |
|------|--------------|---------------|
| Auth tenant | `auth.uid()` → **one** `customer_profiles.id` | Same; optional `household_id` on profile for grouping |
| API | All routes under `/api/customers/me/*` | Add `/api/households/me` read-only summary (v2) |
| RLS | Every row filtered by **own** `customer_id` | Household tables admin/service; member data still per `customer_id` |
| Linking | N/A | Primary invites member; member accepts link + grants consents |

**Forbidden:** Accepting `customer_id` of spouse/child in request body to read their data.

---

## 4. Memory integration principles

| Allowed | Forbidden |
|---------|-----------|
| **Household summary** facts on **primary** only, e.g. `household.premium.total_estimated`, `household.coverage.gap_count` — built by **aggregator worker** from members who **consented** to contribute aggregates | Copying spouse `customer_memory_facts` into primary’s fact store without consent |
| Primary’s own memory unchanged | “승격” of member memory into primary profile |
| Memory Builder runs **per `customer_id`** | One rebuild that merges health diagnoses across members |

**Member Memory sharing is forbidden by default.**

Examples:

| | |
|--|--|
| **Allowed (summary)** | 가족 총 보험료 구간, 가족 보장 공백 건수, “자녀 N명 정책 등록됨” (no names in summary) |
| **Forbidden** | 배우자 건강정보 자동 열람, 자녀 memory fact 자동 참조 in primary’s Runtime prompt |

Transcript/conversation memory remains per member ([MEMORY_BUILDER.md](./MEMORY_BUILDER.md)).

---

## 5. Consent principles

### 5.1 Independent subjects (mandatory)

배우자, 자녀, 부모 정보는 household 소속이라도 **자동 공유 금지**. **반드시 별도 consent** on the **data subject’s** `customer_consents` (or explicit bilateral household agreement recorded per member).

### 5.2 v2 consent candidates (not in 001–012)

| `consent_type` (v2) | Purpose |
|---------------------|---------|
| `household_link_accepted` | Member agrees to appear in a household |
| `household_aggregate_sharing` | Member allows **aggregate** stats to appear in household summary (not raw memory) |
| `household_member_view_by_primary` | **Optional, narrow:** primary may see specific summary card — not default |

Existing per-member consents still required for Runtime on **that member’s** data:

- `insurance_data_processing`, `sensitive_health_processing`, `document_analysis`, `memory_retention`, `ai_consultation`, etc.

### 5.3 Revocation

Revoking `household_aggregate_sharing` removes that member from household rollups immediately; does not delete their own memory.

---

## 6. RAG principles

| Rule | Detail |
|------|--------|
| **Default** | `match_customer_document_chunks(p_customer_id)` — **only** authenticated member’s id |
| **Cross-member RAG** | **Forbidden** without explicit v2 consent + server wrapper that passes **single** allowed `customer_id` per request |
| **Household question** | Primary asks “우리 가족 실손 정리” → Runtime uses **primary RAG + household summary facts** — not spouse chunks |
| **No inference** | Missing spouse document → 자료 부족 for spouse scope; do not guess |

---

## 7. Monitoring principles

| Rule | Detail |
|------|--------|
| **No household inference** | Do not create signals for “the household” without per-member evidence |
| **Compute per member** | `monitoring-worker` runs per `customer_id` with that member’s policies/memory/docs |
| **`family_change` signal** (008) | Fires on **that member’s** `family.*` facts — not inferred household structure |
| **Household dashboard (v2)** | UI may **list** member-level open signals user is allowed to see — not a new detector that invents family risk |

Rollup for primary: optional **count** of members with `renewal_risk` if each member granted `household_aggregate_sharing` — not exposure of spouse health triggers.

---

## 8. Notification principles

| Rule | Detail |
|------|--------|
| **Recipient** | Notifications always target **one** `customer_id` with `notification_delivery` |
| **Household digest** | Optional v2: primary receives digest **only** if all included members consented to aggregate notification policy |
| **Spouse alerts** | Spouse must have own consent + preference; primary cannot receive spouse’s disclosure_risk push by default |

---

## 9. Agent sharing principles

| Rule | Detail |
|------|--------|
| **Assignment** | `agent_assignments` remain tied to **one** `customer_id` (typically primary) |
| **`agent_sharing`** | **Per member** — agent sees summary for assigned customer only |
| **Household card for agent** | High-level: “household: 3 members, 2 renewal signals (counts only)” if aggregate consent — no spouse health memory |
| **Escalation** | `agent.escalation.requested` per member event; not merged into fictional household escalation |

---

## 10. Prohibitions

| # | Forbidden |
|---|-----------|
| 1 | Auto-sharing spouse/child/parent memory, health, or documents because of household link |
| 2 | Household-level monitoring signals without per-member evidence |
| 3 | Inferring family composition (e.g. “must have spouse”) without stored facts |
| 4 | **Mixing Household with [Case Knowledge](./CASE_KNOWLEDGE_ENGINE.md)** — Case is anonymized patterns; Household is identifiable customer domain |
| 5 | Promoting household or member narratives into `case_knowledge_items` |
| 6 | Cross-tenant household links |
| 7 | demo/mock/sample/fake family trees in repo |

> **Case Knowledge ↔ Household**
>
> - **Household** = customer data plane (`customer_id`, consents, memory).
> - **Case Knowledge** = de-identified knowledge plane (no `customer_id` on published items).
> - **Never combine** retrieval paths: Runtime must not use case patterns to fill missing **member** data or household structure.

---

## 11. MVP scope

| v1 MVP (current) | v2 household pilot | Production household |
|------------------|--------------------|-----------------------|
| Single `customer_id` only | Link household + aggregate consent | Full member invite/revoke UX |
| `family_change` on own facts only | Household summary API for primary | Per-member notifications + agent household card |
| No `/api/households/*` | No cross-member Runtime | Governed dependant onboarding |

**v1:** Treat all consultation as **individual**; profile fields may mention family in **own** profile only with consent.

---

## 12. Future extension (v2+)

| Artifact | Purpose |
|----------|---------|
| `households` | `id`, `primary_customer_id`, `status`, `created_at` |
| `household_members` | `household_id`, `member_customer_id`, `relationship`, `link_status` |
| `household_aggregate_snapshots` | Optional rollups (JSON, evidence refs to member ids — not memory bodies) |
| RLS | Members see own data; primary sees summary view only with consents |
| API | `GET /api/households/me/summary`, `POST /api/households/me/invites` |
| Workers | `household-summary-worker` after member memory/state jobs |
| Docs update | CONSENT_ARCHITECTURE §household, API_FINALIZATION routes |

---

## 13. References

- [LIFEGUARD_MONITORING_ENGINE.md](./LIFEGUARD_MONITORING_ENGINE.md) — `family_change` detector
- [CUSTOMER_STATE_ENGINE.md](./CUSTOMER_STATE_ENGINE.md) — `identity_state` / family hints on **own** profile
- [KNOWLEDGE_GOVERNANCE.md](./KNOWLEDGE_GOVERNANCE.md) — case lifecycle (separate from household)

---

*Family & Household architecture v2 design — v1 MVP inactive.*
