import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isClaudeFirstDirectPreview,
  extractPartialCustomerAnswer,
  hardOnlySafetyCheck,
  buildSystemPrompt,
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
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { sentenceHardLiteBlocks } from "../server/keyCore/keyClaudeFirstSentenceCommit.js";
import {
  isPriorAttachFollowUpQuestion,
  PRIOR_ATTACH_REATTACH_CUSTOMER_TEXT,
  normalizeActiveAttachment,
  extractActiveAttachmentFromSessionMessages,
} from "../src/lib/chatActiveAttachment.js";
import {
  buildSessionMetadata,
  buildAssistantTurnMetadata,
} from "../src/lib/lifeguardChatSessionCore.js";
import {
  parseRotationQuarterTurns,
  normalizeQuarterTurns,
  quarterTurnsToDegrees,
  normalizeImageRotationDegrees,
  readJpegSizeFromBuffer,
  requestHasForbiddenClientImageBytes,
  detectImageSignature,
  buildPreviewOrientationHint,
  buildAttachOpsSignals,
} from "../server/keyCore/keyClaudeImageOrient.js";
import {
  buildClaudeFullUserContentWithPdf,
  buildAnthropicPdfDocumentBlock,
  buildAnthropicImageBlock,
  verifyAndFetchCustomerPdfOriginal,
  normalizeClaudeDirectAttachMediaType,
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
  const orientSrc = readFileSync(join(root, "../server/keyCore/keyClaudeImageOrient.js"), "utf8");
  const directSrc = readFileSync(join(root, "../server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  assert.equal(/jpeg-js|pngjs|jpeg\.decode|jpeg\.encode|PNG\.sync/.test(orientSrc), false);
  assert.equal(
    /rotateImageBufferQuarterTurns|jpeg-js|pngjs|server_ephemeral_rotate/.test(directSrc),
    false,
  );
}

assert.equal(
  isClaudeFirstDirectPreview({ VERCEL_ENV: "preview", KEY_BORROWED_SENSES: "shadow" }),
  true,
);
assert.equal(
  isClaudeFirstDirectPreview({ VERCEL_ENV: "production", KEY_BORROWED_SENSES: "shadow" }),
  false,
);
assert.equal(
  isClaudeFirstDirectPreview({
    VERCEL_ENV: "preview",
    KEY_BORROWED_SENSES: "shadow",
    KEY_CLAUDE_FIRST_DIRECT: "0",
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
assert.equal(/No emoji|Tone \(required\)|emit_claude_full|특약|ATTACHED FILE/i.test(prompt), false);
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
  contextPack: { recent_turns: [] },
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
  attachPayload.available_verified_evidence?.personal?.subject_type,
  "individual",
);
assert.equal(
  attachPayload.available_verified_evidence?.personal?.chart?.policy_count?.value,
  22,
);
assert.equal(attachPayload.available_verified_evidence?.documents?.[0]?.attached, true);
assert.deepEqual(attachPayload.available_verified_evidence?.public_evidence, []);
assert.equal(Object.prototype.hasOwnProperty.call(attachPayload, "verified_customer_chart"), false);

// --- rotation_quarter_turns trust policy (safe 0 for invalid) ---
assert.equal(parseRotationQuarterTurns(0), 0);
assert.equal(parseRotationQuarterTurns(1), 1);
assert.equal(parseRotationQuarterTurns(2), 2);
assert.equal(parseRotationQuarterTurns(3), 3);
assert.equal(parseRotationQuarterTurns("0"), 0);
assert.equal(parseRotationQuarterTurns("3"), 3);
assert.equal(parseRotationQuarterTurns(-1), 0);
assert.equal(parseRotationQuarterTurns(4), 0);
assert.equal(parseRotationQuarterTurns(1.5), 0);
assert.equal(parseRotationQuarterTurns("90"), 0);
assert.equal(parseRotationQuarterTurns("abc"), 0);
assert.equal(parseRotationQuarterTurns(null), 0);
assert.equal(normalizeQuarterTurns(2), 2);
assert.equal(quarterTurnsToDegrees(1), 90);
assert.equal(normalizeImageRotationDegrees(90), 90);
assert.equal(normalizeImageRotationDegrees(45), 0);

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

const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x20, 0x00, 0x40, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xd9,
]);
const jpegSize = readJpegSizeFromBuffer(tinyJpeg);
assert.equal(jpegSize?.width, 64);
assert.equal(jpegSize?.height, 32);

// Synthetic 4x2 JPEG (distinct pixels) for rotate geometry
function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// Fixed JPEG fixtures (no jpeg-js/pngjs in product or tests).
const srcJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAQACAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APx3tLS1sLW2sbG2t7KysreG0s7O0hjt7W0tbeNYbe2treFUigt4IkSKGGJEjijRURVVQA23JuUm222227tt6ttvVtvVt7iSSSSSSSSSSsklokktEktkf//Z",
  "base64",
);
const validJpeg8 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx4BBQUFBwYHDggIDh4UERQeHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHv/AABEIAAgACAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AKVAH//Z",
  "base64",
);
const clientB64 = validJpeg8.toString("base64");

assert.equal(detectImageSignature(srcJpeg), "jpeg");
assert.equal(buildPreviewOrientationHint(0), null);
assert.match(buildPreviewOrientationHint(1), /시계 방향으로 1회/);
assert.match(buildPreviewOrientationHint(1), /Storage 원본/);
assert.equal(buildPreviewOrientationHint(1).includes("똑바로"), false);

const storageB64 = srcJpeg.toString("base64");
const storageHash = sha256Hex(srcJpeg);
for (const turns of [0, 1, 2, 3]) {
  const built = buildClaudeImageAttachFromStorageOriginal({
    storageBase64: storageB64,
    storageMediaType: "image/jpeg",
    rotationQuarterTurns: turns,
  });
  assert.equal(built.ok, true, `turns=${turns} must attach`);
  assert.equal(built.claude_image_source, "storage_original");
  assert.equal(built.rotated, false);
  assert.equal(built.base64, storageB64);
  assert.equal(sha256Hex(Buffer.from(built.base64, "base64")), storageHash);
  assert.equal(built.attach_signals?.attachment_block_built, true);
  assert.equal(built.attach_signals?.attachment_attached, true);
  assert.equal(built.attach_signals?.attachment_failed, false);
  assert.equal(built.attach_signals?.rotation_requested, turns);
  assert.equal(built.rotation_quarter_turns, turns);
}

const builtMissing = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: "",
  storageMediaType: "image/jpeg",
  rotationQuarterTurns: 1,
});
assert.equal(builtMissing.ok, false);
assert.equal(builtMissing.attach_signals?.attachment_failed, true);
assert.equal(builtMissing.attach_signals?.attachment_failure_code, "storage_image_missing");

const builtMime = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: storageB64,
  storageMediaType: "image/heic",
  rotationQuarterTurns: 1,
});
assert.equal(builtMime.ok, false);
// Unsupported MIME normalizes to null → treated as missing attach media.
assert.equal(builtMime.attach_signals?.attachment_failure_code, "storage_image_missing");
assert.equal(builtMime.reason, "storage_image_missing");

assert.equal(
  buildAttachOpsSignals({
    attachment_requested: true,
    attachment_attached: false,
    attachment_failed: true,
    attachment_failure_code: "block_build_failed",
    rotation_requested: 2,
    attachment_block_built: false,
  }).rotation_requested,
  2,
);

// client raw base64 must never be selected even if somehow passed elsewhere
assert.equal(
  requestHasForbiddenClientImageBytes({
    document_id: "doc-x",
    claude_upright_image_base64: clientB64,
  }),
  true,
);

const promptTable = buildSystemPrompt();
assert.match(promptTable, /보험 AI KEY/);
assert.equal(/orientation|independently|column/i.test(promptTable), false);

{
  const payload = buildUserPayload({
    question: "이 사진 분석해줘",
    chart: { policies: [], policy_count: { value: 0 } },
    contextPack: {},
    pdfMeta: {
      attached: true,
      mime_type: "image/jpeg",
      rotation_quarter_turns: 1,
      document_id: "doc-hint",
    },
  });
  assert.match(
    payload.available_verified_evidence.documents[0].preview_orientation_hint,
    /시계 방향으로 1회/,
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

// --- Explicit attach fail-closed (no Claude / no chart substitute) ---
assert.match(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT, /첨부 파일을 처리하지 못했습니다/);
assert.match(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT, /다시 첨부/);

function makeAttachQuery(result) {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    maybeSingle: async () => result,
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
  const fetchImpl = async (_url, opts) => {
    claudeCalls += 1;
    const body = JSON.parse(String(opts?.body ?? "{}"));
    const content = body?.messages?.[0]?.content;
    if (Array.isArray(content)) {
      const img = content.find((b) => b?.type === "image");
      imageB64FromClaude = img?.source?.data ?? null;
      const text = content.find((b) => b?.type === "text")?.text ?? "";
      sawHint = /시계 방향으로 1회/.test(text) && /Storage 원본/.test(text);
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
    rotationQuarterTurns: 1,
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
  assert.equal(claudeCalls, 1, "turns=1 must call Claude-first once (no rotate fail-closed)");
  assert.equal(result.key_monopoly_failure, false);
  assert.equal(
    result.customerText.includes(ATTACH_PROCESS_FAILED_CUSTOMER_TEXT),
    false,
  );
  assert.equal(imageB64FromClaude, validJpeg8.toString("base64"));
  assert.equal(sha256Hex(Buffer.from(imageB64FromClaude, "base64")), sha256Hex(validJpeg8));
  assert.equal(sawHint, true);
  const signals =
    result.salesDirectorTrace?.key_compose_trace?.key_voice_trace?.attach_signals;
  assert.equal(signals?.attachment_attached, true);
  assert.equal(signals?.attachment_failed, false);
  assert.equal(signals?.rotation_requested, 1);
  assert.equal(signals?.attachment_block_built, true);
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
    // Phase A only — attach readout must not open Phase B (second call).
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
    question:
      "이 사진에서 보험사, 상품명, 납입기간과 만기, 계약기간, 월 보험료를 표로 정리해줘. 읽기 어려운 항목은 추측하지 말고 미확인으로 표시해줘.",
    history: [],
    loadedContext: chartPolicies,
    customerId: "cust-a",
    attachedDocumentId: "doc-ok-jpg",
    rotationQuarterTurns: 0,
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
    contextPack: { recent_turns: [] },
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
    contextPack: { recent_turns: [] },
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
    contextPack: { recent_turns: [], older_summary: null },
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
    contextPack: { recent_turns: [], older_summary: null },
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

console.log("key-claude-first-direct-unit-test: PASS");
