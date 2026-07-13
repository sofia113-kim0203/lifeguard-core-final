import assert from "node:assert/strict";
import {
  isClaudeFirstDirectPreview,
  extractPartialCustomerAnswer,
  hardOnlySafetyCheck,
  buildSystemPrompt,
  buildUserPayload,
  selectReplacingHardReasons,
  finalizeClaudeFirstStreamContentBlocks,
  hasClientToolUse,
  resolveClaudeFirstPdfDocumentId,
  wantsClaudeFirstVisualBlocks,
  isAttachDocumentReadQuestion,
  buildClaudeImageAttachFromStorageOriginal,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  parseRotationQuarterTurns,
  normalizeQuarterTurns,
  quarterTurnsToDegrees,
  normalizeImageRotationDegrees,
  readJpegSizeFromBuffer,
  rotateImageBufferQuarterTurns,
  requestHasForbiddenClientImageBytes,
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
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

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
assert.match(prompt, /No emoji/i);
assert.match(prompt, /cite/i);
assert.match(prompt, /Clean readable Korean/i);
assert.match(prompt, /Tone \(required\)/i);
assert.match(prompt, /plain Korean text first/i);
assert.match(prompt, /warm/i);
assert.match(prompt, /emit_claude_full is only for optional visual_blocks/i);

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
assert.match(promptImage, /JPEG\/PNG|photo|image/i);
assert.match(promptImage, /payout|지급|증권·약관/i);
assert.match(promptImage, /미확인/);
assert.match(promptImage, /9999세|종신형/);
assert.match(promptImage, /첨부 문서|고객 차트/);
assert.doesNotMatch(promptImage, /Claim\/hospital/i);

assert.equal(
  isAttachDocumentReadQuestion(
    "이 사진에서 병원명, 진료일, 문서 종류, 총 결제금액을 찾아 표로 정리해줘.",
  ),
  true,
);
assert.equal(
  wantsClaudeFirstVisualBlocks("이 사진에서 병원명 찾아 표로 정리해줘.", {
    documentAttached: true,
  }),
  false,
);
assert.equal(
  wantsClaudeFirstVisualBlocks("표로 정리해줘", { documentAttached: true }),
  false,
);
assert.equal(
  wantsClaudeFirstVisualBlocks(
    "이 사진에서 보험사, 상품명, 납입기간과 만기, 계약기간, 월 보험료를 표로 정리해줘. 읽기 어려운 항목은 추측하지 말고 미확인으로 표시해줘.",
    { documentAttached: true },
  ),
  false,
  "attach readout must not trigger Phase B chart call",
);
assert.equal(
  wantsClaudeFirstVisualBlocks("내 보험 현황을 차트로 보여줘", {
    documentAttached: false,
  }),
  true,
);
// Phase B gate alone ⇒ attach readout → 0 extra Claude chart calls (call count stays 1).
assert.equal(
  wantsClaudeFirstVisualBlocks("이 사진에서 표로 정리해줘", {
    documentAttached: true,
  }) === false,
  true,
);

const attachPayload = buildUserPayload({
  question: "이 사진에서 총 결제금액 찾아줘",
  chart: { policy_count: 22 },
  allowlist: { allowed_numbers: ["22"], allowed_entities: [] },
  contextPack: { recent_turns: [] },
  pdfMeta: {
    attached: true,
    document_id: "doc-img",
    mime_type: "image/jpeg",
    original_filename: "receipt.jpg",
  },
});
assert.match(attachPayload.guidance, /ATTACHED FILE READ|미확인|9999세/);
assert.match(attachPayload.guidance, /고객 차트|첨부/);
assert.match(attachPayload.guidance, /orientation|column|셀|independently/i);
assert.equal(attachPayload.verified_customer_chart?.policy_count, 22);

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
function makeSolidJpeg(width, height, fillRgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fillRgba[0];
    data[i * 4 + 1] = fillRgba[1];
    data[i * 4 + 2] = fillRgba[2];
    data[i * 4 + 3] = fillRgba[3];
  }
  // mark top-left pixel unique so 180° flip is detectable
  data[0] = 10;
  data[1] = 20;
  data[2] = 30;
  data[3] = 255;
  const encoded = jpeg.encode({ data, width, height }, 100);
  return Buffer.from(encoded.data);
}

function makeSolidPng(width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = 200;
    png.data[i * 4 + 1] = 100;
    png.data[i * 4 + 2] = 50;
    png.data[i * 4 + 3] = 255;
  }
  png.data[0] = 1;
  png.data[1] = 2;
  png.data[2] = 3;
  png.data[3] = 255;
  return PNG.sync.write(png);
}

const srcJpeg = makeSolidJpeg(8, 4, [80, 80, 80, 255]);
const rot0 = rotateImageBufferQuarterTurns(srcJpeg, "image/jpeg", 0);
assert.equal(rot0.ok, true);
assert.equal(rot0.rotated, false);
assert.equal(rot0.buffer, srcJpeg);
assert.equal(rot0.width, 8);
assert.equal(rot0.height, 4);

const rot1 = rotateImageBufferQuarterTurns(srcJpeg, "image/jpeg", 1);
assert.equal(rot1.ok, true);
assert.equal(rot1.rotated, true);
assert.equal(rot1.width, 4);
assert.equal(rot1.height, 8);

const rot2 = rotateImageBufferQuarterTurns(srcJpeg, "image/jpeg", 2);
assert.equal(rot2.ok, true);
assert.equal(rot2.width, 8);
assert.equal(rot2.height, 4);
{
  const decoded = jpeg.decode(rot2.buffer, { useTArray: true });
  // after 180°, unique pixel moves to bottom-right
  const br = ((decoded.height - 1) * decoded.width + (decoded.width - 1)) * 4;
  assert.ok(decoded.data[br] < 40, "180° should move corner pixel");
}

const rot3 = rotateImageBufferQuarterTurns(srcJpeg, "image/jpeg", 3);
assert.equal(rot3.ok, true);
assert.equal(rot3.width, 4);
assert.equal(rot3.height, 8);

const srcPng = makeSolidPng(6, 3);
const pngRot1 = rotateImageBufferQuarterTurns(srcPng, "image/png", 1);
assert.equal(pngRot1.ok, true);
assert.equal(pngRot1.width, 3);
assert.equal(pngRot1.height, 6);

const badMime = rotateImageBufferQuarterTurns(srcJpeg, "image/webp", 1);
assert.equal(badMime.ok, false);

const storageB64 = srcJpeg.toString("base64");
const clientB64 = makeSolidJpeg(2, 2, [1, 1, 1, 255]).toString("base64");
const built0 = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: storageB64,
  storageMediaType: "image/jpeg",
  rotationQuarterTurns: 0,
});
assert.equal(built0.ok, true);
assert.equal(built0.claude_image_source, "storage_original");
assert.equal(built0.rotated, false);
assert.equal(built0.base64, storageB64);

const built1 = buildClaudeImageAttachFromStorageOriginal({
  storageBase64: storageB64,
  storageMediaType: "image/jpeg",
  rotationQuarterTurns: 1,
});
assert.equal(built1.ok, true);
assert.equal(built1.claude_image_source, "server_ephemeral_rotate");
assert.equal(built1.rotated, true);
assert.notEqual(built1.base64, storageB64);
assert.notEqual(built1.base64, clientB64);

// client raw base64 must never be selected even if somehow passed elsewhere
assert.equal(
  requestHasForbiddenClientImageBytes({
    document_id: "doc-x",
    claude_upright_image_base64: clientB64,
  }),
  true,
);

const promptTable = buildSystemPrompt();
assert.match(promptTable, /orientation|independently|column|셀/i);

console.log("key-claude-first-direct-unit-test: PASS");
