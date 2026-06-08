export const DEFAULT_POLICY_PDF_ID = "526e2e06-1729-4f95-9bda-0b410b604de2";
export const DEFAULT_TEXT_EXTRACTION_RUN_ID = "a8194b3f-9fe6-41d3-bb57-b26063703979";

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function splitIntoChunks(pageText, maxChars = 1200) {
  const text = normalizeText(pageText);
  if (!text) return [];
  const chunks = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks;
}

async function maybeSingle(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? null;
}

async function existingCompletedRun(supabase, policyPdfId) {
  return maybeSingle(
    supabase
      .from("real_policy_chunk_generation_runs")
      .select("id, text_extraction_run_id, policy_pdf_id, policy_source_id, generation_status, source_page_count, generated_chunk_count, generation_context, completed_at")
      .eq("policy_pdf_id", policyPdfId)
      .eq("generation_status", "completed")
      .order("created_at", { ascending: false })
      .limit(1),
    "chunk_run_lookup_failed",
  );
}

async function countChunks(supabase, runId) {
  const { count, error } = await supabase
    .from("real_policy_chunk_items")
    .select("id", { count: "exact", head: true })
    .eq("real_chunk_generation_run_id", runId);
  if (error) throw new Error(`chunk_count_failed: ${error.message}`);
  return count ?? 0;
}

async function insertRowsInBatches(supabase, table, rows, batchSize = 200) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`${table}_insert_failed: ${error.message}`);
  }
}

export async function generateRealPolicyChunks({
  supabase,
  policyPdfId = DEFAULT_POLICY_PDF_ID,
  textExtractionRunId = DEFAULT_TEXT_EXTRACTION_RUN_ID,
  maxChars = 1200,
} = {}) {
  if (!supabase) throw new Error("supabase_required");
  const { data: policyPdf, error: pdfError } = await supabase
    .from("real_policy_pdf_registry")
    .select("id, policy_source_id, carrier_id, product_id, file_name, storage_path")
    .eq("id", policyPdfId)
    .single();
  if (pdfError || !policyPdf) throw new Error(`policy_pdf_not_found: ${pdfError?.message ?? policyPdfId}`);

  const existing = await existingCompletedRun(supabase, policyPdfId);
  if (existing) {
    const existingCount = await countChunks(supabase, existing.id);
    if (existingCount > 0) {
      return { policy_pdf: policyPdf, chunk_generation_run: { ...existing, reused: true }, chunk_count: existingCount, processing_status: "chunked", reused: true };
    }
  }

  const { data: pages, error: pagesError } = await supabase
    .from("real_policy_extracted_text_pages")
    .select("page_number, extracted_text")
    .eq("text_extraction_run_id", textExtractionRunId)
    .eq("policy_pdf_id", policyPdfId)
    .order("page_number", { ascending: true });
  if (pagesError) throw new Error(`extracted_pages_lookup_failed: ${pagesError.message}`);
  if (!pages?.length) throw new Error("extracted_pages_required");

  const { data: run, error: runError } = await supabase
    .from("real_policy_chunk_generation_runs")
    .insert({
      text_extraction_run_id: textExtractionRunId,
      policy_pdf_id: policyPdfId,
      policy_source_id: policyPdf.policy_source_id,
      generation_status: "processing",
      source_page_count: pages.length,
      generated_chunk_count: 0,
      generation_context: {
        engine: "real_policy_chunker",
        actual_extracted_text: true,
        no_mock: true,
        max_chars: maxChars,
        rag_source_deferred_until_embedding: true,
      },
      missing_information: [],
    })
    .select("id, text_extraction_run_id, policy_pdf_id, policy_source_id, generation_status, source_page_count, generated_chunk_count, generation_context, created_at")
    .single();
  if (runError) throw new Error(`chunk_run_insert_failed: ${runError.message}`);

  const rows = [];
  let sequence = 1;
  for (const page of pages) {
    for (const chunkText of splitIntoChunks(page.extracted_text, maxChars)) {
      rows.push({
        real_chunk_generation_run_id: run.id,
        policy_pdf_id: policyPdfId,
        policy_source_id: policyPdf.policy_source_id,
        page_number: page.page_number,
        chunk_sequence: sequence,
        chunk_text: chunkText,
        chunk_status: "created",
        source_reference: `${policyPdf.file_name}#page=${page.page_number}#chunk=${sequence}`,
      });
      sequence += 1;
    }
  }
  if (rows.length === 0) throw new Error("no_chunks_generated");
  await insertRowsInBatches(supabase, "real_policy_chunk_items", rows);
  const completedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("real_policy_chunk_generation_runs")
    .update({
      generation_status: "completed",
      generated_chunk_count: rows.length,
      completed_at: completedAt,
      generation_context: { ...run.generation_context, completed_at: completedAt, generated_chunk_count: rows.length },
    })
    .eq("id", run.id);
  if (updateError) throw new Error(`chunk_run_update_failed: ${updateError.message}`);

  return {
    policy_pdf: policyPdf,
    chunk_generation_run: { ...run, generation_status: "completed", generated_chunk_count: rows.length, completed_at: completedAt },
    chunk_count: rows.length,
    sample_chunks: rows.slice(0, 3).map((row) => ({ page_number: row.page_number, chunk_sequence: row.chunk_sequence, chunk_text: row.chunk_text.slice(0, 240) })),
    processing_status: "chunked",
    reused: false,
  };
}
