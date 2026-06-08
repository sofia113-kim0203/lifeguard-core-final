/**
 * Phase 23 Step 2B — Customer memory snapshot context injection E2E.
 * Uses real Supabase auth/RLS rows and fake OpenAI/Claude fetches for deterministic prompt inspection.
 */
import { createClient } from "@supabase/supabase-js";
import { handleClaudeContextInjectionRequest } from "../server/claudeContextInjectionCore.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("Missing Supabase URL, anon key, or service role key");
  process.exit(1);
}

const report = {
  phase: "23-2B",
  env: { hasServiceRole: !!serviceRoleKey },
  tests: {},
};

const zeroEmbedding = Array(1536).fill(0);

async function setupCustomer(label) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `phase23-2b-${label}-${stamp}@example.com`;
  const password = `Step2b!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });

  const signUp = await sb.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`${label}_signup_failed:${signUp.error.message}`);

  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`${label}_signin_failed:${signIn.error.message}`);

  const authUid = (await sb.auth.getUser()).data.user.id;
  const bootstrap = await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `phase23-2b-${label}`,
    p_consent_version: "2026-01-01-ko",
  });
  if (bootstrap.error) throw new Error(`${label}_bootstrap_failed:${bootstrap.error.message}`);

  const profile = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authUid)
    .single();
  if (profile.error) throw new Error(`${label}_profile_failed:${profile.error.message}`);

  const session = await sb.auth.getSession();
  return { sb, customerId: profile.data.id, accessToken: session.data.session.access_token };
}

async function grantConsents(admin, customerId, consentTypes) {
  const rows = consentTypes.map((consentType) => ({
    customer_id: customerId,
    consent_type: consentType,
    consent_version: "2026-01-01-ko-step2b",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "phase23_step2b_test",
    purpose: "memory snapshot context injection test",
    required: true,
  }));
  const { error } = await admin.from("customer_consents").insert(rows);
  if (error) throw new Error(`consent_seed_failed:${error.message}`);
}

async function seedMemoryFacts(admin, primaryId, otherId) {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3600_000).toISOString();
  const rows = [
    {
      customer_id: primaryId,
      fact_key: "health.medication.summary",
      fact_value: "고객은 혈압약을 복용 중입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "health",
      importance: "critical",
      source_table: "profile_health",
      metadata_json: { consent_type: "sensitive_health_processing", field: "medication" },
    },
    {
      customer_id: primaryId,
      fact_key: "insurance.indemnity.held",
      fact_value: "고객은 실손의료비 보험을 보유 중입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "insurance",
      importance: "high",
      source_table: "profile_insurance_policies",
      metadata_json: { consent_type: "insurance_data_processing", field: "policy_type" },
    },
    {
      customer_id: primaryId,
      fact_key: "profile.occupation",
      fact_value: "고객 직업군은 사무직입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "identity",
      importance: "medium",
      source_table: "customer_profiles",
      metadata_json: { consent_type: "privacy_collection", field: "job_category" },
    },
    {
      customer_id: primaryId,
      fact_key: "health.medication.old",
      fact_value: "과거 복용약 정보이며 사용되면 안 됩니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "health",
      importance: "critical",
      source_table: "profile_health",
      metadata_json: { consent_type: "sensitive_health_processing", field: "old_medication" },
      superseded_at: now,
    },
    {
      customer_id: otherId,
      fact_key: "health.medication.summary",
      fact_value: "다른 고객의 비공개 복용약입니다.",
      confidence: 1,
      provenance_type: "profile",
      fact_type: "health",
      importance: "critical",
      source_table: "profile_health",
      metadata_json: { consent_type: "sensitive_health_processing", field: "medication" },
      updated_at: old,
    },
  ];
  const normalizedRows = rows.map((row) => ({ updated_at: now, ...row }));
  const { error } = await admin.from("customer_memory_facts").insert(normalizedRows);
  if (error) throw new Error(`memory_seed_failed:${error.message}`);
}

async function seedDocumentEvidence(admin, customerId) {
  const documentId = crypto.randomUUID();
  const { error: docError } = await admin.from("customer_documents").insert({
    id: documentId,
    customer_id: customerId,
    storage_path: `${customerId}/${documentId}/terms.txt`,
    mime_type: "text/plain",
    original_filename: "step2b-rag-terms.txt",
    doc_class: "terms",
    ingest_status: "ready",
  });
  if (docError) throw new Error(`document_seed_failed:${docError.message}`);

  const { error: chunkError } = await admin.from("customer_document_chunks").insert({
    customer_id: customerId,
    document_id: documentId,
    chunk_index: 0,
    content: "실손의료비 문서 근거: 입원 치료비는 약관상 자기부담금 공제 후 보장될 수 있습니다.",
    embedding: `[${zeroEmbedding.join(",")}]`,
    embedding_model: "text-embedding-3-small",
    doc_title: "Step2B 실손 약관",
    section: "보장",
    page: 3,
  });
  if (chunkError) throw new Error(`chunk_seed_failed:${chunkError.message}`);

  return documentId;
}

function createFakeFetch(calls) {
  return async (requestUrl, options = {}) => {
    const target = String(requestUrl);
    if (target.includes("api.openai.com/v1/embeddings")) {
      calls.openai += 1;
      return new Response(JSON.stringify({ data: [{ embedding: zeroEmbedding }] }), { status: 200 });
    }

    if (target.includes("api.anthropic.com/v1/messages")) {
      calls.anthropic += 1;
      const body = JSON.parse(options.body ?? "{}");
      calls.lastClaudeRequest = body;
      const userPrompt = body.messages?.[0]?.content ?? "";
      const memoryUsed = userPrompt.includes("[M1]") && /복용|혈압약|실손/.test(userPrompt);
      const answer = memoryUsed
        ? "A. 고객 기억 사실: [M1] 혈압약 복용 정보를 확인했습니다. B. 업로드 문서 근거: [D1] 실손 문서 근거를 확인했습니다. C. 일반 보험 설명: 문서 기준으로 추가 확인이 필요합니다."
        : "A. 고객 기억 사실: 관련 고객 기억은 사용하지 않았습니다. B. 업로드 문서 근거: 관련 문서 근거가 부족합니다. C. 일반 보험 설명: 일반적인 안내만 가능합니다.";
      return new Response(JSON.stringify({ content: [{ type: "text", text: answer }] }), { status: 200 });
    }

    return fetch(requestUrl, options);
  };
}

function promptIncludesOnlyAllowedMemory(prompt) {
  return (
    prompt.includes("A. customer_memory_snapshot:") &&
    prompt.includes("[M1] type=health key=health.medication.summary importance=critical") &&
    prompt.includes("[M2] type=insurance key=insurance.indemnity.held importance=high") &&
    prompt.includes("B. uploaded_document_evidence:") &&
    prompt.includes("[D1] document_id=") &&
    !prompt.includes("과거 복용약 정보") &&
    !prompt.includes("다른 고객의 비공개")
  );
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const primary = await setupCustomer("primary");
const other = await setupCustomer("other");
await grantConsents(admin, primary.customerId, ["document_storage", "document_analysis", "ai_consultation", "memory_retention"]);
await grantConsents(admin, other.customerId, ["document_storage", "document_analysis", "ai_consultation", "memory_retention"]);
await seedMemoryFacts(admin, primary.customerId, other.customerId);
await seedDocumentEvidence(admin, primary.customerId);

const calls = { openai: 0, anthropic: 0, lastClaudeRequest: null };
const authHeader = `Bearer ${primary.accessToken}`;
const env = {
  ...process.env,
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: anonKey,
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
};

const healthQuestion = "내가 복용 중인 약과 실손 보험 기준으로 입원 치료비 상담해줘";
const memoryResult = await handleClaudeContextInjectionRequest({
  question: healthQuestion,
  authHeader,
  mode: "execute",
  fetchImpl: createFakeFetch(calls),
  env,
});
const prompt = calls.lastClaudeRequest?.messages?.[0]?.content ?? "";

report.tests.memoryPromptInjection = {
  pass:
    memoryResult.ok &&
    memoryResult.memory_used === true &&
    memoryResult.memory_fact_count === 3 &&
    memoryResult.used_memory_facts?.some((fact) => fact.fact_key === "health.medication.summary") &&
    promptIncludesOnlyAllowedMemory(prompt),
  memory_used: memoryResult.memory_used,
  memory_fact_count: memoryResult.memory_fact_count,
  used_memory_facts: memoryResult.used_memory_facts,
  used_sources_count: memoryResult.used_sources?.length ?? 0,
  prompt_has_memory_block: prompt.includes("A. customer_memory_snapshot:"),
  prompt_has_document_block: prompt.includes("B. uploaded_document_evidence:"),
  prompt_excludes_superseded: !prompt.includes("과거 복용약 정보"),
  prompt_excludes_other_customer: !prompt.includes("다른 고객의 비공개"),
};

const unrelatedCalls = { openai: 0, anthropic: 0, lastClaudeRequest: null };
const unrelatedResult = await handleClaudeContextInjectionRequest({
  question: "미국 주식 투자 추천 종목 알려줘",
  authHeader,
  mode: "execute",
  fetchImpl: createFakeFetch(unrelatedCalls),
  env,
});
report.tests.unrelatedDoesNotUseMemory = {
  pass:
    unrelatedResult.ok &&
    unrelatedResult.memory_used === false &&
    Array.isArray(unrelatedResult.used_memory_facts) &&
    unrelatedResult.used_memory_facts.length === 0,
  memory_used: unrelatedResult.memory_used,
  used_memory_facts: unrelatedResult.used_memory_facts,
};

const ownFacts = await primary.sb
  .from("customer_memory_facts")
  .select("id", { count: "exact" })
  .eq("customer_id", primary.customerId)
  .is("superseded_at", null);
const crossFacts = await other.sb
  .from("customer_memory_facts")
  .select("id", { count: "exact" })
  .eq("customer_id", primary.customerId)
  .is("superseded_at", null);
report.tests.memoryRls = {
  pass: !ownFacts.error && ownFacts.count === 3 && !crossFacts.error && crossFacts.count === 0,
  own_active_count: ownFacts.count,
  cross_customer_count: crossFacts.count,
  cross_error: crossFacts.error?.message ?? null,
};

report.tests.ragRegression = {
  pass:
    memoryResult.ok &&
    memoryResult.context_used === true &&
    memoryResult.used_sources?.length > 0 &&
    prompt.includes("[D1] document_id=") &&
    prompt.includes("실손의료비 문서 근거"),
  context_used: memoryResult.context_used,
  insufficient_context: memoryResult.insufficient_context,
  used_sources_count: memoryResult.used_sources?.length ?? 0,
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
