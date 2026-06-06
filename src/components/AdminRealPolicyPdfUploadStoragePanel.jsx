import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  loadRealPolicyKnowledgeSources,
  registerRealPolicyPdf,
  validateRealPolicyPdf,
  loadRealPolicyPdfRegistry,
  loadLatestValidationForPdf,
  REAL_POLICY_PDF_UPLOAD_STATUS_LABELS,
  REAL_POLICY_PDF_VALIDATION_STATUS_LABELS,
  REAL_POLICY_PDF_MISSING_LABELS,
} from "../lib/realPolicyPdfUploadStorage.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
  },
  btn: {
    padding: "12px 20px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};

function missingLabel(code) {
  return REAL_POLICY_PDF_MISSING_LABELS[code] ?? code;
}

function uploadStatusLabel(status) {
  return REAL_POLICY_PDF_UPLOAD_STATUS_LABELS[status] ?? status;
}

function validationStatusLabel(status) {
  return REAL_POLICY_PDF_VALIDATION_STATUS_LABELS[status] ?? status;
}

function formatFileSize(size) {
  if (size == null || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminRealPolicyPdfUploadStoragePanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [sources, setSources] = useState([]);
  const [pdfs, setPdfs] = useState([]);
  const [validationMap, setValidationMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [validateResult, setValidateResult] = useState(null);

  const [policySourceId, setPolicySourceId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [fileType, setFileType] = useState("application/pdf");
  const [storagePath, setStoragePath] = useState("");
  const [fileVersion, setFileVersion] = useState("");
  const [selectedPdfId, setSelectedPdfId] = useState("");

  const loadPdfs = useCallback(async () => {
    try {
      const rows = await loadRealPolicyPdfRegistry();
      setPdfs(rows);
      const validations = {};
      await Promise.all(
        rows.map(async (row) => {
          const validation = await loadLatestValidationForPdf(row.id);
          validations[row.id] = validation;
        }),
      );
      setValidationMap(validations);
      if (rows.length && !selectedPdfId) {
        setSelectedPdfId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setPdfs([]);
      setValidationMap({});
    }
  }, [selectedPdfId]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [carrierRows, sourceRows] = await Promise.all([
        loadCarriersForManualKnowledge(),
        loadRealPolicyKnowledgeSources(),
      ]);
      setCarriers(carrierRows);
      setSources(sourceRows);
      if (carrierRows.length && !carrierId) {
        setCarrierId(carrierRows[0].id);
      }
      if (sourceRows.length && !policySourceId) {
        setPolicySourceId(sourceRows[0].id);
      }
      await loadPdfs();
    } catch (err) {
      setError(err.message);
      setCarriers([]);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, [carrierId, policySourceId, loadPdfs]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!carrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    loadProductsForManualKnowledge(carrierId)
      .then((rows) => {
        setProducts(rows);
        setProductId(rows[0]?.id ?? "");
      })
      .catch((err) => setError(err.message));
  }, [carrierId]);

  useEffect(() => {
    const source = sources.find((row) => row.id === policySourceId);
    if (!source) return;
    if (source.carrier_id) setCarrierId(source.carrier_id);
    if (source.product_id) setProductId(source.product_id);
    if (source.source_file_reference && !storagePath) {
      setStoragePath(source.source_file_reference);
    }
    if (source.source_version && !fileVersion) {
      setFileVersion(source.source_version);
    }
  }, [policySourceId, sources, storagePath, fileVersion]);

  const selectedSource = sources.find((row) => row.id === policySourceId) ?? null;
  const selectedPdf = pdfs.find((row) => row.id === selectedPdfId) ?? null;
  const selectedValidation = selectedPdfId ? validationMap[selectedPdfId] ?? null : null;

  const handleRegister = async () => {
    if (!policySourceId) {
      setError("Policy source를 선택해 주세요.");
      return;
    }
    if (!carrierId) {
      setError("보험사를 선택해 주세요.");
      return;
    }
    if (!fileName.trim()) {
      setError("파일명을 입력해 주세요.");
      return;
    }
    if (!storagePath.trim()) {
      setError("Storage Path를 입력해 주세요.");
      return;
    }
    if (!fileVersion.trim()) {
      setError("버전을 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerRealPolicyPdf({
        policySourceId,
        carrierId,
        productId: productId || null,
        fileName,
        fileSize: fileSize ? Number(fileSize) : null,
        fileType,
        storagePath,
        fileVersion,
      });
      setRegisterResult(data);
      await loadPdfs();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleValidate = async () => {
    if (!selectedPdfId) {
      setError("검증할 PDF를 선택해 주세요.");
      return;
    }
    setValidating(true);
    setError("");
    setValidateResult(null);
    try {
      const data = await validateRealPolicyPdf(selectedPdfId);
      setValidateResult(data);
      await loadPdfs();
    } catch (err) {
      setError(err.message);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 PDF 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          실제 보험 PDF 파일의 등록·저장 메타데이터를 관리합니다. OCR·텍스트 추출·임베딩·Claude 실행 없음.
        </p>
      </div>

      {error ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "rgba(127, 29, 29, 0.35)",
            color: "#fecaca",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          PDF 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Policy Source
            <select
              value={policySourceId}
              onChange={(e) => setPolicySourceId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {sources.length === 0 ? (
                <option value="">등록된 Policy source 없음</option>
              ) : (
                sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.source_name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {carriers.length === 0 ? (
                <option value="">등록된 보험사 없음</option>
              ) : (
                carriers.map((carrier) => (
                  <option key={carrier.id} value={carrier.id}>
                    {carrier.carrier_name ?? carrier.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={loading || !carrierId}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택 안 함)</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name ?? product.id}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            File Name
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="예: samsung-life-cancer-terms-2025.pdf"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            File Size (bytes)
            <input
              type="number"
              value={fileSize}
              onChange={(e) => setFileSize(e.target.value)}
              placeholder="예: 1048576"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            File Type
            <input
              type="text"
              value={fileType}
              onChange={(e) => setFileType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Storage Path
            <input
              type="text"
              value={storagePath}
              onChange={(e) => setStoragePath(e.target.value)}
              placeholder="policy-pdfs/carrier/product/file.pdf"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Version
            <input
              type="text"
              value={fileVersion}
              onChange={(e) => setFileVersion(e.target.value)}
              placeholder="예: 2025-03"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !policySourceId || !carrierId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "PDF 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Policy PDF ID: {registerResult.policyPdfId ?? "—"}</div>
            <div>Upload Status: {uploadStatusLabel(registerResult.uploadStatus)}</div>
            {registerResult.missingInformation?.length ? (
              <div>
                Missing Information:{" "}
                {registerResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          메타데이터 검증
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            PDF
            <select
              value={selectedPdfId}
              onChange={(e) => setSelectedPdfId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {pdfs.length === 0 ? (
                <option value="">등록된 PDF 없음</option>
              ) : (
                pdfs.map((pdf) => (
                  <option key={pdf.id} value={pdf.id}>
                    {pdf.file_name} ({uploadStatusLabel(pdf.upload_status)})
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            style={{
              ...S.btn,
              opacity: validating ? 0.6 : 1,
              maxWidth: "280px",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            }}
            disabled={validating || !selectedPdfId}
            onClick={handleValidate}
          >
            {validating ? "검증 중…" : "메타데이터 검증"}
          </button>
        </div>
      </section>

      {validateResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            검증 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Validation Run ID: {validateResult.pdfValidationRunId ?? "—"}</div>
            <div>Validation Status: {validationStatusLabel(validateResult.validationStatus)}</div>
            <div>Upload Status: {uploadStatusLabel(validateResult.uploadStatus)}</div>
            {validateResult.missingInformation?.length ? (
              <div>
                Missing Information:{" "}
                {validateResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {pdfs.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록된 PDF ({pdfs.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pdfs.map((pdf) => {
              const validation = validationMap[pdf.id] ?? null;
              const missing = Array.isArray(validation?.missing_information)
                ? validation.missing_information
                : [];
              return (
                <div
                  key={pdf.id}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    background: "rgba(15, 23, 42, 0.5)",
                    fontSize: "12px",
                    color: "#e2e8f0",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{pdf.file_name}</div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <div>Carrier: {pdf.carrier?.carrier_name ?? "—"}</div>
                    <div>Product: {pdf.product?.product_name ?? "—"}</div>
                    <div>File Size: {formatFileSize(pdf.file_size)}</div>
                    <div>File Type: {pdf.file_type}</div>
                    <div>Version: {pdf.file_version}</div>
                    <div>Upload Status: {uploadStatusLabel(pdf.upload_status)}</div>
                    <div>
                      Validation Status:{" "}
                      {validationStatusLabel(validation?.validation_status ?? "pending")}
                    </div>
                    <div>Storage Path: {pdf.storage_path}</div>
                    {missing.length ? (
                      <div>Missing Information: {missing.map(missingLabel).join(", ")}</div>
                    ) : null}
                    {pdf.source?.source_name ? (
                      <div>Source: {pdf.source.source_name}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedSource ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            선택된 Policy Source
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>{selectedSource.source_name}</div>
            <div>File Reference: {selectedSource.source_file_reference}</div>
            <div>Version: {selectedSource.source_version}</div>
          </div>
        </section>
      ) : null}

      {selectedPdf && selectedValidation ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            선택 PDF 검증 상세
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Carrier: {selectedPdf.carrier?.carrier_name ?? "—"}</div>
            <div>Product: {selectedPdf.product?.product_name ?? "—"}</div>
            <div>Upload Status: {uploadStatusLabel(selectedPdf.upload_status)}</div>
            <div>
              Validation Status: {validationStatusLabel(selectedValidation.validation_status)}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
