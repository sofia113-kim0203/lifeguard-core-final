# Deprecated — unsafe PR-C2 QA scripts

**Do not run.** Moved here because they violate PR-C2b shadow QA safety rules.

| Script | Reason |
|--------|--------|
| `pr-c2-production-shadow-verify.mjs` | `SERVICE_ROLE_KEY`, scans cross-customer `customer_documents` |
| `pr-c2-production-shadow-readonly-verify.mjs` | `SERVICE_ROLE_KEY`, recent-doc scan without `customer_id` |
| `pr-c2-shadow-distribution-audit.mjs` | opt-in service-role cross-customer aggregation |
| `kimjinwoo-document-extraction-audit.mjs` | service-role, dumps OCR line-by-line |

**Replacement:** `scripts/pr-c2b-coverage-sheet-shadow-rls-verify.mjs` (RLS-only, single `DOCUMENT_ID`).
