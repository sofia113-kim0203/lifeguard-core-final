export const POLICY_PDF_ID = "526e2e06-1729-4f95-9bda-0b410b604de2";
export const CHUNK_GENERATION_RUN_ID = "f3b29366-21f9-408f-810a-602cc134ccb6";
export const EMBEDDING_WORKER_URL = "/functions/v1/real-policy-embedding-worker";
export const RAG_SOURCE_ID = "fc5f6fda-137d-4dcf-9102-8c4aa69ce161";

export async function invokeRealPolicyEmbeddingWorker({
  supabaseUrl,
  serviceRoleKey,
  policyPdfId = POLICY_PDF_ID,
  chunkGenerationRunId = CHUNK_GENERATION_RUN_ID,
  chunkOffset = 0,
  chunkLimit = 200,
  ragSourceId = RAG_SOURCE_ID,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("supabaseUrl_and_serviceRoleKey_required");
  const url = `${supabaseUrl}${EMBEDDING_WORKER_URL}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      policy_pdf_id: policyPdfId,
      chunk_generation_run_id: chunkGenerationRunId,
      rag_source_id: ragSourceId,
      chunk_offset: chunkOffset,
      chunk_limit: chunkLimit,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
