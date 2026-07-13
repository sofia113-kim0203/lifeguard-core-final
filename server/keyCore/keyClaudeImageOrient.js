/**
 * Chat image orientation — quarter-turn trust + ephemeral server rotate.
 * Storage originals are never rewritten. Rotated bytes are in-memory only.
 */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/**
 * Strict policy: only exact 0|1|2|3 (number or digit string).
 * Anything else → safe 0 (no rotate).
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

function rotateRgba90Cw(data, width, height) {
  const outW = height;
  const outH = width;
  const out = Buffer.alloc(outW * outH * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4;
      const nx = height - 1 - y;
      const ny = x;
      const di = (ny * outW + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

function rotateRgba180(data, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4;
      const nx = width - 1 - x;
      const ny = height - 1 - y;
      const di = (ny * width + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width, height };
}

function rotateRgba270Cw(data, width, height) {
  // 270 CW = 90 CCW
  const outW = height;
  const outH = width;
  const out = Buffer.alloc(outW * outH * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4;
      const nx = y;
      const ny = width - 1 - x;
      const di = (ny * outW + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

function rotateRgbaQuarterTurns(data, width, height, turns) {
  const t = parseRotationQuarterTurns(turns);
  if (t === 0) return { data, width, height };
  if (t === 1) return rotateRgba90Cw(data, width, height);
  if (t === 2) return rotateRgba180(data, width, height);
  return rotateRgba270Cw(data, width, height);
}

/**
 * Rotate JPEG/PNG buffer in memory. Does not touch Storage.
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   buffer?: Buffer,
 *   mediaType?: string,
 *   rotated?: boolean,
 *   rotation_quarter_turns?: number,
 *   source_width?: number,
 *   source_height?: number,
 *   width?: number,
 *   height?: number,
 * }}
 */
export function rotateImageBufferQuarterTurns(buf, mediaType, quarterTurns = 0) {
  const turns = parseRotationQuarterTurns(quarterTurns);
  const mime = String(mediaType ?? "").trim().toLowerCase();
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);

  if (!input.length) {
    return { ok: false, reason: "empty_image_buffer" };
  }
  if (mime !== "image/jpeg" && mime !== "image/png") {
    return { ok: false, reason: "mime_not_rotatable", mediaType: mime };
  }
  if (turns === 0) {
    const size = readImageSizeFromBuffer(input, mime);
    return {
      ok: true,
      buffer: input,
      mediaType: mime,
      rotated: false,
      rotation_quarter_turns: 0,
      source_width: size?.width ?? null,
      source_height: size?.height ?? null,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  try {
    if (mime === "image/jpeg") {
      const decoded = jpeg.decode(input, { useTArray: true, maxMemoryUsageInMB: 64 });
      if (!decoded?.data || !decoded.width || !decoded.height) {
        return { ok: false, reason: "jpeg_decode_failed" };
      }
      const rotated = rotateRgbaQuarterTurns(
        Buffer.from(decoded.data),
        decoded.width,
        decoded.height,
        turns,
      );
      const encoded = jpeg.encode(
        { data: rotated.data, width: rotated.width, height: rotated.height },
        85,
      );
      return {
        ok: true,
        buffer: Buffer.from(encoded.data),
        mediaType: "image/jpeg",
        rotated: true,
        rotation_quarter_turns: turns,
        source_width: decoded.width,
        source_height: decoded.height,
        width: rotated.width,
        height: rotated.height,
      };
    }

    const png = PNG.sync.read(input);
    const rotated = rotateRgbaQuarterTurns(png.data, png.width, png.height, turns);
    const outPng = new PNG({ width: rotated.width, height: rotated.height });
    rotated.data.copy(outPng.data);
    const encoded = PNG.sync.write(outPng);
    return {
      ok: true,
      buffer: Buffer.from(encoded),
      mediaType: "image/png",
      rotated: true,
      rotation_quarter_turns: turns,
      source_width: png.width,
      source_height: png.height,
      width: rotated.width,
      height: rotated.height,
    };
  } catch {
    return { ok: false, reason: "image_rotate_failed", mediaType: mime };
  }
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
