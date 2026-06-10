-- Phase 28: one phase26-2a-result assistant row per analysis job (duplicate guard)
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS customer_conversations_one_result_per_job_uidx
  ON public.customer_conversations (
    customer_id,
    ((metadata_json ->> 'analysis_job_id'))
  )
  WHERE (metadata_json ->> 'phase') = 'phase26-2a-result'
    AND COALESCE(metadata_json ->> 'analysis_job_id', '') <> '';

COMMIT;
