export type ExtractionRoute = "pdf_stub" | "image_ocr_stub";

export type DocumentRecord = {
  id: string;
  customer_id: string;
  storage_path: string;
  mime_type: string | null;
  original_filename: string | null;
  ingest_status: string;
  ingest_job_id: string | null;
  document_type: string | null;
  customer_hint_type: string | null;
  consent_snapshot: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
};

export type ExtractResult = {
  content: string;
  pageCount: number;
  storageVerified: boolean;
  extractionRoute: ExtractionRoute;
  ocrProvider: "stub";
};

export type ClassifiedDocumentType =
  | "coverage_analysis_sheet"
  | "insurance_terms"
  | "insurance_certificate"
  | "unknown";

export type IngestMetadata = {
  phase: "22A-step2B";
  ocr_provider: "stub";
  extraction_route: ExtractionRoute;
  chunk_count: number;
  storage_verified: boolean;
  classified_document_type: ClassifiedDocumentType | string;
};
