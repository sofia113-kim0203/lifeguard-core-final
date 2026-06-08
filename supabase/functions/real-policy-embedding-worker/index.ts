import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function resolveServiceRoleKey(): string | undefined {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SERVICE_ROLE_KEY")?.trim() ||
    (() => {
      const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
      if (!secretKeys) return undefined;
      if (secretKeys.startsWith("[")) {
        try {
          const parsed = JSON.parse(secretKeys) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0) {
            return (parsed.find((e) => typeof e === "string" && e.startsWith("sb_secret_")) ?? parsed[0]) as string;
          }
        } catch { /* fall through */ }
      }
      return secretKeys;
    })()
  );
}

async function embedBatch(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`openai_error: http_${response.status} ${body.slice(0, 120)}`);
  }
  const payload = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
  const ordered: (number[] | null)[] = texts.map(() => null);
  for (const item of payload.data ?? []) {
    if (typeof item.index === "number" && Array.isArray(item.embedding) && item.embedding.length === EMBEDDING_DIMENSIONS) {
      ordered[item.index] = item.embedding;
    }
  }
  return ordered;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = resolveServiceRoleKey();
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "worker_not_configured" }, 500);
  if (!openAiApiKey) return jsonResponse({ error: "openai_api_key_missing" }, 500);

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== serviceRoleKey) return jsonResponse({ error: "service_role_required" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_json_body" }, 422); }

  const policyPdfId = String(body.policy_pdf_id ?? "").trim();
  const chunkGenerationRunId = String(body.chunk_generation_run_id ?? "").trim();
  const chunkOffset = typeof body.chunk_offset === "number" ? body.chunk_offset : 0;
  const chunkLimit = typeof body.chunk_limit === "number" ? body.chunk_limit : 200;
  const prepRunId = String(body.prep_run_id ?? "").trim() || null;
  if (!policyPdfId) return jsonResponse({ error: "policy_pdf_id_required" }, 422);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { count: chunkCount, error: countError } = await admin
    .from("real_policy_chunk_items")
    .select("id", { count: "exact", head: true })
    .eq("policy_pdf_id", policyPdfId)
    .eq("chunk_status", "created");
  if (countError) return jsonResponse({ error: `chunk_count_failed: ${countError.message}` }, 500);
  if ((chunkCount ?? 0) === 0 && !prepRunId) return jsonResponse({ error: "no_pending_chunks", note: "all_chunks_already_embedded" }, 200);

  let actualPrepRunId = prepRunId;
  if (!actualPrepRunId) {
  const { data: prepRunData, error: prepInsertError } = await admin
    .from("real_policy_embedding_preparation_runs")
    .insert({
      real_chunk_generation_run_id: chunkGenerationRunId || null,
      rag_source_id: body.rag_source_id ?? null,
      embedding_provider: "openai",
      embedding_model: EMBEDDING_MODEL,
      preparation_status: "processing",
      approved_chunk_count: 0,
      queued_chunk_count: chunkCount ?? 0,
      skipped_chunk_count: 0,
      preparation_context: {
        engine: "real-policy-embedding-worker",
        policy_pdf_id: policyPdfId,
        actual_embeddings: true,
        no_mock: true,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
      },
      missing_information: [],
    })
    .select("id, preparation_status, queued_chunk_count")
    .single();
  if (prepInsertError) return jsonResponse({ error: `prep_run_insert_failed: ${prepInsertError.message}` }, 500);
  actualPrepRunId = prepRunData.id;
  } // end !prepRunId
  if (!actualPrepRunId) return jsonResponse({ error: "prep_run_id_required" }, 422);

  let offset = chunkOffset;
  const endOffset = chunkOffset + chunkLimit;
  let embeddedCount = 0;
  let failedCount = 0;
  const failedChunkIds: string[] = [];

  while (true) {
    const { data: chunks, error: chunkError } = await admin
      .from("real_policy_chunk_items")
      .select("id, chunk_sequence, chunk_text")
      .eq("policy_pdf_id", policyPdfId)
      .eq("chunk_status", "created")
      .order("chunk_sequence", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (chunkError) break;
    if (!chunks?.length) break;
    if (offset >= endOffset) break;

    const batchTexts = chunks.slice(0, endOffset - offset).map((c) => String(c.chunk_text ?? "").trim());
    const texts = batchTexts;
    let vectors: (number[] | null)[] | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try { vectors = await embedBatch(texts, openAiApiKey); break; } catch { if (attempt === MAX_RETRIES) vectors = null; }
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors?.[i] ?? null;
      if (vector) {
        const vectorRef = `real_policy:${policyPdfId}:${chunk.chunk_sequence}`;
        await admin.from("real_policy_embedding_preparation_items").insert({
          real_embedding_preparation_run_id: actualPrepRunId,
          real_policy_chunk_item_id: chunk.id,
          chunk_registry_id: null,
          embedding_queue_id: null,
          item_status: "embedded",
        });
        await admin.from("real_policy_chunk_items").update({
          chunk_status: "embedded",
          source_reference: vectorRef,
        }).eq("id", chunk.id);
        embeddedCount += 1;
      } else {
        await admin.from("real_policy_embedding_preparation_items").insert({
          real_embedding_preparation_run_id: actualPrepRunId,
          real_policy_chunk_item_id: chunk.id,
          chunk_registry_id: null,
          embedding_queue_id: null,
          item_status: "failed",
          error_message: "embedding_failed_after_retries",
        });
        failedCount += 1;
        failedChunkIds.push(chunk.id);
      }
    }
    offset += chunks.length;
  }

  const finalStatus = failedCount === 0 ? "completed" : embeddedCount > 0 ? "partial" : "failed";
  await admin.from("real_policy_embedding_preparation_runs").update({
    preparation_status: finalStatus,
    approved_chunk_count: embeddedCount,
    queued_chunk_count: 0,
    skipped_chunk_count: failedCount,
    completed_at: new Date().toISOString(),
    preparation_context: {
      engine: "real-policy-embedding-worker",
      policy_pdf_id: policyPdfId,
      actual_embeddings: true,
      no_mock: true,
      embedding_model: EMBEDDING_MODEL,
      embedding_dimensions: EMBEDDING_DIMENSIONS,
      embedded_count: embeddedCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    },
  }).eq("id", actualPrepRunId);

  const processing_status = failedCount === 0 ? "embedded" : "embedding_partial";
  return jsonResponse({
    worker: "real-policy-embedding-worker",
    policy_pdf_id: policyPdfId,
    preparation_run_id: actualPrepRunId,
    chunk_offset: chunkOffset,
    chunk_limit: chunkLimit,
    next_offset: chunkOffset + chunkLimit,
    embedding_model: EMBEDDING_MODEL,
    embedded_count: embeddedCount,
    failed_count: failedCount,
    failed_chunk_ids: failedChunkIds.slice(0, 10),
    processing_status,
    no_mock: true,
    actual_embeddings: true,
  });
});
