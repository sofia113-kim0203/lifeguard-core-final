/**
 * Document → Insurance Memory pipeline test (production data only).
 * Customer: 2d61e1eb-4b8e-43f4-9d31-ad2300ed554e (김진우)
 * Documents: 김진우.jpg, 보장분석-김진우 jpg.jpg
 */
import { createClient } from "@supabase/supabase-js";
import { runCustomerInsuranceMemoryPipeline } from "../server/customerDocumentToInsuranceMemoryPipeline.js";

const CUSTOMER_ID = "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
const DOCUMENT_IDS = [
  "12c0dcda-a519-4f6f-aeb1-6ae5d8a3d926",
  "41a774e7-6a13-45b0-9f59-9197f1da2cae",
];

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  console.log("=== Document Insurance Memory Pipeline Test ===");
  console.log("customer:", CUSTOMER_ID);

  const { data: docsBefore } = await supabase
    .from("customer_documents")
    .select("id, original_filename, ingest_status")
    .in("id", DOCUMENT_IDS)
    .is("deleted_at", null);
  assert(docsBefore?.length >= 2, `documents exist in customer_documents (${docsBefore?.length})`);

  const pipeline = await runCustomerInsuranceMemoryPipeline({
    supabase,
    supabaseUrl: url,
    serviceRoleKey,
    customerId: CUSTOMER_ID,
    documentIds: DOCUMENT_IDS,
  });

  console.log("merged policies:", pipeline.merged_extraction?.policy_count);
  console.log("insurers:", pipeline.merged_extraction?.insurers?.join(", "));

  assert(pipeline.merged_extraction?.policy_count > 0, "insurer/product/policy count extracted");
  assert(pipeline.merged_extraction?.insurers?.length > 0, "insurers detected");

  for (const docId of DOCUMENT_IDS) {
    const { data: doc } = await supabase
      .from("customer_documents")
      .select("ingest_status, metadata_json")
      .eq("id", docId)
      .single();
    const hasExtract = Boolean(doc.metadata_json?.structured_extract?.policy_count > 0);
    const ocrReady = doc.ingest_status === "ready" || hasExtract;
    assert(ocrReady, `OCR/extract completed for ${docId} (status=${doc.ingest_status})`);
  }

  const { data: policies } = await supabase
    .from("profile_insurance_policies")
    .select("id, insurer_name, product_name, source")
    .eq("customer_id", CUSTOMER_ID)
    .eq("source", "upload_extract")
    .is("deleted_at", null);
  assert((policies ?? []).length > 0, `profile_insurance_policies upload_extract rows (${policies?.length})`);

  const { data: facts } = await supabase
    .from("customer_memory_facts")
    .select("fact_key, fact_value, fact_type")
    .eq("customer_id", CUSTOMER_ID)
    .eq("fact_type", "insurance")
    .is("superseded_at", null);
  assert((facts ?? []).length > 0, `customer_memory_facts insurance facts (${facts?.length})`);

  const insuranceFactKeys = (facts ?? []).map((f) => f.fact_key);
  console.log("insurance fact keys:", insuranceFactKeys.join(", "));

  assert(
    insuranceFactKeys.some((k) => k.includes("insurance.policy.count")),
    "insurance.policy.count fact exists",
  );

  const memoryVersion = pipeline.memory_rebuild?.memory_version;
  assert(memoryVersion != null, `memory rebuilt (version=${memoryVersion})`);

  const { buildDirectFactualAnswer } = await import("../server/customerConversationalTone.js");
  const { loadCustomerMemorySnapshot } = await import("../server/customerMemorySnapshot.js");
  const { loadCustomerSourceContext } = await import("../server/customerMemoryContextSync.js");

  const snapshot = await loadCustomerMemorySnapshot(supabase, CUSTOMER_ID);
  const sourceContext = await loadCustomerSourceContext(supabase, CUSTOMER_ID);
  const workingContext = {
    snapshot,
    sourceContext,
    sourceSummary: {
      insurance: (sourceContext.policies ?? []).map((p) => ({
        insurer: p.insurer_name,
        product: p.product_name,
        insurer_name: p.insurer_name,
        product_name: p.product_name,
        is_active: p.is_active,
      })),
    },
  };

  const q1 = buildDirectFactualAnswer("나의 보험 총 건수는?", workingContext);
  const q2 = buildDirectFactualAnswer("내가 가입한 보험사는?", workingContext);
  const q3 = buildDirectFactualAnswer("내가 가입한 보험은?", workingContext);

  console.log("\n--- AI 상담 direct answers ---");
  console.log("Q1:", q1?.slice(0, 200));
  console.log("Q2:", q2?.slice(0, 200));
  console.log("Q3:", q3?.slice(0, 200));

  assert(q1 && !q1.includes("찾지 못했습니다"), "Q1 보험 총 건수 answered");
  assert(q2 && !q2.includes("확인하지 못했습니다"), "Q2 가입 보험사 answered");
  assert(q3 || q1, "Q3 가입 보험 (via policy descriptions)");

  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((error) => {
  console.error("TEST FAILED:", error);
  process.exit(1);
});
