export type ClovaOcrConfig = {
  apiUrl: string;
  secretKey: string;
};

export type ClovaOcrParsedResult = {
  text: string;
  pageCount: number;
  ocrConfidenceAvg: number | null;
};

type ClovaField = {
  inferText?: string;
  inferConfidence?: number;
  confidence?: number;
};

type ClovaImageResult = {
  fields?: ClovaField[];
  tables?: Array<{ cells?: ClovaField[] }>;
  convertedImageInfo?: { pageCount?: number };
  inferResult?: string;
};

type ClovaResponse = {
  images?: ClovaImageResult[];
  message?: string;
};

export function getClovaOcrConfig(): ClovaOcrConfig {
  const apiUrl = Deno.env.get("CLOVA_OCR_API_URL")?.trim();
  const secretKey = Deno.env.get("CLOVA_OCR_SECRET_KEY")?.trim();

  if (!apiUrl || !secretKey) {
    throw new Error("clova_not_configured");
  }

  return { apiUrl, secretKey };
}

function formatFromMimeAndFilename(
  mimeType: string | null,
  originalFilename: string | null,
): string {
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

function collectFieldTexts(fields: ClovaField[] | undefined): {
  texts: string[];
  confidences: number[];
} {
  const texts: string[] = [];
  const confidences: number[] = [];

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

export function parseClovaOcrResponse(payload: unknown): ClovaOcrParsedResult {
  const response = payload as ClovaResponse;
  const images = response.images ?? [];

  const allTexts: string[] = [];
  const allConfidences: number[] = [];
  let pageCount = 0;

  for (const image of images) {
    const pageTexts: string[] = [];

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

    if (pageTexts.length > 0) {
      allTexts.push(pageTexts.join("\n"));
    }

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
      (
        allConfidences.reduce((sum, value) => sum + value, 0) /
        allConfidences.length
      ).toFixed(4),
    )
    : null;

  return {
    text,
    pageCount: pageCount > 0 ? pageCount : (text ? 1 : 0),
    ocrConfidenceAvg,
  };
}

export async function runClovaOcr(params: {
  fileBytes: Uint8Array;
  mimeType: string | null;
  originalFilename: string | null;
}): Promise<ClovaOcrParsedResult> {
  const config = getClovaOcrConfig();
  const format = formatFromMimeAndFilename(params.mimeType, params.originalFilename);
  const requestId = crypto.randomUUID();
  const name = params.originalFilename?.split(/[/\\]/).pop() ?? `document.${format}`;

  const message = {
    version: "V2",
    requestId,
    timestamp: Date.now(),
    lang: "ko",
    images: [{ format, name }],
  };

  const form = new FormData();
  form.append(
    "message",
    new Blob([JSON.stringify(message)], { type: "application/json" }),
  );
  form.append(
    "file",
    new Blob([params.fileBytes], { type: params.mimeType ?? "application/octet-stream" }),
    name,
  );

  let response: Response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "X-OCR-SECRET": config.secretKey },
      body: form,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network_error";
    throw new Error(`clova_ocr_failed: ${detail}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `clova_ocr_failed: http_${response.status} ${responseText.slice(0, 200)}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("clova_ocr_failed: invalid_json_response");
  }

  const parsed = parseClovaOcrResponse(payload);
  if (!parsed.text) {
    throw new Error("clova_ocr_empty");
  }

  return parsed;
}
