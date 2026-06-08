export type MemoryBuilderScope = "smoke";

export type MemoryBuilderMode = "smoke";

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
  action: "inserted" | "superseded_and_inserted" | "no_op";
  fact_id: string;
  fact_key: string;
};

export type MemoryBuilderRequestBody = {
  job_id?: string;
  customer_id?: string;
  scope?: MemoryBuilderScope;
  mode?: MemoryBuilderMode;
};
