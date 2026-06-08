export type ExtractionRoute = "pdf_stub" | "image_ocr_stub";

export type OcrProvider = "clova";

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
  ocrProvider: OcrProvider;
  ocrConfidenceAvg: number | null;
};

export type ClassifiedDocumentType =
  | "coverage_analysis_sheet"
  | "insurance_terms"
  | "insurance_certificate"
  | "unknown";

export type WorkerPhase = "22D-step1B";

export type IngestMetadata = {
  phase: WorkerPhase;
  ocr_provider: OcrProvider;
  extraction_route: ExtractionRoute;
  chunk_count: number;
  storage_verified: boolean;
  classified_document_type: ClassifiedDocumentType | string;
  embedding_model?: string;
  ocr_confidence_avg?: number | null;
};
