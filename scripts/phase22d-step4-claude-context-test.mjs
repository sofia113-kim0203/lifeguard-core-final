/**
 * Phase 22D Step 4 — Claude context injection foundation test.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { handleClaudeContextInjectionRequest } from "../server/claudeContextInjectionCore.js";
import {
  evaluateContextSufficiency,
  formatDocumentContextForPrompt,
  mapChunksToUsedSources,
  retrieveCustomerDocumentChunks,
} from "../server/documentRagContext.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SAMPLES_DIR = join(import.meta.dirname, "samples/korean-insurance");

const KOREAN_QUESTIONS = [
  "암진단비 청구 가능해?",
  "K603 골절이면 보험금 청구 가능해?",
  "실손의료비 보장 내용 알려줘",
  "고지의무 위반하면 어떻게 돼?",
  "약관상 입원일당 지급 기준 알려줘",
];

const UNRELATED_QUESTION = "미국 주식 투자 추천 종목 알려줘";

if (!url || !anonKey) {
  console.error("Missing Supabase URL or anon key");
  process.exit(1);
}

spawnSync("python3", [join(import.meta.dirname, "korean-insurance-image-gen.py")], { stdio: "inherit" });

async function setupCustomerWithSamples() {
  const stamp = Date.now();
  const email = `phase22d-step4-${stamp}@example.com`;
  const password = `Step4!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });

  await sb.auth.signUp({ email, password });
  await sb.auth.signInWithPassword({ email, password });
  const authUid = (await sb.auth.getUser()).data.user.id;

  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: "phase22d-step4",
    p_consent_version: "2026-01-01-ko",
  });

  const { data: profile } = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authUid)
    .single();

  const customerId = profile.id;
  const consentBase = {
    customer_id: customerId,
    consent_version: "2026-06-07-ko-doc",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "phase22d_step4",
    purpose: "claude_context_test",
    required: true,
  };

  for (const consentType of ["document_storage", "document_analysis", "ai_consultation"]) {
    await sb.from("customer_consents").insert({ ...consentBase, consent_type: consentType });
  }

  const { data: session } = await sb.auth.getSession();
  const accessToken = session.session.access_token;
  const workerUrl = `${url}/functions/v1/document-ingest-worker`;

  const sampleFiles = [
    "ko-insurance-terms-1.png",
    "ko-insurance-terms-2.png",
    "ko-insurance-terms-3.png",
  ];
  const ingestedDocIds = [];

  for (const filename of sampleFiles) {
    const bytes = readFileSync(join(SAMPLES_DIR, filename));
    const documentId = crypto.randomUUID();
    const storagePath = `${customerId}/${documentId}/document-${documentId}.png`;

    await sb.storage
      .from("customer-documents")
      .upload(storagePath, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });

    await sb.from("customer_documents").insert({
      id: documentId,
      customer_id: customerId,
      storage_path: storagePath,
      mime_type: "image/png",
      original_filename: filename,
      doc_class: "other",
      ingest_status: "uploaded",
    });

    await sb.rpc("lifeguard_request_customer_document_ingest", { p_document_id: documentId });

    const workerRes = await fetch(workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_id: documentId }),
    });

    if (!workerRes.ok) {
      throw new Error(`ingest_failed:${filename}:${workerRes.status}`);
    }
    ingestedDocIds.push(documentId);
  }

  return { email, customerId, accessToken, sampleDocIds: ingestedDocIds };
}

function judgeAnswerUsesContext(answer, sources) {
  if (!answer || !sources?.length) return false;
  const sourceText = sources.map((s) => s.content_preview ?? "").join(" ");
  const markers = ["D1", "D2", "D3", "문서", "약관", "보험", "청구", "고지", "실손", "입원", "골절", "K603", "암진단"];
  const answerHit = markers.some((m) => answer.includes(m));
  const overlap = sources.some((s) => {
    const preview = s.content_preview ?? "";
    return preview.split("\n").some((line) => line.length > 2 && answer.includes(line.slice(0, 6)));
  });
  return answerHit || overlap || /\[D\d\]/.test(answer);
}

async function securityRegression(accessToken, customerId) {
  const otherStamp = Date.now();
  const otherEmail = `step4-b-${otherStamp}@example.com`;
  const otherPassword = `Step4b!${otherStamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  await sb.auth.signUp({ email: otherEmail, password: otherPassword });
  await sb.auth.signInWithPassword({ email: otherEmail, password: otherPassword });
  const otherUid = (await sb.auth.getUser()).data.user.id;
  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: "step4-b",
    p_consent_version: "2026-01-01-ko",
  });
  const { data: otherProfile } = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", otherUid)
    .single();

  const crossRes = await fetch(`${url}/rest/v1/rpc/match_customer_document_chunks`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_customer_id: otherProfile.id,
      p_query_embedding: `[${Array(1536).fill(0).join(",")}]`,
      p_match_threshold: 0.3,
      p_match_count: 5,
    }),
  });

  const anonRes = await fetch(`${url}/rest/v1/rpc/match_customer_document_chunks`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_customer_id: customerId,
      p_query_embedding: `[${Array(1536).fill(0).join(",")}]`,
      p_match_threshold: 0.3,
      p_match_count: 5,
    }),
  });

  return {
    crossStatus: crossRes.status,
    crossPass: crossRes.status === 403 || crossRes.status === 401,
    anonStatus: anonRes.status,
    anonPass: anonRes.status === 401 || anonRes.status === 403,
  };
}

function queryProbeText(question) {
  return String(question).replace(/[?？!！.。\s]+/g, " ").trim().slice(0, 24);
}

async function renderQueryPng(queryText) {
  const outPath = join(import.meta.dirname, ".tmp-step4-query.png");
  const text = queryProbeText(queryText);
  const result = spawnSync(
    "python3",
    [
      "-c",
      `from PIL import Image, ImageDraw, ImageFont; import sys
font=ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',40)
img=Image.new('RGB',(1000,200),'white'); d=ImageDraw.Draw(img)
d.text((30,70),sys.argv[1],fill='black',font=font)
img.save(sys.argv[2])`,
      text,
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`query_png_render_failed:${text}:${result.stderr}`);
  }
  return readFileSync(outPath);
}

async function embedQueryViaWorker({ sb, customerId, accessToken, query }) {
  const bytes = await renderQueryPng(query);
  const documentId = crypto.randomUUID();
  const storagePath = `${customerId}/${documentId}/document-${documentId}.png`;
  await sb.storage
    .from("customer-documents")
    .upload(storagePath, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });
  await sb.from("customer_documents").insert({
    id: documentId,
    customer_id: customerId,
    storage_path: storagePath,
    mime_type: "image/png",
    original_filename: `query-${documentId}.png`,
    doc_class: "other",
    ingest_status: "uploaded",
  });
  await sb.rpc("lifeguard_request_customer_document_ingest", { p_document_id: documentId });
  const workerRes = await fetch(`${url}/functions/v1/document-ingest-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!workerRes.ok) {
    const body = await workerRes.json().catch(() => ({}));
    throw new Error(`query_embed_failed:${query}:${workerRes.status}:${body?.message ?? ""}`);
  }
  const { data: chunks } = await sb
    .from("customer_document_chunks")
    .select("embedding")
    .eq("document_id", documentId)
    .limit(1);
  return { embedding: chunks?.[0]?.embedding, probeDocumentId: documentId };
}

async function runRagOnlyViaModules({ sb, customerId, accessToken, question, sampleDocIds }) {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  let queryEmbedding;
  let embeddingMode;

  if (hasOpenAi) {
    const result = await handleClaudeContextInjectionRequest({
      question,
      authHeader: `Bearer ${accessToken}`,
      mode: "rag_only",
    });
    return { ...result, embeddingMode: "openai_direct" };
  }

  const probe = await embedQueryViaWorker({ sb, customerId, accessToken, query: question });
  queryEmbedding = probe.embedding;
  embeddingMode = "worker_korean_query_probe";
  const chunks = await retrieveCustomerDocumentChunks(sb, {
    customerId,
    queryEmbedding,
    topK: 5,
    threshold: 0.3,
  });
  const filtered = chunks.filter((c) => sampleDocIds.includes(c.document_id));
  const usedSources = mapChunksToUsedSources(filtered);
  const { contextUsed, insufficientContext } = evaluateContextSufficiency(filtered, {
    threshold: 0.3,
    question,
  });
  return {
    ok: true,
    mode: "rag_only",
    rag_row_count: filtered.length,
    used_sources: usedSources,
    context_used: contextUsed,
    insufficient_context: insufficientContext,
    document_context_preview: formatDocumentContextForPrompt(filtered).slice(0, 1200),
    embeddingMode,
    probeDocumentId: probe.probeDocumentId,
  };
}

const { email, customerId, accessToken, sampleDocIds } = await setupCustomerWithSamples();
const authHeader = `Bearer ${accessToken}`;
const sb = createClient(url, anonKey, {
  auth: { persistSession: false },
  global: { headers: { Authorization: authHeader } },
});

const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim());

const ragResults = [];
for (const question of [...KOREAN_QUESTIONS, UNRELATED_QUESTION]) {
  const result = await runRagOnlyViaModules({
    sb,
    customerId,
    accessToken,
    question,
    sampleDocIds,
  });

  ragResults.push({
    question,
    embeddingMode: result.embeddingMode ?? "openai_direct",
    ok: result.ok,
    rag_row_count: result.rag_row_count ?? 0,
    context_used: result.context_used ?? false,
    insufficient_context: result.insufficient_context ?? true,
    used_sources_count: result.used_sources?.length ?? 0,
    top_similarity: result.used_sources?.[0]?.similarity ?? null,
    top_doc_title: result.used_sources?.[0]?.doc_title ?? null,
    top_chunk_index: result.used_sources?.[0]?.chunk_index ?? null,
    content_preview: result.used_sources?.[0]?.content_preview ?? null,
    pass:
      result.ok &&
      (question === UNRELATED_QUESTION
        ? result.insufficient_context || result.rag_row_count === 0
        : result.rag_row_count > 0 && !result.insufficient_context),
  });
}

const claudeResults = [];
if (hasOpenAi && hasAnthropic) {
  for (const question of KOREAN_QUESTIONS.slice(0, 2)) {
    const result = await handleClaudeContextInjectionRequest({
      question,
      authHeader,
      mode: "execute",
    });
    claudeResults.push({
      question,
      ok: result.ok,
      answer_preview: result.answer?.slice(0, 300) ?? null,
      used_sources_count: result.used_sources?.length ?? 0,
      context_used: result.context_used,
      insufficient_context: result.insufficient_context,
      references_context: judgeAnswerUsesContext(result.answer, result.used_sources),
      pass: result.ok && result.used_sources?.length > 0 && !result.insufficient_context,
    });
  }
}

const security = await securityRegression(accessToken, customerId);

const koreanPassCount = ragResults.filter((r) => r.question !== UNRELATED_QUESTION && r.pass).length;
const report = {
  phase: "22D-step4-claude-context-injection",
  testUser: email,
  customerId,
  env: { hasOpenAi, hasAnthropic },
  ragResults,
  claudeResults,
  koreanPassCount,
  koreanRequired: 4,
  unrelatedPass: ragResults.find((r) => r.question === UNRELATED_QUESTION)?.pass ?? false,
  security,
  allPass:
    koreanPassCount >= 4 &&
    (ragResults.find((r) => r.question === UNRELATED_QUESTION)?.pass ?? false) &&
    security.crossPass &&
    security.anonPass &&
    (claudeResults.length === 0 || claudeResults.every((r) => r.pass)),
};

writeFileSync(join(import.meta.dirname, ".phase22d-step4-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
