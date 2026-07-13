/**
 * Chat image orientation — quarter-turn trust + ephemeral server rotate.
 * Storage originals are never rewritten. Rotated bytes are in-memory only.
 * Observation fields are redacted metrics only (no bytes / PII / filenames).
 */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { randomBytes } from "node:crypto";

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

const FAILURE_CODE_ALLOWLIST = new Set([
  "empty_image_buffer",
  "mime_not_rotatable",
  "jpeg_decode_failed",
  "png_decode_failed",
  "image_rotate_failed",
  "image_encode_failed",
  "dimension_read_failed",
  "storage_image_missing",
  "mime_not_image",
  "image_too_large",
  "rotated_image_too_large",
  "block_build_failed",
  "attach_error",
]);

/** Redact exception into allowlisted / sanitized fields only. */
export function sanitizeRotateObservationError(err, fallbackCode = "image_rotate_failed") {
  const name = err && err.name != null ? String(err.name).slice(0, 80) : null;
  let msg = err && err.message != null ? String(err.message) : "";
  msg = msg
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp|app)\/[^\s"'`]+/gi, "[path]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/data:[^;]+;base64,\S+/gi, "[b64]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[id]",
    )
    .replace(/\bcustomer_id\b/gi, "[redacted]")
    .replace(/\bdocument_id\b/gi, "[redacted]")
    .slice(0, 160);
  const code = FAILURE_CODE_ALLOWLIST.has(fallbackCode)
    ? fallbackCode
    : "image_rotate_failed";
  return {
    normalized_failure_code: code,
    sanitized_error_name: name,
    sanitized_error_message: msg || null,
  };
}

export function newImageRotateObservationId() {
  return `iro_${randomBytes(8).toString("hex")}`;
}

function baseObservation({
  observation_id = null,
  rotation_quarter_turns = 0,
  normalized_db_mime = null,
  detected_signature = "unknown",
  input_byte_size = null,
  input_width = null,
  input_height = null,
} = {}) {
  return {
    observation_id: observation_id ?? newImageRotateObservationId(),
    rotation_quarter_turns,
    normalized_db_mime,
    detected_signature,
    input_byte_size:
      typeof input_byte_size === "number" && Number.isFinite(input_byte_size)
        ? input_byte_size
        : null,
    input_width: input_width ?? null,
    input_height: input_height ?? null,
    decode_started: false,
    decode_ok: null,
    decoded_width: null,
    decoded_height: null,
    rotate_started: false,
    rotate_ok: null,
    expected_output_width: null,
    expected_output_height: null,
    encode_started: false,
    encode_ok: null,
    output_byte_size: null,
    attachment_block_built: null,
    failure_stage: null,
    normalized_failure_code: null,
    sanitized_error_name: null,
    sanitized_error_message: null,
  };
}

/** Strip any accidental PII keys from observation objects before trace. */
export function redactImageRotateObservation(obs = null) {
  if (!obs || typeof obs !== "object") return null;
  const out = { ...obs };
  for (const k of Object.keys(out)) {
    if (
      /base64|filename|customer|document_id|storage_path|url|payload|answer/i.test(k)
    ) {
      delete out[k];
    }
  }
  if (typeof out.sanitized_error_message === "string") {
    out.sanitized_error_message = out.sanitized_error_message.slice(0, 160);
  }
  return out;
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

function expectedSizeAfterQuarterTurns(width, height, turns) {
  const t = parseRotationQuarterTurns(turns);
  if (!width || !height) return { width: null, height: null };
  if (t === 1 || t === 3) return { width: height, height: width };
  return { width, height };
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
 * Adds redacted `observation` for Preview fail-stage triage.
 */
export function rotateImageBufferQuarterTurns(buf, mediaType, quarterTurns = 0) {
  const turns = parseRotationQuarterTurns(quarterTurns);
  const mime = String(mediaType ?? "").trim().toLowerCase();
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  const detected_signature = detectImageSignature(input);
  const sizeHint = readImageSizeFromBuffer(input, mime);
  const obs = baseObservation({
    rotation_quarter_turns: turns,
    normalized_db_mime: mime || null,
    detected_signature,
    input_byte_size: input.length,
    input_width: sizeHint?.width ?? null,
    input_height: sizeHint?.height ?? null,
  });

  if (!input.length) {
    obs.failure_stage = "signature";
    obs.normalized_failure_code = "empty_image_buffer";
    return { ok: false, reason: "empty_image_buffer", observation: redactImageRotateObservation(obs) };
  }
  if (mime !== "image/jpeg" && mime !== "image/png") {
    obs.failure_stage = "signature";
    obs.normalized_failure_code = "mime_not_rotatable";
    return {
      ok: false,
      reason: "mime_not_rotatable",
      mediaType: mime,
      observation: redactImageRotateObservation(obs),
    };
  }

  // turns=0: pass-through original bytes — do not enter decode/rotate/encode.
  if (turns === 0) {
    return {
      ok: true,
      buffer: input,
      mediaType: mime,
      rotated: false,
      rotation_quarter_turns: 0,
      source_width: sizeHint?.width ?? null,
      source_height: sizeHint?.height ?? null,
      width: sizeHint?.width ?? null,
      height: sizeHint?.height ?? null,
      observation: redactImageRotateObservation(obs),
    };
  }

  const expected = expectedSizeAfterQuarterTurns(
    sizeHint?.width ?? null,
    sizeHint?.height ?? null,
    turns,
  );
  obs.expected_output_width = expected.width;
  obs.expected_output_height = expected.height;

  if (mime === "image/jpeg") {
    obs.decode_started = true;
    let decoded;
    try {
      decoded = jpeg.decode(input, { useTArray: true, maxMemoryUsageInMB: 64 });
    } catch (err) {
      const san = sanitizeRotateObservationError(err, "jpeg_decode_failed");
      obs.decode_ok = false;
      obs.failure_stage = "decode";
      Object.assign(obs, san);
      return {
        ok: false,
        reason: "jpeg_decode_failed",
        observation: redactImageRotateObservation(obs),
      };
    }
    if (!decoded?.data || !decoded.width || !decoded.height) {
      obs.decode_ok = false;
      obs.failure_stage = "decode";
      obs.normalized_failure_code = "jpeg_decode_failed";
      return {
        ok: false,
        reason: "jpeg_decode_failed",
        observation: redactImageRotateObservation(obs),
      };
    }
    obs.decode_ok = true;
    obs.decoded_width = decoded.width;
    obs.decoded_height = decoded.height;
    obs.input_width = obs.input_width ?? decoded.width;
    obs.input_height = obs.input_height ?? decoded.height;
    const exp2 = expectedSizeAfterQuarterTurns(decoded.width, decoded.height, turns);
    obs.expected_output_width = exp2.width;
    obs.expected_output_height = exp2.height;

    obs.rotate_started = true;
    let rotated;
    try {
      rotated = rotateRgbaQuarterTurns(
        Buffer.from(decoded.data),
        decoded.width,
        decoded.height,
        turns,
      );
    } catch (err) {
      const san = sanitizeRotateObservationError(err, "image_rotate_failed");
      obs.rotate_ok = false;
      obs.failure_stage = "rotate";
      Object.assign(obs, san);
      return {
        ok: false,
        reason: "image_rotate_failed",
        observation: redactImageRotateObservation(obs),
      };
    }
    obs.rotate_ok = true;

    obs.encode_started = true;
    let encoded;
    try {
      encoded = jpeg.encode(
        { data: rotated.data, width: rotated.width, height: rotated.height },
        85,
      );
    } catch (err) {
      const san = sanitizeRotateObservationError(err, "image_encode_failed");
      obs.encode_ok = false;
      obs.failure_stage = "encode";
      Object.assign(obs, san);
      return {
        ok: false,
        reason: "image_encode_failed",
        observation: redactImageRotateObservation(obs),
      };
    }
    if (!encoded?.data?.length) {
      obs.encode_ok = false;
      obs.failure_stage = "encode";
      obs.normalized_failure_code = "image_encode_failed";
      return {
        ok: false,
        reason: "image_encode_failed",
        observation: redactImageRotateObservation(obs),
      };
    }
    obs.encode_ok = true;
    const outBuf = Buffer.from(encoded.data);
    obs.output_byte_size = outBuf.length;
    return {
      ok: true,
      buffer: outBuf,
      mediaType: "image/jpeg",
      rotated: true,
      rotation_quarter_turns: turns,
      source_width: decoded.width,
      source_height: decoded.height,
      width: rotated.width,
      height: rotated.height,
      observation: redactImageRotateObservation(obs),
    };
  }

  // PNG path
  obs.decode_started = true;
  let png;
  try {
    png = PNG.sync.read(input);
  } catch (err) {
    const san = sanitizeRotateObservationError(err, "png_decode_failed");
    obs.decode_ok = false;
    obs.failure_stage = "decode";
    Object.assign(obs, san);
    return {
      ok: false,
      reason: "png_decode_failed",
      observation: redactImageRotateObservation(obs),
    };
  }
  if (!png?.data || !png.width || !png.height) {
    obs.decode_ok = false;
    obs.failure_stage = "decode";
    obs.normalized_failure_code = "png_decode_failed";
    return {
      ok: false,
      reason: "png_decode_failed",
      observation: redactImageRotateObservation(obs),
    };
  }
  obs.decode_ok = true;
  obs.decoded_width = png.width;
  obs.decoded_height = png.height;
  const expPng = expectedSizeAfterQuarterTurns(png.width, png.height, turns);
  obs.expected_output_width = expPng.width;
  obs.expected_output_height = expPng.height;

  obs.rotate_started = true;
  let rotatedPng;
  try {
    rotatedPng = rotateRgbaQuarterTurns(png.data, png.width, png.height, turns);
  } catch (err) {
    const san = sanitizeRotateObservationError(err, "image_rotate_failed");
    obs.rotate_ok = false;
    obs.failure_stage = "rotate";
    Object.assign(obs, san);
    return {
      ok: false,
      reason: "image_rotate_failed",
      observation: redactImageRotateObservation(obs),
    };
  }
  obs.rotate_ok = true;

  obs.encode_started = true;
  let encodedPng;
  try {
    const outPng = new PNG({ width: rotatedPng.width, height: rotatedPng.height });
    rotatedPng.data.copy(outPng.data);
    encodedPng = PNG.sync.write(outPng);
  } catch (err) {
    const san = sanitizeRotateObservationError(err, "image_encode_failed");
    obs.encode_ok = false;
    obs.failure_stage = "encode";
    Object.assign(obs, san);
    return {
      ok: false,
      reason: "image_encode_failed",
      observation: redactImageRotateObservation(obs),
    };
  }
  const outBuf = Buffer.from(encodedPng);
  obs.encode_ok = true;
  obs.output_byte_size = outBuf.length;
  return {
    ok: true,
    buffer: outBuf,
    mediaType: "image/png",
    rotated: true,
    rotation_quarter_turns: turns,
    source_width: png.width,
    source_height: png.height,
    width: rotatedPng.width,
    height: rotatedPng.height,
    observation: redactImageRotateObservation(obs),
  };
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
