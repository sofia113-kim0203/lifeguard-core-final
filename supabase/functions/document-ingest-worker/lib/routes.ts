import type { ExtractionRoute } from "./types.ts";

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

const EXTENSION_ROUTE_MAP: Record<string, ExtractionRoute> = {
  pdf: "pdf_stub",
  jpg: "image_ocr_stub",
  jpeg: "image_ocr_stub",
  png: "image_ocr_stub",
  heic: "image_ocr_stub",
  heif: "image_ocr_stub",
  webp: "image_ocr_stub",
};

function normalizeMimeType(mimeType: string | null | undefined): string {
  return String(mimeType ?? "").trim().toLowerCase();
}

function extensionFromFilename(filename: string | null | undefined): string {
  const parts = String(filename ?? "").toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

export function resolveExtractionRoute(params: {
  mimeType: string | null;
  originalFilename: string | null;
}): ExtractionRoute {
  const mime = normalizeMimeType(params.mimeType);

  if (PDF_MIME_TYPES.has(mime)) return "pdf_stub";
  if (IMAGE_MIME_TYPES.has(mime)) return "image_ocr_stub";

  const extension = extensionFromFilename(params.originalFilename);
  const routeFromExtension = EXTENSION_ROUTE_MAP[extension];
  if (routeFromExtension) return routeFromExtension;

  throw new Error(
    `unsupported_file_type: mime=${mime || "unknown"} ext=${extension || "none"}`,
  );
}

export function isSupportedExtractionRoute(route: string): route is ExtractionRoute {
  return route === "pdf_stub" || route === "image_ocr_stub";
}
