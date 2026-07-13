/**
 * Chat image orientation — quarter-turn trust for UI preview + soft Claude hint.
 * Storage originals are never rewritten. Server byte rotate/re-encode is retired.
 */

/**
 * Strict policy: only exact 0|1|2|3 (number or digit string).
 * Anything else → safe 0 (no preview hint).
 */
export function parseRotationQuarterTurns(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "0" || t === "1" || t === "2" || t === "3") return Number(t);
    return 0;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) {
    return value;
  }
  return 0;
}

export function normalizeQuarterTurns(turns = 0) {
  return parseRotationQuarterTurns(turns);
}

export function quarterTurnsToDegrees(turns = 0) {
  return parseRotationQuarterTurns(turns) * 90;
}

/** @deprecated Prefer parseRotationQuarterTurns — kept for older callers. */
export function normalizeImageRotationDegrees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const deg = ((Math.trunc(n) % 360) + 360) % 360;
  if (deg === 0 || deg === 90 || deg === 180 || deg === 270) return deg;
  return 0;
}

/** jpeg | png | unknown from magic bytes (no mime trust). */
export function detectImageSignature(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "png";
  }
  return "unknown";
}

/**
 * Soft direction hint only — never asserts upright facts or triggers byte transform.
 * @returns {string|null}
 */
export function buildPreviewOrientationHint(quarterTurns = 0) {
  const turns = parseRotationQuarterTurns(quarterTurns);
  if (turns <= 0) return null;
  return [
    `고객은 미리보기에서 이미지를 시계 방향으로 ${turns}회 회전해 보고 있습니다.`,
    "입력 이미지는 Storage 원본입니다.",
  ].join(" ");
}

/**
 * Minimal attach ops signals (no decode/rotate/encode detail, no PII).
 */
export function buildAttachOpsSignals({
  attachment_requested = false,
  attachment_attached = false,
  attachment_failed = false,
  attachment_failure_code = null,
  rotation_requested = 0,
  attachment_block_built = false,
} = {}) {
  const failed = attachment_failed === true;
  return {
    attachment_requested: attachment_requested === true,
    attachment_attached: attachment_attached === true,
    attachment_failed: failed,
    attachment_failure_code: failed
      ? String(attachment_failure_code ?? "attach_failed").slice(0, 80)
      : null,
    rotation_requested: parseRotationQuarterTurns(rotation_requested),
    attachment_block_built: attachment_block_built === true,
  };
}

/**
 * Read JPEG SOF dimensions without decoding the full image.
 * @returns {{ width: number, height: number } | null}
 */
export function readJpegSizeFromBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (b[i + 2] << 8) + b[i + 3];
    if (len < 2 || i + 2 + len > b.length) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const height = (b[i + 5] << 8) + b[i + 6];
      const width = (b[i + 7] << 8) + b[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Read PNG IHDR dimensions.
 * @returns {{ width: number, height: number } | null}
 */
export function readPngSizeFromBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) {
    if (b[i] !== sig[i]) return null;
  }
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (width > 0 && height > 0) return { width, height };
  return null;
}

export function readImageSizeFromBuffer(buf, mediaType = "") {
  const mime = String(mediaType ?? "").toLowerCase();
  if (mime === "image/png") return readPngSizeFromBuffer(buf);
  if (mime === "image/jpeg" || mime === "image/jpg") return readJpegSizeFromBuffer(buf);
  return readJpegSizeFromBuffer(buf) || readPngSizeFromBuffer(buf);
}

/** True when request body tries to inject client image bytes for Claude. */
export function requestHasForbiddenClientImageBytes(body = {}) {
  if (!body || typeof body !== "object") return false;
  const keys = [
    "claude_upright_image_base64",
    "claudeUprightImageBase64",
    "claude_upright_image",
    "claudeUprightImage",
    "attach_image_base64",
    "image_base64",
  ];
  for (const k of keys) {
    const v = body[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim()) return true;
    if (typeof v === "object" && String(v.base64 ?? "").trim()) return true;
  }
  return false;
}
