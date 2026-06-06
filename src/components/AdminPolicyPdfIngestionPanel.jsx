import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  registerPolicyPdfIngestion,
  linkPolicyPdfToRagSource,
  loadPolicyPdfIngestionRuns,
  POLICY_PDF_INGESTION_STATUS_LABELS,
  POLICY_PDF_MISSING_LABELS,
} from "../lib/policyPdfIngestion.js";
import { POLICY_RAG_SOURCE_STATUS_LABELS } from "../lib/policyRag.js";

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
  return POLICY_PDF_MISSING_LABELS[code] ?? code;
}

function ingestionStatusLabel(status) {
  return POLICY_PDF_INGESTION_STATUS_LABELS[status] ?? status;
}

function ragStatusLabel(status) {
  return POLICY_RAG_SOURCE_STATUS_LABELS[status] ?? status ?? "—";
}

export default function AdminPolicyPdfIngestionPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [linkResult, setLinkResult] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState("");

  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [originalFilename, setOriginalFilename] = useState("");
  const [storagePath, setStoragePath] = useState("");
  const [mimeType, setMimeType] = useState("application/pdf");
  const [fileSize, setFileSize] = useState("");
  const [sourceReference, setSourceReference] = useState("");

  const loadRuns = useCallback(async () => {
    try {
      const rows = await loadPolicyPdfIngestionRuns();
      setRuns(rows);
      if (rows.length && !selectedRunId) {
        setSelectedRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setRuns([]);
    }
  }, [selectedRunId]);

  const loadCarriers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadCarriersForManualKnowledge();
      setCarriers(rows);
    } catch (err) {
      setError(err.message);
      setCarriers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async (nextCarrierId) => {
    if (!nextCarrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    try {
      const rows = await loadProductsForManualKnowledge(nextCarrierId);
      setProducts(rows);
      setProductId("");
    } catch (err) {
      setError(err.message);
      setProducts([]);
      setProductId("");
    }
  }, []);

  useEffect(() => {
    loadCarriers();
    loadRuns();
  }, [loadCarriers, loadRuns]);

  useEffect(() => {
    loadProducts(carrierId);
  }, [carrierId, loadProducts]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOriginalFilename(file.name);
    setMimeType(file.type || "application/pdf");
    setFileSize(String(file.size));
  };

  const handleRegister = async () => {
    if (!carrierId) {
      setError("보험사를 선택해 주세요.");
      return;
    }
    if (!originalFilename.trim()) {
      setError("파일을 선택하거나 파일명을 입력해 주세요.");
      return;
    }
    if (!storagePath.trim()) {
      setError("Storage Path를 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    setLinkResult(null);
    try {
      const data = await registerPolicyPdfIngestion({
        carrierId,
        productId: productId || null,
        originalFilename: originalFilename.trim(),
        storagePath: storagePath.trim(),
        mimeType,
        fileSize: fileSize ? Number(fileSize) : null,
        sourceReference,
      });
      setRegisterResult(data);
      setSelectedRunId(data.pdfIngestionRunId ?? "");
      await loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleLink = async () => {
    const runId = selectedRunId || registerResult?.pdfIngestionRunId;
    if (!runId) {
      setError("PDF 적재 run을 선택해 주세요.");
      return;
    }
    setLinking(true);
    setError("");
    setLinkResult(null);
    try {
      const data = await linkPolicyPdfToRagSource(runId);
      setLinkResult(data);
      await loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };

  const selectedRun = runs.find((row) => row.id === selectedRunId);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 PDF 적재
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          실제 업로드된 PDF 메타데이터만 등록합니다. 가짜 문서·텍스트 추출·청크·임베딩 없음.
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
            Carrier
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.carrier_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!carrierId || products.length === 0}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(전체)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            File
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              style={{ ...S.input, marginTop: "6px", padding: "8px 12px" }}
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
            Source Reference (선택)
            <input
              type="text"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "PDF 적재 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Upload Status: {ingestionStatusLabel(registerResult.ingestionStatus)}</div>
            <div>Storage Path: {registerResult.storagePath || "—"}</div>
            {registerResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:
                <ul style={{ margin: "6px 0 0", paddingLeft: "20px" }}>
                  {registerResult.missingInformation.map((code) => (
                    <li key={code}>{missingLabel(code)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          RAG 소스 연결
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            PDF Ingestion Run
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {runs.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.original_filename} — {ingestionStatusLabel(row.ingestion_status)}
                </option>
              ))}
            </select>
          </label>
          {selectedRun ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Carrier: {selectedRun.carrier?.carrier_name ?? "—"}</div>
              <div>Product: {selectedRun.product?.product_name ?? "—"}</div>
              <div>File: {selectedRun.original_filename}</div>
              <div>Upload Status: {ingestionStatusLabel(selectedRun.ingestion_status)}</div>
              <div>Storage Path: {selectedRun.storage_path}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: linking ? 0.6 : 1, maxWidth: "280px" }}
            disabled={linking || !selectedRunId}
            onClick={handleLink}
          >
            {linking ? "연결 중…" : "RAG 소스 연결"}
          </button>
        </div>
      </section>

      {linkResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            RAG 연결 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>RAG Source Status: {ragStatusLabel(linkResult.sourceStatus)}</div>
            <div>RAG Source ID: {linkResult.ragSourceId ?? "—"}</div>
            {linkResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:
                <ul style={{ margin: "6px 0 0", paddingLeft: "20px" }}>
                  {linkResult.missingInformation.map((code) => (
                    <li key={code}>{missingLabel(code)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div style={{ marginTop: "8px" }}>Missing Information: 없음</div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
