import { useCallback, useEffect, useState } from "react";
import {
  prepareClaudeExecution,
  storeClaudeExecutionResult,
  loadClaudeExecutionRun,
  loadClaudeExecutionItems,
  loadRecentClaudeGroundingRuns,
  CLAUDE_EXECUTION_STATUS_LABELS,
  CLAUDE_EXECUTION_MISSING_LABELS,
} from "../lib/claudeExecution.js";
import {
  checkClaudeGroundedExecutionReadiness,
  runClaudeGroundedExecution,
  READINESS_MISSING_LABELS,
  READINESS_WARNING_LABELS,
} from "../lib/claudeGroundedExecution.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const RUN_STATUSES = Object.keys(CLAUDE_EXECUTION_STATUS_LABELS);

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
  return CLAUDE_EXECUTION_MISSING_LABELS[code] ?? code;
}

function statusLabel(status) {
  return CLAUDE_EXECUTION_STATUS_LABELS[status] ?? status;
}

function responsePreview(run, items) {
  if (run?.response_context && Object.keys(run.response_context).length > 0) {
    return run.response_context;
  }
  const item = items?.[0];
  if (item?.response_reference) {
    return { response_reference: item.response_reference };
  }
  return run?.request_context ?? {};
}

export default function AdminClaudeExecutionPanel() {
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [readinessResult, setReadinessResult] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [groundingRuns, setGroundingRuns] = useState([]);

  const [claudeGroundingRunId, setClaudeGroundingRunId] = useState("");
  const [modelName, setModelName] = useState("");
  const [executionStatus, setExecutionStatus] = useState("completed");
  const [responseContextJson, setResponseContextJson] = useState("{}");
  const [errorMessage, setErrorMessage] = useState("");

  const loadGroundingRuns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadRecentClaudeGroundingRuns();
      setGroundingRuns(rows);
      if (rows.length && !claudeGroundingRunId) {
        setClaudeGroundingRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setGroundingRuns([]);
    } finally {
      setLoading(false);
    }
  }, [claudeGroundingRunId]);

  useEffect(() => {
    loadGroundingRuns();
  }, [loadGroundingRuns]);

  const refreshRun = async (runId) => {
    const [runRow, itemRows] = await Promise.all([
      loadClaudeExecutionRun(runId),
      loadClaudeExecutionItems(runId),
    ]);
    setRun(runRow);
    setItems(itemRows);
  };

  const selectedGrounding = groundingRuns.find((row) => row.id === claudeGroundingRunId);
  const displayQuery =
    items[0]?.query ??
    run?.request_context?.query ??
    selectedGrounding?.query ??
    prepareResult?.requestContext?.query ??
    "";
  const displayModel = run?.model_name ?? modelName;
  const displaySourceCount =
    run?.source_count ?? prepareResult?.sourceCount ?? selectedGrounding?.request_context?.source_count ?? 0;
  const displayStatus =
    executeResult?.executionStatus ??
    storeResult?.executionStatus ??
    run?.execution_status ??
    prepareResult?.executionStatus ??
    null;
  const displayError =
    executeResult?.errorMessage ??
    run?.error_message ??
    items[0]?.error_message ??
    errorMessage ??
    "";
  const preview =
    executeResult?.responsePreview && Object.keys(executeResult.responsePreview).length > 0
      ? executeResult.responsePreview
      : responsePreview(run, items);
  const activeRunId = prepareResult?.claudeExecutionRunId ?? run?.id ?? null;
  const readinessReady = readinessResult?.ready ?? false;
  const canExecute =
    Boolean(activeRunId) &&
    (readinessReady || ["ready", "pending"].includes(displayStatus));

  const handlePrepare = async () => {
    if (!claudeGroundingRunId.trim()) {
      setError("Claude grounding run을 선택해 주세요.");
      return;
    }
    if (!modelName.trim()) {
      setError("Model을 입력해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    setReadinessResult(null);
    setExecuteResult(null);
    setStoreResult(null);
    try {
      const data = await prepareClaudeExecution({
        claudeGroundingRunId: claudeGroundingRunId.trim(),
        modelName: modelName.trim(),
      });
      setPrepareResult(data);
      if (data.claudeExecutionRunId) {
        await refreshRun(data.claudeExecutionRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleCheckReadiness = async () => {
    if (!activeRunId) {
      setError("먼저 Claude 실행을 준비해 주세요.");
      return;
    }
    setCheckingReadiness(true);
    setError("");
    setReadinessResult(null);
    try {
      const data = await checkClaudeGroundedExecutionReadiness(activeRunId);
      setReadinessResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingReadiness(false);
    }
  };

  const handleExecute = async () => {
    if (!activeRunId) {
      setError("먼저 Claude 실행을 준비해 주세요.");
      return;
    }
    setExecuting(true);
    setError("");
    setExecuteResult(null);
    try {
      const data = await runClaudeGroundedExecution(activeRunId);
      setExecuteResult(data);
      await refreshRun(activeRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleStore = async () => {
    const runId = prepareResult?.claudeExecutionRunId ?? run?.id;
    if (!runId) {
      setError("먼저 Claude 실행을 준비해 주세요.");
      return;
    }
    let parsed = {};
    if (executionStatus === "completed") {
      try {
        parsed = JSON.parse(responseContextJson || "{}");
      } catch {
        setError("Response Context JSON 형식이 올바르지 않습니다.");
        return;
      }
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storeClaudeExecutionResult({
        claudeExecutionRunId: runId,
        responseContext: parsed,
        executionStatus,
        errorMessage,
      });
      setStoreResult(data);
      await refreshRun(runId);
    } catch (err) {
      setError(err.message);
    } finally {
      setStoring(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          Claude 실행 준비
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          Grounding 기반 Claude 실행 워크플로만 준비합니다. 외부 API·가짜 응답·API 키 없음.
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
          실행 준비
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Claude Grounding Run
            <select
              value={claudeGroundingRunId}
              onChange={(e) => setClaudeGroundingRunId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {groundingRuns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.query || "(query 없음)"} — {row.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Model
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="예: claude-sonnet-4-20250514"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Claude 실행 준비"}
          </button>
        </div>
      </section>

      {prepareResult || run ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              실행 상태
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Model: {displayModel || "—"}</div>
              <div>Query: {displayQuery || "—"}</div>
              <div>Source Count: {displaySourceCount}</div>
              <div>Execution Status: {statusLabel(displayStatus) || "—"}</div>
              <div>
                Readiness Status:{" "}
                {readinessResult
                  ? readinessResult.ready
                    ? "준비 완료"
                    : "준비 미완료"
                  : "—"}
              </div>
              {displayError ? <div>Error Message: {displayError}</div> : null}
              <div style={{ marginTop: "8px" }}>
                Response Preview:
                <pre
                  style={{
                    margin: "8px 0 0",
                    padding: "12px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "16px" }}>
                {activeRunId ? (
                  <button
                    type="button"
                    style={{ ...S.btn, opacity: checkingReadiness ? 0.6 : 1, maxWidth: "280px" }}
                    disabled={checkingReadiness}
                    onClick={handleCheckReadiness}
                  >
                    {checkingReadiness ? "확인 중…" : "실행 준비 확인"}
                  </button>
                ) : null}
                {canExecute ? (
                  <button
                    type="button"
                    style={{ ...S.btn, opacity: executing ? 0.6 : 1, maxWidth: "280px" }}
                    disabled={executing}
                    onClick={handleExecute}
                  >
                    {executing ? "실행 중…" : "Claude 실행"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {readinessResult?.missingInformation?.length ? (
            <section style={S.card}>
              <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
                Readiness Missing Information
              </h2>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "13px" }}>
                {readinessResult.missingInformation.map((code) => (
                  <li key={code}>{READINESS_MISSING_LABELS[code] ?? code}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {readinessResult?.warningMessages?.length ? (
            <section style={S.card}>
              <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
                Warning Messages
              </h2>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#fbbf24", fontSize: "13px" }}>
                {readinessResult.warningMessages.map((code) => (
                  <li key={code}>{READINESS_WARNING_LABELS[code] ?? code}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {prepareResult?.missingInformation?.length ? (
            <section style={S.card}>
              <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
                Missing Information
              </h2>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "13px" }}>
                {prepareResult.missingInformation.map((code) => (
                  <li key={code}>{missingLabel(code)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={S.card}>
            <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              실행 결과 저장
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Execution Status
                <select
                  value={executionStatus}
                  onChange={(e) => setExecutionStatus(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                >
                  {RUN_STATUSES.filter((s) => s !== "ready").map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              {executionStatus === "completed" ? (
                <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                  Response Context (JSON)
                  <textarea
                    value={responseContextJson}
                    onChange={(e) => setResponseContextJson(e.target.value)}
                    rows={6}
                    style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
                  />
                </label>
              ) : null}
              {executionStatus === "failed" ? (
                <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                  Error Message
                  <input
                    type="text"
                    value={errorMessage}
                    onChange={(e) => setErrorMessage(e.target.value)}
                    style={{ ...S.input, marginTop: "6px" }}
                  />
                </label>
              ) : null}
              <button
                type="button"
                style={{ ...S.btn, opacity: storing ? 0.6 : 1, maxWidth: "280px" }}
                disabled={storing}
                onClick={handleStore}
              >
                {storing ? "저장 중…" : "실행 결과 저장"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
