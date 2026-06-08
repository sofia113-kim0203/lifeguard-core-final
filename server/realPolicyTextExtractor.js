export const DEFAULT_POLICY_PDF_ID = "526e2e06-1729-4f95-9bda-0b410b604de2";

async function downloadPolicyPdf(supabase, policyPdf) {
  const { data, error } = await supabase.storage.from("policy-pdfs").download(policyPdf.storage_path);
  if (error || !data) throw new Error(`policy_pdf_download_failed: ${error?.message ?? "no_blob"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function parsePdfPages(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      pageCount: result.total,
      totalTextLength: result.text.length,
      pages: (result.pages ?? [])
        .map((page) => ({ page_number: page.num, text: String(page.text ?? "").trim() }))
        .filter((page) => page.text.length > 0),
    };
  } finally {
    await parser.destroy();
  }
}

async function getPolicyPdf(supabase, policyPdfId) {
  const { data, error } = await supabase
    .from("real_policy_pdf_registry")
    .select("id, policy_source_id, carrier_id, product_id, file_name, file_size, file_type, storage_path, file_version, upload_status")
    .eq("id", policyPdfId)
    .single();
  if (error || !data) throw new Error(`policy_pdf_not_found: ${error?.message ?? policyPdfId}`);
  return data;
}

async function findCompletedTextRun(supabase, policyPdfId) {
  const { data, error } = await supabase
    .from("real_policy_text_extraction_runs")
    .select("id, extraction_run_id, policy_pdf_id, extraction_status, extracted_page_count, extraction_context, created_at, completed_at")
    .eq("policy_pdf_id", policyPdfId)
    .eq("extraction_status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`text_run_lookup_failed: ${error.message}`);
  return data ?? null;
}

async function countExtractedPages(supabase, textRunId) {
  const { count, error } = await supabase
    .from("real_policy_extracted_text_pages")
    .select("id", { count: "exact", head: true })
    .eq("text_extraction_run_id", textRunId);
  if (error) throw new Error(`extracted_page_count_failed: ${error.message}`);
  return count ?? 0;
}

async function insertRowsInBatches(supabase, table, rows, batchSize = 100) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`${table}_insert_failed: ${error.message}`);
  }
}

export async function extractRealPolicyPdfText({ supabase, policyPdfId = DEFAULT_POLICY_PDF_ID } = {}) {
  if (!supabase) throw new Error("supabase_required");
  const policyPdf = await getPolicyPdf(supabase, policyPdfId);
  const existing = await findCompletedTextRun(supabase, policyPdfId);
  if (existing) {
    const existingPageCount = await countExtractedPages(supabase, existing.id);
    if (existingPageCount > 0) {
      return {
        policy_pdf_id: policyPdfId,
        policy_pdf: policyPdf,
        extraction_run: { id: existing.extraction_run_id, reused: true },
        text_extraction_run: { ...existing, reused: true },
        extracted_page_count: existingPageCount,
        total_text_length: existing.extraction_context?.total_text_length ?? null,
        processing_status: "text_extracted",
        reused: true,
      };
    }
  }

  const buffer = await downloadPolicyPdf(supabase, policyPdf);
  const parsed = await parsePdfPages(buffer);
  if (parsed.pages.length === 0 || parsed.totalTextLength === 0) throw new Error("pdf_text_extraction_empty");

  const { data: extractionRun, error: extractionError } = await supabase
    .from("real_policy_pdf_extraction_runs")
    .insert({
      policy_pdf_id: policyPdfId,
      extraction_status: "processing",
      page_count: parsed.pageCount,
      extraction_context: {
        engine: "pdf-parse",
        actual_pdf: true,
        no_mock: true,
        total_text_length: parsed.totalTextLength,
      },
      missing_information: [],
    })
    .select("id, policy_pdf_id, extraction_status, page_count, extraction_context, created_at")
    .single();
  if (extractionError) throw new Error(`extraction_run_insert_failed: ${extractionError.message}`);

  await insertRowsInBatches(supabase, "real_policy_pdf_page_registry", parsed.pages.map((page) => ({
    extraction_run_id: extractionRun.id,
    policy_pdf_id: policyPdfId,
    page_number: page.page_number,
    page_status: "processed",
    page_reference: `${policyPdf.file_name}#page=${page.page_number}`,
  })));

  const { data: textRun, error: textRunError } = await supabase
    .from("real_policy_text_extraction_runs")
    .insert({
      extraction_run_id: extractionRun.id,
      policy_pdf_id: policyPdfId,
      extraction_status: "processing",
      extracted_page_count: 0,
      extraction_context: {
        engine: "pdf-parse",
        actual_pdf: true,
        no_mock: true,
        page_count: parsed.pageCount,
        total_text_length: parsed.totalTextLength,
      },
      missing_information: [],
    })
    .select("id, extraction_run_id, policy_pdf_id, extraction_status, extracted_page_count, extraction_context, created_at")
    .single();
  if (textRunError) throw new Error(`text_run_insert_failed: ${textRunError.message}`);

  await insertRowsInBatches(supabase, "real_policy_extracted_text_pages", parsed.pages.map((page) => ({
    text_extraction_run_id: textRun.id,
    policy_pdf_id: policyPdfId,
    page_number: page.page_number,
    extracted_text: page.text,
    text_status: "extracted",
  })));

  const completedAt = new Date().toISOString();
  const { error: textUpdateError } = await supabase
    .from("real_policy_text_extraction_runs")
    .update({
      extraction_status: "completed",
      extracted_page_count: parsed.pages.length,
      completed_at: completedAt,
      extraction_context: {
        ...textRun.extraction_context,
        completed_at: completedAt,
      },
    })
    .eq("id", textRun.id);
  if (textUpdateError) throw new Error(`text_run_update_failed: ${textUpdateError.message}`);

  const { error: extractionUpdateError } = await supabase
    .from("real_policy_pdf_extraction_runs")
    .update({ extraction_status: "completed", completed_at: completedAt })
    .eq("id", extractionRun.id);
  if (extractionUpdateError) throw new Error(`extraction_run_update_failed: ${extractionUpdateError.message}`);

  return {
    policy_pdf_id: policyPdfId,
    policy_pdf: policyPdf,
    extraction_run: { ...extractionRun, extraction_status: "completed" },
    text_extraction_run: { ...textRun, extraction_status: "completed", extracted_page_count: parsed.pages.length, completed_at: completedAt },
    extracted_page_count: parsed.pages.length,
    total_text_length: parsed.totalTextLength,
    sample_text: parsed.pages.slice(0, 3).map((page) => page.text.slice(0, 240)),
    processing_status: "text_extracted",
    reused: false,
  };
}
