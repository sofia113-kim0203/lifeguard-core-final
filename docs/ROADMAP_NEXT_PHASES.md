# LIFEGUARD Core — Next Phases Technical Roadmap

**Document version:** 2026-06-07  
**Scope:** Planning only — no implementation in this document  
**Baseline:** `main` through Phase 18 (merged PRs #2–#8); Phase 19 sidebar shells open/in progress (PR #9)

This roadmap defines what exists, what is missing, and the recommended build order before adding more production features.

---

## Executive Summary

LIFEGUARD Core has a mature **schema + RLS foundation** (migrations `001`–`016`) and a working **customer auth + signup provision** path, but most customer-facing menus are still **placeholder shells** or **admin-only dev panels**. The critical path is:

1. Finish **customer intake** hardening (Phase 17 done; validation + completeness next)
2. **Document upload/storage** (unblocks claims, RAG, memory)
3. **Customer memory builder** (unblocks AI recommendation + grounded chat)
4. **Claims check** (reads documents + policies + health signals)
5. **AI insurance recommendation** (reads memory + policies; mock → rules → Claude)
6. **Agent desk** (assignment-scoped views; no health RAG leakage)
7. **Admin console** consolidation (operational vs dev panels)
8. **Claude/RAG integration** (last-mile grounding on top of documents + policy knowledge)

---

## Cross-Cutting Foundations (All Areas)

### Auth & identity (done — do not change without explicit phase)

| Item | Status |
|------|--------|
| Supabase Auth signup/login | Done (`AuthPanel`, `useAuthSession`) |
| Post-login redirect to 고객 분석 | Done (PR #5) |
| `lifeguard_on_auth_user_created` trigger → `public.users` | Done (`013`) |
| `lifeguard_provision_customer_signup` on signup | Done (`013`–`015`) |
| `lifeguard_bootstrap_customer_signup` RPC on first dashboard load | Done (Phase 16) |

### Core tables always in scope

- `users`, `customer_profiles`, `customer_consents`
- Helper RLS functions: `lifeguard_auth_customer_id()`, `lifeguard_is_own_customer()`, `lifeguard_is_admin()`, `lifeguard_agent_assigned_to_customer()`

### Recommended storage buckets (not yet provisioned in repo migrations)

| Bucket | Purpose | Path convention |
|--------|---------|-----------------|
| `customer-documents` | Customer-uploaded PDFs/images | `{customer_id}/{document_id}/{filename}` |
| `policy-pdfs` | Carrier policy PDFs (admin ingest) | `{carrier}/{policy_pdf_id}/{filename}` |
| `claim-evidence` (optional) | Claim-specific uploads | `{customer_id}/claims/{claim_id}/...` |

Storage RLS must mirror table RLS: customer JWT can read/write only under own `customer_id` prefix; admin service role for policy ingest; agents **no direct storage** to health/documents per architecture.

---

## 1. Customer Intake

### Purpose

Collect minimum customer profile, address, insurance summary, simplified health disclosure, and consultation purpose at signup/post-login — without disease-specific form sprawl. Data feeds memory builder, AI recommendation, and claims pre-check.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `customer_profiles` | Name, DOB, gender, job | Exists; UI writes |
| `profile_health` | `details_json.intake`, `details_json.insurance_disclosure` | Exists; UI writes |
| `profile_insurance_policies` | Insurer, product, coverage summary | Exists; UI writes |
| `customer_consents` | Legal consent ledger | Exists; signup provision |

**No new tables required** for intake MVP. Optional future: `customer_intake_sessions` for multi-step wizard audit.

### Required Supabase Storage buckets

None for intake MVP.

### Required frontend screens

| Screen | Status |
|--------|--------|
| 고객 분석 dashboard summary | Done (Phase 16) |
| `CustomerIntakePanel` — profile, address, insurance, consultation, health disclosure | Done (Phase 17) |
| Read-only consent status | Done (Phase 17) |
| Intake completeness indicator | **Missing** |
| Validation errors per field | **Missing** |
| Post-save memory refresh trigger | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `customer_profiles` | Customer select/insert/update own | Done (`002`) |
| `profile_health` | Customer select/insert/update own; admin audit select | Done (`002`) |
| `profile_insurance_policies` | Customer CRUD own; agent select assigned; admin audit | Done (`002`) |
| `customer_consents` | Customer select/insert/update own; admin audit | Done (`004`) |

### Future AI/OCR/RAG connection points

- `profile_health.details_json.insurance_disclosure` notes → NLP extraction → `customer_memory_facts`
- `profile_insurance_policies.coverage_summary` → structured fact keys for gap analysis
- Intake completion event → `outbox_events` → memory builder worker

### What is already done

- Phase 16: real dashboard data binding
- Phase 17: simplified 5×(status+notes) health disclosure in `details_json`
- Signup provision creates profile, health row, consents
- `customerIntake.js` load/save via RLS

### What is missing

- Intake completeness scoring (`draft` → `active` profile status transition)
- Consent version re-prompt on policy change
- Agent-visible **non-health** profile summary view (masked)
- Automated memory fact extraction from intake save
- E2E tests for intake persistence

### Recommended phase order

**Phase 20** — Intake hardening (validation, completeness, profile status)  
Depends on: Phases 16–17 (done)

---

## 2. Document Upload / Storage

### Purpose

Let customers upload insurance certificates, medical records, and claim-related documents. Store binaries in Supabase Storage; track metadata and ingest pipeline in Postgres; eventually chunk + embed for per-customer RAG.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `customer_documents` | Metadata, `storage_path`, ingest status | Exists (`001`) |
| `customer_document_chunks` | Per-customer RAG chunks + embeddings | Exists (`001`) |
| `document_upload_events` | Upload audit log | Exists (`005`) |
| `document_ingest_traces` | Pipeline trace | Exists (`005`) |
| `outbox_events` | Async ingest jobs | Exists (`001`) |

### Required Supabase Storage buckets

| Bucket | Status |
|--------|--------|
| `customer-documents` | **Missing** — must create + storage policies |
| Optional signed-URL upload flow | **Missing** |

### Required frontend screens

| Screen | Status |
|--------|--------|
| `DocumentsPanel` placeholder | Done (Phase 19 shell) |
| Document list (by customer) | **Missing** |
| Upload UI (drag/drop or file picker) | **Missing** |
| Ingest status per document | **Missing** |
| Document preview/download | **Missing** |
| Consent gate (`document_storage`, `document_analysis`) | **Missing** in UI |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `customer_documents` | Customer CRUD own; admin audit; **no agent** | Done (`002`) |
| `customer_document_chunks` | Customer CRUD own; admin audit; **no agent** | Done (`002`) |
| `document_upload_events` | Customer select/insert own | Done (`005`) |
| Storage objects | Customer read/write own prefix | **Missing** |

### Future AI/OCR/RAG connection points

- Upload → `outbox_events` (`document_ingest`) → worker OCR/text extract
- Extracted text → `customer_document_chunks` + embeddings (pgvector)
- OCR output → claim evidence refs, memory facts
- Admin `policy-pdfs` pipeline (separate from customer docs) feeds global policy RAG

### What is already done

- Schema + RLS for documents and chunks
- Document ingest extension tables (`005`)
- Admin dev panels for policy PDF pipelines (not customer-facing)
- Consent types `document_storage`, `document_analysis` in consent architecture

### What is missing

- Storage bucket + policies
- Customer upload UI wired to Storage + `customer_documents` insert
- Ingest worker (Edge Function or external) updating `ingest_status`
- Chunk generation + embedding pipeline for **customer** documents
- Virus/type validation, size limits
- UI consent check before upload

### Recommended phase order

**Phase 21** — Customer document upload MVP (storage + metadata + list)  
**Phase 22** — Document ingest + chunk pipeline  
Depends on: Phase 20 (intake/consents stable)

---

## 3. Claims Check

### Purpose

Help customers understand claim eligibility, required documents, and next steps — grounded in their policies, uploaded evidence, health disclosure summary, and monitoring signals. Not a full claims filing engine initially.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `profile_insurance_policies` | Coverage context | Exists |
| `profile_health` | Disclosure summary (not disease-specific fields) | Exists |
| `customer_documents` | Evidence (`doc_class = 'claim'`) | Exists |
| `customer_monitoring_signals` | Proactive claim/coverage signals | Exists (`008`) |
| `customer_state_snapshots` | Aggregated state for detectors | Exists (`007`) |
| `rule_packs` / `rule_pack_versions` | Deterministic claim rules | Exists (`001`, `003`) |

**Future tables (not in migrations yet):**

- `claim_assessments` — persisted check results per customer/request
- `claim_checklist_items` — required docs per assessment

### Required Supabase Storage buckets

| Bucket | Role |
|--------|------|
| `customer-documents` | Claim evidence uploads |
| `claim-evidence` (optional) | Dedicated claim artifact prefix |

### Required frontend screens

| Screen | Status |
|--------|--------|
| `ClaimCheckPanel` placeholder | Done (Phase 19 shell) |
| Claim possibility summary | **Missing** |
| Required documents checklist | **Missing** |
| Link to upload missing docs | **Missing** |
| Signal/history timeline | **Missing** |
| Rule-pack-based explanation (no hallucination) | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `customer_monitoring_signals` | Customer select/dismiss own; admin full | Done (`008`) |
| `customer_state_snapshots` | Customer select own; admin CRUD | Done (`007`) |
| `rule_packs` | Authenticated read (seeded) | Done (`002`) |
| `claim_assessments` (future) | Customer select/insert own; agent assigned; admin | **Missing** |

### Future AI/OCR/RAG connection points

- OCR on medical/claim docs → evidence_refs in signals
- RAG retrieval from `customer_document_chunks` filtered by `customer_id`
- Rule pack evaluation → structured assessment JSON
- Claude summarization **only after** rule engine produces grounded facts
- `customer_memory_facts` keys: `claim.eligibility.*`, `claim.missing_docs.*`

### What is already done

- Monitoring signals schema + RLS
- Customer state snapshots schema
- Rule packs seeded
- Insurance + health intake data path

### What is missing

- Claims assessment persistence table
- Rule engine RPC wired to customer UI
- Document dependency (Phase 21–22)
- Checklist UI
- Agent view for assigned customers (non-health subset)

### Recommended phase order

**Phase 23** — Claims check MVP (rules + checklist, no Claude)  
**Phase 24** — Claims + document evidence integration  
Depends on: Phases 21–22 (documents), Phase 20 (intake)

---

## 4. AI Insurance Recommendation

### Purpose

Surface coverage gaps, premium optimization hints, and product suggestions based on customer profile, policies, health disclosure summary, and memory facts — with clear grounding and consent gates.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `profile_insurance_policies` | In-force summary | Exists |
| `profile_health` | Disclosure in `details_json` | Exists |
| `customer_memory_facts` | Normalized recommendation inputs | Exists |
| `customer_state_snapshots` | Computed gap/sufficiency | Exists (`007`) |
| `rule_packs` | Deterministic recommendation rules | Exists |
| `case_knowledge_items` | Case-based knowledge | Exists (`006`) |

**Future tables:**

- `recommendation_runs` — audit each recommendation session
- `recommendation_items` — individual suggestions with evidence refs

### Required Supabase Storage buckets

None directly; indirect via policy/case knowledge PDFs (admin `policy-pdfs`).

### Required frontend screens

| Screen | Status |
|--------|--------|
| `AiRecommendationPanel` placeholder | Done (Phase 19 shell) |
| Gap analysis summary | **Missing** |
| Recommendation cards with evidence | **Missing** |
| Consent gate (`ai_consultation`) | Partial (signup only) |
| Compare current vs suggested coverage | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `customer_memory_facts` | Customer CRUD own; admin audit; **no agent** | Done (`002`) |
| `customer_state_snapshots` | Customer select own | Done (`007`) |
| `case_knowledge_items` | Admin only (customer via RPC/view later) | Done (`006`) |
| `recommendation_*` (future) | Customer own; admin audit | **Missing** |

### Future AI/OCR/RAG connection points

- Memory builder: intake + documents → `customer_memory_facts`
- State snapshot worker: facts + policies → `customer_state_snapshots`
- Rule pack → structured gaps before LLM
- Case knowledge RAG (admin corpus) for product explanations
- Claude for natural language packaging of **pre-computed** gaps only

### What is already done

- Memory facts schema
- State snapshots schema
- Case knowledge schema (admin)
- Intake captures insurance summary
- AI recommendation menu shell

### What is missing

- Memory builder worker invocation on data change
- State snapshot computation in production path
- Customer-facing recommendation UI
- Recommendation audit tables
- Grounding validation before any LLM output

### Recommended phase order

**Phase 25** — Recommendation MVP (rules + snapshots, no Claude)  
**Phase 26** — Recommendation + memory integration  
Depends on: Phases 20–22, optionally 23

---

## 5. Customer Memory

### Purpose

Maintain versioned, normalized facts about each customer (not raw chat) for prompts, grounding, and cross-feature consistency. Bridge between intake, documents, conversations, and AI features.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `customer_memory_facts` | Canonical fact store | Exists (`001`) |
| `customer_profiles.memory_version` | Bump on rebuild | Exists |
| `profile_health.details_json` | Source for health facts | Exists |
| `customer_conversations` | Raw chat ledger (Phase 18) | Exists (`016`) |
| `consultations` / `consultation_messages` | Structured consultation threads | Exists (`001`) |
| `customer_state_snapshots` | Derived aggregate state | Exists (`007`) |

**Scripts not in numbered migrations (admin deploy patches):**

- `customer_conversation_memory_runs/items` — in `supabase/scripts/` (optional advanced path)

### Required Supabase Storage buckets

None directly.

### Required frontend screens

| Screen | Status |
|--------|--------|
| Customer-visible memory summary (facts user can see) | **Missing** |
| Admin `AdminCustomerMemoryIntegrationPanel` | Dev panel exists |
| Admin `AdminCustomerConversationMemoryPanel` | Dev panel exists |
| Memory version / last rebuilt indicator on dashboard | **Missing** |
| Fact provenance display | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `customer_memory_facts` | Customer CRUD own; admin audit | Done (`002`) |
| `customer_conversations` | Customer select/insert own; admin select | Done (`016`) |
| `consultations` / `consultation_messages` | Customer own; agent assigned select; admin audit | Done (`002`) |

### Future AI/OCR/RAG connection points

- Conversation → fact extraction worker (supersede old `fact_key` rows)
- Document OCR → facts with `provenance_type = 'document'`
- Intake save → facts with `provenance_type = 'profile'`
- Memory rebuild → increment `memory_version` → invalidate stale snapshots
- Prompt assembly: active facts + consent filter + PII minimization

### What is already done

- `customer_memory_facts` schema + RLS
- Phase 18: `customer_conversations` for chat persistence (mock assistant)
- Consultation tables (unused by customer UI yet)
- Admin memory dev panels

### What is missing

- Memory builder RPC/worker wired to customer events
- Unify `customer_conversations` vs `consultation_messages` strategy
- Customer-facing memory transparency UI
- Fact conflict resolution / supersede logic in app layer
- Conversation → fact pipeline

### Recommended phase order

**Phase 27** — Memory builder MVP (intake → facts)  
**Phase 28** — Conversation + document → facts  
Depends on: Phases 20–22; parallel with 25

---

## 6. Agent Desk

### Purpose

Give insurance agents (설계사) a scoped workspace to view assigned customers, non-sensitive profile/insurance data, consultation history, and claim/recommendation status — **without** access to `profile_health`, `customer_documents`, or document chunks per RLS architecture.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `agent_assignments` | Customer ↔ agent link | Exists (`001`) |
| `customer_profiles` | Limited fields for agent | Exists |
| `profile_insurance_policies` | Agent select assigned | Exists |
| `consultations` / `consultation_messages` | Agent select assigned | Exists |
| `users` | Agent role | Exists |

**Future tables:**

- `agent_notes` — agent-authored notes per customer
- `agent_handoff_packets` — structured handoff exports

### Required Supabase Storage buckets

Agents should **not** have storage policies on `customer-documents` (architecture constraint). Document review flows through customer share or admin tooling only.

### Required frontend screens

| Screen | Status |
|--------|--------|
| `AgentDeskPanel` placeholder | Done (Phase 19 shell) |
| Role gate (agent/admin only) | Done (Phase 19 `RoleAccessPanel`) |
| Assigned customer list | **Missing** |
| Customer summary (non-health) | **Missing** |
| Consultation transcript view | **Missing** |
| Claim/recommendation status (agent-safe subset) | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `agent_assignments` | Customer select own; agent select assigned; admin | Done (`002`) |
| `customer_profiles` | Agent select assigned | Done (`002`) |
| `profile_insurance_policies` | Agent select assigned | Done (`002`) |
| `consultations` / `consultation_messages` | Agent select assigned | Done (`002`) |
| `profile_health` | **No agent policy** (by design) | Enforced |
| `customer_documents` / chunks | **No agent policy** (by design) | Enforced |
| `lifeguard_agent_customer_state_summary` view | Agent-safe state subset | Exists (`007`) |

### Future AI/OCR/RAG connection points

- Agent copilot with **assigned-customer** context only
- Suggested talking points from `customer_state_snapshots` view (no health detail)
- Handoff packet generation via `outbox_events`
- No direct Claude access to health OCR text

### What is already done

- `agent_assignments` schema + RLS
- Agent-scoped policies on insurance, consultations
- Agent desk menu shell with role gate
- Agent-safe state summary view

### What is missing

- Agent user provisioning flow
- Assignment admin UI
- Assigned customer list UI
- Agent-safe dashboard widgets
- Explicit health/document access denial UX messaging

### Recommended phase order

**Phase 29** — Agent desk MVP (assignments + customer list)  
**Phase 30** — Agent consultation + status views  
Depends on: Phases 23, 25, 27 (features to display)

---

## 7. Admin Console

### Purpose

Operational control for data readiness, policy/RAG ingest, worker jobs, notifications, monitoring, and audit — separate from customer-facing features. Consolidate dozens of dev panels into a coherent admin IA.

### Required database tables

Most admin operations touch existing tables plus:

| Table / area | Role | Status |
|--------------|------|--------|
| `worker_jobs`, `worker_runs`, `retry_queue`, `dead_letter_jobs` | Async processing | Exists (`010`) |
| `notification_*` | Notification service | Exists (`009`, `012`) |
| `outbox_*` | Event delivery | Exists (`011`) |
| `monitoring_detection_runs`, `customer_monitoring_signals` | Signals | Exists (`008`) |
| `case_knowledge_items`, `case_extraction_jobs` | Case knowledge | Exists (`006`) |
| Policy RAG tables | In `supabase/scripts/` (phase14 real policy) | Scripts only, not all in migrations |

### Required Supabase Storage buckets

| Bucket | Role |
|--------|------|
| `policy-pdfs` | Admin policy document ingest |
| `customer-documents` | Admin audit/metadata only (no bulk download without audit) |

### Required frontend screens

| Screen | Status |
|--------|--------|
| `AdminMenuPanel` + 30+ `Admin*Panel` dev tools | Done (scattered) |
| Role gate (admin only) | Done (Phase 19) |
| Unified admin navigation IA | **Missing** |
| Production vs dev panel separation | **Missing** |
| Customer search / audit view | **Missing** |
| Worker job monitor | **Missing** in unified UI |
| Migration/deploy status dashboard | **Missing** |

### Required RLS rules

| Pattern | Status |
|---------|--------|
| `lifeguard_is_admin()` select/CRUD on operational tables | Done across migrations |
| Service role bypass for workers | Documented; server-only |
| No customer access to admin tables | Enforced |

### Future AI/OCR/RAG connection points

- Admin triggers policy PDF ingest → chunk → embed pipeline
- Grounded retrieval validation panels (exist as dev tools)
- Production Claude execution gates
- Case knowledge curation → customer recommendation corpus

### What is already done

- Extensive admin dev panels (policy RAG, Claude, memory, data flow)
- Admin RLS on sensitive tables
- Real data readiness panel
- Role-gated admin menu shell (Phase 19)

### What is missing

- Consolidated admin product IA (not 30 tab buttons)
- Operational dashboards wired to real job tables
- Customer support lookup (admin audit)
- Script → migration promotion for phase14 policy tables
- Environment promotion checklist (Supabase migration apply tracking)

### Recommended phase order

**Phase 31** — Admin console IA consolidation  
**Phase 32** — Operational monitoring (workers, outbox, notifications)  
Can proceed in parallel with customer features; admin policy ingest should precede Phase 8 (Claude/RAG) production.

---

## 8. Claude / RAG Integration

### Purpose

Deliver grounded AI responses for customer consultation, recommendations, and claims explanations — using per-customer document RAG, policy knowledge RAG, rule packs, and memory facts. Claude is the **last mile**, not the source of truth.

### Required database tables

| Table | Role | Status |
|-------|------|--------|
| `customer_document_chunks` | Per-customer vector RAG | Exists |
| `consultation_messages` | Grounded turns + `sources_json` | Exists |
| `consultation_traces` | Prompt/retrieval audit | Exists |
| `customer_conversations` | Simple chat ledger (Phase 18) | Exists (`016`) |
| `case_knowledge_items` | Global case RAG | Exists |
| Policy chunk tables | In scripts (`real_policy_*`, `policy_*`) | Scripts/partial |

**Scripts (deploy separately today):**

- `customer_ai_consultations` — in `phase7_claude_consultation_deploy_patch.sql`
- Real policy embedding/search tables — phase14 scripts

### Required Supabase Storage buckets

| Bucket | Role |
|--------|------|
| `customer-documents` | Source for customer RAG |
| `policy-pdfs` | Source for policy RAG |

### Required frontend screens

| Screen | Status |
|--------|--------|
| `CustomerAiChatPanel` — save/load messages | Done (Phase 18, mock reply) |
| Grounded chat with citations | **Missing** |
| `AiRecommendationPanel` grounded output | **Missing** |
| Admin Claude/grounding test panels | Dev tools exist |
| Retrieval debug / citation UI for customer | **Missing** |

### Required RLS rules

| Table | Policy pattern | Status |
|-------|----------------|--------|
| `consultation_traces` | Admin only | Done (`002`) |
| `customer_document_chunks` | Customer own; retrieval must filter `customer_id` | Done |
| `customer_conversations` | Customer insert/select own | Done (`016`) |
| Edge Functions | Service role for Claude calls; never expose API key client-side | **Required** |

### Future AI/OCR/RAG connection points

```
Customer message
  → consent check (ai_consultation, sensitive_health_processing)
  → memory facts load (customer_memory_facts)
  → customer RAG retrieval (customer_document_chunks, customer_id filter)
  → policy RAG retrieval (global corpus, no customer PII)
  → rule pack evaluation
  → prompt assembly + consultation_traces row
  → Claude API (Edge Function)
  → consultation_messages / customer_conversations persist
  → sources_json citations returned to UI
```

OCR feeds customer RAG; policy ingest feeds global RAG; Claude never sees cross-tenant data.

### What is already done

- pgvector column on chunks
- Consultation + trace schema
- Phase 18 customer chat persistence (mock)
- Admin grounding/Claude dev panels
- `customer_conversations` migration (`016`) — **requires Supabase apply**

### What is missing

- Edge Function for Claude invocation
- Unify chat tables strategy (`customer_conversations` vs `consultations`)
- Customer document RAG populated (Phase 22)
- Policy RAG tables promoted from scripts to migrations
- Citation UI
- Grounded retrieval validation in production path
- `016` migration applied in production Supabase

### Recommended phase order

**Phase 33** — Edge Function + grounded consultation (customer docs + memory)  
**Phase 34** — Policy RAG + Claude for recommendations  
**Phase 35** — Full trace audit + agent-safe summaries  
Depends on: Phases 21–22, 27, 31; **last in roadmap**

---

## Master Phase Order (Recommended)

| Phase | Area | Summary | Depends on |
|-------|------|---------|------------|
| 16–18 | Foundation | Dashboard, intake, chat persistence | Done (merged) |
| 19 | Shells | Sidebar placeholder panels | Done (PR open) |
| **20** | Intake | Validation, completeness, profile activation | 16–17 |
| **21** | Documents | Storage bucket + upload + metadata list | 20 |
| **22** | Documents | Ingest, OCR, chunk, embed | 21 |
| **27** | Memory | Builder MVP (intake → facts) | 20 |
| **23** | Claims | Rules + checklist MVP | 20, 21 |
| **25** | AI reco | Rules + snapshots MVP | 20, 27 |
| **24** | Claims | Evidence + signals integration | 22, 23 |
| **28** | Memory | Conversation + document → facts | 18, 22 |
| **26** | AI reco | Memory-integrated recommendations | 25, 28 |
| **29** | Agent | Assignments + customer list | 20 |
| **30** | Agent | Consultation + status views | 29, 23, 25 |
| **31** | Admin | Console IA consolidation | — |
| **32** | Admin | Worker/outbox monitoring | 31 |
| **33** | Claude/RAG | Grounded customer consultation | 22, 27, 28 |
| **34** | Claude/RAG | Policy RAG + reco Claude layer | 26, 32, policy migrations |
| **35** | Claude/RAG | Full trace + agent-safe AI summaries | 30, 33, 34 |

### Parallel tracks

- **Customer track:** 20 → 21 → 22 → 23/24 → 25/26  
- **Memory track:** 27 → 28 (can start after 20)  
- **Agent track:** 29 → 30 (after customer features have data to show)  
- **Admin track:** 31 → 32 (parallel)  
- **AI track:** 33 → 34 → 35 (last)

---

## Migration & Deploy Checklist (Operational)

Before enabling each phase in production Supabase:

| Migration / script | Required for | Applied in prod? |
|--------------------|--------------|------------------|
| `001`–`015` | Core schema, auth, signup | Assumed yes |
| `016_customer_conversations` | Phase 18 AI 상담 | **Verify applied** |
| Phase14 policy scripts | Admin policy RAG, Claude | **Not in migrations** — plan promotion |
| Phase7 `customer_ai_consultations` | Advanced consultation audit | Script only |
| Storage buckets | Phase 21+ | **Not created in repo** |

---

## Explicit Non-Goals (Until Later Phases)

- Full insurance policy admin / carrier product catalog UI for customers
- Disease-specific health disclosure forms (excluded per Phase 17)
- Agent access to health documents or profile_health
- Client-side Claude API keys
- Changing auth flow or signup trigger/provision SQL without dedicated phase
- INSUX / legacy database integration

---

## Document Maintenance

Update this file when:

1. A phase merges to `main` — move items from **Missing** to **Done**
2. New migrations land — update table/RLS sections
3. Storage buckets are provisioned — update bucket status
4. Production Supabase apply status changes — update checklist

**Owner:** Engineering / Cloud Agent  
**Next review:** After Phase 20 kickoff
