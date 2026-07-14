/**
 * Claude-Full document-direct — unit tests (no network · no real customer PDF · no commit).
 */
import assert from "node:assert/strict";
import {
  verifyAndFetchCustomerPdfOriginal,
  buildAnthropicPdfDocumentBlock,
  buildClaudeFullUserContentWithPdf,
  buildDocumentDirectTraceMeta,
  estimateAnthropicMessagesRequestBytes,
  isClaudeFullRequestTooLarge,
  CLAUDE_FULL_REQUEST_MAX_BYTES,
  DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import { buildClaudeFullSystemPrompt, normalizeClaudeFullOutput } from "../server/keyCore/keyClaudeFullEmit.js";
import { buildReflection } from "../server/keyCore/keyReflection.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { buildUserPayload, buildEarlyBorrowedFactBoundary } from "../server/keyCore/keyBorrowedSensesSpeak.js";

/** Minimal valid-ish PDF bytes (header only) for attach-path tests — not executed against Anthropic. */
const TINY_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8",
);

const softReality = {
  policy_count: 22,
  policies: [
    {
      insurer_name: "삼성생명",
      product_name: "실손의료비보험",
      monthly_premium: 45000,
    },
  ],
};

const previewActive = {
  KEY_VOICE: "on",
  KEY_BORROWED_SENSES: "active",
  VERCEL_ENV: "preview",
  ANTHROPIC_API_KEY: "test-key",
};

/** Answers that pass KEY fact gate (verified chart numbers only). */
function goodDocAnswer(overrides = {}) {
  return {
    customer_answer:
      "올려주신 PDF를 먼저 봤어요. 보험 관련 문서로 보이며, 확인된 차트상 계약은 22건이고 대표 실손 월 4만5천 원은 참고만 할게요.",
    document_findings: {
      kind_guess: "보험 관련 문서",
      pages_noted: ["page=1"],
    },
    evidence_references: ["document_id=doc-1", "page=1", "policy_count"],
    visual_blocks: [
      {
        type: "premium_summary_table",
        title: "문서·차트 기준 요약",
        rows: [
          ["등록 계약 수", "22건", "차트 기준"],
          ["대표 월 납입", "월 4만5천 원", "확인된 대표"],
        ],
      },
    ],
    ...overrides,
  };
}

function makeFetch({ answer, log = [] } = {}) {
  return async (_url, opts = {}) => {
    const body = JSON.parse(String(opts.body ?? "{}"));
    const content = body.messages?.[0]?.content;
    let payloadText = "";
    if (Array.isArray(content)) {
      payloadText = content.find((c) => c?.type === "text")?.text ?? "";
    } else if (typeof content === "string") {
      payloadText = content;
    }
    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch {
      parsedPayload = null;
    }
    log.push({
      tools: (body.tools ?? []).map((t) => t.name),
      contentIsArray: Array.isArray(content),
      hasDocumentBlock: Array.isArray(content)
        ? content.some((c) => c?.type === "document")
        : false,
      documentMedia:
        Array.isArray(content) &&
        content.find((c) => c?.type === "document")?.source?.media_type,
      hasBase64Data: Array.isArray(content)
        ? content.some(
            (c) => c?.type === "document" && String(c?.source?.data ?? "").length > 0,
          )
        : false,
      customerQuestion: parsedPayload?.customer_question ?? null,
      uploadWithoutQuestion: parsedPayload?.upload_without_question === true,
      hasKeyPdfSummaryField: Boolean(parsedPayload?.key_document_summary),
      hasWebSearch: (body.tools ?? []).some((t) => t?.name === "web_search"),
    });
    return {
      ok: true,
      async json() {
        return {
          usage: { input_tokens: 200, output_tokens: 80 },
          content: [
            {
              type: "tool_use",
              name: "emit_claude_full",
              input:
                typeof answer === "function"
                  ? answer(body)
                  : answer ?? goodDocAnswer(),
            },
          ],
        };
      },
    };
  };
}

// Anthropic PDF block shape
{
  const block = buildAnthropicPdfDocumentBlock({
    base64: TINY_PDF.toString("base64"),
  });
  assert.equal(block.type, "document");
  assert.equal(block.source.type, "base64");
  assert.equal(block.source.media_type, "application/pdf");
  assert.ok(block.source.data.length > 10);
}

// Ownership denied
{
  const denied = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: { VERCEL_ENV: "preview" },
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-OTHER",
      mime_type: "application/pdf",
      original_filename: "x.pdf",
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "document_ownership_denied");
  assert.equal(denied.metrics.ownership_verified, false);
  assert.equal(JSON.stringify(denied).includes(TINY_PDF.toString("base64")), false);
}

// Production shares Preview ownership path — no VERCEL_ENV hard-block
{
  const prod = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: { VERCEL_ENV: "production" },
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-a",
      mime_type: "application/pdf",
      original_filename: "policy.pdf",
      ingest_status: "ready",
    },
  });
  assert.equal(prod.ok, true);
  assert.equal(prod.metrics.direct_document_attached, true);
  assert.equal(prod.metrics.ownership_verified, true);
  assert.notEqual(prod.reason, "production_document_access_forbidden");
}

// Owned PDF attach OK — metrics redacted
{
  const ok = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: { VERCEL_ENV: "preview" },
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-a",
      mime_type: "application/pdf",
      original_filename: "policy.pdf",
      ingest_status: "ready",
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.metrics.direct_document_attached, true);
  assert.equal(ok.metrics.ownership_verified, true);
  assert.equal(typeof ok.metrics.file_size_bytes, "number");
  assert.equal(ok.metrics.storage_path, undefined);
  assert.equal(ok.metrics.pdfBase64, undefined);
  const meta = buildDocumentDirectTraceMeta(ok.metrics);
  const metaBlob = JSON.stringify(meta);
  assert.equal(/base64|storage_path|signed/.test(metaBlob), false);
}

// User content includes document block + text payload (no KEY summary of PDF)
{
  const content = buildClaudeFullUserContentWithPdf({
    userPayload: {
      customer_question: "",
      direct_document: { attached: true, document_id: "doc-1" },
      verified_customer_chart: { policy_count: 22 },
    },
    pdfBase64: TINY_PDF.toString("base64"),
  });
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "document");
  assert.equal(content[1].type, "text");
  assert.equal(/KEY.*요약|사전 해석/.test(content[1].text), false);
}

// System prompt: document-direct, no KEY structure force
{
  const prompt = buildClaudeFullSystemPrompt({ mode: "emit", documentDirect: true });
  assert.match(prompt, /original PDF|native PDF/i);
  assert.equal(/consult paths: \(1\)/.test(prompt), false);
  assert.equal(/맞아 보입니다/.test(prompt), false);
}

// document_findings kept; reasoning bags stripped
{
  const n = normalizeClaudeFullOutput({
    customer_answer: "문서 설명",
    document_findings: {
      pages_noted: ["page=2"],
      chain_of_thought: "숨긴 추론",
    },
  });
  assert.deepEqual(n.document_findings.pages_noted, ["page=2"]);
  assert.equal(n.document_findings.chain_of_thought, undefined);
}

// Compose: PDF-only → Claude 1 / S6 0 / document_direct mode / no rewrite
{
  const log = [];
  const pdf = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: previewActive,
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-a",
      mime_type: "application/pdf",
      original_filename: "policy.pdf",
    },
  });
  const reflectionSeed = "올린 보험 관련 문서를 확인해 주세요.";
  const answer = goodDocAnswer();
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: reflectionSeed, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: "",
      env: previewActive,
      fetchImpl: makeFetch({ log, answer }),
      directPdfAttachment: {
        pdfBase64: pdf.pdfBase64,
        mediaType: pdf.mediaType,
      },
      documentDirectMeta: pdf.metrics,
    },
  );
  assert.equal(result.compose_mode, "key_claude_full_document_direct");
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(result.key_voice_trace.focused_correction_count, 0);
  assert.equal(result.key_voice_trace.document_direct?.direct_document_attached, true);
  assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
  assert.equal(result.text, answer.customer_answer);
  assert.equal(log[0].hasDocumentBlock, true);
  assert.equal(log[0].documentMedia, "application/pdf");
  assert.equal(log[0].customerQuestion, "");
  assert.equal(log[0].uploadWithoutQuestion, true);
  assert.equal(log[0].hasKeyPdfSummaryField, false);
  assert.equal(log[0].hasWebSearch, false);
  assert.ok((result.visual_blocks ?? []).length >= 1);
  assert.equal(result.key_voice_trace.visual_blocks_source, "claude_emit");
  const traceBlob = JSON.stringify(result.key_voice_trace);
  assert.equal(traceBlob.includes(pdf.pdfBase64), false);
  assert.equal(/data:application\/pdf|storage_path/.test(traceBlob), false);
}

// PDF + question — question present; PDF attached; Claude 1 / S6 0
{
  const log = [];
  const pdf = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: previewActive,
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-a",
      mime_type: "application/pdf",
    },
  });
  const q = "이 증권에서 보험료 줄일 부분 확인해줘";
  const answer = goodDocAnswer({
    customer_answer:
      "질문하신 보험료 줄일 부분은 PDF와 확인된 22건 기준으로 중복·납입부터 보면 좋을 것 같아요. 대표 실손 월 4만5천 원은 참고만 할게요.",
  });
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ log, answer }),
      directPdfAttachment: {
        pdfBase64: pdf.pdfBase64,
        mediaType: pdf.mediaType,
      },
      documentDirectMeta: pdf.metrics,
    },
  );
  assert.equal(log[0].hasDocumentBlock, true);
  assert.equal(log[0].customerQuestion, q);
  assert.equal(log[0].uploadWithoutQuestion, false);
  assert.equal(result.compose_mode, "key_claude_full_document_direct");
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(result.text, answer.customer_answer);
  const payload = buildUserPayload({
    question: q,
    factBoundary: buildEarlyBorrowedFactBoundary({ reality: softReality, question: q }),
    answerMode: "claude_full",
  });
  assert.equal(payload.customer_question, q);
  assert.equal(payload.decision, null);
}

// Request size helpers: raw PDF under 20MB is not enough — full payload measured
{
  const small = estimateAnthropicMessagesRequestBytes({
    model: "claude-test",
    maxTokens: 4096,
    temperature: 0.3,
    system: "sys",
    tools: [{ name: "emit_claude_full", input_schema: { type: "object" } }],
    toolChoice: { type: "auto" },
    messages: [{ role: "user", content: "hello" }],
  });
  assert.ok(small > 50);
  assert.equal(isClaudeFullRequestTooLarge(CLAUDE_FULL_REQUEST_MAX_BYTES), false);
  assert.equal(isClaudeFullRequestTooLarge(CLAUDE_FULL_REQUEST_MAX_BYTES + 1), true);
  assert.equal(isClaudeFullRequestTooLarge(small), false);
}

// Small PDF + normal context → direct attach (provider called once)
{
  const log = [];
  let providerCalls = 0;
  const pdf = await verifyAndFetchCustomerPdfOriginal({
    customerId: "cust-a",
    documentId: "doc-1",
    env: previewActive,
    injectedPdfBytes: TINY_PDF,
    injectedDocument: {
      id: "doc-1",
      customer_id: "cust-a",
      mime_type: "application/pdf",
    },
  });
  const q = "보험료 줄이고 싶어";
  const fetchImpl = async (_url, opts) => {
    providerCalls += 1;
    return makeFetch({ log, answer: goodDocAnswer() })(_url, opts);
  };
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl,
      directPdfAttachment: {
        pdfBase64: pdf.pdfBase64,
        mediaType: pdf.mediaType,
      },
      documentDirectMeta: pdf.metrics,
    },
  );
  assert.equal(providerCalls, 1);
  assert.equal(result.compose_mode, "key_claude_full_document_direct");
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(log[0].hasDocumentBlock, true);
}

// PDF ≤20MB raw but full request >30MB (large context) → block; provider 0; no base64 in trace
{
  const rawUnder20 = Buffer.alloc(12 * 1024 * 1024, 1); // 12MB raw < 20MB
  const fatPdfB64 = rawUnder20.toString("base64"); // ~16MB base64
  const fatContext = "C".repeat(15 * 1024 * 1024); // large context → total request >30MB
  const probeEstimate = estimateAnthropicMessagesRequestBytes({
    model: "claude-test",
    maxTokens: 4096,
    temperature: 0.3,
    system: "sys",
    tools: [{ name: "emit_claude_full", input_schema: { type: "object", properties: {} } }],
    toolChoice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: fatPdfB64,
            },
          },
          {
            type: "text",
            text: JSON.stringify(
              {
                customer_question: "보험료?",
                verified_customer_chart: softReality,
                document_evidence: [{ content: fatContext, document_id: "doc-fat" }],
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  });
  assert.ok(rawUnder20.length < 20 * 1024 * 1024);
  assert.ok(
    probeEstimate > CLAUDE_FULL_REQUEST_MAX_BYTES,
    `expected estimate > 30MB, got ${probeEstimate}`,
  );

  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };
  const q = "보험료 줄이고 싶어";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl,
      documentEvidence: [
        {
          document_id: "doc-fat",
          content: fatContext,
          page: 1,
        },
      ],
      directPdfAttachment: {
        pdfBase64: fatPdfB64,
        mediaType: "application/pdf",
      },
      documentDirectMeta: buildDocumentDirectTraceMeta({
        documentId: "doc-fat",
        mimeType: "application/pdf",
        fileSizeBytes: rawUnder20.length,
        directDocumentAttached: true,
        ownershipVerified: true,
      }),
    },
  );
  assert.equal(providerCalls, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 0);
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.fallback_reason, "request_payload_too_large");
  assert.equal(result.key_voice_trace.document_direct?.document_fallback_reason, "request_payload_too_large");
  assert.equal(result.key_voice_trace.document_direct?.direct_document_attached, false);
  assert.equal(result.key_voice_trace.document_direct?.file_size_bytes, rawUnder20.length);
  assert.ok(
    typeof result.key_voice_trace.document_direct?.estimated_request_bytes === "number" &&
      result.key_voice_trace.document_direct.estimated_request_bytes > CLAUDE_FULL_REQUEST_MAX_BYTES,
  );
  assert.equal(result.text, DOCUMENT_DIRECT_REQUEST_TOO_LARGE_CUSTOMER_TEXT);
  const traceBlob = JSON.stringify(result.key_voice_trace);
  assert.equal(traceBlob.includes(fatPdfB64.slice(0, 80)), false);
  assert.equal(traceBlob.includes(fatContext.slice(0, 80)), false);
  assert.equal(/storage_path|signed|data:application\/pdf/.test(traceBlob), false);
  assert.equal("estimated_request_bytes" in (result.key_voice_trace.document_direct ?? {}), true);
}

console.log("key-claude-full-document-direct-unit-test: PASS");
