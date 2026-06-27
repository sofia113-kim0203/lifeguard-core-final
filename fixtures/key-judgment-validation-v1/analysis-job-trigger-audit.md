# Analysis Job Trigger Audit

Observed: 2026-06-27T11:56:29.822Z
Staging ref: `inwswsruvvzaeioqkelq`
Preview: `https://lifeguard-core-final-f2dr3qccw-70sofia113-1918s-projects.vercel.app`

## Trigger map

| Trigger | API | Inserts job? |
|---------|-----|--------------|
| document_upload_pipeline | `POST /api/customer-document-analysis-refresh` | true |
| customer_analysis_request | `POST /api/customer-conversational-qa` | conditional |
| key_home_chat | `POST /api/customer-home-brain-fact` | false |
| recommendation_request | `POST /api/customer-recommendations (+ underwriting-risk, insurance-design)` | false |
| background_worker | `GET/POST /api/analysis-jobs-runner (CRON_SECRET)` | false |

## Staging DB

```json
{
  "auth": "service_role",
  "analysis_jobs_total": 0,
  "qa_customer_jobs": 0
}
```

## Preview probes

```json
[
  {
    "probe": "preview_access",
    "bypass_secret_set": true
  },
  {
    "probe": "preview_serverless_env",
    "status": 200,
    "bindings": {
      "SUPABASE_URL": {
        "set": true,
        "ref": "inwswsruvvzaeioqkelq"
      },
      "SUPABASE_ANON_KEY": {
        "set": true,
        "len": 208
      },
      "VITE_SUPABASE_URL": {
        "set": true,
        "ref": "fhvlxcguvjvtftttfrix"
      },
      "VITE_SUPABASE_ANON_KEY": {
        "set": true,
        "len": 46
      }
    },
    "staging_ref_match": true
  },
  {
    "probe": "key_home_brain_fact",
    "route": "/api/customer-home-brain-fact",
    "status": 200,
    "ok": true,
    "sales_director_loop": true,
    "creates_job_by_design": false,
    "reason": null
  },
  {
    "probe": "legacy_conversational_qa",
    "route": "/api/customer-conversational-qa",
    "status": 500,
    "ok": false,
    "job_skipped": null,
    "analysis_job_id": null,
    "reason": "SERVER_ERROR",
    "error_message": "profile_lookup_failed: Invalid API key",
    "tom_gap_light_path": null
  },
  {
    "probe": "document_analysis_refresh",
    "route": "/api/customer-document-analysis-refresh",
    "status": 500,
    "ok": false,
    "analysis_job_id": null,
    "reason": "analysis_refresh_failed",
    "error_message": "analysis_cache_load_failed: Invalid API key"
  },
  {
    "probe": "recommendation_panel",
    "route": "/api/customer-recommendations",
    "status": 200,
    "ok": true,
    "creates_job_by_design": false,
    "reason": null
  }
]
```

## Job count deltas (QA customer)

```json
{
  "qa_customer": "a247a66f-a597-4ccf-9530-761b82518002",
  "before": 0,
  "after_home_brain": 0,
  "after_conversational_qa": 0,
  "after_document_refresh": 0
}
```

## Synthesis

- KEY home chat (/api/customer-home-brain-fact) returned 200 — current Preview KEY path does not create analysis_jobs by design.
- Preview env mismatch: SUPABASE_URL=inwswsruvvzaeioqkelq but VITE_SUPABASE_URL=fhvlxcguvjvtftttfrix.
- Job-insert APIs reached Preview but failed with Invalid API key — likely SERVICE_ROLE_KEY / Supabase project mismatch on serverless (not a KEY bug).
- Background cron (/api/analysis-jobs-runner) only processes existing queued jobs — cannot explain zero rows alone.
- Document upload pipeline would call /api/customer-document-analysis-refresh after extract — same insert path as direct refresh probe.

