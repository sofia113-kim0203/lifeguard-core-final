import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
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
      const s = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
      if (!s) return undefined;
      if (s.startsWith("[")) {
        try {
          const p = JSON.parse(s) as unknown;
          if (Array.isArray(p) && p.length > 0) {
            return (p.find((e) => typeof e === "string" && e.startsWith("sb_secret_")) ?? p[0]) as string;
          }
        } catch { /* */ }
      }
      return s;
    })()
  );
}

async function embedBatch(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  const r = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  });
  if (!r.ok) throw new Error(`openai_error: ${r.status}`);
  const p = await r.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
  const ordered: (number[] | null)[] = texts.map(() => null);
  for (const item of p.data ?? []) {
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
  const chunkOffset = typeof body.chunk_offset === "number" ? body.chunk_offset : 0;
  const chunkLimit = typeof body.chunk_limit === "number" ? body.chunk_limit : 100;
  let knowledgeDocId = String(body.knowledge_doc_id ?? "").trim() || null;
  if (!policyPdfId) return jsonResponse({ error: "policy_pdf_id_required" }, 422);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (!knowledgeDocId) {
    const existing = await admin.from("policy_knowledge_documents")
      .select("id")
      .eq("storage_path", `policy-pdfs/hanwha/${policyPdfId}.pdf`)
      .maybeSingle();
    if (existing.data?.id) {
      knowledgeDocId = existing.data.id;
    } else {
      const pdfRow = await admin.from("real_policy_pdf_registry")
        .select("file_name, storage_path, carrier_id, product_id")
        .eq("id", policyPdfId)
        .single();
      if (pdfRow.error) return jsonResponse({ error: `pdf_not_found: ${pdfRow.error.message}` }, 500);
      const docInsert = await admin.from("policy_knowledge_documents").insert({
        document_type: "policy_terms",
        title: pdfRow.data.file_name,
        storage_path: pdfRow.data.storage_path,
        ingest_status: "processing",
        metadata_json: {
          policy_pdf_id: policyPdfId,
          carrier_id: pdfRow.data.carrier_id,
          product_id: pdfRow.data.product_id,
          source: "real_policy_vector_store_worker",
          no_mock: true,
        },
      }).select("id").single();
      if (docInsert.error) return jsonResponse({ error: `doc_insert_failed: ${docInsert.error.message}` }, 500);
      knowledgeDocId = docInsert.data.id;
    }
  }

  const { data: chunks, error: chunksError } = await admin
    .from("real_policy_chunk_items")
    .select("id, chunk_sequence, chunk_text")
    .eq("policy_pdf_id", policyPdfId)
    .eq("chunk_status", "approved")
    .order("chunk_sequence", { ascending: true })
    .range(chunkOffset, chunkOffset + chunkLimit - 1);

  if (chunksError) return jsonResponse({ error: `chunks_lookup_failed: ${chunksError.message}` }, 500);
  if (!chunks?.length) {
    await admin.from("policy_knowledge_documents").update({ ingest_status: "ready", metadata_json: { policy_pdf_id: policyPdfId, completed_at: new Date().toISOString() } }).eq("id", knowledgeDocId);
    return jsonResponse({ knowledge_doc_id: knowledgeDocId, chunk_offset: chunkOffset, chunks_processed: 0, stored_count: 0, failed_count: 0, all_done: true, no_mock: true });
  }

  const texts = chunks.map((c) => String(c.chunk_text ?? "").trim());
  let vectors: (number[] | null)[] | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { vectors = await embedBatch(texts, openAiApiKey); break; } catch { if (attempt === 3) vectors = null; }
  }

  let storedCount = 0;
  let failedCount = 0;
  const insertRows = [];
  for (let i = 0; i < chunks.length; i++) {
    const vec = vectors?.[i];
    if (vec) {
      insertRows.push({
        document_id: knowledgeDocId,
        chunk_text: texts[i],
        embedding: `[${vec.join(",")}]`,
        embedding_model: EMBEDDING_MODEL,
        chunk_order: chunks[i].chunk_sequence,
      });
    } else {
      failedCount += 1;
    }
  }

  if (insertRows.length > 0) {
    const { error: insertError } = await admin.from("policy_knowledge_chunks").insert(insertRows);
    if (!insertError) storedCount = insertRows.length;
    else return jsonResponse({ error: `chunk_insert_failed: ${insertError.message}`, knowledge_doc_id: knowledgeDocId }, 500);
  }

  return jsonResponse({
    knowledge_doc_id: knowledgeDocId,
    chunk_offset: chunkOffset,
    chunk_limit: chunkLimit,
    next_offset: chunkOffset + chunkLimit,
    chunks_processed: chunks.length,
    stored_count: storedCount,
    failed_count: failedCount,
    no_mock: true,
    actual_embeddings: true,
    embedding_model: EMBEDDING_MODEL,
  });
});
