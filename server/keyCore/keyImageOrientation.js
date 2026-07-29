/**
 * Mechanical EXIF / JPEG orientation normalize for Claude runtime bytes only.
 * Never mutates Storage originals. No OCR / page-order judgment.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Read JPEG EXIF Orientation (1–8) from buffer. Missing → 1. */
export function readJpegExifOrientation(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return 1;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if (size < 2) break;
    if (marker === 0xe1) {
      const start = offset + 4;
      const end = offset + 2 + size;
      const segment = buf.subarray(start, Math.min(end, buf.length));
      const orientation = parseExifOrientationFromApp1(segment);
      if (orientation != null) return orientation;
    }
    if (marker === 0xda) break; // SOS
    offset += 2 + size;
  }
  return 1;
}

function parseExifOrientationFromApp1(segment) {
  if (segment.length < 14) return null;
  if (segment.toString("ascii", 0, 4) !== "Exif" || segment[4] !== 0 || segment[5] !== 0) {
    return null;
  }
  const tiff = segment.subarray(6);
  if (tiff.length < 8) return null;
  const le = tiff.toString("ascii", 0, 2) === "II";
  const be = tiff.toString("ascii", 0, 2) === "MM";
  if (!le && !be) return null;
  const readU16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const readU32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = readU32(4);
  if (ifd0 + 2 > tiff.length) return null;
  const entries = readU16(ifd0);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = readU16(entry);
    if (tag !== 0x0112) continue;
    const value = readU16(entry + 8);
    if (value >= 1 && value <= 8) return value;
  }
  return null;
}

/**
 * Normalize image bytes for Claude attach. PDF / non-image → passthrough.
 * Uses sharp when available; otherwise returns original with rotated=false.
 */
export async function normalizeImageOrientationForClaude({
  base64 = null,
  mediaType = null,
  sharpImpl = null,
} = {}) {
  const mime = String(mediaType ?? "").toLowerCase().trim();
  const rawB64 = String(base64 ?? "").trim();
  if (!rawB64 || !mime.startsWith("image/")) {
    return {
      base64: rawB64 || null,
      mediaType: mime || null,
      rotated: false,
      orientation_before: null,
      orientation_after: null,
      reason: !rawB64 ? "no_bytes" : "not_image",
    };
  }
  let buf;
  try {
    buf = Buffer.from(rawB64, "base64");
  } catch {
    return {
      base64: rawB64,
      mediaType: mime,
      rotated: false,
      orientation_before: null,
      orientation_after: null,
      reason: "base64_decode_failed",
    };
  }

  const orientation_before = mime.includes("jpeg") || mime.includes("jpg")
    ? readJpegExifOrientation(buf)
    : null;

  let sharpFn = sharpImpl;
  if (!sharpFn) {
    try {
      sharpFn = require("sharp");
    } catch {
      sharpFn = null;
    }
  }
  if (!sharpFn) {
    return {
      base64: rawB64,
      mediaType: mime,
      rotated: false,
      orientation_before,
      orientation_after: orientation_before,
      reason: "sharp_unavailable",
    };
  }

  try {
    const pipeline = sharpFn(buf).rotate(); // auto EXIF orient, then strip
    const outMime = mime.includes("png")
      ? "image/png"
      : mime.includes("webp")
        ? "image/webp"
        : "image/jpeg";
    const outBuf =
      outMime === "image/png"
        ? await pipeline.png().toBuffer()
        : outMime === "image/webp"
          ? await pipeline.webp().toBuffer()
          : await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    const orientation_after =
      outMime.includes("jpeg") ? readJpegExifOrientation(outBuf) : 1;
    return {
      base64: outBuf.toString("base64"),
      mediaType: outMime,
      rotated: orientation_before != null && orientation_before !== 1,
      orientation_before,
      orientation_after,
      reason: "normalized",
    };
  } catch (err) {
    return {
      base64: rawB64,
      mediaType: mime,
      rotated: false,
      orientation_before,
      orientation_after: orientation_before,
      reason: `normalize_failed:${String(err?.message ?? err).slice(0, 80)}`,
    };
  }
}

export async function normalizeAttachmentRowsForClaude(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row?.base64) continue;
    const normalized = await normalizeImageOrientationForClaude({
      base64: row.base64,
      mediaType: row.mediaType || row.mime_type || null,
      sharpImpl: opts.sharpImpl,
    });
    out.push({
      ...row,
      base64: normalized.base64,
      mediaType: normalized.mediaType || row.mediaType,
      orientation: {
        rotated: normalized.rotated,
        before: normalized.orientation_before,
        after: normalized.orientation_after,
        reason: normalized.reason,
      },
    });
  }
  return out;
}
