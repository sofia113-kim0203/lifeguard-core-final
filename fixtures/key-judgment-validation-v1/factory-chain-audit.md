# Factory Chain Audit — Blood Flow Report

Customer: `a247a66f-a597-4ccf-9530-761b82518002`
Observed: 2026-06-27T09:31:52.730Z

## Chain

| Step | State | Reason |
|------|-------|--------|
| document | **exists** | customer_documents_present |
| memory | **exists** | customer_memory_facts_present |
| analysis_job | **missing** | no_analysis_job_ever_created |
| coverage_gap | **skip** | analysis_job_never_created |
| underwriting | **skip** | analysis_job_never_created |
| recommendation | **skip** | analysis_job_never_created |

## Breakpoint

**analysis_job** — missing: no_analysis_job_ever_created

## Interpretation

Blood flow stops at analysis_job (missing: no_analysis_job_ever_created)