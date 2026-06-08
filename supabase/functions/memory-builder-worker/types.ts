export type MemoryBuilderScope = "smoke" | "profile_health_policy" | "conversation";

export type MemoryBuilderMode = "smoke" | "extract" | "rebuild";

export type WorkerJobRecord = {
  id: string;
  job_type: string;
  status: string;
  customer_id: string;
  source_ref: string;
  payload_json: Record<string, unknown>;
  retry_count: number;
};

export type SmokeFactResult = {
  action: FactUpsertAction;
  fact_id: string;
  fact_key: string;
};

export type FactUpsertAction = "inserted" | "superseded_and_inserted" | "no_op";

export type FactUpsertResult = {
  action: FactUpsertAction;
  fact_id: string;
  fact_key: string;
};

export type CandidateFact = {
  customer_id: string;
  fact_key: string;
  fact_value: string;
  fact_type: "identity" | "health" | "insurance" | "preference" | "risk";
  importance: "low" | "medium" | "high" | "critical";
  source_table: string;
  source_record_id: string;
  confidence: number;
  metadata_json: Record<string, unknown>;
};

export type ExtractRebuildResult = {
  consent_snapshot: Record<string, boolean>;
  extractors: Record<
    string,
    {
      skipped: boolean;
      skip_reason?: string;
      candidate_count: number;
    }
  >;
  fact_results: FactUpsertResult[];
  fact_action_summary: Record<FactUpsertAction, number>;
  facts_changed: number;
  memory_version: number | null;
  fact_keys: string[];
};

export type MemoryBuilderRequestBody = {
  job_id?: string;
  customer_id?: string;
  scope?: MemoryBuilderScope;
  mode?: MemoryBuilderMode;
};
