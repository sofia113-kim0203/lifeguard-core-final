import { useCallback, useEffect, useState } from "react";
import {
  checkRealDataReadiness,
  REAL_DATA_READINESS_CHECK_LABELS,
  REAL_DATA_READINESS_MISSING_LABELS,
} from "../lib/realDataReadiness.js";
import { loadCustomersForGroundingTest } from "../lib/customerGrounding.js";

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

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return String(value);
  }
}

function missingLabel(code) {
  return REAL_DATA_READINESS_MISSING_LABELS[code] ?? code;
}

function checkLabel(name) {
  return REAL_DATA_READINESS_CHECK_LABELS[name] ?? name;
}

export default function AdminRealDataReadinessPanel() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const customerRows = await loadCustomersForGroundingTest();
      setCustomers(customerRows);
      if (customerRows.length && !customerId) {
        setCustomerId(customerRows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const handleRun = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const data = await checkRealDataReadiness({ customerId });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실데이터 준비상태 점검
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          기존 실데이터만 점검합니다. 가짜 데이터 생성·시드 없음.
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
          입력
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            고객
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {loading ? (
                <option value="">불러오는 중…</option>
              ) : customers.length === 0 ? (
                <option value="">등록된 고객 없음</option>
              ) : (
                customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name || c.id.slice(0, 8)} · {c.id.slice(0, 8)}…
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: running ? 0.6 : 1, maxWidth: "280px" }}
            disabled={running || !customers.length}
            onClick={handleRun}
          >
            {running ? "점검 중…" : "준비상태 점검 실행"}
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              요약
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>readiness_run_id: {result.readinessRunId ?? "—"}</div>
              <div>고객 ID: {result.customerId ?? "—"}</div>
              <div>Readiness Status: {result.readinessStatus ?? "—"}</div>
              <div>created_at: {formatDate(result.createdAt)}</div>
            </div>
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Ready Checks
            </h2>
            {!result.readyChecks?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>준비 완료 항목 없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#cbd5e1", fontSize: "13px" }}>
                {result.readyChecks.map((check) => (
                  <li key={check.check_name}>
                    {checkLabel(check.check_name)} ({check.check_name})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Missing Checks
            </h2>
            {!result.missingChecks?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>누락 항목 없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#cbd5e1", fontSize: "13px" }}>
                {result.missingChecks.map((check) => (
                  <li key={check.check_name}>
                    {checkLabel(check.check_name)} ({check.check_name})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Missing Information
            </h2>
            {!result.missingInformation?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>누락 코드 없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#cbd5e1", fontSize: "13px" }}>
                {result.missingInformation.map((code) => (
                  <li key={code}>
                    {missingLabel(code)} ({code})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Readiness Preview
            </h2>
            <pre
              style={{
                margin: 0,
                padding: "14px",
                borderRadius: "10px",
                background: "rgba(15, 23, 42, 0.85)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
                fontSize: "11px",
                color: "#cbd5e1",
                overflow: "auto",
                maxHeight: "520px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {JSON.stringify(result.checks ?? result.readinessContext ?? result.raw, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
