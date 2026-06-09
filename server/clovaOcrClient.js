/**
 * Node.js CLOVA OCR client — mirrors supabase/functions/document-ingest-worker/lib/clova-ocr.ts
 */

function formatFromMimeAndFilename(mimeType, originalFilename) {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";

  const ext = String(originalFilename ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "jpeg" || ext === "jpg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "heic") return "heic";
  if (ext === "heif") return "heif";
  return "jpg";
}

function imageNameForRequest(format, originalFilename) {
  const raw = originalFilename?.split(/[/\\]/).pop() ?? `document.${format}`;
  const base = raw.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  return base || "document";
}

function buildRequestMessage(format, name) {
  return {
    version: "V2",
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    lang: "ko",
    images: [{ format, name }],
  };
}

function collectFieldTexts(fields) {
  const texts = [];
  const confidences = [];
  for (const field of fields ?? []) {
    const text = String(field.inferText ?? "").trim();
    if (text) texts.push(text);
    const confidence = field.inferConfidence ?? field.confidence;
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      confidences.push(confidence);
    }
  }
  return { texts, confidences };
}

export function parseClovaOcrResponse(payload) {
  const images = payload?.images ?? [];
  const allTexts = [];
  const allConfidences = [];
  let pageCount = 0;

  for (const image of images) {
    const pageTexts = [];
    if (typeof image.inferResult === "string" && image.inferResult.trim()) {
      pageTexts.push(image.inferResult.trim());
    }
    const fieldResult = collectFieldTexts(image.fields);
    pageTexts.push(...fieldResult.texts);
    allConfidences.push(...fieldResult.confidences);

    for (const table of image.tables ?? []) {
      const tableResult = collectFieldTexts(table.cells);
      pageTexts.push(...tableResult.texts);
      allConfidences.push(...tableResult.confidences);
    }

    if (pageTexts.length > 0) allTexts.push(pageTexts.join("\n"));
    const convertedPages = image.convertedImageInfo?.pageCount;
    if (typeof convertedPages === "number" && convertedPages > 0) {
      pageCount += convertedPages;
    } else if (pageTexts.length > 0) {
      pageCount += 1;
    }
  }

  const text = allTexts.join("\n\n").trim();
  const ocrConfidenceAvg = allConfidences.length
    ? Number(
        (allConfidences.reduce((sum, value) => sum + value, 0) / allConfidences.length).toFixed(4),
      )
    : null;

  return {
    text,
    pageCount: pageCount > 0 ? pageCount : (text ? 1 : 0),
    ocrConfidenceAvg,
  };
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function callClovaMultipart(config, params) {
  const message = buildRequestMessage(params.format, params.imageName);
  const form = new FormData();
  form.append("message", JSON.stringify(message));
  form.append(
    "file",
    new File([params.fileBytes], params.uploadFilename, {
      type: params.mimeType ?? "application/octet-stream",
    }),
  );

  return fetch(config.apiUrl, {
    method: "POST",
    headers: { "X-OCR-SECRET": config.secretKey },
    body: form,
  });
}

async function callClovaJsonBase64(config, params) {
  const message = {
    ...buildRequestMessage(params.format, params.imageName),
    images: [
      {
        format: params.format,
        name: params.imageName,
        data: bytesToBase64(params.fileBytes),
      },
    ],
  };

  return fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "X-OCR-SECRET": config.secretKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}

function isRequestInvalidError(status, responseText) {
  if (status !== 400) return false;
  return responseText.includes('"code":"0011"') || responseText.includes("Request invalid");
}

export function getClovaOcrConfig(env = process.env) {
  const apiUrl = String(env.CLOVA_OCR_API_URL ?? "").trim();
  const secretKey = String(env.CLOVA_OCR_SECRET_KEY ?? "").trim();
  if (!apiUrl || !secretKey) return null;
  return { apiUrl, secretKey };
}

export async function runClovaOcr({
  fileBytes,
  mimeType = null,
  originalFilename = null,
  env = process.env,
} = {}) {
  const config = getClovaOcrConfig(env);
  if (!config) throw new Error("clova_not_configured");

  const format = formatFromMimeAndFilename(mimeType, originalFilename);
  const imageName = imageNameForRequest(format, originalFilename);
  const uploadFilename = originalFilename?.split(/[/\\]/).pop() ?? `document.${format}`;

  let response;
  try {
    response = await callClovaMultipart(config, {
      fileBytes,
      mimeType,
      format,
      imageName,
      uploadFilename,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network_error";
    throw new Error(`clova_ocr_failed: ${detail}`);
  }

  let responseText = await response.text();
  if (!response.ok && isRequestInvalidError(response.status, responseText)) {
    response = await callClovaJsonBase64(config, { fileBytes, format, imageName });
    responseText = await response.text();
  }

  if (!response.ok) {
    throw new Error(`clova_ocr_failed: http_${response.status} ${responseText.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("clova_ocr_failed: invalid_json_response");
  }

  const parsed = parseClovaOcrResponse(payload);
  if (!parsed.text) throw new Error("clova_ocr_empty");
  return parsed;
}
