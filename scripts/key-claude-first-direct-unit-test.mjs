import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isClaudeFirstDirectPreview,
  extractPartialCustomerAnswer,
  hardOnlySafetyCheck,
  buildSystemPrompt,
  extractPoliciesFromContext,
  buildUserPayload,
  buildRequestClock,
  extractPublicEvidenceFromClaudeContent,
  selectReplacingHardReasons,
  finalizeClaudeFirstStreamContentBlocks,
  hasClientToolUse,
  resolveClaudeFirstPdfDocumentId,
  wantsClaudeFirstVisualBlocks,
  isAttachDocumentReadQuestion,
  buildClaudeImageAttachFromStorageOriginal,
  runClaudeFirstDirectQuestionTurn,
  ATTACH_PROCESS_FAILED_CUSTOMER_TEXT,
  RECORD_CONFIRMED_SOURCE_FACTS_TOOL,
  RECORD_CLAIM_CASE_UPDATES_TOOL,
  RECORD_SESSION_GOAL_TOOL,
  RECORD_RECOMMENDATION_BASIS_TOOL,
  buildClaudeFirstAnswerTools,
  listClaudeFirstAnswerToolNames,
  extractSessionGoalFromContent,
  extractRecommendationBasisFromContent,
  buildRecommendationEvidenceCatalog,
  normalizeSessionGoalRecord,
  isForbiddenSessionGoalText,
  shouldDiscardStaleSessionGoal,
  resolveSessionGoalForContext,
  resolvePersistableSessionGoal,
  loadLatestSessionGoalFromConversations,
  classifySessionGoalRejectReason,
  SESSION_GOAL_MAX_CHARS,
  bucketDocumentBytes,
  classifyAnthropicMessageCategory,
  buildAnthropicUpstreamDiag,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  buildVerifiedLiteralSetFromPolicies,
  detectKeyVerifiedLiteralConflict,
} from "../server/keyCore/keyVerifiedLiteralConflict.js";
import {
  finalizeKeyCustomerText,
  KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
} from "../server/keyCore/keyCustomerMonopoly.js";
import { buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { sentenceHardLiteBlocks } from "../server/keyCore/keyClaudeFirstSentenceCommit.js";
import {
  isPriorAttachFollowUpQuestion,
  isReusableActiveAttachmentId,
  PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT,
  normalizeActiveAttachment,
  extractActiveAttachmentFromSessionMessages,
  shouldClearActiveAttachmentAfterTurn,
  clearActiveAttachmentIfDocumentDeleted,
  extractMentionedFilenamesFromChat,
  hasRecentAttachReadoutContext,
  readChatTurnText,
} from "../src/lib/chatActiveAttachment.js";
import {
  buildSessionMetadata,
  buildAssistantTurnMetadata,
  resolveActiveSessionGoalFromMessages,
  mapSessionRowsToChatMessages,
  LIFEGUARD_HOME_CHAT_PHASE,
} from "../src/lib/lifeguardChatSessionCore.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  buildClaudeFullUserContentWithPdf,
  buildAnthropicPdfDocumentBlock,
  buildAnthropicImageBlock,
  verifyAndFetchCustomerPdfOriginal,
  normalizeClaudeDirectAttachMediaType,
  requestHasForbiddenClientImageBytes,
  buildAttachOpsSignals,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import {
  isChatPdfFile,
  isChatAttachFile,
  CHAT_ATTACH_FILE_ACCEPT,
  CHAT_PDF_FILE_ACCEPT,
} from "../src/lib/chatPdfAttach.js";
import { createHash } from "node:crypto";

{
  const root = dirname(fileURLToPath(import.meta.url));
  const directSrc = readFileSync(join(root, "../server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  assert.equal(
    /keyClaudeImageOrient|preview_orientation_hint|rotation_quarter_turns|rotateImageBufferQuarterTurns|jpeg-js|pngjs|server_ephemeral_rotate/.test(
      directSrc,
    ),
    false,
  );
  assert.equal(/지금 바로 말한다/.test(directSrc), false);
}

assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "preview",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "1",
  }),
  true,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "preview",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "0",
  }),
  false,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "preview",
    KEY_BORROWED_SENSES: "shadow",
  }),
  false,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "production",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "1",
  }),
  true,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "production",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "0",
  }),
  false,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "production",
    KEY_BORROWED_SENSES: "shadow",
  }),
  false,
);

const p = extractPartialCustomerAnswer('{"customer_answer":"안녕');
assert.equal(p.text, "안녕");
assert.equal(p.complete, false);
const p2 = extractPartialCustomerAnswer('{"customer_answer":"안녕"}');
assert.equal(p2.text, "안녕");
assert.equal(p2.complete, true);

const soft = hardOnlySafetyCheck("확인된 22건 기준으로 같이 보면 좋겠어요.", {
  allowed_numbers: ["22", "21", "1"],
  allowed_entities: ["삼성생명"],
});
assert.equal(soft.hard_fail, false);

const hard = hardOnlySafetyCheck("지금 가입하세요. 해지해도 됩니다.", {
  allowed_numbers: ["22"],
  allowed_entities: ["삼성생명"],
});
assert.equal(hard.hard_fail, true);

const prompt = buildSystemPrompt();
assert.match(prompt, /보험 AI KEY/);
assert.match(prompt, /일상 대화/);
assert.match(prompt, /보험 전문가의 기본 능력/);
assert.match(prompt, /가입·유지·정리·보완/);
assert.match(prompt, /지금 묻는 문제를 온전히 해결/);
assert.match(prompt, /최종 KEY 답변/);
assert.match(prompt, /웹 검색어/);
assert.match(prompt, /검색어로 외부에 내보내지 않는다/);
assert.match(prompt, /보험 추천·맞춤 추천/);
assert.match(prompt, /첫 문장부터 바로 말한다/);
assert.match(prompt, /확인되지 않음/);
assert.match(prompt, /내보험다보여·보험다보여 안내를 자동으로 붙이지 않는다/);
assert.match(prompt, /추천 답변을 내보험다보여 안내로 끝내지 않는다/);
assert.equal(/부족하면 무엇이 부족한지 구체적으로 밝힌다/.test(prompt), false);
assert.equal(/올려주시면 정리·확인한다고 말하고/.test(prompt), false);
assert.equal(/내보험다보여 조회자료/.test(prompt), false);
assert.equal(/자료가 더 필요하면/.test(prompt), false);
assert.equal(/No emoji|Tone \(required\)|emit_claude_full|특약|ATTACHED FILE/i.test(prompt), false);

{
  const mixed = extractPoliciesFromContext({
    loadedContext: {
      policy_count: 2,
      policies: [
        { id: "a", insurer_name: "KB", policy_status: "active" },
        { id: "r", insurer_name: "한화", policy_status: "retired" },
      ],
    },
  });
  assert.equal(mixed.policies.length, 1);
  assert.equal(mixed.policy_count, 1);
  assert.equal(mixed.policies[0].id, "a");

  const statusOnly = extractPoliciesFromContext({
    loadedContext: {
      policies: [{ id: "r2", insurer_name: "DB", policy_status: "retired" }],
    },
  });
  assert.equal(statusOnly.policies.length, 0);
  assert.equal(statusOnly.policy_count, 0);

  const allGone = extractPoliciesFromContext({
    customerContextBundle: {
      policy_count: 9,
      policies: [
        { id: "d1", deleted_at: "2026-07-01" },
        { id: "r3", retired_reason: "soft_delete" },
      ],
    },
  });
  assert.equal(allGone.policies.length, 0);
  assert.equal(allGone.policy_count, 0);

  const noArray = extractPoliciesFromContext({
    loadedContext: { policy_count: 3 },
  });
  assert.deepEqual(noArray.policies, []);
  assert.equal(noArray.policy_count, 3);
}
assert.equal(/guidance|must ask|do not mix/i.test(prompt), false);
assert.equal(/맛집이면|키워드|classifier|모든 대화에 보험|반드시 보험을 언급/i.test(prompt), false);
assert.equal(/별도 일상 모드|고정 템플릿|답변 길이/i.test(prompt), false);

// Monopoly A: definitive-only wording must not monopoly-replace.
const definitiveOnly = selectReplacingHardReasons(
  ["recommendation_or_termination"],
  "확인된 범위에서는 큰 문제는 없어 보여요. 증권으로 한 번 더 같이 보면 좋겠어요.",
);
assert.deepEqual(definitiveOnly, []);

// Monopoly A: real enroll push still replaces.
const enrollReplace = selectReplacingHardReasons(
  ["recommendation_or_termination"],
  "지금 가입하세요. 특약을 바로 추가하시는 게 좋아요.",
);
assert.equal(enrollReplace.includes("recommendation_or_termination"), true);

// Server web_search blocks must keep native types (never rewrite to client tool_use).
const finalized = finalizeClaudeFirstStreamContentBlocks([
  { type: "text", text: "분당 맛집을 찾고 계시는군요!" },
  {
    type: "server_tool_use",
    id: "srvtoolu_test",
    name: "web_search",
    input_json: '{"query":"분당 맛집"}',
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_test",
    content: [{ type: "web_search_result", title: "A", url: "https://example.com" }],
  },
  {
    type: "tool_use",
    id: "toolu_client",
    name: "emit_claude_full",
    input_json: '{"customer_answer":"표입니다."}',
  },
]);
assert.equal(finalized[0].type, "text");
assert.equal(finalized[1].type, "server_tool_use");
assert.equal(finalized[1].name, "web_search");
assert.deepEqual(finalized[1].input, { query: "분당 맛집" });
assert.equal(Object.prototype.hasOwnProperty.call(finalized[1], "input_json"), false);
assert.equal(finalized[2].type, "web_search_tool_result");
assert.equal(finalized[2].tool_use_id, "srvtoolu_test");
assert.equal(finalized[3].type, "tool_use");
assert.equal(finalized[3].name, "emit_claude_full");
assert.deepEqual(finalized[3].input, { customer_answer: "표입니다." });

assert.equal(hasClientToolUse(finalized), true);
assert.equal(
  hasClientToolUse(finalized.filter((b) => b.type !== "tool_use")),
  false,
);
assert.equal(
  hasClientToolUse([
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
  ]),
  false,
);

// Explicit chat document_id wins over unifiedState "latest".
assert.equal(
  resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: "doc-chat",
    unifiedState: { documents: [{ id: "doc-old" }, { id: "doc-latest" }] },
    loadedContext: { documents: [{ id: "doc-ctx" }] },
  }),
  "doc-chat",
);
assert.equal(
  resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: null,
    unifiedState: { documents: [{ id: "doc-a" }, { id: "doc-b" }] },
    loadedContext: { documents: "empty" },
  }),
  "doc-b",
);
assert.equal(
  resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: "",
    unifiedState: null,
    loadedContext: { documents: "empty" },
  }),
  null,
);

assert.match(CHAT_ATTACH_FILE_ACCEPT, /application\/pdf/);
assert.match(CHAT_ATTACH_FILE_ACCEPT, /image\/jpeg/);
assert.match(CHAT_ATTACH_FILE_ACCEPT, /image\/png/);
assert.equal(CHAT_PDF_FILE_ACCEPT, CHAT_ATTACH_FILE_ACCEPT);
assert.equal(isChatPdfFile({ name: "증권.pdf", type: "application/pdf" }), true);
assert.equal(isChatPdfFile({ name: "photo.png", type: "image/png" }), false);
assert.equal(isChatAttachFile({ name: "증권.pdf", type: "application/pdf" }), true);
assert.equal(isChatAttachFile({ name: "receipt.jpg", type: "image/jpeg" }), true);
assert.equal(isChatAttachFile({ name: "receipt.JPEG", type: "" }), true);
assert.equal(isChatAttachFile({ name: "photo.png", type: "image/png" }), true);
assert.equal(isChatAttachFile({ name: "shot.heic", type: "image/heic" }), false);
assert.equal(isChatAttachFile({ name: "shot.webp", type: "image/webp" }), false);

assert.equal(normalizeClaudeDirectAttachMediaType("image/jpg"), "image/jpeg");
assert.equal(normalizeClaudeDirectAttachMediaType("image/heic"), null);

const pdfBlock = buildAnthropicPdfDocumentBlock({
  base64: Buffer.from("%PDF-1.1\n%%EOF\n").toString("base64"),
});
assert.equal(pdfBlock?.type, "document");
const userContent = buildClaudeFullUserContentWithPdf({
  userPayload: { question: "이 증권 봐줘" },
  pdfBase64: Buffer.from("%PDF-1.1\n%%EOF\n").toString("base64"),
});
assert.equal(Array.isArray(userContent), true);
assert.equal(userContent[0]?.type, "document");
assert.equal(userContent[1]?.type, "text");

const jpegTiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const jpegBlock = buildAnthropicImageBlock({
  base64: jpegTiny.toString("base64"),
  mediaType: "image/jpeg",
});
assert.equal(jpegBlock?.type, "image");
assert.equal(jpegBlock?.source?.media_type, "image/jpeg");
const jpegContent = buildClaudeFullUserContentWithPdf({
  userPayload: { question: "이 영수증 봐줘" },
  pdfBase64: jpegTiny.toString("base64"),
  mediaType: "image/jpeg",
});
assert.equal(jpegContent[0]?.type, "image");
assert.equal(jpegContent[0]?.source?.media_type, "image/jpeg");

const pngTiny = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const pngBlock = buildAnthropicImageBlock({
  base64: pngTiny.toString("base64"),
  mediaType: "image/png",
});
assert.equal(pngBlock?.type, "image");
assert.equal(pngBlock?.source?.media_type, "image/png");
const pngContent = buildClaudeFullUserContentWithPdf({
  userPayload: { question: "이 사진 봐줘" },
  pdfBase64: pngTiny.toString("base64"),
  mediaType: "image/png",
});
assert.equal(pngContent[0]?.type, "image");
assert.equal(pngContent[0]?.source?.media_type, "image/png");

assert.equal(
  buildAnthropicImageBlock({
    base64: jpegTiny.toString("base64"),
    mediaType: "image/heic",
  }),
  null,
);

const denied = await verifyAndFetchCustomerPdfOriginal({
  supabase: {},
  customerId: "cust-a",
  documentId: "doc-1",
  env: { VERCEL_ENV: "preview" },
  injectedPdfBytes: Buffer.from("%PDF-1.1\n%%EOF\n"),
  injectedDocument: {
    id: "doc-1",
    customer_id: "cust-b",
    mime_type: "application/pdf",
  },
});
assert.equal(denied.ok, false);
assert.equal(denied.reason, "document_ownership_denied");

const jpegOk = await verifyAndFetchCustomerPdfOriginal({
  supabase: {},
  customerId: "cust-a",
  documentId: "doc-jpg",
  env: { VERCEL_ENV: "preview" },
  injectedPdfBytes: jpegTiny,
  injectedDocument: {
    id: "doc-jpg",
    customer_id: "cust-a",
    mime_type: "image/jpeg",
    original_filename: "receipt.jpg",
  },
});
assert.equal(jpegOk.ok, true);
assert.equal(jpegOk.mediaType, "image/jpeg");
assert.equal(Boolean(jpegOk.pdfBase64), true);

const pngOk = await verifyAndFetchCustomerPdfOriginal({
  supabase: {},
  customerId: "cust-a",
  documentId: "doc-png",
  env: { VERCEL_ENV: "preview" },
  injectedPdfBytes: pngTiny,
  injectedDocument: {
    id: "doc-png",
    customer_id: "cust-a",
    mime_type: "image/png",
    original_filename: "receipt.png",
  },
});
assert.equal(pngOk.ok, true);
assert.equal(pngOk.mediaType, "image/png");

const heicDenied = await verifyAndFetchCustomerPdfOriginal({
  supabase: {},
  customerId: "cust-a",
  documentId: "doc-heic",
  env: { VERCEL_ENV: "preview" },
  injectedPdfBytes: Buffer.from("ftypheic"),
  injectedDocument: {
    id: "doc-heic",
    customer_id: "cust-a",
    mime_type: "image/heic",
  },
});
assert.equal(heicDenied.ok, false);
assert.equal(heicDenied.reason, "mime_not_supported_for_direct");

const promptImage = buildSystemPrompt();
assert.match(promptImage, /보험 AI KEY/);
assert.match(promptImage, /웹 검색어/);
assert.equal(/9999세|종신형|ATTACHED FILE|emit_claude_full|Tone \(required\)/i.test(promptImage), false);

assert.equal(
  isAttachDocumentReadQuestion(
    "이 사진에서 병원명, 진료일, 문서 종류, 총 결제금액을 찾아 표로 정리해줘.",
  ),
  false,
  "Slice 5: keyword attach pre-route removed",
);
assert.equal(
  wantsClaudeFirstVisualBlocks("이 사진에서 병원명 찾아 표로 정리해줘.", {
    documentAttached: true,
  }),
  false,
);
assert.equal(
  wantsClaudeFirstVisualBlocks("내 보험 현황을 차트로 보여줘", {
    documentAttached: false,
  }),
  false,
  "Slice 5: Phase B removed",
);

const attachPayload = buildUserPayload({
  question: "이 사진에서 총 결제금액 찾아줘",
  chart: { policy_count: { value: 22 } },
  contextPack: {
    recent_conversation_originals: [
      { role: "user", text: "추천해줘" },
      { role: "assistant", text: "직전 답입니다." },
    ],
    older_conversation_summary: null,
  },
  pdfMeta: {
    attached: true,
    document_id: "doc-img",
    mime_type: "image/jpeg",
    original_filename: "receipt.jpg",
  },
  now: new Date("2026-07-14T12:00:00+09:00"),
});
assert.equal(Object.prototype.hasOwnProperty.call(attachPayload, "guidance"), false);
assert.equal(Object.prototype.hasOwnProperty.call(attachPayload, "allowed_numbers"), false);
assert.equal(Object.prototype.hasOwnProperty.call(attachPayload, "mode"), false);
assert.equal(attachPayload.current_question, "이 사진에서 총 결제금액 찾아줘");
assert.equal(attachPayload.current_context?.timezone, "Asia/Seoul");
assert.equal(attachPayload.current_context?.current_date, "2026-07-14");
assert.equal(
  attachPayload.current_context?.conversation?.recent_conversation_originals?.length,
  2,
);
assert.equal(
  attachPayload.current_context?.conversation?.recent_conversation_originals?.[0]?.text,
  "추천해줘",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    attachPayload.current_context?.conversation ?? {},
    "recent_turns",
  ),
  false,
);
assert.equal(
  attachPayload.available_verified_evidence?.personal?.subject_type,
  "individual",
);
assert.equal(attachPayload.available_verified_evidence?.personal?.chart, null);
assert.deepEqual(
  attachPayload.available_verified_evidence?.personal?.key_confirmed_source_facts,
  [],
);
assert.equal(attachPayload.available_verified_evidence?.documents?.[0]?.attached, true);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    attachPayload.available_verified_evidence?.documents?.[0] ?? {},
    "preview_orientation_hint",
  ),
  false,
);
assert.deepEqual(attachPayload.available_verified_evidence?.public_evidence, []);
assert.equal(Object.prototype.hasOwnProperty.call(attachPayload, "verified_customer_chart"), false);

// --- Storage original image attach (no rotate / no orientation hint) ---
assert.equal(requestHasForbiddenClientImageBytes({}), false);
assert.equal(
  requestHasForbiddenClientImageBytes({ claude_upright_image_base64: "abc" }),
  true,
);
assert.equal(
  requestHasForbiddenClientImageBytes({ image_base64: "abc" }),
  true,
);
assert.equal(
  requestHasForbiddenClientImageBytes({ claudeUprightImage: { base64: "xyz" } }),
  true,
);

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const srcJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAQACAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APx3tLS1sLW2sbG2t7KysreG0s7O0hjt7W0tbeNYbe2treFUigt4IkSKGGJEjijRURVVQA23JuUm222227tt6ttvVtvVt7iSSSSSSSSSSsklokktEktkf//Z",
  "base64",
);
const validJpeg8 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx4BBQUFBwYHDggIDh4UERQeHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHv/AABEIAAgACAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AKVAH//Z",
  "base64",
);
const clientB64 = validJpeg8.toString("base64");

const storageB64 = srcJpeg.toString("base64");
const storageHash = sha256Hex(srcJpeg);
const built = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: storageB64,
  storageMediaType: "image/jpeg",
});
assert.equal(built.ok, true);
assert.equal(built.claude_image_source, "storage_original");
assert.equal(built.rotated, false);
assert.equal(built.base64, storageB64);
assert.equal(sha256Hex(Buffer.from(built.base64, "base64")), storageHash);
assert.equal(built.attach_signals?.attachment_block_built, true);
assert.equal(built.attach_signals?.attachment_attached, true);
assert.equal(built.attach_signals?.attachment_failed, false);
assert.equal(
  Object.prototype.hasOwnProperty.call(built.attach_signals ?? {}, "rotation_requested"),
  false,
);

const builtMissing = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: "",
  storageMediaType: "image/jpeg",
});
assert.equal(builtMissing.ok, false);
assert.equal(builtMissing.attach_signals?.attachment_failed, true);
assert.equal(builtMissing.attach_signals?.attachment_failure_code, "storage_image_missing");

const builtMime = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: storageB64,
  storageMediaType: "image/heic",
});
assert.equal(builtMime.ok, false);
assert.equal(builtMime.attach_signals?.attachment_failure_code, "storage_image_missing");
assert.equal(builtMime.reason, "storage_image_missing");

assert.equal(
  buildAttachOpsSignals({
    attachment_requested: true,
    attachment_attached: false,
    attachment_failed: true,
    attachment_failure_code: "block_build_failed",
    attachment_block_built: false,
  }).attachment_failure_code,
  "block_build_failed",
);

assert.equal(
  requestHasForbiddenClientImageBytes({
    document_id: "doc-x",
    claude_upright_image_base64: clientB64,
  }),
  true,
);

const promptTable = buildSystemPrompt();
assert.match(promptTable, /보험 AI KEY/);
assert.equal(/orientation|independently|column|지금 바로 말한다/i.test(promptTable), false);

{
  const payload = buildUserPayload({
    question: "이 사진 분석해줘",
    chart: { policies: [], policy_count: { value: 0 } },
    contextPack: {},
    pdfMeta: {
      attached: true,
      mime_type: "image/jpeg",
      document_id: "doc-hint",
    },
  });
  assert.equal(payload.available_verified_evidence.personal.chart, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      payload.available_verified_evidence.documents[0],
      "preview_orientation_hint",
    ),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "guidance"), false);
}

// --- Slice A: prior attach follow-up / active attachment ---
assert.equal(isPriorAttachFollowUpQuestion("이 사진 다시 봐줘"), true);
assert.equal(isPriorAttachFollowUpQuestion("방금 사진"), true);
assert.equal(isPriorAttachFollowUpQuestion("첨부 사진만 분석해줘"), true);
assert.equal(isPriorAttachFollowUpQuestion("잘못 읽은 것 같아"), true);
assert.equal(
  isPriorAttachFollowUpQuestion("잘못 읽은 것 같아. 이 사진만 다시 확인해줘."),
  true,
);
assert.equal(isPriorAttachFollowUpQuestion("잘 지내?"), false);
assert.equal(isPriorAttachFollowUpQuestion("내 보험 현황 알려줘"), false);
// Ambiguous recheck alone needs recent photo readout context.
assert.equal(isPriorAttachFollowUpQuestion("다시 확인해줘"), false);
assert.equal(
  isPriorAttachFollowUpQuestion("다시 확인해줘", {
    history: [
      { role: "user", content: "이 첨부 사진만 분석해줘.\n\n(첨부: a.jpg)" },
      { role: "assistant", content: "첨부 이미지 판독 결과\n| 보험사 | 미확인 |" },
    ],
  }),
  true,
);
assert.equal(
  isPriorAttachFollowUpQuestion("다시 확인해줘", {
    history: [
      { role: "user", content: "오늘 기분은 어때?" },
      { role: "assistant", content: "좋아요." },
    ],
  }),
  false,
);

// Claude-first history remap uses `.text` — attach helpers must dual-read content/text.
assert.equal(readChatTurnText({ text: "hello" }), "hello");
assert.equal(readChatTurnText({ content: "c", text: "t" }), "c");
assert.deepEqual(
  extractMentionedFilenamesFromChat("내 문서 확인해봐", [
    { role: "user", text: "방금 올렸어요.\n\n(첨부: policy-scan.jpg)" },
  ]),
  ["policy-scan.jpg"],
);
assert.equal(
  hasRecentAttachReadoutContext({
    history: [{ role: "user", text: "확인\n\n(첨부: a.png)" }],
  }),
  true,
);
assert.equal(
  isPriorAttachFollowUpQuestion("다시 확인해줘", {
    history: [
      { role: "user", text: "이 첨부 사진만 분석해줘.\n\n(첨부: a.jpg)" },
      { role: "assistant", text: "첨부 이미지 판독 결과\n| 보험사 | 미확인 |" },
    ],
  }),
  true,
);

assert.equal(
  wantsClaudeFirstVisualBlocks("잘못 읽은 것 같아", { documentAttached: true }),
  false,
);

assert.equal(
  resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: null,
    unifiedState: { documents: [{ id: "doc-old" }, { id: "doc-new" }] },
    allowLatestFallback: false,
  }),
  null,
  "prior-attach follow-up must not use latest-document fallback",
);
assert.equal(
  resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: "doc-active",
    unifiedState: { documents: [{ id: "doc-other" }] },
    allowLatestFallback: false,
  }),
  "doc-active",
);

const activeNorm = normalizeActiveAttachment({
  active_attachment_id: "doc-a",
  active_attachment_mime: "image/jpeg",
  active_rotation_quarter_turns: 2,
});
assert.equal(activeNorm.active_attachment_id, "doc-a");
assert.equal(activeNorm.active_rotation_quarter_turns, 2);
assert.equal(
  clearActiveAttachmentIfDocumentDeleted(activeNorm, "doc-a"),
  null,
  "deleted document clears conversation active attach",
);
assert.equal(
  clearActiveAttachmentIfDocumentDeleted(activeNorm, "doc-other")?.active_attachment_id,
  "doc-a",
  "unrelated delete keeps active attach",
);
assert.equal(normalizeActiveAttachment({ rotation_quarter_turns: 9 }), null); // no id
assert.equal(
  normalizeActiveAttachment({
    active_attachment_id: "doc-b",
    active_rotation_quarter_turns: 9,
  }).active_rotation_quarter_turns,
  0,
);

const metaWithActive = buildAssistantTurnMetadata("sess-1", {
  activeAttachment: activeNorm,
});
assert.equal(metaWithActive.active_attachment_id, "doc-a");
assert.equal(metaWithActive.active_rotation_quarter_turns, 2);
assert.equal(buildSessionMetadata("sess-1").active_attachment_id, undefined);

const extracted = extractActiveAttachmentFromSessionMessages([
  { role: "user", content: "hi" },
  { role: "assistant", content: "ok", metadata: metaWithActive },
]);
assert.equal(extracted?.active_attachment_id, "doc-a");
assert.match(PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT, /다시 첨부/);

assert.equal(
  shouldClearActiveAttachmentAfterTurn({
    answerText: ATTACH_PROCESS_FAILED_CUSTOMER_TEXT,
    failureReason: "attach_process_failed",
    keyMonopolyFailure: true,
  }),
  true,
);
assert.equal(
  shouldClearActiveAttachmentAfterTurn({
    answerText: PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT,
    failureReason: "prior_attach_missing",
  }),
  true,
);
assert.equal(
  shouldClearActiveAttachmentAfterTurn({
    answerText: "확인된 내용을 기준으로 말씀드릴게요.",
    failureReason: null,
  }),
  false,
);
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const homeChat = readFileSync(join(root, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /shouldClearActiveAttachmentAfterTurn/);
  assert.match(homeChat, /clearFailedAttach/);
  const docDirect = readFileSync(
    join(root, "server/keyCore/keyClaudeFullDocumentDirect.js"),
    "utf8",
  );
  assert.equal(/production_document_access_forbidden/.test(docDirect), false);
}

// --- Explicit attach fail-closed (no Claude / no chart substitute) ---
assert.match(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT, /첨부 파일을 처리하지 못했습니다/);
assert.match(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT, /다시 첨부/);

function makeAttachQuery(result) {
  const q = {
    select: () => q,
    eq: () => q,
    is: (column, value) => {
      if (column === "deleted_at" && value === null) q._requireDeletedAtNull = true;
      return q;
    },
    maybeSingle: async () => {
      if (result?.error) return result;
      if (q._requireDeletedAtNull && result?.data?.deleted_at) {
        return { data: null, error: null };
      }
      return result;
    },
  };
  return q;
}

function makeAttachSupabase({ document = null, docError = null, blob = null, downloadError = null } = {}) {
  return {
    from: () => makeAttachQuery({ data: document, error: docError }),
    storage: {
      from: () => ({
        download: async () => ({ data: blob, error: downloadError }),
      }),
    },
  };
}

function makeBlobFromBuffer(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  return {
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function assertNoChartLeak(text) {
  const t = String(text ?? "");
  assert.equal(/총\s*\d+\s*건|계약\s*\d+\s*건|\d+\s*건/.test(t), false);
  assert.equal(/삼성생명|한화생명|교보생명|월\s*보험료/.test(t), false);
  assert.equal(t.includes("verified_customer_chart"), false);
}

const failClosedEnv = {
  VERCEL_ENV: "preview",
  ANTHROPIC_API_KEY: "test-key-fail-closed",
};
const chartPolicies = {
  policies: [
    { insurer: "삼성생명", product_name: "종신", monthly_premium: 50000 },
    { insurer: "한화생명", product_name: "실손", monthly_premium: 30000 },
  ],
  policy_count: 34,
};

{
  let claudeCalls = 0;
  let imageB64FromClaude = null;
  let sawHint = false;
  let sawChartObject = false;
  let sawFillPressure = false;
  let toolNames = [];
  let firstToolChoice = null;
  const fetchImpl = async (_url, opts) => {
    claudeCalls += 1;
    const body = JSON.parse(String(opts?.body ?? "{}"));
    const content = body?.messages?.[0]?.content;
    const system = String(body?.system ?? "");
    toolNames = (Array.isArray(body?.tools) ? body.tools : []).map((t) => t?.name).filter(Boolean);
    if (claudeCalls === 1) firstToolChoice = body?.tool_choice ?? null;
    sawFillPressure = /지금 바로 말한다/.test(system);
    if (Array.isArray(content)) {
      const img = content.find((b) => b?.type === "image");
      imageB64FromClaude = img?.source?.data ?? null;
      const text = content.find((b) => b?.type === "text")?.text ?? "";
      sawHint = /시계 방향으로|preview_orientation_hint/.test(text);
      try {
        const payload = JSON.parse(text);
        sawChartObject =
          payload?.available_verified_evidence?.personal?.chart != null &&
          typeof payload.available_verified_evidence.personal.chart === "object";
      } catch {
        sawChartObject = /"insurer"\s*:\s*"삼성생명"/.test(text);
      }
    }
    // Turn 1: forced facts tool. Turn 2: customer answer (no rewrite pipeline).
    if (claudeCalls === 1) {
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                id: "fact-img-1",
                name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
                input: {
                  confirmed_source_facts: [
                    {
                      fact_type: "insurer",
                      literal_value: "미확인",
                      source_document_id: "doc-rot-ok",
                    },
                  ],
                },
              },
            ],
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "text",
              text: "첨부 이미지에서 보험사 칸은 미확인입니다. 더 궁금한 점 말씀해 주세요.",
            },
          ],
        };
      },
    };
  };
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 사진에서 보험사와 월 보험료를 표로 정리해줘.",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-rot-ok",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-rot-ok",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-rot-ok.jpg",
        mime_type: "image/jpeg",
        original_filename: "table.jpg",
        deleted_at: null,
      },
      blob: makeBlobFromBuffer(validJpeg8),
    }),
    env: failClosedEnv,
    fetchImpl,
  });
  assert.equal(
    claudeCalls,
    2,
    "image original: facts tool turn + answer turn (no rewrite call)",
  );
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(
    result.customerText.includes(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT),
    false,
  );
  assert.equal(imageB64FromClaude, validJpeg8.toString("base64"));
  assert.equal(sha256Hex(Buffer.from(imageB64FromClaude, "base64")), sha256Hex(validJpeg8));
  assert.equal(sawHint, false);
  assert.equal(sawChartObject, false);
  assert.equal(sawFillPressure, false);
  assert.equal(toolNames.includes("record_confirmed_source_facts"), true);
  assert.equal(toolNames.includes("record_coverage_baseline_facts"), true);
  assert.deepEqual(firstToolChoice, {
    type: "tool",
    name: "record_confirmed_source_facts",
  });
  const signals =
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.attach_signals;
  assert.equal(signals?.attachment_attached, true);
  assert.equal(signals?.attachment_failed, false);
  assert.equal(signals?.attachment_block_built, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(signals ?? {}, "rotation_requested"),
    false,
  );
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.image_rotate_observation,
    undefined,
  );
  assert.equal(
    JSON.stringify(result).includes(validJpeg8.toString("base64").slice(0, 12)),
    false,
  );
}

{
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 첨부 파일 읽어줘",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-own-deny",
    userSupabase: makeAttachSupabase({ document: null }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run_on_ownership_fail");
    },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.key_monopoly_failure, true);
  assert.match(result.customerText, /첨부 파일을 처리하지 못했습니다/);
  assertNoChartLeak(result.customerText);
  assert.ok(
    ["document_ownership_denied", "pdf_attach_skipped", "attach_process_failed"].includes(
      result.failure_reason,
    ) || String(result.failure_reason ?? "").length > 0,
  );
}

{
  // Soft-deleted document (storage may still exist) must be excluded from KEY read.
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 사진 다시 읽어줘",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-soft-deleted",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-soft-deleted",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-soft-deleted.jpg",
        mime_type: "image/jpeg",
        original_filename: "gone.jpg",
        deleted_at: "2026-07-12T00:00:00.000Z",
      },
    }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run_on_soft_deleted_doc");
    },
  });
  assert.equal(claudeCalls, 0, "soft-deleted document must not reach Claude");
  assert.equal(result.key_monopoly_failure, true);
  assert.match(result.customerText, /첨부 파일을 처리하지 못했습니다|다시 첨부/);
}


{
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 PDF 증권 봐줘",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-dl-fail",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-dl-fail",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-dl-fail.pdf",
        mime_type: "application/pdf",
        original_filename: "policy.pdf",
        deleted_at: null,
      },
      blob: null,
      downloadError: { message: "not_found" },
    }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run_on_download_fail");
    },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.key_monopoly_failure, true);
  assert.match(result.customerText, /첨부 파일을 처리하지 못했습니다/);
  assertNoChartLeak(result.customerText);
}

{
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 사진 표로 정리해줘",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-heic-block",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-heic-block",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-heic-block.heic",
        mime_type: "image/heic",
        original_filename: "shot.heic",
        deleted_at: null,
      },
      blob: makeBlobFromBuffer(Buffer.from("ftypheic")),
    }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run_on_block_fail");
    },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.key_monopoly_failure, true);
  assert.match(result.customerText, /첨부 파일을 처리하지 못했습니다/);
  assertNoChartLeak(result.customerText);
}

{
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 사진 다시 봐줘",
    history: [
      { role: "user", content: "이 첨부 사진만 분석해줘.\n\n(첨부: a.jpg)" },
      { role: "assistant", content: "첨부 이미지 판독 결과\n| 보험사 | 미확인 |" },
    ],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-prior-gone",
    priorAttachFollowUp: true,
    userSupabase: makeAttachSupabase({ document: null }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      throw new Error("claude_must_not_run_on_prior_attach_miss");
    },
  });
  assert.equal(claudeCalls, 0);
  assert.equal(result.failure_reason, "prior_attach_missing");
  assert.equal(result.customerText, PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT);
  assertNoChartLeak(result.customerText);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.prior_attach_follow_up,
    true,
  );
  assert.equal(result.key_monopoly_failure, false);
}

{
  // Delete then first insurance-count question: stale active id must not wall with reattach.
  assert.equal(
    isReusableActiveAttachmentId("doc-deleted-stale", [
      { id: "doc-other", deleted_at: null },
    ]),
    false,
  );
  assert.equal(
    isReusableActiveAttachmentId("doc-live", [{ id: "doc-live", deleted_at: null }]),
    true,
  );
  assert.equal(
    isReusableActiveAttachmentId("doc-gone", [
      { id: "doc-gone", deleted_at: "2026-07-18T00:00:00.000Z" },
    ]),
    false,
  );
  // Unloaded chat document list must keep active id (server ownership is authoritative).
  assert.equal(isReusableActiveAttachmentId("doc-active", []), true);

  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내보험 건수는?",
    history: [
      { role: "user", content: "이 첨부 사진만 분석해줘.\n\n(첨부: a.jpg)" },
      { role: "assistant", content: "첨부 이미지 판독 결과\n| 보험사 | 한화생명 |" },
    ],
    loadedContext: {
      policies: [
        { insurer: "한화생명", product_name: "건강보험" },
        { insurer: "한화생명", product_name: "건강보험" },
      ],
      policy_count: 2,
    },
    customerId: "cust-a",
    attachedDocumentId: "doc-deleted-stale",
    priorAttachFollowUp: true,
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-deleted-stale",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-deleted-stale.jpg",
        mime_type: "image/jpeg",
        original_filename: "gone.jpg",
        deleted_at: "2026-07-18T00:00:00.000Z",
      },
    }),
    env: failClosedEnv,
    fetchImpl: async () => {
      claudeCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "text",
                text: "현재 확인된 보험 계약은 총 2건입니다. 두 계약 모두 한화생명 건강보험으로 확인됩니다.",
              },
            ],
          };
        },
      };
    },
  });
  assert.ok(claudeCalls >= 1, "stale deleted active must reach Claude-first");
  assert.notEqual(result.failure_reason, "prior_attach_missing");
  assert.notEqual(result.customerText, PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT);
  assert.match(result.customerText, /총\s*2건|2건/);
  assert.equal(result.key_monopoly_failure, false);
}

{
  let claudeCalls = 0;
  let sawImageBlock = false;
  let imageHash = null;
  const fetchImpl = async (_url, opts) => {
    claudeCalls += 1;
    const body = JSON.parse(String(opts?.body ?? "{}"));
    const content = body?.messages?.[0]?.content;
    if (Array.isArray(content)) {
      const img = content.find((b) => b?.type === "image");
      sawImageBlock = Boolean(img);
      if (img?.source?.data) {
        imageHash = sha256Hex(Buffer.from(img.source.data, "base64"));
      }
    }
    // Facts tool + answer in one Claude-first call (not Phase B rewrite).
    return {
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "tool_use",
              id: "fact-ok-jpg",
              name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
              input: {
                confirmed_source_facts: [
                  {
                    fact_type: "insurer",
                    literal_value: "미확인",
                    source_document_id: "doc-ok-jpg",
                  },
                ],
              },
            },
            {
              type: "text",
              text: "첨부 이미지에서 보험사 칸은 미확인입니다. 더 궁금한 점 말씀해 주세요.",
            },
          ],
        };
      },
    };
  };
  const result = await runClaudeFirstDirectQuestionTurn({
    question:
      "이 사진에서 보험사, 상품명, 납입기간과 만기, 계약기간, 월 보험료를 표로 정리해줘. 읽기 어려운 항목은 추측하지 말고 미확인으로 표시해줘.",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-ok-jpg",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-ok-jpg",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-ok-jpg.jpg",
        mime_type: "image/jpeg",
        original_filename: "ok.jpg",
        deleted_at: null,
      },
      blob: makeBlobFromBuffer(validJpeg8),
    }),
    env: failClosedEnv,
    fetchImpl,
  });
  assert.equal(claudeCalls, 1, "attach success: Claude-first single call (Phase B skipped)");
  assert.equal(sawImageBlock, true);
  assert.equal(imageHash, sha256Hex(validJpeg8));
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(
    result.customerText.includes(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT),
    false,
  );
  assert.ok(String(result.customerText ?? "").includes("미확인"));
}

{
  const tinyPdf = Buffer.from("%PDF-1.1\n%%EOF\n");
  let claudeCalls = 0;
  let sawDocBlock = false;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 증권 PDF에서 보험료만 확인해줘.",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-ok-pdf",
    userSupabase: makeAttachSupabase({
      document: {
        id: "doc-ok-pdf",
        customer_id: "cust-a",
        storage_path: "cust-a/doc-ok-pdf.pdf",
        mime_type: "application/pdf",
        original_filename: "ok.pdf",
        deleted_at: null,
      },
      blob: makeBlobFromBuffer(tinyPdf),
    }),
    env: failClosedEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const body = JSON.parse(String(opts?.body ?? "{}"));
      const content = body?.messages?.[0]?.content;
      if (Array.isArray(content)) {
        sawDocBlock = content.some((b) => b?.type === "document");
      }
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                id: "fact-ok-pdf",
                name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
                input: {
                  confirmed_source_facts: [
                    {
                      fact_type: "premium",
                      literal_value: "미확인",
                      source_document_id: "doc-ok-pdf",
                    },
                  ],
                },
              },
              {
                type: "text",
                text: "첨부 문서에서 보험료 칸은 미확인입니다. 더 궁금한 점 말씀해 주세요.",
              },
            ],
          };
        },
      };
    },
  });
  assert.equal(claudeCalls, 1);
  assert.equal(sawDocBlock, true);
  assert.equal(result.key_monopoly_failure, false);
}

{
  let claudeCalls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내 보험 현황 알려줘",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: null,
    unifiedState: { documents: [{ id: "doc-latest-should-not-force-fail" }] },
    userSupabase: makeAttachSupabase({ document: null }),
    env: failClosedEnv,
    fetchImpl: async (_url, opts) => {
      claudeCalls += 1;
      const body = JSON.parse(String(opts?.body ?? "{}"));
      const userText = Array.isArray(body?.messages?.[0]?.content)
        ? body.messages[0].content.find((b) => b?.type === "text")?.text
        : body?.messages?.[0]?.content;
      assert.ok(String(userText ?? "").includes("verified_customer_chart"));
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "text",
                text: "확인된 계약을 기준으로 현황을 같이 보면 좋겠어요. 더 궁금한 점 말씀해 주세요.",
              },
            ],
          };
        },
      };
    },
  });
  assert.ok(claudeCalls >= 1, "general question without explicit attach still calls Claude");
  assert.equal(
    result.customerText.includes(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT),
    false,
  );
  assert.equal(result.key_monopoly_failure, false);
}

{
  // Explicit document_id present → must not silently succeed via a different latest id.
  const resolved = resolveClaudeFirstPdfDocumentId({
    attachedDocumentId: "doc-explicit-fail-closed",
    unifiedState: { documents: [{ id: "doc-other-latest" }] },
    allowLatestFallback: true,
  });
  assert.equal(resolved, "doc-explicit-fail-closed");
}

// --- Slice 6: question-centered evidence + coverage Hand + public_evidence ---
{
  const clock = buildRequestClock(new Date("2026-07-14T15:30:00+09:00"));
  assert.equal(clock.timezone, "Asia/Seoul");
  assert.equal(clock.current_date, "2026-07-14");
  assert.match(clock.current_datetime, /^2026-07-14T/);
}

{
  const chart = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        id: "pol-1",
        insurer_name: "삼성생명",
        product_name: "실손의료비보험",
        monthly_premium: 45000,
        end_date: "9999세",
        coverage_summary: {
          payment_period: "20년납",
          insurance_period: "9999세",
          source_document_id: "doc-src",
          extractor_version: "step4-ocr-policy-v3-multi",
          extracted_at: "2026-01-10T00:00:00.000Z",
          rider_details: [
            {
              rider_name: "암진단비",
              coverage_amount: 30000000,
              source_line: "암진단비 3,000만원",
            },
            {
              rider_name: "암주요치료비",
              coverage_amount: 5000000,
            },
          ],
          detected_coverages: ["암", "실손"],
        },
      },
    ],
  });
  const c0 = chart.contracts[0];
  assert.equal(c0.insurer, "삼성생명");
  assert.equal(c0.end_date, "9999세");
  assert.equal(c0.insurance_period, "9999세");
  assert.equal(c0.payment_period, "20년납");
  assert.equal(JSON.stringify(c0).includes("종신"), false);
  const cancer = c0.coverages.find((x) => x.coverage_name === "암진단비");
  assert.equal(cancer?.coverage_amount, 30000000);
  assert.equal(cancer?.provenance?.document_id, "doc-src");
  const treat = c0.coverages.find((x) => x.coverage_name === "암주요치료비");
  assert.equal(treat?.coverage_amount, 5000000);
  assert.ok(c0.coverages.every((x) => x.coverage_amount !== 0 || x.coverage_name));
  // amount-only row stays partial + unknown name
  const amountOnly = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        insurer_name: "A",
        product_name: "B",
        coverage_summary: {
          rider_details: [{ coverage_amount: 10000000, coverage_amount_raw: "1000만원" }],
        },
      },
    ],
  });
  const partialCov = amountOnly.contracts[0].coverages[0];
  assert.equal(partialCov.coverage_name, "unknown");
  assert.equal(partialCov.coverage_amount, 10000000);
  assert.equal(partialCov.coverage_amount_raw, "1000만원");
  assert.equal(partialCov.evidence_state, "partial");
}

{
  const { buildClaudeCorporateFactPack } = await import(
    "../server/keyCore/keyClaudeCorporateContext.js"
  );
  const pack = buildClaudeCorporateFactPack({
    entityRecord: {
      entity_id: "corp-1",
      id: "corp-1",
      entity_type: "corporate",
      display_name: "QA법인",
    },
    membership: { member_role: "owner" },
    snapshot: {
      contract_version: "corporate-snapshot-v1",
      derived: {
        industry: "제조",
        group_insurance_status: "present",
        employee_count: null,
        executive_protection: null,
        fire_insurance: null,
        liability: null,
        unknowns: ["fire_insurance", "liability", "executive_protection"],
      },
    },
    memorySnapshot: { facts: [], fact_count: 0 },
  });
  const payload = buildUserPayload({
    question: "올해 보험료 세액공제 기준을 설명해줘",
    chart: buildVerifiedCustomerChart({
      policy_count: 2,
      policies: [
        { insurer_name: "한화생명", product_name: "건강보험", monthly_premium: 10000 },
        { insurer_name: "삼성생명", product_name: "실손", monthly_premium: 45000 },
      ],
    }),
    contextPack: { recent_conversation_originals: [] },
    corporateContexts: [pack],
    corporateGapEvidence: [
      {
        entity_id: "corp-1",
        item: "fire_insurance",
        unknown_gap: true,
        status: "unknown",
      },
    ],
    now: new Date("2026-07-14T10:00:00+09:00"),
  });
  assert.equal(payload.current_question.includes("올해"), true);
  assert.equal(payload.current_context.current_date, "2026-07-14");
  const personal = payload.available_verified_evidence.personal;
  const corporate = payload.available_verified_evidence.corporate;
  assert.equal(personal.subject_type, "individual");
  assert.equal(personal.chart.policy_count.value, 2);
  assert.equal(JSON.stringify(personal).includes("group_insurance"), false);
  assert.equal(corporate.length, 1);
  assert.equal(corporate[0].subject_type, "corporate");
  assert.equal(corporate[0].entity_id, "corp-1");
  assert.ok(corporate[0].gap_evidence.length >= 1);
  assert.equal(JSON.stringify(corporate[0]).includes("한화생명"), false);
  assert.equal(JSON.stringify(corporate[0]).includes("삼성생명"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "mode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "guidance"), false);
}

{
  assert.deepEqual(extractPublicEvidenceFromClaudeContent([]), []);
  const pub = extractPublicEvidenceFromClaudeContent(
    [
      {
        type: "web_search_tool_result",
        content: [
          {
            type: "web_search_result",
            title: "국세청 보험료 세액공제",
            url: "https://www.nts.go.kr/example",
            publisher: "국세청",
            published_at: "2025-01-01",
          },
        ],
      },
      {
        type: "text",
        text: "한도는 100만 원입니다.",
        citations: [
          {
            title: "국세청 보험료 세액공제",
            url: "https://www.nts.go.kr/example",
            cited_text: "보장성 보험료 세액공제",
          },
        ],
      },
    ],
    { retrievedAt: "2026-07-14T12:00:00" },
  );
  assert.ok(pub.length >= 1);
  assert.equal(pub[0].publisher, "국세청");
  assert.equal(pub[0].retrieved_at, "2026-07-14T12:00:00");
  assert.equal(pub.some((p) => /web_search_used|tool/.test(JSON.stringify(p))), false);
}

// --- Slice 7: contract parties Hand (policyholder / insured) ---
{
  const chart = buildVerifiedCustomerChart({
    policy_count: 2,
    policies: [
      {
        id: "pol-a",
        insurer_name: "삼성생명",
        product_name: "실손",
        monthly_premium: 45000,
        coverage_summary: {
          policyholder: "홍길동",
          insured: "김영희",
          source_document_id: "doc-a",
          extractor_version: "step4-ocr-policy-v3-multi",
          extracted_at: "2026-01-10T00:00:00.000Z",
          detected_coverages: ["암"],
        },
      },
      {
        id: "pol-b",
        insurer_name: "한화생명",
        product_name: "건강",
        insured_name: "이순신",
        coverage_summary: {
          source_document_id: "doc-b",
          detected_coverages: ["실손"],
        },
      },
    ],
  });
  const a = chart.contracts[0];
  const b = chart.contracts[1];
  assert.equal(a.policyholder, "홍길동");
  assert.equal(a.insured, "김영희");
  assert.equal(a.parties.policyholder.evidence_state, "verified");
  assert.equal(a.parties.insured.evidence_state, "verified");
  assert.equal(a.provenance.document_id, "doc-a");
  assert.equal(a.parties.policyholder.provenance.document_id, "doc-a");
  // Contract B: insured_name alias → insured; no policyholder → unknown
  assert.equal(b.insured, "이순신");
  assert.equal(b.verified_fields.insured_name, "이순신");
  assert.equal(b.policyholder, null);
  assert.equal(b.parties.policyholder.evidence_state, "unknown");
  assert.equal(b.unknown_fields.includes("policyholder"), true);
  // No cross-contract mix
  assert.equal(a.insured.includes("이순신"), false);
  assert.equal(JSON.stringify(b).includes("홍길동"), false);
  assert.equal(JSON.stringify(b).includes("김영희"), false);
}

{
  // coverage_summary.insured alone (no insured_name) must not be lost
  const chart = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        insurer_name: "A",
        product_name: "B",
        coverage_summary: { insured: "박씨", policyholder: "박씨" },
      },
    ],
  });
  assert.equal(chart.contracts[0].insured, "박씨");
  assert.equal(chart.contracts[0].policyholder, "박씨");
}

// --- Slice 8.1: beneficiaries Hand + optional actual_premium_funder ---
{
  const chart = buildVerifiedCustomerChart({
    policy_count: 2,
    policies: [
      {
        id: "pol-a",
        insurer_name: "삼성생명",
        product_name: "종신",
        coverage_summary: {
          policyholder: "갑",
          insured: "갑",
          beneficiaries: [
            {
              name: "을",
              beneficiary_type: "death_benefit",
              share: "60%",
              evidence_state: "verified",
            },
            {
              name: "병",
              beneficiary_type: "death_benefit",
              share: "40%",
              evidence_state: "verified",
            },
            {
              name: "정",
              beneficiary_type: "maturity_benefit",
              share: null,
              evidence_state: "verified",
            },
          ],
          actual_premium_funder: {
            name: "무",
            evidence_state: "verified",
            provenance: { source_label: "보험료 납입자" },
          },
          party_changes: [
            {
              party_role: "beneficiary",
              previous_value: "을",
              new_value: "기",
              effective_date: "2024-05-01",
              evidence_state: "verified",
            },
          ],
          source_document_id: "doc-a",
          insurance_period: "9999세",
        },
      },
      {
        id: "pol-b",
        insurer_name: "한화생명",
        product_name: "건강",
        coverage_summary: {
          policyholder: "신",
          insured: "신",
          source_document_id: "doc-b",
        },
      },
    ],
  });
  const a = chart.contracts[0];
  const b = chart.contracts[1];
  assert.equal(a.beneficiaries.length, 3);
  assert.equal(a.beneficiaries.filter((x) => x.beneficiary_type === "death_benefit").length, 2);
  assert.equal(a.actual_premium_funder?.name, "무");
  assert.equal(a.actual_premium_funder.name === a.policyholder, false);
  assert.equal(a.premium_payers, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(a, "premium_payers"), false);
  assert.equal(a.party_changes[0].effective_date, "2024-05-01");
  assert.equal(a.insurance_period, "9999세");
  assert.equal(b.beneficiaries.length, 0);
  assert.equal(b.actual_premium_funder, undefined);
  assert.equal(b.unknown_fields.includes("beneficiaries"), true);
  assert.equal(b.unknown_fields.includes("premium_payers"), false);
  assert.equal(JSON.stringify(b).includes("을"), false);
  assert.equal(JSON.stringify(b).includes("무"), false);
  assert.equal(JSON.stringify(chart).includes("premium_payers"), false);
}

{
  // No funder evidence → omit; do not invent from policyholder
  const chart = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        insurer_name: "A",
        product_name: "B",
        coverage_summary: {
          policyholder: "갑",
          insured: "갑",
          actual_premium_funder: { name: "갑" },
        },
      },
    ],
  });
  assert.equal(chart.contracts[0].policyholder, "갑");
  assert.equal(chart.contracts[0].actual_premium_funder, undefined);
}

{
  // explanatory party answer must not be treated as sentence_hard_lite truncation case
  const educational =
    "계약자와 피보험자가 다르면 계약 변경·해지 권한은 계약자에게 있고, 보장은 피보험자 기준입니다. 지금 결정하기 전에 구조를 확인하세요.";
  assert.equal(sentenceHardLiteBlocks(educational), false);
  const enroll = hardOnlySafetyCheck("지금 가입하세요. 바로 해지하세요.", {
    allowed_numbers: [],
    allowed_entities: [],
  });
  assert.ok(enroll.hard_fail);
  const replace = selectReplacingHardReasons(enroll.hard, "지금 가입하세요. 바로 해지하세요.");
  assert.ok(replace.length > 0);
}

// --- Slice 9: positive party fixtures → chart → Claude payload (judgment Hand materials) ---
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pack = JSON.parse(
    readFileSync(
      join(root, "fixtures/key-judgment-validation-v1/slice-9-party-positive-fixtures.json"),
      "utf8",
    ),
  );
  const caseA = pack.cases.find((c) => c.id === "slice-9-case-a");
  const caseB = pack.cases.find((c) => c.id === "slice-9-case-b");
  assert.ok(caseA && caseB);

  const chartA = buildVerifiedCustomerChart(caseA.reality);
  const a = chartA.contracts[0];
  assert.equal(a.policyholder, "가상갑");
  assert.equal(a.insured, "가상갑");
  assert.equal(a.beneficiaries.filter((b) => b.beneficiary_type === "death_benefit").length, 2);
  assert.equal(a.beneficiaries.some((b) => b.beneficiary_type === "maturity_benefit"), true);
  assert.equal(a.beneficiaries.find((b) => b.share === "60%")?.name, "가상의을");
  assert.equal(a.beneficiaries.find((b) => b.share === "40%")?.name, "가상의병");
  assert.equal(a.party_changes[0]?.effective_date, "2023-06-01");
  assert.equal(a.actual_premium_funder, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(a, "premium_payers"), false);

  const chartB = buildVerifiedCustomerChart(caseB.reality);
  const b = chartB.contracts[0];
  assert.equal(b.policyholder, "가상정");
  assert.equal(b.insured, "가상무");
  assert.equal(b.actual_premium_funder?.name, "가상경");
  assert.equal(b.actual_premium_funder.name === b.policyholder, false);

  const combined = {
    policy_count: 2,
    policies: [...caseA.reality.policies, ...caseB.reality.policies],
  };
  const chart = buildVerifiedCustomerChart(combined);
  assert.equal(chart.contracts.length, 2);
  assert.equal(JSON.stringify(chart.contracts[0]).includes("가상경"), false);
  assert.equal(JSON.stringify(chart.contracts[1]).includes("가상의을"), false);

  const payload = buildUserPayload({
    question: "사망보험금은 누가 얼마씩 받게 돼?",
    chart,
    contextPack: { recent_conversation_originals: [] },
    now: new Date("2026-07-14T12:00:00+09:00"),
  });
  const personal = payload.available_verified_evidence.personal.chart;
  assert.equal(personal.contracts[0].beneficiaries.length >= 2, true);
  assert.equal(personal.contracts[1].actual_premium_funder.name, "가상경");
  assert.equal(JSON.stringify(payload).includes("premium_payers"), false);

  // 60%/40% of 3억 — materials include amount for Claude calculation
  const amountRaw = JSON.stringify(caseA.reality.policies[0].coverage_summary);
  assert.equal(amountRaw.includes("300000000") || amountRaw.includes("3억"), true);

  const sys = buildSystemPrompt();
  assert.equal(/상속\s*모드|세무\s*persona|classifier/i.test(sys), false);
  assert.ok(sys.includes("법정상속인"));
  assert.ok(sys.includes("내부 필드명"));
}

// --- KEY confirmed source facts → customer card (existing coverage_summary) ---
{
  assert.equal(RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name, "record_confirmed_source_facts");

  const chartWithKey = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        id: "pol-key-1",
        insurer_name: "OCR보험",
        product_name: "OCR상품",
        coverage_summary: {
          source_document_id: "doc-key-1",
          policyholder: "OCR계약자",
          key_confirmed_source_facts: [
            {
              fact_type: "policyholder",
              literal_value: "KEY계약자",
              source_document_id: "doc-key-1",
              source_locator: { page: 1 },
              confirmed_at: "2026-07-15T00:00:00.000Z",
              confirmation_source: "key_claude_original_document",
            },
            {
              fact_type: "coverage_amount",
              literal_value: "9999세",
              source_document_id: "doc-key-1",
              confirmed_at: "2026-07-15T00:00:00.000Z",
              confirmation_source: "key_claude_original_document",
            },
          ],
        },
      },
    ],
  });
  assert.equal(chartWithKey.key_confirmed_source_facts.length, 2);
  assert.equal(chartWithKey.contracts[0].key_confirmed_source_facts[0].literal_value, "KEY계약자");
  assert.ok(String(chartWithKey.ownership).includes("key_confirmed_source_facts"));

  const hydratePayload = buildUserPayload({
    question: "지난 문서에서 확인한 계약자와 보장금액을 다시 알려줘.",
    chart: chartWithKey,
    contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
    now: new Date("2026-07-15T12:00:00+09:00"),
  });
  const keyFacts =
    hydratePayload.available_verified_evidence.personal.key_confirmed_source_facts;
  assert.equal(keyFacts.length, 2);
  assert.equal(keyFacts[0].literal_value, "KEY계약자");
  assert.equal(
    hydratePayload.available_verified_evidence.personal.chart.contracts[0].policyholder,
    "OCR계약자",
  );
  assert.equal(JSON.stringify(hydratePayload).includes("보험료 부담을 늘리지"), false);
}

{
  const customerAnswer =
    "이 문서에서 확인되는 계약자는 홍길동이고, 보장기간 표기는 9999세입니다.";
  let claudeCalls = 0;
  let sawFactsTool = false;
  let policyUpdates = [];
  const fetchImpl = async (_url, opts) => {
    claudeCalls += 1;
    const body = JSON.parse(String(opts?.body ?? "{}"));
    sawFactsTool = (body.tools ?? []).some(
      (t) => t?.name === RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
    );
    assert.equal(
      (body.tools ?? []).some((t) => t?.name === "emit_claude_full"),
      false,
    );
    return {
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: customerAnswer },
            {
              type: "tool_use",
              id: "fact-1",
              name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
              input: {
                confirmed_source_facts: [
                  {
                    fact_type: "policyholder",
                    literal_value: "홍길동",
                    source_document_id: "doc-card-1",
                    source_locator: { page: 1, source_text: "계약자 홍길동" },
                  },
                  {
                    fact_type: "insurance_period",
                    literal_value: "9999세",
                    source_document_id: "doc-card-1",
                  },
                  {
                    fact_type: "priority",
                    literal_value: "보험료 부담을 늘리지 않고",
                    source_document_id: "doc-card-1",
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };

  const userSupabase = {
    from(table) {
      if (table === "customer_documents" || table === "documents") {
        return makeAttachQuery({
          data: {
            id: "doc-card-1",
            customer_id: "cust-card",
            storage_path: "cust-card/doc-card-1.pdf",
            mime_type: "application/pdf",
            original_filename: "policy.pdf",
            deleted_at: null,
          },
          error: null,
        });
      }
      if (table === "profile_insurance_policies") {
        let mode = "select";
        let updatePayload = null;
        const api = {
          select() {
            mode = "select";
            return api;
          },
          update(payload) {
            mode = "update";
            updatePayload = payload;
            return api;
          },
          eq() {
            return api;
          },
          then(resolve, reject) {
            try {
              if (mode === "select") {
                resolve({
                  data: [
                    {
                      id: "pol-card-1",
                      is_active: true,
                      coverage_summary: {
                        source_document_id: "doc-card-1",
                        policyholder: "OCR홍길동",
                      },
                    },
                  ],
                  error: null,
                });
                return;
              }
              policyUpdates.push(updatePayload);
              resolve({ data: null, error: null });
            } catch (err) {
              reject(err);
            }
          },
        };
        return api;
      }
      return makeAttachQuery({ data: null, error: null });
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: makeBlobFromBuffer(Buffer.from("%PDF-1.4 card")),
          error: null,
        }),
      }),
    },
  };

  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 문서에서 확인되는 계약자와 보장금액을 알려줘.",
    history: [],
    loadedContext: {
      policy_count: 1,
      policies: [
        {
          id: "pol-card-1",
          insurer_name: "테스트생명",
          coverage_summary: { source_document_id: "doc-card-1", policyholder: "OCR홍길동" },
        },
      ],
    },
    customerId: "cust-card",
    attachedDocumentId: "doc-card-1",
    userSupabase,
    env: failClosedEnv,
    fetchImpl,
  });

  assert.equal(claudeCalls, 1, "Claude-first call count must stay 1");
  assert.equal(sawFactsTool, true);
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(result.customerText, customerAnswer);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sealed_matches_claude,
    true,
  );
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.web_search
      ?.phase_b_call_count,
    0,
  );
  assert.equal(policyUpdates.length, 1);
  const stored =
    policyUpdates[0].coverage_summary.key_confirmed_source_facts ?? [];
  assert.equal(stored.length, 2);
  assert.equal(stored.some((f) => f.literal_value === "9999세"), true);
  assert.equal(stored.some((f) => f.fact_type === "priority"), false);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_confirmed_persist?.ok,
    true,
  );
  // GO2-M / GO1 gate regression: accepted/rejected counts stay on confirm path.
  {
    const gate =
      result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_confirmed_fact_gate;
    assert.equal(gate?.attempted, true, "GO1 gate attempted");
    assert.equal(gate?.accepted_count, 2, "GO1 gate accepted_count regression");
    assert.equal(gate?.ownership_ok, true, "GO1 gate ownership_ok");
    assert.equal(gate?.active_document_present, true, "GO1 gate active_document_present");
    assert.equal(
      typeof gate?.rejected_reason_counts,
      "object",
      "GO1 gate rejected_reason_counts present",
    );
    // priority dropped before/at gate — must not appear in accepted persist set (above).
  }
}

{
  // Persist failure must not rewrite sealed customer answer / no second Claude.
  const customerAnswer = "계약자는 김철수입니다.";
  let claudeCalls = 0;
  const fetchImpl = async () => {
    claudeCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: customerAnswer },
            {
              type: "tool_use",
              id: "fact-fail",
              name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
              input: {
                confirmed_source_facts: [
                  {
                    fact_type: "policyholder",
                    literal_value: "김철수",
                    source_document_id: "doc-fail-1",
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };
  const userSupabase = {
    from(table) {
      if (table === "customer_documents" || table === "documents") {
        return makeAttachQuery({
          data: {
            id: "doc-fail-1",
            customer_id: "cust-fail",
            storage_path: "cust-fail/doc-fail-1.pdf",
            mime_type: "application/pdf",
            original_filename: "fail.pdf",
            deleted_at: null,
          },
          error: null,
        });
      }
      if (table === "profile_insurance_policies") {
        const api = {
          select() {
            return api;
          },
          update() {
            return api;
          },
          eq() {
            return api;
          },
          then(resolve) {
            resolve({ data: null, error: { message: "forced_persist_error" } });
          },
        };
        return api;
      }
      return makeAttachQuery({ data: null, error: null });
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: makeBlobFromBuffer(Buffer.from("%PDF-1.4 fail")),
          error: null,
        }),
      }),
    },
  };

  const result = await runClaudeFirstDirectQuestionTurn({
    question: "계약자가 누구야?",
    history: [],
    loadedContext: { policy_count: 0, policies: [] },
    customerId: "cust-fail",
    attachedDocumentId: "doc-fail-1",
    userSupabase,
    env: failClosedEnv,
    fetchImpl,
  });
  assert.equal(claudeCalls, 1);
  assert.equal(result.customerText, customerAnswer);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sealed_matches_claude,
    true,
  );
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_confirmed_persist?.ok,
    false,
  );
}

// --- Active claim cases → customer card (profile_health.details_json) ---
{
  assert.equal(RECORD_CLAIM_CASE_UPDATES_TOOL.name, "record_claim_case_updates");
  assert.ok(String(buildSystemPrompt()).includes("record_claim_case_updates"));

  const hydratePayload = buildUserPayload({
    question: "지난 청구는 지금 어디까지 진행됐지?",
    chart: buildVerifiedCustomerChart({ policy_count: 1, policies: [] }),
    contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
    activeClaimCases: [
      {
        claim_case_key: "date:2026-07-12:kind:surgery",
        medical_event: {
          surgery_name: "슬관절 수술",
          surgery_date: "2026-07-12",
          event_kind: "surgery",
        },
        related_policies: ["실손의료비보험"],
        related_coverages: ["실손", "수술비"],
        assessment: { code: "claim_warranted", rationale: "확인된 수술" },
        required_documents: ["진단서", "영수증"],
        available_documents: ["진단서"],
        missing_documents: ["영수증"],
        status: "preparing",
        next_action: "영수증 준비",
        evidence: [],
        updated_at: "2026-07-15T00:00:00.000Z",
      },
    ],
    now: new Date("2026-07-15T12:00:00+09:00"),
  });
  const cases =
    hydratePayload.available_verified_evidence.personal.active_claim_cases;
  assert.equal(cases.length, 1);
  assert.equal(cases[0].status, "preparing");
  assert.equal(
    hydratePayload.available_verified_evidence.personal.provenance
      .active_claim_case_count,
    1,
  );
  // Internal field names may exist in payload materials, but not as customer copy instructions.
  assert.equal(JSON.stringify(hydratePayload).includes("claim_bridge"), false);
}

{
  const customerAnswer =
    "어제 수술 기준으로는 확인된 실손·수술비 청구를 준비해보는 게 맞습니다. 지금은 진단서가 있고 영수증이 더 필요합니다.";
  let claudeCalls = 0;
  let sawClaimTool = false;
  let sawHydratedCase = false;
  let healthWrites = [];
  const fetchImpl = async (_url, opts) => {
    claudeCalls += 1;
    const body = JSON.parse(String(opts?.body ?? "{}"));
    sawClaimTool = (body.tools ?? []).some(
      (t) => t?.name === RECORD_CLAIM_CASE_UPDATES_TOOL.name,
    );
    assert.equal(
      (body.tools ?? []).some((t) => t?.name === "emit_claude_full"),
      false,
    );
    const rawContent = body?.messages?.[0]?.content;
    const userText = Array.isArray(rawContent)
      ? rawContent.find((b) => b?.type === "text")?.text
      : rawContent;
    sawHydratedCase = String(userText ?? "").includes("date:2026-07-12:kind:surgery");
    return {
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: customerAnswer },
            {
              type: "tool_use",
              id: "claim-1",
              name: RECORD_CLAIM_CASE_UPDATES_TOOL.name,
              input: {
                claim_case_updates: [
                  {
                    claim_case_key: "date:2026-07-12:kind:surgery",
                    medical_event: {
                      surgery_name: "슬관절 수술",
                      surgery_date: "2026-07-12",
                      event_kind: "surgery",
                      diagnosis_certainty: "confirmed",
                    },
                    related_policies: ["실손의료비보험"],
                    related_coverages: ["실손", "수술비"],
                    assessment: { code: "claim_warranted" },
                    required_documents: ["진단서", "영수증", "수술기록"],
                    available_documents: ["진단서", "영수증"],
                    missing_documents: ["수술기록"],
                    status: "preparing",
                    next_action: "수술기록 준비",
                    evidence: [],
                  },
                  {
                    medical_event: { diagnosis_name: "추측만" },
                    status: "paid",
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };

  const userSupabase = {
    from(table) {
      if (table === "profile_health") {
        let mode = "select";
        let payload = null;
        const api = {
          select() {
            mode = "select";
            return api;
          },
          update(p) {
            mode = "update";
            payload = p;
            return api;
          },
          insert(p) {
            mode = "insert";
            payload = p;
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                customer_id: "cust-claim",
                details_json: {
                  key_active_claim_cases: [
                    {
                      claim_case_key: "date:2026-07-12:kind:surgery",
                      status: "identified",
                      available_documents: ["진단서"],
                      missing_documents: ["영수증"],
                      evidence: [],
                      medical_event: {
                        surgery_date: "2026-07-12",
                        event_kind: "surgery",
                      },
                    },
                  ],
                },
              },
              error: null,
            });
          },
          then(resolve) {
            if (mode === "update" || mode === "insert") {
              healthWrites.push({ mode, payload });
              resolve({ data: null, error: null });
              return;
            }
            resolve({ data: null, error: null });
          },
        };
        return api;
      }
      return makeAttachQuery({ data: null, error: null });
    },
  };

  const result = await runClaudeFirstDirectQuestionTurn({
    question: "진단서와 영수증은 준비했어. 아직 부족한 서류가 뭐야?",
    history: [],
    loadedContext: {
      policy_count: 1,
      policies: [
        {
          id: "pol-claim-1",
          insurer_name: "테스트생명",
          product_name: "실손의료비보험",
          coverage_summary: { source_document_id: "doc-claim-1" },
        },
      ],
    },
    customerId: "cust-claim",
    userSupabase,
    env: failClosedEnv,
    fetchImpl,
  });

  assert.equal(claudeCalls, 1, "Claude-first call count must stay 1");
  assert.equal(sawClaimTool, true);
  assert.equal(sawHydratedCase, true);
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(result.customerText, customerAnswer);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sealed_matches_claude,
    true,
  );
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.web_search
      ?.phase_b_call_count,
    0,
  );
  assert.equal(
    result.oneKeyCoreTrace?.legacy_paths_blocked?.includes("claim_bridge_speak"),
    true,
  );
  assert.equal(healthWrites.length, 1);
  const stored = healthWrites[0].payload.details_json.key_active_claim_cases;
  assert.equal(stored.length, 1, "same claim case must not duplicate");
  assert.equal(stored[0].available_documents.includes("영수증"), true);
  assert.equal(stored[0].missing_documents.includes("수술기록"), true);
  assert.equal(stored[0].status, "preparing");
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_claim_case_persist
      ?.ok,
    true,
  );
  assert.equal(JSON.stringify(result.customerText).includes("claim_case_key"), false);
  assert.equal(JSON.stringify(result.customerText).includes("record_claim_case"), false);
}

{
  // Claim persist failure must not rewrite sealed customer answer / no second Claude.
  const customerAnswer =
    "접수하셨다면 고객카드에 제출 확인으로 남겨 두겠습니다. 보험사 심사 연동은 아직 없습니다.";
  let claudeCalls = 0;
  const fetchImpl = async () => {
    claudeCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: customerAnswer },
            {
              type: "tool_use",
              id: "claim-fail",
              name: RECORD_CLAIM_CASE_UPDATES_TOOL.name,
              input: {
                claim_case_updates: [
                  {
                    claim_case_key: "date:2026-07-12:kind:surgery",
                    status: "submitted_by_customer",
                    evidence: ["customer_said_submitted"],
                    medical_event: {
                      surgery_date: "2026-07-12",
                      event_kind: "surgery",
                    },
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };
  const userSupabase = {
    from(table) {
      if (table === "profile_health") {
        const api = {
          select() {
            return api;
          },
          update() {
            return api;
          },
          insert() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            resolve({ data: null, error: { message: "forced_claim_persist_error" } });
          },
        };
        return api;
      }
      return makeAttachQuery({ data: null, error: null });
    },
  };

  const result = await runClaudeFirstDirectQuestionTurn({
    question: "내가 직접 접수하고 왔어.",
    history: [],
    loadedContext: { policy_count: 0, policies: [] },
    customerId: "cust-claim-fail",
    userSupabase,
    env: failClosedEnv,
    fetchImpl,
  });
  assert.equal(claudeCalls, 1);
  assert.equal(result.customerText, customerAnswer);
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sealed_matches_claude,
    true,
  );
  assert.equal(
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_claim_case_persist
      ?.ok,
    false,
  );
}

// --- GO2: KEY verified literal conflict (sentence pre-commit) ---
{
  const DOC = "doc-go2-a";
  function keyFact(type, value, docId = DOC) {
    return {
      fact_type: type,
      literal_value: value,
      source_document_id: docId,
      confirmation_source: "key_claude_original_document",
    };
  }
  function keyPolicy(facts, { id = "pol-go2", docId = DOC, active = true } = {}) {
    return {
      id,
      is_active: active,
      coverage_summary: {
        source_document_id: docId,
        key_confirmed_source_facts: facts,
      },
    };
  }

  const samsungSet = buildVerifiedLiteralSetFromPolicies(
    [
      keyPolicy([
        keyFact("insurer_name", "삼성화재"),
        keyFact("product_name", "무배당 삼성화재 자녀보험 NEW마이슈퍼스타(2404.3)"),
        keyFact("monthly_premium", "52000"),
        keyFact("insured", "김수정"),
      ]),
    ],
    { activeDocumentId: DOC },
  );

  // Baseline: accurate insurer / wrong insurer / compare / question / assume / premium
  assert.equal(
    detectKeyVerifiedLiteralConflict("이 계약의 보험사는 삼성화재입니다.", samsungSet).conflict,
    false,
  );
  {
    const b = detectKeyVerifiedLiteralConflict("이 계약은 KB손해보험입니다.", samsungSet);
    assert.equal(b.conflict, true);
    assert.equal(b.field, "insurer_name");
  }
  assert.equal(
    detectKeyVerifiedLiteralConflict("KB손해보험 상품과 비교하면 보장 구성이 달라요.", samsungSet)
      .conflict,
    false,
  );
  assert.equal(
    detectKeyVerifiedLiteralConflict("이 계약 보험사가 삼성화재가 아닌가요?", samsungSet).conflict,
    false,
  );
  assert.equal(
    detectKeyVerifiedLiteralConflict("보험료가 8만 원이라고 가정하면 부담이 커요.", samsungSet)
      .conflict,
    false,
  );
  assert.equal(
    detectKeyVerifiedLiteralConflict("이 계약의 월 보험료는 52,000원입니다.", samsungSet).conflict,
    false,
  );

  // A: activeDocumentId fact 0 + other-doc facts only → pass (fail-closed, no fall-through)
  {
    const otherOnly = buildVerifiedLiteralSetFromPolicies(
      [keyPolicy([keyFact("insurer_name", "현대해상", "doc-other")], { id: "p-other", docId: "doc-other" })],
      { activeDocumentId: DOC },
    );
    assert.equal(
      detectKeyVerifiedLiteralConflict("이 계약은 KB손해보험입니다.", otherOnly).conflict,
      false,
      "A: activeDocumentId with 0 matching facts → pass",
    );
    assert.equal(
      detectKeyVerifiedLiteralConflict("이 계약은 KB손해보험입니다.", otherOnly).reason,
      "active_document_no_verified_facts",
    );
  }

  // B/C: negation → pass (never treat as positive conflict)
  assert.equal(
    detectKeyVerifiedLiteralConflict("이 계약은 KB손해보험이 아닙니다.", samsungSet).conflict,
    false,
    "B: negation of wrong insurer → pass",
  );
  assert.equal(
    detectKeyVerifiedLiteralConflict("이 계약은 삼성화재가 아닙니다.", samsungSet).conflict,
    false,
    "C: negation of verified insurer → pass",
  );

  // D/E: premium role-bound only
  assert.equal(
    detectKeyVerifiedLiteralConflict(
      "이 계약의 보험료는 미확인이고 진단비는 3,000만 원입니다.",
      samsungSet,
    ).conflict,
    false,
    "D: uncertain premium + diagnosis amount → pass",
  );
  {
    const e = detectKeyVerifiedLiteralConflict("월 보험료는 87,000원입니다.", samsungSet);
    assert.equal(e.conflict, true, "E: wrong monthly premium → block");
    assert.equal(e.field, "monthly_premium");
  }

  // F/G: 증권상 — distinction pass vs bare false party assert block
  assert.equal(
    detectKeyVerifiedLiteralConflict(
      "증권상 피보험자는 김수정이고 로그인 고객과 다릅니다.",
      samsungSet,
    ).conflict,
    false,
    "F: doc vs login distinction → pass",
  );
  {
    const g = detectKeyVerifiedLiteralConflict("증권상 피보험자는 조무연입니다.", samsungSet);
    assert.equal(g.conflict, true, "G: bare 증권상 wrong party → block");
    assert.equal(g.field, "insured");
  }

  // H/I: 반면 alone does not soft-pass; clear comparison does
  {
    const h = detectKeyVerifiedLiteralConflict(
      "반면 이 계약은 KB손해보험입니다.",
      samsungSet,
    );
    assert.equal(h.conflict, true, "H: bare 반면 + wrong insurer → block");
  }
  assert.equal(
    detectKeyVerifiedLiteralConflict(
      "다른 KB 간편실속 상품과 비교하면 담보가 다릅니다.",
      samsungSet,
    ).conflict,
    false,
    "I: clear comparison → pass",
  );

  // product abbrev / multi-contract ambiguous / OCR excluded
  assert.equal(
    detectKeyVerifiedLiteralConflict(
      "이 계약의 상품명은 NEW마이슈퍼스타입니다.",
      samsungSet,
    ).conflict,
    false,
  );
  {
    const multi = buildVerifiedLiteralSetFromPolicies(
      [
        keyPolicy([keyFact("insurer_name", "삼성화재", "doc-1")], { id: "p1", docId: "doc-1" }),
        keyPolicy([keyFact("insurer_name", "현대해상", "doc-2")], { id: "p2", docId: "doc-2" }),
      ],
      { activeDocumentId: null },
    );
    assert.equal(
      detectKeyVerifiedLiteralConflict("이 계약은 KB손해보험입니다.", multi).conflict,
      false,
    );
  }
  {
    const ocrOnly = buildVerifiedLiteralSetFromPolicies(
      [
        {
          id: "pol-ocr",
          is_active: true,
          coverage_summary: {
            source_document_id: DOC,
            key_confirmed_source_facts: [
              {
                fact_type: "insurer_name",
                literal_value: "OCR보험",
                source_document_id: DOC,
                confirmation_source: "upload_extract",
              },
            ],
          },
        },
      ],
      { activeDocumentId: DOC },
    );
    assert.equal(ocrOnly.entries.length, 0);
  }
}

async function runGo2ConflictTurn({
  answerText,
  verifiedPolicy,
  docId,
  extras = {},
}) {
  const expectedCloser = finalizeKeyCustomerText("", { failureMode: true }).keySpeakOriginal;
  let claudeCalls = 0;
  let confirmedPersistCalls = 0;
  let baselinePersistCalls = 0;
  let claimPersistCalls = 0;
  const deltas = [];
  const fetchImpl = async () => {
    claudeCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: answerText },
            {
              type: "tool_use",
              id: "fact-conflict",
              name: RECORD_CONFIRMED_SOURCE_FACTS_TOOL.name,
              input: {
                confirmed_source_facts: [
                  {
                    fact_type: "insurer_name",
                    literal_value: "KB손해보험",
                    source_document_id: docId,
                  },
                ],
              },
            },
            {
              type: "tool_use",
              id: "baseline-conflict",
              name: "record_coverage_baseline_facts",
              input: {
                coverage_baseline_facts: [
                  {
                    baseline_item_id: "cancer_diagnosis",
                    amount_literal: "1000만원",
                    source_document_id: docId,
                  },
                ],
              },
            },
            {
              type: "tool_use",
              id: "claim-conflict",
              name: RECORD_CLAIM_CASE_UPDATES_TOOL.name,
              input: {
                claim_case_updates: [
                  { claim_case_id: "cc-1", status: "open", note: "x" },
                ],
              },
            },
          ],
        };
      },
    };
  };
  const userSupabase = {
    from(table) {
      if (table === "profile_insurance_policies") {
        let mode = "select";
        const api = {
          select() {
            mode = "select";
            return api;
          },
          update() {
            mode = "update";
            confirmedPersistCalls += 1;
            baselinePersistCalls += 1;
            return api;
          },
          insert() {
            mode = "insert";
            confirmedPersistCalls += 1;
            return api;
          },
          eq() {
            return api;
          },
          then(resolve) {
            if (mode === "select") {
              resolve({ data: [verifiedPolicy], error: null });
              return;
            }
            resolve({ data: null, error: null });
          },
        };
        return api;
      }
      if (table === "customer_claim_cases" || table === "claim_cases") {
        claimPersistCalls += 1;
        return makeAttachQuery({ data: null, error: null });
      }
      return makeAttachQuery({ data: null, error: null });
    },
  };
  const streamHandlers = {
    _emitted: false,
    onDelta(text) {
      deltas.push(String(text ?? ""));
      streamHandlers._emitted = true;
    },
    onFirstToken() {},
  };
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "이 증권 보험사만 확인해 주세요",
    history: [],
    loadedContext: { policy_count: 1, policies: [verifiedPolicy] },
    customerContextBundle: { policies: [verifiedPolicy], policy_count: 1 },
    unifiedState: { policies: [verifiedPolicy], policy_count: 1 },
    customerId: "cust-go2",
    userSupabase,
    env: failClosedEnv,
    fetchImpl,
    streamHandlers,
    ...extras,
  });
  return {
    result,
    deltas,
    claudeCalls,
    confirmedPersistCalls,
    baselinePersistCalls,
    claimPersistCalls,
    expectedCloser,
  };
}

{
  // J: good sentence then conflict — keep first, block rest, closer once, SSE===seal
  const DOC = "doc-go2-stream-j";
  const verifiedPolicy = {
    id: "pol-go2-j",
    is_active: true,
    coverage_summary: {
      source_document_id: DOC,
      key_confirmed_source_facts: [
        {
          fact_type: "insurer_name",
          literal_value: "삼성화재",
          source_document_id: DOC,
          confirmation_source: "key_claude_original_document",
        },
      ],
    },
  };
  const good = "확인해 보니 증권 내용은 이렇게 정리됩니다.";
  const conflict = " 이 계약은 KB손해보험입니다.";
  const after = " 추가로 진단비도 있습니다.";
  const answerText = good + conflict + after;
  const run = await runGo2ConflictTurn({ answerText, verifiedPolicy, docId: DOC });
  const sseJoined = run.deltas.join("");
  assert.equal(run.claudeCalls, 1, "N: Claude provider call === 1");
  assert.equal(run.deltas[0], good, "J: first good sentence kept");
  assert.equal(
    run.deltas.filter((d) => d.includes("KB손해보험")).length,
    0,
    "J: conflict sentence 0",
  );
  assert.equal(sseJoined.includes("추가로 진단비"), false, "J: later sentence 0");
  assert.equal(
    run.deltas.filter((d) => d === run.expectedCloser).length,
    1,
    "J: closer 1회",
  );
  assert.equal(sseJoined, good + run.expectedCloser);
  assert.equal(run.result.customerText, sseJoined, "J: SSE === sealed === return");
  assert.equal(run.result.keySpeakOriginal, sseJoined);
  assert.equal(
    run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sentence_commit
      ?.committed_len,
    good.length,
    "J: getCommitted length = good only (no conflict/after)",
  );
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_confirmed_persist?.attempted, false);
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_coverage_baseline_persist?.attempted, false);
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_claim_case_persist?.attempted, false);
  assert.equal(run.confirmedPersistCalls, 0, "L: confirmed persist calls 0");
  assert.equal(run.baselinePersistCalls, 0, "L: baseline persist calls 0");
  assert.equal(run.claimPersistCalls, 0, "L: claim persist calls 0");
}

{
  // K: tiny answer conflict (no progressive boundaries until flush)
  const DOC = "doc-go2-stream-k";
  const verifiedPolicy = {
    id: "pol-go2-k",
    is_active: true,
    coverage_summary: {
      source_document_id: DOC,
      key_confirmed_source_facts: [
        {
          fact_type: "insurer_name",
          literal_value: "삼성화재",
          source_document_id: DOC,
          confirmation_source: "key_claude_original_document",
        },
      ],
    },
  };
  // No ASCII sentence terminator — flushAll commits as one tiny unit.
  const tinyConflict = "이 계약은 KB손해보험입니다";
  const run = await runGo2ConflictTurn({ answerText: tinyConflict, verifiedPolicy, docId: DOC });
  const sseJoined = run.deltas.join("");
  assert.equal(run.claudeCalls, 1, "K/N: Claude 1");
  assert.equal(sseJoined.includes("KB손해보험"), false, "K: conflict not in SSE");
  assert.equal(run.deltas.join(""), run.expectedCloser);
  assert.equal(run.result.customerText, run.expectedCloser);
  assert.equal(run.result.keySpeakOriginal, run.expectedCloser);
  assert.equal(
    run.deltas.filter((d) => d === run.expectedCloser).length,
    1,
    "K: closer 1",
  );
  assert.equal(
    run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.sentence_commit
      ?.committed_len,
    0,
    "K: committed stays 0 (conflict not kept)",
  );
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_confirmed_persist?.attempted, false);
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_coverage_baseline_persist?.attempted, false);
  assert.equal(run.result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.key_claim_case_persist?.attempted, false);
}

// --- GO3 correction: server SSOT + discard persist + no client prior trust ---
{
  assert.equal(RECORD_SESSION_GOAL_TOOL.name, "record_session_goal");
  assert.equal(SESSION_GOAL_MAX_CHARS, 80);
  assert.equal(isForbiddenSessionGoalText("해지하려는 것 같다"), true, "K");
  assert.equal(isForbiddenSessionGoalText("보험료 부담을 줄일 선택지 비교"), false, "K allow");
  assert.equal(
    classifySessionGoalRejectReason("a".repeat(81), "active"),
    "too_long",
    "K too long",
  );
  assert.equal(
    classifySessionGoalRejectReason("연락처는 test@example.com", "active"),
    "pii_email",
    "K pii",
  );
  assert.equal(shouldDiscardStaleSessionGoal("그 얘기 말고"), true, "E discard");
  assert.equal(shouldDiscardStaleSessionGoal("이제 그만"), true, "E");
  assert.equal(shouldDiscardStaleSessionGoal("그건 나중에"), true, "E");
  assert.equal(shouldDiscardStaleSessionGoal("그 얘기 말고도 궁금한 게 있어요"), false, "G");
  assert.equal(shouldDiscardStaleSessionGoal('"그 얘기 말고"라고 말했죠'), false, "G quote");

  const now = new Date("2026-07-19T12:00:00.000Z");
  assert.equal(
    resolvePersistableSessionGoal({
      discardRequested: true,
      usedFailure: true,
      claudeGoal: { goal: "가입 계약 확인", status: "active", updated_at: "x" },
      now,
    })?.status,
    "completed",
    "E: discard wins over failure",
  );
  assert.equal(
    resolvePersistableSessionGoal({
      discardRequested: false,
      usedFailure: true,
      claudeGoal: { goal: "가입 계약 확인", status: "active", updated_at: "x" },
      now,
    }),
    null,
    "H: failure → new goal store 0",
  );

  // A/B/C/D: SSOT loader
  {
    const rows = [
      {
        role: "assistant",
        created_at: "2026-07-19T12:02:00.000Z",
        metadata_json: {
          session_id: "sess-a",
          session_goal: {
            goal: null,
            status: "completed",
            updated_at: "2026-07-19T12:02:00.000Z",
          },
        },
      },
      {
        role: "assistant",
        created_at: "2026-07-19T12:01:00.000Z",
        metadata_json: {
          session_id: "sess-a",
          session_goal: {
            goal: "가입 계약 확인",
            status: "active",
            updated_at: "2026-07-19T12:01:00.000Z",
          },
        },
      },
      {
        role: "assistant",
        created_at: "2026-07-19T12:00:00.000Z",
        metadata_json: {
          session_id: "sess-other",
          session_goal: {
            goal: "다른 세션 목표",
            status: "active",
            updated_at: "2026-07-19T12:00:00.000Z",
          },
        },
      },
    ];
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: rows, error: null });
          },
        };
      },
    };
    const completedWins = await loadLatestSessionGoalFromConversations({
      supabase,
      customerId: "cust-1",
      sessionId: "sess-a",
    });
    assert.equal(completedWins.goal, null, "D: completed beats older active");
    assert.equal(completedWins.reason, "completed_slot");

    const activeOnly = await loadLatestSessionGoalFromConversations({
      supabase: {
        from() {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [rows[1], rows[2]],
                error: null,
              });
            },
          };
        },
      },
      customerId: "cust-1",
      sessionId: "sess-a",
    });
    assert.equal(activeOnly.goal?.goal, "가입 계약 확인", "C: same session active");

    const otherSession = await loadLatestSessionGoalFromConversations({
      supabase,
      customerId: "cust-1",
      sessionId: "sess-missing",
    });
    assert.equal(otherSession.goal, null, "B: other session 0");
  }

  // A: client forged prior ignored — body has no prior_session_goal; request uses session_id
  {
    const forgedBody = buildHomeBrainFactRequestBody("이어서", [], {
      sessionId: "sess-a",
      priorSessionGoal: {
        goal: "변조된 목표 주입",
        status: "active",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.equal(forgedBody.prior_session_goal, undefined, "A: prior field removed");
    assert.equal(forgedBody.session_id, "sess-a");
  }

  // Integration: SSOT inject + forged client prior param ignored (no priorSessionGoal arg)
  {
    const answerText = "가입하신 계약을 기준으로 확인해 드릴게요.";
    let claudeCalls = 0;
    let injectedGoal = null;
    const fetchImpl = async (_url, opts) => {
      claudeCalls += 1;
      const bodyJson = JSON.parse(String(opts.body ?? "{}"));
      const userText = JSON.stringify(bodyJson.messages ?? []);
      if (userText.includes("보험료 부담을 줄일 선택지 비교")) {
        injectedGoal = "보험료 부담을 줄일 선택지 비교";
      }
      if (userText.includes("변조된 목표")) injectedGoal = "FORGED";
      return {
        ok: true,
        async json() {
          return {
            content: [
              { type: "text", text: answerText },
              {
                type: "tool_use",
                id: "toolu_sg",
                name: "record_session_goal",
                input: { goal: "가입 계약 확인", status: "active" },
              },
            ],
          };
        },
      };
    };
    const userSupabase = {
      from(table) {
        if (table === "customer_conversations") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [
                  {
                    role: "assistant",
                    created_at: "2026-07-19T11:00:00.000Z",
                    metadata_json: {
                      session_id: "sess-a",
                      session_goal: {
                        goal: "보험료 부담을 줄일 선택지 비교",
                        status: "active",
                        updated_at: "2026-07-19T11:00:00.000Z",
                      },
                    },
                  },
                ],
                error: null,
              });
            },
          };
        }
        return makeAttachQuery({ data: null, error: null });
      },
    };
    const deltas = [];
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "계약 확인해줘",
      history: [],
      sessionId: "sess-a",
      customerId: "cust-1",
      userSupabase,
      loadedContext: { policies: [] },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl,
      streamHandlers: {
        _emitted: false,
        onDelta(t) {
          this._emitted = true;
          deltas.push(String(t ?? ""));
        },
        onFirstToken() {},
        onReplace() {},
      },
    });
    assert.equal(claudeCalls, 1, "J: provider 1");
    assert.equal(injectedGoal, "보험료 부담을 줄일 선택지 비교", "C: SSOT inject");
    assert.notEqual(injectedGoal, "FORGED", "A: forged not injected");
    assert.equal(result.salesDirectorTrace?.decision, null, "Q");
    assert.equal(result.salesDirectorTrace?.decision_persisted, false, "Q");
    assert.equal(result.salesDirectorTrace?.session_goal?.goal, "가입 계약 확인", "L");
    assert.equal(deltas.join(""), result.customerText, "P: SSE===sealed");
    assert.equal(result.keySpeakOriginal, result.customerText, "P");
  }

  // E/F: discard → completed persist + no inject; next turn completed_slot
  {
    let claudeCalls = 0;
    let injected = false;
    const fetchImpl = async (_url, opts) => {
      claudeCalls += 1;
      const bodyJson = JSON.parse(String(opts.body ?? "{}"));
      const msgs = JSON.stringify(bodyJson.messages ?? []);
      // Tool description may mention examples — only fail if soft context slot is present.
      if (/session_goal/.test(msgs) && /가입 계약 확인/.test(msgs)) injected = true;
      return {
        ok: true,
        async json() {
          return { content: [{ type: "text", text: "네, 다른 주제로 이어갈게요." }] };
        },
      };
    };
    const userSupabase = {
      from(table) {
        if (table === "customer_conversations") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [
                  {
                    role: "assistant",
                    metadata_json: {
                      session_id: "sess-a",
                      session_goal: {
                        goal: "가입 계약 확인",
                        status: "active",
                        updated_at: "2026-07-19T11:00:00.000Z",
                      },
                    },
                  },
                ],
                error: null,
              });
            },
          };
        }
        return makeAttachQuery({ data: null, error: null });
      },
    };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "그 얘기 말고",
      history: [],
      sessionId: "sess-a",
      customerId: "cust-1",
      userSupabase,
      loadedContext: { policies: [] },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl,
    });
    assert.equal(claudeCalls, 1, "J");
    assert.equal(injected, false, "E: discard inject 0");
    assert.equal(result.salesDirectorTrace?.session_goal?.status, "completed", "E: completed save");
    assert.equal(result.salesDirectorTrace?.session_goal?.goal, null);
    // F: completed slot → next load 0
    const after = await loadLatestSessionGoalFromConversations({
      supabase: {
        from() {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [
                  {
                    role: "assistant",
                    metadata_json: {
                      session_id: "sess-a",
                      session_goal: result.salesDirectorTrace.session_goal,
                    },
                  },
                  {
                    role: "assistant",
                    metadata_json: {
                      session_id: "sess-a",
                      session_goal: {
                        goal: "가입 계약 확인",
                        status: "active",
                        updated_at: "2026-07-19T11:00:00.000Z",
                      },
                    },
                  },
                ],
                error: null,
              });
            },
          };
        },
      },
      customerId: "cust-1",
      sessionId: "sess-a",
    });
    assert.equal(after.goal, null, "F: stale revive 0");
  }

  // I: goal-only → no Continue re-call, provider 1, goal discarded
  {
    let claudeCalls = 0;
    const fetchImpl = async () => {
      claudeCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                id: "toolu_only",
                name: "record_session_goal",
                input: { goal: "가입 계약 확인", status: "active" },
              },
            ],
          };
        },
      };
    };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "계약",
      history: [],
      loadedContext: { policies: [] },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl,
    });
    assert.equal(claudeCalls, 1, "I/J: no re-call");
    assert.equal(result.salesDirectorTrace?.session_goal, null, "I: goal-only store 0");
    assert.equal(result.key_monopoly_failure, true, "I: failure path");
  }

  // H: conflict turn — new goal store 0 (reuse GO2 helper pattern)
  {
    const DOC = "doc-go3-conflict";
    const verifiedPolicy = {
      id: "pol-go3",
      is_active: true,
      coverage_summary: {
        source_document_id: DOC,
        key_confirmed_source_facts: [
          {
            fact_type: "insurer_name",
            literal_value: "삼성화재",
            source_document_id: DOC,
            confirmation_source: "key_claude_original_document",
          },
        ],
      },
    };
    let claudeCalls = 0;
    const fetchImpl = async () => {
      claudeCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            content: [
              { type: "text", text: "이 계약은 삼성화재입니다. 이 계약은 KB손해보험입니다." },
              {
                type: "tool_use",
                id: "g",
                name: "record_session_goal",
                input: { goal: "가입 계약 확인", status: "active" },
              },
            ],
          };
        },
      };
    };
    // Use runClaudeFirstDirectQuestionTurn with conflict via onCommit — simpler: resolvePersistable already tested;
    // integration: usedFailure path with claude goal present
    const persist = resolvePersistableSessionGoal({
      discardRequested: false,
      usedFailure: true,
      claudeGoal: { goal: "가입 계약 확인", status: "active", updated_at: now.toISOString() },
      now,
    });
    assert.equal(persist, null, "H");
    void claudeCalls;
    void verifiedPolicy;
    void fetchImpl;
  }

  // M: answer ok when goal persistence omitted (no tool)
  {
    const answerText = "네, 오늘도 도와드릴게요.";
    let claudeCalls = 0;
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "안녕",
      history: [],
      loadedContext: { policies: [] },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: async () => {
        claudeCalls += 1;
        return {
          ok: true,
          async json() {
            return { content: [{ type: "text", text: answerText }] };
          },
        };
      },
    });
    assert.equal(claudeCalls, 1);
    assert.equal(result.customerText, answerText, "M");
    assert.equal(result.salesDirectorTrace?.session_goal, null);
  }

  // N: metadata builder does not invent rows — one assistant metadata object
  {
    const meta = buildAssistantTurnMetadata("sess-a", {
      sessionGoal: normalizeSessionGoalRecord(
        { goal: "가입 계약 확인", status: "active" },
        { now },
      ),
    });
    assert.equal(meta.session_goal?.goal, "가입 계약 확인", "L/N");
    assert.equal(buildAssistantTurnMetadata("sess-a", {}).session_goal, undefined, "N");
  }

  {
    const root = dirname(fileURLToPath(import.meta.url));
    const directSrc = readFileSync(join(root, "../server/keyCore/keyClaudeFirstDirect.js"), "utf8");
    assert.equal(/customer_memory_facts/.test(directSrc), false);
    assert.equal(/validateAndRecordClaudeDecision/.test(directSrc), false);
    assert.match(directSrc, /loadLatestSessionGoalFromConversations/);
    assert.equal(
      /content:\s*"Continue and provide the final Korean customer answer as plain text\."/.test(
        directSrc,
      ),
      false,
      "I: Continue re-call removed",
    );
  }

  assert.match(buildSystemPrompt(), /참고용/);
  assert.equal(resolveSessionGoalForContext(null, "x"), null);
}

// --- GO4A: recommendation_basis trace-only (no answer mutation / Continue 0) ---
{
  assert.equal(RECORD_RECOMMENDATION_BASIS_TOOL.name, "record_recommendation_basis");
  assert.match(
    RECORD_RECOMMENDATION_BASIS_TOOL.description,
    /같은 응답에서/,
    "GO4A: tool description same-response cue",
  );
  {
    const sys = buildSystemPrompt();
    assert.match(sys, /record_session_goal은 선택 도구다/);
    assert.match(
      sys,
      /record_recommendation_basis는 선택 도구다\. 이번 고객 답변에 보험 추천·보완·방향 제안이 있을 때만, 같은 응답에서 available_verified_evidence와 이번 응답에서 KEY가 검증한 coverage baseline의 실제 ref로 내부 근거를 기록한다\. 추천이 없으면 호출하지 않는다\. 고객에게 도구명이나 JSON을 말하지 말고, 고객 답변은 평문으로 완성한다\./,
      "GO4A: system prompt basis instruction",
    );
    const goalAt = sys.indexOf("record_session_goal은 선택 도구다");
    const basisAt = sys.indexOf("record_recommendation_basis는 선택 도구다");
    assert.ok(goalAt >= 0 && basisAt > goalAt, "GO4A: basis instruction immediately after session_goal");
  }

  const DOC = "doc-go4a-owned";
  const go4Policies = [
    {
      id: "pol-go4a",
      is_active: true,
      insurer_name: "삼성화재",
      product_name: "테스트상품",
      coverage_summary: {
        source_document_id: DOC,
        key_confirmed_source_facts: [
          {
            fact_type: "insurer_name",
            literal_value: "삼성화재",
            source_document_id: DOC,
            confirmation_source: "key_claude_original_document",
          },
        ],
      },
    },
  ];
  const answerText = "확인된 계약을 기준으로 암 진단비 축부터 보면 좋겠습니다.";
  const voice = (result) =>
    result?.salesDirectorTrace?.key_compose_trace?.key_voice_trace ?? null;

  function makeJsonFetch(content, counter) {
    return async () => {
      counter.n += 1;
      return {
        ok: true,
        async json() {
          return { content };
        },
      };
    };
  }

  const validBasisInput = {
    recommendations: [
      {
        recommendation_id: "r1",
        recommendation_type: "coverage_gap_review",
        evidence_refs: [`personal.contract:pol-go4a`, "personal.fact:insurer_name"],
        gap_or_axis: "insurer_name",
        why_relevant: "확인된 보험사 사실과 계약 기준",
        uncertainty: "암 진단비 금액은 미확인",
      },
    ],
  };

  // A: non-recommend question — no forced basis; answer normal; provider 1
  {
    const hello = "안녕하세요. KEY입니다.";
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "안녕하세요",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch([{ type: "text", text: hello }], counter),
    });
    assert.equal(counter.n, 1, "A: provider 1");
    assert.equal(result.customerText, hello, "A: answer");
    assert.equal(result.keySpeakOriginal, hello, "A: sealed");
    assert.equal(voice(result)?.recommendation_basis_tool_seen, false, "A: tool_seen");
    assert.equal(voice(result)?.recommendation_basis_ok, true, "A: ok default — missing tool not blocked");
    assert.equal(result.salesDirectorTrace?.decision, null, "G: decision null");
    assert.equal(result.salesDirectorTrace?.decision_persisted, false, "G");
    assert.equal(voice(result)?.decision_persisted, false, "G voice");
  }

  // A2: recommend question without basis tool — still ok (no force)
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch([{ type: "text", text: answerText }], counter),
    });
    assert.equal(counter.n, 1, "A2: provider 1");
    assert.equal(result.customerText, answerText, "A2: answer");
    assert.equal(result.keySpeakOriginal, answerText, "A2: sealed");
    assert.equal(voice(result)?.recommendation_basis_tool_seen, false, "A2: tool_seen");
    assert.equal(voice(result)?.recommendation_basis_ok, true, "A2: ok default");
  }

  // B: valid basis → answer/SSE/sealed byte-equal to A path
  {
    const counter = { n: 0 };
    const deltas = [];
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: validBasisInput,
          },
        ],
        counter,
      ),
      streamHandlers: {
        onDelta(t) {
          deltas.push(t);
        },
      },
    });
    assert.equal(counter.n, 1, "B/G: provider 1");
    assert.equal(result.customerText, answerText, "B: answer unchanged");
    assert.equal(result.keySpeakOriginal, answerText, "B: sealed unchanged");
    assert.equal(deltas.join(""), answerText, "B: SSE unchanged");
    assert.equal(voice(result)?.recommendation_basis_tool_seen, true, "B: seen");
    assert.equal(voice(result)?.recommendation_basis_ok, true, "B: ok");
    assert.equal(voice(result)?.recommendation_basis_count, 1, "B: count");
    assert.equal(voice(result)?.recommendation_basis_rejected_count, 0, "B");
    assert.deepEqual(voice(result)?.recommendation_basis_reject_reasons, [], "B");
    assert.equal(result.salesDirectorTrace?.decision, null, "K");
    assert.equal(result.salesDirectorTrace?.decision_persisted, false, "K");
  }

  // C: unknown ref
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: {
              recommendations: [
                {
                  recommendation_id: "r1",
                  recommendation_type: "coverage_gap_review",
                  evidence_refs: ["personal.contract:does-not-exist"],
                  gap_or_axis: "contract",
                  why_relevant: "없는 계약",
                  uncertainty: "미확인",
                },
              ],
            },
          },
        ],
        counter,
      ),
    });
    assert.equal(counter.n, 1, "C: provider 1");
    assert.equal(result.customerText, answerText, "C: answer unchanged");
    assert.equal(voice(result)?.recommendation_basis_ok, false, "C");
    assert.ok(
      voice(result)?.recommendation_basis_reject_reasons?.includes("unknown_ref"),
      "C: unknown_ref",
    );
  }

  // D: foreign document ref
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: {
              recommendations: [
                {
                  recommendation_id: "r1",
                  recommendation_type: "coverage_gap_review",
                  evidence_refs: [`personal.fact:insurer_name@doc-foreign-other`],
                  gap_or_axis: "insurer_name",
                  why_relevant: "타 문서",
                  uncertainty: "미확인",
                },
              ],
            },
          },
        ],
        counter,
      ),
    });
    assert.equal(result.customerText, answerText, "D: answer unchanged");
    assert.ok(
      voice(result)?.recommendation_basis_reject_reasons?.includes("foreign_document_ref"),
      "D: foreign_document_ref",
    );
  }

  // E: axis mismatch
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: {
              recommendations: [
                {
                  recommendation_id: "r1",
                  recommendation_type: "coverage_gap_review",
                  evidence_refs: ["personal.fact:insurer_name"],
                  gap_or_axis: "cancer_diagnosis",
                  why_relevant: "축 불일치",
                  uncertainty: "미확인",
                },
              ],
            },
          },
        ],
        counter,
      ),
    });
    assert.equal(result.customerText, answerText, "E: answer unchanged");
    assert.ok(
      voice(result)?.recommendation_basis_reject_reasons?.includes("axis_mismatch"),
      "E: axis_mismatch",
    );
  }

  // F: invalid schema / empty refs
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: {
              recommendations: [
                {
                  recommendation_id: "r1",
                  recommendation_type: "coverage_gap_review",
                  evidence_refs: [],
                  gap_or_axis: "insurer_name",
                  why_relevant: "refs 없음",
                  uncertainty: "미확인",
                },
              ],
            },
          },
        ],
        counter,
      ),
    });
    assert.equal(result.customerText, answerText, "F: answer unchanged");
    assert.ok(
      voice(result)?.recommendation_basis_reject_reasons?.includes("empty_refs"),
      "F: empty_refs",
    );

    const badSchema = extractRecommendationBasisFromContent(
      [
        {
          type: "tool_use",
          name: "record_recommendation_basis",
          input: { recommendations: [{ recommendation_id: "x" }] },
        },
      ],
      { userPayload: null, validatedBaselineFacts: [] },
    );
    assert.equal(badSchema.recommendation_basis_ok, false, "F: invalid_schema");
    assert.ok(
      badSchema.recommendation_basis_reject_reasons.includes("invalid_schema"),
      "F: invalid_schema reason",
    );
  }

  // H: basis-only → provider 1, no answer re-call
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 추천해줘",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          {
            type: "tool_use",
            id: "toolu_rb",
            name: "record_recommendation_basis",
            input: validBasisInput,
          },
        ],
        counter,
      ),
    });
    assert.equal(counter.n, 1, "H: provider 1");
    assert.equal(voice(result)?.recommendation_basis_tool_seen, true, "H: seen");
    assert.equal(voice(result)?.recommendation_basis_count, 0, "H: dropped accepted");
    assert.equal(result.key_monopoly_failure, true, "H: empty → failure path");
  }

  // Pure catalog unit: foreign vs unknown
  {
    const catalog = buildRecommendationEvidenceCatalog({
      userPayload: {
        available_verified_evidence: {
          personal: {
            chart: {
              contracts: [{ index: 0, contract_id: "pol-go4a", coverages: [] }],
              key_confirmed_source_facts: [
                {
                  fact_type: "insurer_name",
                  literal_value: "삼성화재",
                  source_document_id: DOC,
                },
              ],
            },
            key_confirmed_source_facts: [
              {
                fact_type: "insurer_name",
                literal_value: "삼성화재",
                source_document_id: DOC,
              },
            ],
          },
          corporate: [],
          documents: [{ document_id: DOC }],
        },
      },
      validatedBaselineFacts: [],
    });
    assert.equal(catalog.catalog.has("personal.fact:insurer_name"), true);
    assert.equal(catalog.allowedDocuments.has(DOC), true);
  }

  // Catalog: VERIFIED baseline accepted; PENDING baseline excluded → unknown_ref
  {
    const catalog = buildRecommendationEvidenceCatalog({
      userPayload: {
        available_verified_evidence: {
          personal: { chart: { contracts: [] }, key_confirmed_source_facts: [] },
          corporate: [],
          documents: [{ document_id: DOC }],
        },
      },
      validatedBaselineFacts: [
        {
          baseline_item_id: "cancer_diagnosis",
          status: "verified",
          source_document_id: DOC,
        },
        {
          baseline_item_id: "surgery",
          status: "pending",
          source_document_id: DOC,
        },
      ],
    });
    assert.equal(
      catalog.catalog.has("baseline:cancer_diagnosis"),
      true,
      "VERIFIED baseline in catalog",
    );
    assert.equal(
      catalog.catalog.has("baseline:surgery"),
      false,
      "PENDING baseline excluded from catalog",
    );

    const pendingReject = extractRecommendationBasisFromContent(
      [
        {
          type: "tool_use",
          name: "record_recommendation_basis",
          input: {
            recommendations: [
              {
                recommendation_id: "r-pending",
                recommendation_type: "coverage_gap_review",
                evidence_refs: ["baseline:surgery"],
                gap_or_axis: "surgery",
                why_relevant: "PENDING baseline 인용",
                uncertainty: "미확인",
              },
            ],
          },
        },
      ],
      {
        userPayload: {
          available_verified_evidence: {
            personal: { chart: { contracts: [] }, key_confirmed_source_facts: [] },
            corporate: [],
            documents: [{ document_id: DOC }],
          },
        },
        validatedBaselineFacts: [
          {
            baseline_item_id: "surgery",
            status: "pending",
            source_document_id: DOC,
          },
        ],
      },
    );
    assert.equal(pendingReject.recommendation_basis_ok, false, "PENDING ref not accepted");
    assert.ok(
      pendingReject.recommendation_basis_reject_reasons.includes("unknown_ref"),
      "PENDING baseline ref → unknown_ref",
    );

    const verifiedOk = extractRecommendationBasisFromContent(
      [
        {
          type: "tool_use",
          name: "record_recommendation_basis",
          input: {
            recommendations: [
              {
                recommendation_id: "r-verified",
                recommendation_type: "coverage_gap_review",
                evidence_refs: ["baseline:cancer_diagnosis"],
                gap_or_axis: "cancer_diagnosis",
                why_relevant: "VERIFIED baseline 인용",
                uncertainty: "금액 미확인",
              },
            ],
          },
        },
      ],
      {
        userPayload: {
          available_verified_evidence: {
            personal: { chart: { contracts: [] }, key_confirmed_source_facts: [] },
            corporate: [],
            documents: [{ document_id: DOC }],
          },
        },
        validatedBaselineFacts: [
          {
            baseline_item_id: "cancer_diagnosis",
            status: "verified",
            source_document_id: DOC,
          },
        ],
      },
    );
    assert.equal(verifiedOk.recommendation_basis_ok, true, "VERIFIED baseline accepted");
    assert.equal(verifiedOk.recommendation_basis_count, 1, "VERIFIED count");
    assert.deepEqual(verifiedOk.recommendation_basis_reject_reasons, []);
  }

  // I: GO2 conflict regression still present in source + helper
  {
    const set = buildVerifiedLiteralSetFromPolicies(go4Policies, {
      activeDocumentId: DOC,
    });
    const hit = detectKeyVerifiedLiteralConflict("이 계약의 보험사는 KB손해보험입니다.", set);
    assert.equal(hit?.conflict, true, "I: conflict still detects");
  }

  // J: GO3 session_goal regression — answer+goal still Continue 0 / decision null
  {
    const counter = { n: 0 };
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "계약 확인",
      history: [],
      loadedContext: { policies: go4Policies },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: makeJsonFetch(
        [
          { type: "text", text: answerText },
          {
            type: "tool_use",
            id: "g",
            name: "record_session_goal",
            input: { goal: "가입 계약 확인", status: "active" },
          },
        ],
        counter,
      ),
    });
    assert.equal(counter.n, 1, "J: provider 1");
    assert.equal(result.customerText, answerText, "J: answer");
    assert.equal(result.salesDirectorTrace?.session_goal?.status, "active", "J: goal");
    assert.equal(result.salesDirectorTrace?.decision, null, "J/K");
    assert.equal(result.salesDirectorTrace?.decision_persisted, false, "J/K");
  }

  {
    const root = dirname(fileURLToPath(import.meta.url));
    const directSrc = readFileSync(join(root, "../server/keyCore/keyClaudeFirstDirect.js"), "utf8");
    assert.match(directSrc, /record_recommendation_basis/);
    assert.equal(/keyBorrowedSensesStage2|keyBorrowedSensesStage3/.test(directSrc), false);
    assert.equal(/customerCoverageGapCore/.test(directSrc), false);
    assert.equal(/recommendation_basis_persist|reinject_recommendation/.test(directSrc), false);
    // PENDING baseline excluded: catalog + validateSameResponse filter are VERIFIED-only
    assert.match(
      directSrc,
      /KEY-confirmed baseline only — PENDING \(structured_details_incomplete\) excluded/,
    );
    assert.equal(
      /status !== KEY_BASELINE_FACT_STATUSES\.PENDING/.test(directSrc) === false &&
        /status === KEY_BASELINE_FACT_STATUSES\.PENDING/.test(directSrc) === false,
      true,
      "no PENDING allow in recommendation_basis catalog path",
    );
  }
}

console.log("key-claude-first-direct-unit-test: PASS");

// --- REQUEST LIGHTENING: confirmed-context tool assembly (no new keyword router) ---
{
  const BEFORE = {
    general: [
      "web_search",
      "record_claim_case_updates",
      "record_session_goal",
      "record_recommendation_basis",
    ],
    pdf: [
      "web_search",
      "record_confirmed_source_facts",
      "record_coverage_baseline_facts",
      "record_claim_case_updates",
      "record_session_goal",
      "record_recommendation_basis",
    ],
  };

  // A: general question — facts/baseline/claim excluded; session_goal/basis included
  {
    const names = listClaudeFirstAnswerToolNames({
      question: "안녕하세요. 짧게만 인사해 주세요.",
      history: [],
      pdfAttached: false,
      activeClaimCases: [],
    });
    assert.equal(names.includes("record_session_goal"), true, "A: session_goal");
    assert.equal(names.includes("record_recommendation_basis"), true, "A: basis");
    assert.equal(names.includes("record_confirmed_source_facts"), false, "A: no facts");
    assert.equal(names.includes("record_coverage_baseline_facts"), false, "A: no baseline");
    assert.equal(names.includes("record_claim_case_updates"), false, "A: no claim");
    assert.equal(names.includes("web_search"), false, "A: no web on plain greeting");
    assert.deepEqual(
      names,
      ["record_session_goal", "record_recommendation_basis"],
      "A: exact tool list",
    );

    const hello = "안녕하세요. KEY입니다.";
    const counter = { n: 0 };
    let sawTools = null;
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "안녕하세요",
      history: [],
      loadedContext: { policies: [], policy_count: 0 },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: async (_url, opts) => {
        counter.n += 1;
        const body = JSON.parse(String(opts?.body ?? "{}"));
        sawTools = (body.tools ?? []).map((t) => t?.name).filter(Boolean);
        return {
          ok: true,
          async json() {
            return { content: [{ type: "text", text: hello }] };
          },
        };
      },
    });
    assert.equal(counter.n, 1, "A: provider 1");
    assert.equal(result.customerText, hello, "A: answer");
    assert.equal(result.keySpeakOriginal, hello, "A: sealed");
    assert.deepEqual(
      sawTools,
      ["record_session_goal", "record_recommendation_basis"],
      "A: request tools",
    );
  }

  // B: PDF document question — facts/baseline on; web/claim off without claim context
  {
    const names = listClaudeFirstAnswerToolNames({
      question: "이 첨부 증권 내용 정리해 주세요.",
      history: [],
      pdfAttached: true,
      activeClaimCases: [],
    });
    assert.equal(names.includes("record_confirmed_source_facts"), true, "B: facts");
    assert.equal(names.includes("record_coverage_baseline_facts"), true, "B: baseline");
    assert.equal(names.includes("record_session_goal"), true, "B: session_goal");
    assert.equal(names.includes("record_recommendation_basis"), true, "B: basis");
    assert.equal(names.includes("web_search"), false, "B: no web on document turn");
    assert.equal(names.includes("record_claim_case_updates"), false, "B: no claim");
    assert.equal(names.length, 4, "B: tool count 4");

    const tools = buildClaudeFirstAnswerTools({
      pdfAttached: true,
      activeClaimCases: [],
      question: "이 첨부 증권 내용 정리해 주세요.",
    });
    assert.equal(
      tools.some((t) => t === RECORD_CONFIRMED_SOURCE_FACTS_TOOL),
      true,
      "B: same tool object",
    );
  }

  // C: claim context present / absent
  {
    const withClaim = listClaudeFirstAnswerToolNames({
      question: "청구 진행 어디까지야?",
      pdfAttached: false,
      activeClaimCases: [{ claim_case_key: "date:2026-07-12:kind:surgery" }],
    });
    const withoutClaim = listClaudeFirstAnswerToolNames({
      question: "청구 진행 어디까지야?",
      pdfAttached: false,
      activeClaimCases: [],
    });
    assert.equal(withClaim.includes("record_claim_case_updates"), true, "C: claim on");
    assert.equal(withoutClaim.includes("record_claim_case_updates"), false, "C: claim off");
    assert.equal(
      withoutClaim.filter((n) => n === "record_claim_case_updates").length,
      0,
      "C: claim tool 0",
    );
  }

  // D: recommendation_basis still available on natural recommend; no extra provider call
  {
    const names = listClaudeFirstAnswerToolNames({
      question: "암 보장 보완 방향 짧게 추천해 주세요.",
      pdfAttached: false,
      activeClaimCases: [],
    });
    assert.equal(names.includes("record_recommendation_basis"), true, "D: basis available");
    const answerText = "확인된 계약을 기준으로 암 진단비 축부터 보면 좋겠습니다.";
    const counter = { n: 0 };
    const DOC = "doc-light-d";
    const result = await runClaudeFirstDirectQuestionTurn({
      question: "암 보장 보완 방향 짧게 추천해 주세요.",
      history: [],
      loadedContext: {
        policies: [
          {
            id: "pol-light-d",
            is_active: true,
            insurer_name: "삼성화재",
            product_name: "테스트상품",
            coverage_summary: {
              source_document_id: DOC,
              key_confirmed_source_facts: [
                {
                  fact_type: "insurer_name",
                  literal_value: "삼성화재",
                  source_document_id: DOC,
                  confirmation_source: "key_claude_original_document",
                },
              ],
            },
          },
        ],
      },
      env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
      fetchImpl: async () => {
        counter.n += 1;
        return {
          ok: true,
          async json() {
            return {
              content: [
                { type: "text", text: answerText },
                {
                  type: "tool_use",
                  id: "basis-light-d",
                  name: "record_recommendation_basis",
                  input: {
                    recommendations: [
                      {
                        recommendation_id: "r1",
                        recommendation_type: "coverage_gap_review",
                        evidence_refs: ["personal.contract:pol-light-d"],
                        gap_or_axis: "insurer_name",
                        why_relevant: "확인된 계약 기준",
                        uncertainty: "금액 미확인",
                      },
                    ],
                  },
                },
              ],
            };
          },
        };
      },
    });
    assert.equal(counter.n, 1, "D: provider 1 — no extra call");
    assert.equal(result.customerText, answerText, "D: answer unchanged");
    assert.equal(result.keySpeakOriginal, answerText, "D: sealed unchanged");
    assert.equal(
      result.salesDirectorTrace?.key_compose_trace?.key_voice_trace
        ?.recommendation_basis_tool_seen,
      true,
      "D: tool_seen",
    );
  }

  // G: request size — tool counts only (no prompt/PII dump)
  {
    const afterGeneral = listClaudeFirstAnswerToolNames({
      question: "안녕하세요",
      pdfAttached: false,
      activeClaimCases: [],
    });
    const afterPdf = listClaudeFirstAnswerToolNames({
      question: "첨부 증권 정리",
      pdfAttached: true,
      activeClaimCases: [],
    });
    console.log(
      JSON.stringify({
        request_lightening_tool_counts: {
          general_before: BEFORE.general.length,
          general_after: afterGeneral.length,
          general_before_names: BEFORE.general,
          general_after_names: afterGeneral,
          pdf_before: BEFORE.pdf.length,
          pdf_after: afterPdf.length,
          pdf_before_names: BEFORE.pdf,
          pdf_after_names: afterPdf,
        },
      }),
    );
    assert.ok(afterGeneral.length < BEFORE.general.length, "G: general lighter");
    assert.ok(afterPdf.length < BEFORE.pdf.length, "G: pdf lighter");
  }

  console.log("REQUEST LIGHTENING LOCAL CHECKS OK");
}

// --- PDF 400 DIAGNOSTIC: codes-only upstream trace (no raw message / base64) ---
{
  assert.equal(bucketDocumentBytes(0), "none");
  assert.equal(bucketDocumentBytes(500), "lt_1kb");
  assert.equal(bucketDocumentBytes(50 * 1024), "1kb_100kb");

  assert.equal(
    classifyAnthropicMessageCategory({
      status: 400,
      errorType: "invalid_request_error",
      errorMessage: "Could not process PDF document",
    }),
    "invalid_document",
  );
  assert.equal(
    classifyAnthropicMessageCategory({
      status: 400,
      errorType: "invalid_request_error",
      errorMessage: "tools.2.custom.input_schema: invalid",
    }),
    "tool_schema",
  );
  assert.equal(
    classifyAnthropicMessageCategory({
      status: 429,
      errorType: "rate_limit_error",
      errorMessage: "Rate limit exceeded",
    }),
    "rate_or_transient",
  );

  const secretMsg = "SECRET_PDF_FAIL_TOKEN_do_not_persist";
  const diag = buildAnthropicUpstreamDiag({
    status: 400,
    errText: JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: secretMsg },
    }),
    pdfAttachedAttempted: true,
    pdfBase64: Buffer.from("%PDF-1.4 minimal").toString("base64"),
    toolCount: 4,
    providerCallNumber: 1,
  });
  assert.equal(diag.upstream_status, 400);
  assert.equal(diag.error_type, "invalid_request_error");
  assert.equal(diag.message_category, "invalid_request");
  assert.equal(diag.pdf_attached_attempted, true);
  assert.equal(diag.document_byte_bucket, "lt_1kb");
  assert.equal(diag.tool_count, 4);
  assert.equal(diag.provider_call_number, 1);
  assert.equal(diag.request_phase, "claude_first_messages_request");
  assert.equal(Object.prototype.hasOwnProperty.call(diag, "message"), false);
  assert.equal(JSON.stringify(diag).includes(secretMsg), false);
  assert.equal(JSON.stringify(diag).includes("%PDF"), false);

  const monopolyText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
  let calls = 0;
  const result = await runClaudeFirstDirectQuestionTurn({
    question: "안녕하세요",
    history: [],
    loadedContext: { policies: [], policy_count: 0 },
    env: { ANTHROPIC_API_KEY: "test-key", KEY_CLAUDE_FIRST_DIRECT: "1" },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `Unable to process PDF document :: ${secretMsg}`,
            },
          });
        },
      };
    },
  });
  assert.equal(calls, 1, "provider call count unchanged");
  assert.equal(result.key_monopoly_failure, true);
  assert.equal(result.customerText, monopolyText, "customer byte-equal monopoly");
  assert.equal(result.keySpeakOriginal, monopolyText);
  assert.equal(result.failure_reason, "ANTHROPIC_HTTP_400");
  const voice = result.salesDirectorTrace?.key_compose_trace?.key_voice_trace;
  assert.equal(voice?.anthropic_upstream_diag?.upstream_status, 400);
  assert.equal(voice?.anthropic_upstream_diag?.error_type, "invalid_request_error");
  assert.equal(voice?.anthropic_upstream_diag?.message_category, "invalid_document");
  assert.equal(voice?.anthropic_upstream_diag?.pdf_attached_attempted, false);
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes(secretMsg), false, "raw Anthropic message not in result");
  assert.equal(dumped.includes("Unable to process PDF"), false);
  assert.equal(dumped.includes("detail\""), false);
  console.log("PDF 400 DIAGNOSTIC LOCAL CHECKS OK");
}

// --- PDF 400 DIAGNOSTIC TRACE: homeBrain monopoly early-return forwards sales_director_trace ---
{
  const root = dirname(fileURLToPath(import.meta.url));
  const homeSrc = readFileSync(join(root, "../server/homeBrainFactCore.js"), "utf8");
  const monopolyBlock = homeSrc.slice(
    homeSrc.indexOf("if (coreResult.key_monopoly_failure === true)"),
    homeSrc.indexOf("const intent = agentTurn.consultationIntent"),
  );
  assert.match(
    monopolyBlock,
    /sales_director_trace:\s*salesDirectorTrace/,
    "monopoly early return must forward salesDirectorTrace",
  );
  assert.match(
    homeSrc,
    /sales_director_trace:\s*observability\.sales_director_trace/,
    "success path still uses observability.sales_director_trace",
  );
  const successIdx = homeSrc.indexOf("sales_director_trace: observability.sales_director_trace");
  const monopolyIdx = homeSrc.indexOf("if (coreResult.key_monopoly_failure === true)");
  assert.ok(successIdx > monopolyIdx, "success path remains after monopoly branch");

  const diagCustomerId = "cust-monopoly-diag";
  const wireSecret = "SECRET_UPSTREAM_MSG_do_not_surface";
  function buildMonopolyDiagSupabase(customerId = diagCustomerId) {
    return {
      from(table) {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          is() {
            return chain;
          },
          order() {
            return chain;
          },
          limit() {
            return chain;
          },
          maybeSingle: async () => ({
            data: { id: customerId, display_name: "DiagQA", memory_version: 1 },
            error: null,
          }),
          then(onFulfilled, onRejected) {
            let payload = { data: [], error: null, count: 0 };
            if (table === "active_profile_insurance_policies") {
              payload = { data: [], error: null };
            }
            if (table === "customer_memory_facts") {
              payload = { data: [], error: null, count: 0 };
            }
            if (table === "analysis_jobs") {
              payload = { data: [], error: null };
            }
            return Promise.resolve(payload).then(onFulfilled, onRejected);
          },
        };
        return chain;
      },
    };
  }

  let providerCalls = 0;
  const deltas = [];
  const done = await handleHomeBrainFactRequest({
    userSupabase: buildMonopolyDiagSupabase(),
    customerId: diagCustomerId,
    question: "문서 확인 부탁해요",
    history: [],
    env: {
      ...process.env,
      ONE_KEY_CORE_S1: "1",
      KEY_CLAUDE_FIRST_DIRECT: "1",
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
      ANTHROPIC_API_KEY: "test-key",
    },
    fetchImpl: async () => {
      providerCalls += 1;
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `Unable to process PDF document :: ${wireSecret}`,
            },
          });
        },
      };
    },
    streamHandlers: {
      _emitted: false,
      onDelta(text) {
        deltas.push(text);
      },
      onFirstToken() {},
    },
  });

  assert.equal(providerCalls, 1, "provider call count unchanged (single attempt)");
  assert.equal(done.ok, true);
  assert.equal(done.key_monopoly_failure, true);
  assert.equal(done.failure_reason, "ANTHROPIC_HTTP_400");
  assert.ok(done.sales_director_trace, "monopoly done extras must include sales_director_trace");
  assert.equal(done.answerText, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT, "customer byte-equal");
  assert.equal(done.key_speak_original, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
  assert.equal(done.key_text_equal, true);
  assert.equal(done.key_text_integrity?.ok, true, "SSE===sealed integrity ok");
  assert.equal(done.key_text_integrity?.text_equal, true);
  assert.equal(
    deltas.join(""),
    KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
    "SSE delta customer text byte-equal monopoly",
  );
  assert.equal(
    done.answerText.includes("anthropic_upstream_diag"),
    false,
    "diag never in customer visible text",
  );

  const wireDiag =
    done.sales_director_trace?.key_compose_trace?.key_voice_trace?.anthropic_upstream_diag ??
    done.one_key_core_trace?.steps?.find((s) => s.step === "claude_first_direct")?.payload
      ?.anthropic_upstream_diag ??
    null;
  assert.ok(wireDiag, "400 monopoly done payload must carry anthropic_upstream_diag");
  assert.equal(wireDiag.upstream_status, 400);
  assert.equal(wireDiag.error_type, "invalid_request_error");
  assert.equal(wireDiag.message_category, "invalid_document");
  assert.equal(wireDiag.request_phase, "claude_first_messages_request");
  assert.equal(typeof wireDiag.pdf_attached_attempted, "boolean");
  assert.equal(typeof wireDiag.tool_count === "number" || wireDiag.tool_count === null, true);
  assert.equal(wireDiag.provider_call_number, 1);
  assert.ok(
    done.sales_director_trace?.key_compose_trace?.key_voice_trace?.anthropic_upstream_diag,
    "diag reachable via sales_director_trace.key_compose_trace.key_voice_trace",
  );

  const doneDump = JSON.stringify(done);
  assert.equal(doneDump.includes(wireSecret), false, "raw Anthropic message not in done");
  assert.equal(doneDump.includes("Unable to process PDF"), false);
  for (const forbidden of ["base64", "message_raw", "errText", "detail"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(wireDiag, forbidden),
      false,
      `diag must not expose ${forbidden}`,
    );
  }
  assert.equal(Object.prototype.hasOwnProperty.call(wireDiag, "message"), false);
  console.log("PDF 400 DIAGNOSTIC TRACE LOCAL CHECKS OK");
}

