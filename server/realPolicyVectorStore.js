export const VECTOR_WORKER_URL = "/functions/v1/real-policy-vector-store-worker";

export async function invokeRealPolicyVectorStoreWorker({
  supabaseUrl,
  serviceRoleKey,
  policyPdfId,
  chunkOffset = 0,
  chunkLimit = 100,
  knowledgeDocId = null,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("supabaseUrl_and_serviceRoleKey_required");
  if (!policyPdfId) throw new Error("policy_pdf_id_required");

  const url = `${supabaseUrl}${VECTOR_WORKER_URL}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      policy_pdf_id: policyPdfId,
      chunk_offset: chunkOffset,
      chunk_limit: chunkLimit,
      knowledge_doc_id: knowledgeDocId,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
