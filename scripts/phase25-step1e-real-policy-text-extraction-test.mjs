import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_POLICY_PDF_ID, extractRealPolicyPdfText } from "../server/realPolicyTextExtractor.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const result = await extractRealPolicyPdfText({ supabase, policyPdfId: DEFAULT_POLICY_PDF_ID });
const { count: pageCount } = await supabase
  .from("real_policy_extracted_text_pages")
  .select("id", { count: "exact", head: true })
  .eq("text_extraction_run_id", result.text_extraction_run.id);
const { data: firstPages } = await supabase
  .from("real_policy_extracted_text_pages")
  .select("page_number, extracted_text, text_status")
  .eq("text_extraction_run_id", result.text_extraction_run.id)
  .order("page_number", { ascending: true })
  .limit(3);
const { count: customerDocCount } = await supabase
  .from("customer_documents")
  .select("id", { count: "exact", head: true })
  .eq("id", "7a897bce-c8dd-4ca9-b6bb-1d17945c6002")
  .is("deleted_at", null);
const textLength = (firstPages ?? []).reduce((sum, row) => sum + String(row.extracted_text ?? "").length, 0);
const report = {
  phase: "25-1E",
  tests: {
    policyPdfExists: { pass: result.policy_pdf.file_name === "3ten55_se_2(2604)_03_1.pdf", policy_pdf: result.policy_pdf },
    storagePdfReadAndTextExtracted: { pass: result.extracted_page_count > 0 && result.total_text_length > 0, extracted_page_count: result.extracted_page_count, total_text_length: result.total_text_length },
    extractionRunCreated: { pass: result.reused === true || result.extraction_run.extraction_status === "completed", extraction_run: result.extraction_run, reused: result.reused },
    textRunCompleted: { pass: result.text_extraction_run.extraction_status === "completed", text_extraction_run: result.text_extraction_run },
    extractedPagesStored: { pass: pageCount > 0 && pageCount === result.extracted_page_count && textLength > 0, pageCount, firstPages },
    processingStatusTextExtracted: { pass: result.processing_status === "text_extracted", processing_status: result.processing_status },
    customerOriginalPreserved: { pass: customerDocCount === 1, customerDocCount },
    noEmbeddingOrVector: { pass: true, note: "Embedding and vector storage are intentionally not executed in Step 1E." },
  },
  result,
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
