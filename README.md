# LIFEGUARD Core

Customer memory–based AI insurance consultation platform (design-first).

**Consent Gate required before memory build** — facts are created only from real inputs with valid legal consent (see [CONSENT_ARCHITECTURE.md](./docs/CONSENT_ARCHITECTURE.md), [MEMORY_BUILDER.md](./docs/MEMORY_BUILDER.md) §2).

**Not part of INSUX / INSUX2 / insux-pro-ai.** This directory is a standalone product specification and schema design.

**Phase 2+ build execution (plan only):** [docs/PHASE2_EXECUTION_PLAN.md](./docs/PHASE2_EXECUTION_PLAN.md) — Supabase → migrations → RLS/consent → Auth → workers → Runtime → minimal UI.

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture, data model, AI/RAG pipeline |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | Tables, RLS, indexes |
| [docs/AI_PIPELINE.md](./docs/AI_PIPELINE.md) | Prompt assembly, retrieval, rules engine hooks |
| [docs/CONSULTATION_ORCHESTRATOR.md](./docs/CONSULTATION_ORCHESTRATOR.md) | Consultation API contracts, message flow, prompt composer, safety |
| [docs/CONSULTATION_RUNTIME_ARCHITECTURE.md](./docs/CONSULTATION_RUNTIME_ARCHITECTURE.md) | End-to-end Runtime pipeline (001–012), audit, async monitoring boundary |
| [docs/OPENAPI_DRAFT.md](./docs/OPENAPI_DRAFT.md) | HTTP API request/response contract draft (all routes) |
| [docs/API_FINALIZATION.md](./docs/API_FINALIZATION.md) | Final API contract: envelope, errors, access matrix, Runtime message schema |
| [docs/IMPLEMENTATION_READINESS.md](./docs/IMPLEMENTATION_READINESS.md) | Pre-implementation checklist: design vs build, phases, risks, Go/No-Go |
| [docs/VOICE_CONVERSATION.md](./docs/VOICE_CONVERSATION.md) | Voice STT/TTS design (v2 consent); v1 MVP text-only; same Runtime pipeline |
| [docs/FAMILY_ARCHITECTURE.md](./docs/FAMILY_ARCHITECTURE.md) | Household/family design (v2); v1 single-customer; summary vs memory isolation |
| [docs/ARCHITECTURE_REVIEW.md](./docs/ARCHITECTURE_REVIEW.md) | Cross-review: conflicts, gaps, risks, design vs implementation GO/NO-GO, freeze |
| [docs/PHASE1_SUPABASE_SETUP.md](./docs/PHASE1_SUPABASE_SETUP.md) | Phase 1: new Supabase project plan, migration order, verification (execution guide) |
| [docs/PHASE1_PRE_DEPLOY_CHECKLIST.md](./docs/PHASE1_PRE_DEPLOY_CHECKLIST.md) | Pre-deploy gate: 001–012 cross-check, Go/No-Go, P1-1–P1-6 |
| [docs/PHASE2_EXECUTION_PLAN.md](./docs/PHASE2_EXECUTION_PLAN.md) | Build execution plan: Phases 2–14, verification, Go/No-Go, build-start gate |
| [docs/CONSENT_ARCHITECTURE.md](./docs/CONSENT_ARCHITECTURE.md) | Legal consent types, `customer_consents`, grant/revoke flows, service mapping |
| [docs/MEMORY_BUILDER.md](./docs/MEMORY_BUILDER.md) | Consent Gate + profile/document/chat → `customer_memory_facts` rules |
| [docs/DOCUMENT_INGEST.md](./docs/DOCUMENT_INGEST.md) | PDF/image upload, OCR, chunking, embedding, per-customer RAG ingest |
| [docs/COMMUNICATION_ENGINE.md](./docs/COMMUNICATION_ENGINE.md) | Customer-facing tone, plain language, forbidden/recommended phrasing |
| [docs/LIFEGUARD_REASONING_ENGINE.md](./docs/LIFEGUARD_REASONING_ENGINE.md) | Pre-answer judgment stages (consent → memory → RAG → rules → response) |
| [docs/LIFEGUARD_MONITORING_ENGINE.md](./docs/LIFEGUARD_MONITORING_ENGINE.md) | Proactive risk/opportunity detection, outbox signals, notification planning |
| [docs/NOTIFICATION_SERVICE.md](./docs/NOTIFICATION_SERVICE.md) | Outbox → notification events, channels, consent gates, delivery queue (design) |
| [docs/WORKER_ARCHITECTURE.md](./docs/WORKER_ARCHITECTURE.md) | Background workers (`service_role`), triggers, tables, dependency graph |
| [docs/CUSTOMER_STATE_ENGINE.md](./docs/CUSTOMER_STATE_ENGINE.md) | Unified Customer State from memory, docs, policies, consents, monitoring |
| [docs/CASE_KNOWLEDGE_ENGINE.md](./docs/CASE_KNOWLEDGE_ENGINE.md) | De-identified case patterns; separate from customer memory & rule packs |
| [docs/KNOWLEDGE_GOVERNANCE.md](./docs/KNOWLEDGE_GOVERNANCE.md) | Knowledge lifecycle, trust tiers, approval, retrieval precedence, audit |
| [supabase/migrations/002_rls_service_policies.sql](./supabase/migrations/002_rls_service_policies.sql) | Customer / agent / admin RLS policies + test checklist |
| [supabase/migrations/004_customer_consents.sql](./supabase/migrations/004_customer_consents.sql) | Legal consent table + `lifeguard_has_consent` helpers |
| [supabase/migrations/005_document_ingest_extend.sql](./supabase/migrations/005_document_ingest_extend.sql) | Document ingest statuses, types, audit tables, RAG gates |
| [supabase/migrations/006_case_knowledge.sql](./supabase/migrations/006_case_knowledge.sql) | De-identified case knowledge + extraction jobs (admin/service only) |
| [supabase/migrations/007_customer_state_snapshots.sql](./supabase/migrations/007_customer_state_snapshots.sql) | Customer State snapshots + latest/agent views |
| [supabase/migrations/008_monitoring_signals.sql](./supabase/migrations/008_monitoring_signals.sql) | Monitoring signals, detection runs, customer/agent views, RLS |
| [supabase/migrations/009_notification_service.sql](./supabase/migrations/009_notification_service.sql) | Notification preferences, events, templates, RLS |
| [supabase/migrations/010_worker_jobs.sql](./supabase/migrations/010_worker_jobs.sql) | Worker job queue, runs, retry queue, dead letter (admin audit) |
| [supabase/migrations/011_outbox_processing.sql](./supabase/migrations/011_outbox_processing.sql) | Outbox processing runs, delivery attempts, status mapping audit |
| [supabase/migrations/012_notification_delivery.sql](./supabase/migrations/012_notification_delivery.sql) | Notification delivery runs, attempts, 009↔012 status mapping |
