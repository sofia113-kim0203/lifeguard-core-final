# Real Policy Production SQL Deploy Order

Apply scripts in Supabase SQL Editor **in this order**. Each script is one-time unless noted.

**Prerequisite:** Migrations `001`–`012` must already be applied.

**Final patches:** Run `phase15_1a_production_blocker_fix.sql` and `phase15_1c_missing_early_rpc_patch.sql` after all scripts below.

---

## Phase 11 — Generic policy RAG engine

| # | Script |
|---|--------|
| 1 | `phase11_real_data_readiness_foundation.sql` |
| 2 | `phase11_carrier_product_ingestion_readiness.sql` |
| 3 | `phase11_manual_knowledge_ingestion_foundation.sql` |
| 4 | `phase11_manual_knowledge_search_review_foundation.sql` |
| 5 | `phase11_policy_rag_foundation.sql` |
| 6 | `phase11_policy_chunk_processing_foundation.sql` |
| 7 | `phase11_embedding_preparation_foundation.sql` |
| 8 | `phase11_vector_search_foundation.sql` |
| 9 | `phase11_grounding_context_foundation.sql` |
| 10 | `phase11_claude_grounding_integration_foundation.sql` |

---

## Phase 12 — Required execution engines

| # | Script |
|---|--------|
| 11 | `phase12_embedding_execution_foundation.sql` |
| 12 | `phase12_claude_execution_foundation.sql` |
| 13 | `phase12_grounded_retrieval_validation_foundation.sql` |

### Not required for Phase 14 real-policy path (legacy parallel track)

- `phase12_policy_pdf_ingestion_foundation.sql`
- `phase12_policy_text_extraction_foundation.sql`
- `phase12_policy_chunk_generation_foundation.sql`
- `phase12_embedding_pipeline_foundation.sql`

---

## Phase 13 — Customer conversation chain

| # | Script |
|---|--------|
| 14 | `phase13_production_data_flow_validation_foundation.sql` |
| 15 | `phase13_customer_memory_integration_foundation.sql` |
| 16 | `phase13_customer_conversation_memory_foundation.sql` |
| 17 | `phase13_customer_grounded_conversation_foundation.sql` |
| 18 | `phase13_customer_ai_conversation_execution_foundation.sql` |

---

## Phase 14 — Real policy pipeline

| # | Script |
|---|--------|
| 19 | `phase14_real_policy_knowledge_ingestion_foundation.sql` |
| 20 | `phase14_real_policy_pdf_upload_storage_foundation.sql` |
| 21 | `phase14_real_policy_pdf_extraction_pipeline_foundation.sql` |
| 22 | `phase14_real_policy_text_extraction_execution_foundation.sql` |
| 23 | `phase14_real_policy_chunk_generation_foundation.sql` |
| 24 | `phase14_real_policy_embedding_preparation_foundation.sql` |
| 25 | `phase14_real_policy_embedding_execution_integration.sql` |
| 26 | `phase14_real_policy_vector_search_integration.sql` |
| 27 | `phase14_real_policy_customer_ai_conversation_integration.sql` |

---

## Phase 15-1A — Production blocker patch

| # | Script |
|---|--------|
| 28 | `phase15_1a_production_blocker_fix.sql` |

Patches:

- `lifeguard_review_policy_chunk` — syncs `real_policy_chunk_items.chunk_status`
- `lifeguard_prepare_customer_ai_conversation` — valid Claude model default
- `lifeguard_prepare_customer_real_policy_ai_conversation` — valid Claude model default

---

## Phase 15-1C — Missing early RPC patch + seed check

| # | Script | Purpose |
|---|--------|---------|
| 29 | `phase15_1c_missing_early_rpc_patch.sql` | Deploy missing early-stage RPCs |
| — | `phase15_1c_minimal_admin_e2e_seed_check.sql` | Read-only carrier/product/customer check |

### Missing RPC source files (Phase 15-1C audit)

| RPC | Source script (feature branch) |
|-----|-------------------------------|
| `lifeguard_register_real_policy_source` | `phase14_real_policy_knowledge_ingestion_foundation.sql` |
| `lifeguard_register_real_policy_pdf` | `phase14_real_policy_pdf_upload_storage_foundation.sql` |
| `lifeguard_store_real_policy_extracted_text` | `phase14_real_policy_text_extraction_execution_foundation.sql` |
| `lifeguard_register_policy_rag_source` | `phase11_policy_rag_foundation.sql` |

`phase15_1c_missing_early_rpc_patch.sql` redeploys these four RPCs only (`CREATE OR REPLACE FUNCTION`). No new tables.

### Phase 15-1C deploy steps

1. Run `phase15_1c_missing_early_rpc_patch.sql` in Supabase SQL Editor.
2. Verify missing RPCs exist (query below).
3. Run `phase15_1c_minimal_admin_e2e_seed_check.sql`.
4. If `missing_information` includes `no_active_carrier`, `no_active_product`, or `no_active_customer`, seed minimal test data manually (optional seed block in seed check script is disabled by default).
5. Begin admin E2E from **실제 약관 자료 관리** → through **실제 약관 고객 AI 답변 준비**.

### Verify missing RPCs (Phase 15-1C)

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'lifeguard_register_real_policy_source',
    'lifeguard_register_real_policy_pdf',
    'lifeguard_store_real_policy_extracted_text',
    'lifeguard_register_policy_rag_source'
  )
ORDER BY routine_name;
```

Expected: **4 rows**.

---

## Admin prerequisite (not a SQL script)

Before chunk generation (step 23), register a matching row in `policy_rag_source_registry` via **약관 RAG 소스 관리** (`lifeguard_register_policy_rag_source`, Phase 11-5).

---

## Post-deploy verification

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'lifeguard_review_policy_chunk',
    'lifeguard_prepare_customer_real_policy_ai_conversation'
  )
ORDER BY routine_name;
```

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'real_policy_customer_ai_runs',
    'real_policy_customer_ai_responses',
    'real_policy_claude_runs',
    'real_policy_claude_items',
    'real_policy_vector_search_runs',
    'real_policy_vector_search_items'
  )
ORDER BY table_name;
```

Expected duplicate-table result: **0 rows**.
