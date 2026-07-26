import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignmentCloseActionLabel,
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
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S_DARK = {
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
  title: { margin: "0 0 8px", fontSize: "18px", color: "#f8fafc" },
  sub: { margin: "0 0 20px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 },
  body: { display: "grid", gap: "8px", fontSize: "14px", color: "#e2e8f0" },
  muted: { color: "#94a3b8" },
  err: { margin: "0 0 12px", color: "#fca5a5", fontSize: "14px" },
  okLine: { margin: "0 0 6px", color: "#bbf7d0", fontSize: "14px" },
  errLine: { margin: 0, color: "#fecaca", fontSize: "14px" },
  h3: { margin: "0 0 12px", fontSize: "16px", color: "#f8fafc" },
};

const S_LIGHT = {
  card: {
    background: FINAL_UI.surface,
    border: `1px solid ${FINAL_UI.line}`,
    borderRadius: `${FINAL_UI.cardRadius}px`,
    padding: `${FINAL_UI.sectionPadY}px ${FINAL_UI.sectionPadX}px`,
    flex: 1,
  },
  label: {
    display: "block",
    fontSize: `${FINAL_UI.bodySize}px`,
    fontWeight: 600,
    color: FINAL_UI.muted,
    marginBottom: `${FINAL_UI.sectionKMbPx}px`,
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${FINAL_UI.line}`,
    background: FINAL_UI.cream,
    color: FINAL_UI.text,
    fontSize: `${FINAL_UI.bodySize}px`,
    fontFamily: FINAL_UI.sans,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    minHeight: "72px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${FINAL_UI.line}`,
    background: FINAL_UI.cream,
    color: FINAL_UI.text,
    fontSize: `${FINAL_UI.bodySize}px`,
    fontFamily: FINAL_UI.sans,
    boxSizing: "border-box",
    resize: "vertical",
  },
  btn: {
    padding: `${FINAL_UI.actionCtaPadY}px ${FINAL_UI.actionCtaPadX}px`,
    borderRadius: "12px",
    border: "none",
    background: FINAL_UI.ctaGradient,
    color: "#fff",
    fontSize: `${FINAL_UI.actionCtaSize}px`,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FINAL_UI.sans,
  },
  btnMuted: {
    padding: `${FINAL_UI.actionCtaPadY}px ${FINAL_UI.actionCtaPadX}px`,
    borderRadius: "12px",
    border: `1px solid ${FINAL_UI.line}`,
    background: FINAL_UI.surface,
    color: FINAL_UI.text,
    fontSize: `${FINAL_UI.actionCtaSize}px`,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FINAL_UI.sans,
  },
  title: {
    margin: `0 0 ${FINAL_UI.cardHeadGapPx}px`,
    fontSize: `${FINAL_UI.actionTitleSize}px`,
    color: FINAL_UI.navyDeep,
  },
  sub: {
    margin: `0 0 ${FINAL_UI.actionBodyMbPx}px`,
    fontSize: `${FINAL_UI.actionBodySize}px`,
    color: FINAL_UI.muted,
    lineHeight: FINAL_UI.actionBodyLine,
  },
  body: {
    display: "grid",
    gap: `${FINAL_UI.railStackGapPx}px`,
    fontSize: `${FINAL_UI.bodySize}px`,
    color: FINAL_UI.text,
  },
  muted: { color: FINAL_UI.muted },
  err: {
    margin: `0 0 ${FINAL_UI.cardHeadGapPx}px`,
    color: FINAL_UI.coral,
    fontSize: `${FINAL_UI.bodySize}px`,
  },
  okLine: {
    margin: `0 0 ${FINAL_UI.sectionKMbPx}px`,
    color: FINAL_UI.teal,
    fontSize: `${FINAL_UI.bodySize}px`,
  },
  errLine: { margin: 0, color: FINAL_UI.coral, fontSize: `${FINAL_UI.bodySize}px` },
  h3: {
    margin: `0 0 ${FINAL_UI.cardHeadGapPx}px`,
    fontSize: `${FINAL_UI.metricTitleSize}px`,
    color: FINAL_UI.navy,
  },
};

function findPerson(list, id) {
  return (list || []).find((row) => row.id === id) ?? null;
}

export default function AdminAgentAssignmentPanel({
  tone = "dark",
  onWorkspaceMeta = null,
}) {
  const S = tone === "light" ? S_LIGHT : S_DARK;
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
  const [bindingLabel, setBindingLabel] = useState("조회 전");
  const [consentLabel, setConsentLabel] = useState("조회 전");
  const [loadReason, setLoadReason] = useState(null);

  const refreshOptions = useCallback(async () => {
    setLoadingOptions(true);
    setLoadError("");
    setLoadReason(null);
    try {
      const result = await loadAdminAssignmentOptions();
      if (!result.ok) {
        setCustomers([]);
        setAgents([]);
        setLoadReason(result.reason || "OPTIONS_LOAD_FAILED");
        setLoadError(
          result.error_message
            ? `${result.error_message}${result.reason ? ` (${result.reason})` : ""}`
            : `목록을 불러오지 못했습니다.${result.reason ? ` (${result.reason})` : ""}`,
        );
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
    } catch (err) {
      setCustomers([]);
      setAgents([]);
      const msg = err instanceof Error ? err.message : String(err ?? "unknown");
      const reason = /로그인/.test(msg) ? "AUTH_REQUIRED" : "OPTIONS_EXCEPTION";
      setLoadReason(reason);
      setLoadError(`${msg} (${reason})`);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    void refreshOptions();
  }, [refreshOptions]);

  useEffect(() => {
    if (typeof onWorkspaceMeta !== "function") return;
    const pickCustomer = findPerson(customers, customerId);
    const pickAgent = findPerson(agents, agentUserId);
    onWorkspaceMeta({
      assignmentId,
      status,
      customerLabel:
        customerLabel ||
        (pickCustomer ? formatAssignmentOptionLabel(pickCustomer) : ""),
      agentLabel:
        agentLabel || (pickAgent ? formatAssignmentOptionLabel(pickAgent) : ""),
      resultLines,
      errorMessage,
      loadError,
      loadReason,
      bindingLabel,
      consentLabel,
      customersCount: customers.length,
      agentsCount: agents.length,
      loadingOptions,
    });
  }, [
    onWorkspaceMeta,
    assignmentId,
    status,
    customerLabel,
    agentLabel,
    customerId,
    agentUserId,
    customers,
    agents,
    resultLines,
    errorMessage,
    loadError,
    loadReason,
    bindingLabel,
    consentLabel,
    loadingOptions,
  ]);

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
          source_status: action === "close" ? status : null,
        }),
      );
      if (result.binding_created === true) {
        setBindingLabel("연결됨");
        setConsentLabel("동의 확인됨");
      } else if (result.binding_skipped_no_consent === true) {
        setBindingLabel("미연결");
        setConsentLabel("동의 없음 · 연결 보류");
      } else if (action === "close") {
        setBindingLabel("종료 후 확인");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-admin-assignment-load-reason={loadReason || ""}
      data-admin-assignment-customers={String(customers.length)}
      data-admin-assignment-agents={String(agents.length)}
      data-admin-assignment-loading={loadingOptions ? "1" : "0"}
      style={{
        fontFamily: tone === "light" ? FINAL_UI.sans : FONT,
        display: "flex",
        flexDirection: "column",
        gap: tone === "light" ? `${FINAL_UI.railStackGapPx}px` : "16px",
        flex: tone === "light" ? 1 : undefined,
        minHeight: tone === "light" ? 0 : undefined,
      }}
    >
      <div style={S.card}>
        <h2 style={S.title}>설계사 배정 관리</h2>
        <p style={S.sub}>
          고객과 설계사를 선택한 뒤 대기 배정을 만들고, 활성화하거나 종료합니다.
        </p>

        {loadError ? <p style={S.err}>{loadError}</p> : null}

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
          <h3 style={S.h3}>현재 배정</h3>
          <div style={S.body}>
            <div>
              <span style={S.muted}>고객 · </span>
              {customerLabel || "—"}
            </div>
            <div>
              <span style={S.muted}>설계사 · </span>
              {agentLabel || "—"}
            </div>
            <div>
              <span style={S.muted}>현재 상태 · </span>
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
                  {assignmentCloseActionLabel("pending")}
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
                {assignmentCloseActionLabel("active")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {resultLines.length > 0 ? (
        <div
          style={{
            ...S.card,
            borderColor: tone === "light" ? "rgba(15, 138, 122, 0.35)" : "rgba(52, 211, 153, 0.35)",
          }}
        >
          {resultLines.map((line) => (
            <p key={line} style={S.okLine}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <div
          style={{
            ...S.card,
            borderColor: tone === "light" ? "rgba(232, 106, 74, 0.4)" : "rgba(248, 113, 113, 0.4)",
          }}
        >
          <p style={S.errLine}>{errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
