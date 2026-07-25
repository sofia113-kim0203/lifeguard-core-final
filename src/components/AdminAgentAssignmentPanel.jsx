import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignmentStatusLabelKo,
  buildActivateBody,
  buildAlignedCreatePendingFromOptionIds,
  buildCloseBody,
  canActivateAssignment,
  canCloseAssignment,
  canCreatePendingAssignment,
  formatAssignmentOptionLabel,
  loadAdminAssignmentOptions,
  loadAdminLiveAssignments,
  mapAssignmentSuccessLines,
  pickRehydratableLiveAssignment,
  postAdminAssignmentAction,
} from "../lib/adminAgentAssignment.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: "8px",
  },
  select: {
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
  textarea: {
    width: "100%",
    minHeight: "72px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
    resize: "vertical",
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
  btnMuted: {
    padding: "12px 20px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    background: "rgba(15, 23, 42, 0.55)",
    color: "#e2e8f0",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};

function findPerson(list, id) {
  return (list || []).find((row) => row.id === id) ?? null;
}

export default function AdminAgentAssignmentPanel() {
  const [customers, setCustomers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [customerId, setCustomerId] = useState("");
  const [agentUserId, setAgentUserId] = useState("");
  const [notes, setNotes] = useState("");

  const [assignmentId, setAssignmentId] = useState(null);
  const [status, setStatus] = useState(null);
  const [customerLabel, setCustomerLabel] = useState("");
  const [agentLabel, setAgentLabel] = useState("");
  const [resultLines, setResultLines] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshOptions = useCallback(async () => {
    setLoadingOptions(true);
    setLoadError("");
    const result = await loadAdminAssignmentOptions();
    if (!result.ok) {
      setCustomers([]);
      setAgents([]);
      setLoadError(result.error_message || "목록을 불러오지 못했습니다.");
      setLoadingOptions(false);
      return;
    }
    setCustomers(result.customers);
    setAgents(result.agents);

    // Rehydrate from server live rows — do not rely only on create response state.
    const live = await loadAdminLiveAssignments();
    if (live.ok) {
      const row = pickRehydratableLiveAssignment(live.assignments);
      if (row?.id) {
        setAssignmentId(row.id);
        setStatus(row.status ?? null);
        setCustomerId(row.customer?.id || "");
        setAgentUserId(row.agent?.id || "");
        setCustomerLabel(formatAssignmentOptionLabel(row.customer || {}));
        setAgentLabel(formatAssignmentOptionLabel(row.agent || {}));
      }
    }
    setLoadingOptions(false);
  }, []);

  useEffect(() => {
    void refreshOptions();
  }, [refreshOptions]);

  const selectedCustomer = useMemo(
    () => findPerson(customers, customerId),
    [customers, customerId],
  );
  const selectedAgent = useMemo(
    () => findPerson(agents, agentUserId),
    [agents, agentUserId],
  );

  const createEnabled = canCreatePendingAssignment({
    customerId,
    agentUserId,
    busy,
  });
  const activateEnabled = canActivateAssignment({
    assignmentId,
    status,
    busy,
  });
  const closeEnabled = canCloseAssignment({
    assignmentId,
    status,
    busy,
  });

  async function runAction(action) {
    if (busy) return;
    if (action === "create_pending" && !createEnabled) return;
    if (action === "activate" && !activateEnabled) return;
    if (action === "close" && !closeEnabled) return;
    if (
      action !== "create_pending" &&
      action !== "activate" &&
      action !== "close"
    ) {
      return;
    }

    setBusy(true);
    setErrorMessage("");
    setResultLines([]);

    try {
      let body = null;
      if (action === "create_pending") {
        body = buildAlignedCreatePendingFromOptionIds({
          customerId,
          agentUserId,
          notes,
          customers,
          agents,
        });
        if (!body) {
          setErrorMessage("고객·설계사 식별이 목록과 일치하지 않아 등록하지 않았습니다.");
          return;
        }
      } else if (action === "activate") {
        body = buildActivateBody({ assignmentId });
      } else {
        body = buildCloseBody({ assignmentId });
      }

      const result = await postAdminAssignmentAction(body);
      if (!result.ok) {
        console.warn("[admin-assignment]", result.reason ?? "failed");
        setErrorMessage(result.error_message || "요청에 실패했습니다.");
        return;
      }

      const nextStatus = result.assignment?.status ?? null;
      const nextId = result.assignment?.id ?? assignmentId;
      setAssignmentId(nextId || null);
      setStatus(nextStatus);
      if (action === "create_pending") {
        setCustomerLabel(formatAssignmentOptionLabel(selectedCustomer || {}));
        setAgentLabel(formatAssignmentOptionLabel(selectedAgent || {}));
      }
      setResultLines(
        mapAssignmentSuccessLines({
          action,
          binding_created: result.binding_created,
          binding_skipped_no_consent: result.binding_skipped_no_consent,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={S.card}>
        <h2 style={{ margin: "0 0 8px", fontSize: "18px", color: "#f8fafc" }}>
          설계사 배정 관리
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
          고객과 설계사를 선택한 뒤 대기 배정을 만들고, 활성화하거나 종료합니다.
        </p>

        {loadError ? (
          <p style={{ margin: "0 0 12px", color: "#fca5a5", fontSize: "14px" }}>{loadError}</p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={S.label} htmlFor="admin-assign-customer">
              고객
            </label>
            <select
              id="admin-assign-customer"
              style={S.select}
              value={customerId}
              disabled={loadingOptions || busy}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">
                {loadingOptions ? "목록 불러오는 중…" : "고객을 선택하세요"}
              </option>
              {customers.map((row) => (
                <option key={row.id} value={row.id}>
                  {formatAssignmentOptionLabel(row)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={S.label} htmlFor="admin-assign-agent">
              담당 설계사
            </label>
            <select
              id="admin-assign-agent"
              style={S.select}
              value={agentUserId}
              disabled={loadingOptions || busy}
              onChange={(e) => setAgentUserId(e.target.value)}
            >
              <option value="">
                {loadingOptions ? "목록 불러오는 중…" : "설계사를 선택하세요"}
              </option>
              {agents.map((row) => (
                <option key={row.id} value={row.id}>
                  {formatAssignmentOptionLabel(row)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={S.label} htmlFor="admin-assign-notes">
              관리 메모
            </label>
            <textarea
              id="admin-assign-notes"
              style={S.textarea}
              value={notes}
              disabled={busy}
              placeholder="선택 입력"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div>
            <button
              type="button"
              style={{
                ...S.btn,
                opacity: createEnabled ? 1 : 0.45,
                cursor: createEnabled ? "pointer" : "not-allowed",
              }}
              disabled={!createEnabled}
              onClick={() => void runAction("create_pending")}
            >
              대기 배정 생성
            </button>
          </div>
        </div>
      </div>

      {assignmentId && status ? (
        <div style={S.card}>
          <h3 style={{ margin: "0 0 12px", fontSize: "16px", color: "#f8fafc" }}>
            현재 배정
          </h3>
          <div style={{ display: "grid", gap: "8px", fontSize: "14px", color: "#e2e8f0" }}>
            <div>
              <span style={{ color: "#94a3b8" }}>고객 · </span>
              {customerLabel || "—"}
            </div>
            <div>
              <span style={{ color: "#94a3b8" }}>설계사 · </span>
              {agentLabel || "—"}
            </div>
            <div>
              <span style={{ color: "#94a3b8" }}>현재 상태 · </span>
              {assignmentStatusLabelKo(status)}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "18px" }}>
            {status === "pending" ? (
              <>
                <button
                  type="button"
                  style={{
                    ...S.btn,
                    opacity: activateEnabled ? 1 : 0.45,
                    cursor: activateEnabled ? "pointer" : "not-allowed",
                  }}
                  disabled={!activateEnabled}
                  onClick={() => void runAction("activate")}
                >
                  활성화
                </button>
                <button
                  type="button"
                  style={{
                    ...S.btnMuted,
                    opacity: closeEnabled ? 1 : 0.45,
                    cursor: closeEnabled ? "pointer" : "not-allowed",
                  }}
                  disabled={!closeEnabled}
                  onClick={() => void runAction("close")}
                >
                  종료
                </button>
              </>
            ) : null}
            {status === "active" ? (
              <button
                type="button"
                style={{
                  ...S.btnMuted,
                  opacity: closeEnabled ? 1 : 0.45,
                  cursor: closeEnabled ? "pointer" : "not-allowed",
                }}
                disabled={!closeEnabled}
                onClick={() => void runAction("close")}
              >
                배정 종료
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {resultLines.length > 0 ? (
        <div style={{ ...S.card, borderColor: "rgba(52, 211, 153, 0.35)" }}>
          {resultLines.map((line) => (
            <p key={line} style={{ margin: "0 0 6px", color: "#bbf7d0", fontSize: "14px" }}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <div style={{ ...S.card, borderColor: "rgba(248, 113, 113, 0.4)" }}>
          <p style={{ margin: 0, color: "#fecaca", fontSize: "14px" }}>{errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
