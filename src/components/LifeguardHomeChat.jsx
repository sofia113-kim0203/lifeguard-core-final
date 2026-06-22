import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { listDocuments } from "../lib/customerDocuments.js";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import {
  activeSessionStorageKey,
  createLifeguardSessionId,
  listLifeguardRecentSessions,
  loadLifeguardSessionMessages,
  persistLifeguardChatTurn,
} from "../lib/lifeguardChatSessions.js";
import { supabase } from "../lib/supabase.js";
import { buildLifeguardHomeGreeting } from "../lib/lifeguardGreeting.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  formatDocClass,
  formatIngestStatus,
  formatUploadDate,
  toCustomerErrorMessage,
} from "../lib/uiLocale.js";

const EXAMPLE_QUESTIONS = [
  "보험료 너무 비싼가?",
  "암보험 부족한가?",
  "대장 선종 제거했는데 보험금 받을 수 있나?",
  "분당에서 가족이랑 갈 만한 곳 추천해줘",
];

function sidebarBtn(active) {
  return {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "none",
    background: active ? "#EFEFEB" : "transparent",
    color: active ? LG.text : LG.textMuted,
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontFamily: LG.sans,
  };
}

function LayerPanel({ title, children, onBack }) {
  return (
    <div style={{ padding: "8px 0" }}>
      <button type="button" onClick={onBack} style={{ ...sidebarBtn(false), width: "auto", marginBottom: "20px" }}>
        ← 대화로 돌아가기
      </button>
      <h3 style={{ margin: "0 0 12px", color: LG.text, fontSize: "18px", fontWeight: 600 }}>{title}</h3>
      <div style={{ color: LG.textMuted, fontSize: "15px", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function formatAnalysisComplete(document) {
  const extractionStatus = document?.metadata_json?.policy_extraction_status;
  if (document?.ingest_status === "ready" && extractionStatus === "completed") {
    return "분석 완료";
  }
  if (extractionStatus === "extraction_failed") return "분석 실패";
  if (extractionStatus === "pending_manual_review") return "검토 대기";
  if (document?.ingest_status === "ready") return "분석 진행 중";
  return "대기";
}

function formatOcrStatus(document) {
  if (document?.ingest_status === "ready") return "OCR 완료";
  return formatIngestStatus(document?.ingest_status);
}

function formatMonthlyPremium(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  return `월 ${Math.round(numeric).toLocaleString("ko-KR")}원`;
}

function listCardStyle() {
  return {
    border: `1px solid ${LG.border}`,
    borderRadius: "10px",
    padding: "14px 16px",
    background: LG.surface,
  };
}

function CustomerInsuranceList({ policies, loading }) {
  if (loading) {
    return <p style={{ margin: 0, color: LG.textMuted }}>보험 정보를 불러오는 중…</p>;
  }
  if (!policies.length) {
    return (
      <p style={{ margin: 0, color: LG.textMuted }}>
        아직 등록된 보험이 없어요. 필요하면 대화에서 편하게 말씀해 주세요.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {policies.map((policy) => (
        <div key={policy.id} style={listCardStyle()}>
          <div style={{ fontWeight: 600, color: LG.text, marginBottom: "6px" }}>
            {policy.insurer_name ?? "—"}
          </div>
          {policy.product_name ? (
            <div style={{ fontSize: "14px", color: LG.textMuted, marginBottom: "4px" }}>{policy.product_name}</div>
          ) : null}
          <div style={{ display: "grid", gap: "4px", fontSize: "14px", color: LG.textMuted }}>
            <div>{formatMonthlyPremium(policy.monthly_premium)}</div>
            <div>상태: {policy.is_active ? "active" : policy.policy_status ?? "—"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CustomerDocumentsList({ documents, loading, error }) {
  if (loading) {
    return <p style={{ margin: 0, color: LG.textMuted }}>문서를 불러오는 중…</p>;
  }
  if (error) {
    return <p style={{ margin: 0, color: "#B91C1C" }}>{error}</p>;
  }
  if (documents.length === 0) {
    return <p style={{ margin: 0, color: LG.textMuted }}>아직 업로드된 문서가 없어요</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {documents.map((document) => (
        <div key={document.id} style={listCardStyle()}>
          <div style={{ fontWeight: 600, color: LG.text, marginBottom: "8px", wordBreak: "break-all" }}>
            {document.original_filename ?? "—"}
          </div>
          <div style={{ display: "grid", gap: "4px", fontSize: "14px", color: LG.textMuted }}>
            <div>문서 유형: {formatDocClass(document.doc_class)}</div>
            <div>업로드일: {formatUploadDate(document.created_at)}</div>
            <div>OCR: {formatOcrStatus(document)}</div>
            <div>분석: {formatAnalysisComplete(document)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LifeguardHomeChat({ layer1Only = true, disabled = false, displayName: displayNameProp }) {
  const session = useOptionalCustomerSession();
  const authUser = session?.user ?? null;
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const focusTimerRef = useRef(null);
  const displayName =
    displayNameProp ??
    session?.dashboardData?.displayName ??
    session?.unifiedState?.profile?.display_name ??
    "고객";
  const policies = session?.unifiedState?.policies ?? [];
  const customerId = session?.dashboardData?.customerId ?? session?.unifiedState?.customer_id ?? null;
  const loadingSession = Boolean(session?.loading);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelView, setPanelView] = useState("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attachHint, setAttachHint] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [sessionId, setSessionId] = useState(() => createLifeguardSessionId());
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");

  const greeting = useMemo(
    () => buildLifeguardHomeGreeting(displayName, session?.unifiedState),
    [displayName, session?.unifiedState],
  );
  const isDisabled = disabled || loadingSession;

  const focusChatInput = useCallback(() => {
    if (focusTimerRef.current) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    window.requestAnimationFrame(() => {
      focusTimerRef.current = window.setTimeout(() => {
        const el = inputRef.current;
        if (!el || el.disabled || el.readOnly) return;
        el.focus({ preventScroll: false });
        const len = el.value?.length ?? 0;
        try {
          el.setSelectionRange(len, len);
        } catch {
          // ignore selection errors on unsupported inputs
        }
      }, 0);
    });
  }, []);

  useEffect(() => () => {
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
  }, []);

  const goBackToChat = useCallback(() => {
    setPanelView("chat");
    setSidebarOpen(false);
    focusChatInput();
  }, [focusChatInput]);

  useEffect(() => {
    if (panelView === "chat") focusChatInput();
  }, [panelView, focusChatInput]);

  useEffect(() => {
    if (panelView === "chat" && !loading) focusChatInput();
  }, [loading, panelView, messages.length, focusChatInput]);

  useEffect(() => {
    if (panelView !== "documents" || !authUser) return undefined;
    let cancelled = false;
    setDocumentsLoading(true);
    setDocumentsError("");
    listDocuments(authUser, { categoryKey: "all" })
      .then((result) => {
        if (cancelled) return;
        setDocuments(result.documents ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setDocuments([]);
        setDocumentsError(toCustomerErrorMessage(err, "문서 목록을 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panelView, authUser]);

  useEffect(() => {
    if (!authUser || !customerId || loadingSession) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        if (cancelled) return;
        setThreads(recent);

        const storageKey = activeSessionStorageKey(customerId);
        const storedSessionId = window.sessionStorage.getItem(storageKey);
        const activeId = storedSessionId ?? createLifeguardSessionId();
        setSessionId(activeId);
        window.sessionStorage.setItem(storageKey, activeId);

        if (storedSessionId && recent.some((entry) => entry.id === storedSessionId)) {
          const restored = await loadLifeguardSessionMessages(authUser, storedSessionId, { customerId });
          if (!cancelled) setMessages(restored);
        }
      } catch (err) {
        if (!cancelled) {
          setError(toCustomerErrorMessage(err, "대화 기록을 불러오지 못했습니다."));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser, customerId, loadingSession]);

  const openSession = useCallback(
    async (targetSessionId) => {
      setPanelView("chat");
      setSidebarOpen(false);
      if (!authUser || !customerId) {
        focusChatInput();
        return;
      }

      setSessionId(targetSessionId);
      setError("");
      window.sessionStorage.setItem(activeSessionStorageKey(customerId), targetSessionId);

      try {
        const restored = await loadLifeguardSessionMessages(authUser, targetSessionId, { customerId });
        setMessages(restored);
      } catch (err) {
        setMessages([]);
        setError(toCustomerErrorMessage(err, "대화를 불러오지 못했습니다."));
      } finally {
        focusChatInput();
      }
    },
    [authUser, customerId, focusChatInput],
  );

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || isDisabled || loading) return;

    setPanelView("chat");
    setSidebarOpen(false);
    const userMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    focusChatInput();
    setLoading(true);
    setError("");

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      const result = await fetchHomeBrainFact(trimmed, history);
      const assistantMessage = { role: "assistant", content: result.answerText };
      setMessages([...nextMessages, assistantMessage]);

      if (authUser && customerId) {
        await persistLifeguardChatTurn(authUser, {
          sessionId,
          customerId,
          userMessage: trimmed,
          assistantMessage: result.answerText,
        });
        window.sessionStorage.setItem(activeSessionStorageKey(customerId), sessionId);
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        setThreads(recent);
      }
    } catch (err) {
      setError(toCustomerErrorMessage(err, "질문에 답변하지 못했습니다."));
    } finally {
      setLoading(false);
      focusChatInput();
    }
  };

  const startNewChat = () => {
    const newSessionId = createLifeguardSessionId();
    setSessionId(newSessionId);
    setMessages([]);
    setInput("");
    setError("");
    setPanelView("chat");
    setSidebarOpen(false);
    if (customerId) {
      window.sessionStorage.setItem(activeSessionStorageKey(customerId), newSessionId);
    }
    focusChatInput();
  };

  const handleAttachClick = () => {
    setAttachHint("문서는 대화에서 편하게 말씀해 주세요. 예: \"이 증권 봐줘\"");
    window.setTimeout(() => setAttachHint(""), 4000);
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: LG.sans,
        background: LG.bg,
        color: LG.text,
      }}
    >
      {sidebarOpen ? (
        <>
          <div
            role="presentation"
            onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.18)", zIndex: 20 }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: "280px",
              zIndex: 30,
              borderRight: `1px solid ${LG.border}`,
              background: LG.sidebarBg,
              padding: "20px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              boxShadow: "4px 0 24px rgba(0,0,0,0.06)",
            }}
          >
            <button type="button" onClick={startNewChat} style={sidebarBtn(false)}>
              새 대화
            </button>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: LG.textSoft,
                marginTop: "16px",
                marginBottom: "4px",
                letterSpacing: "0.08em",
              }}
            >
              최근 대화
            </div>
            {threads.length === 0 ? (
              <div style={{ fontSize: "13px", color: LG.textSoft, padding: "8px 12px" }}>아직 대화가 없어요</div>
            ) : (
              threads.slice(0, 8).map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  style={sidebarBtn(sessionId === thread.id)}
                  onClick={() => openSession(thread.id)}
                >
                  {thread.preview}
                </button>
              ))
            )}
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              <button type="button" style={sidebarBtn(panelView === "insurance")} onClick={() => setPanelView("insurance")}>
                내 보험
              </button>
              <button type="button" style={sidebarBtn(panelView === "documents")} onClick={() => setPanelView("documents")}>
                내 문서
              </button>
              <button type="button" style={sidebarBtn(panelView === "settings")} onClick={() => setPanelView("settings")}>
                설정
              </button>
              <button
                type="button"
                style={{ ...sidebarBtn(false), marginTop: "8px", color: LG.textMuted }}
                onClick={() => supabase.auth.signOut()}
              >
                로그아웃
              </button>
            </div>
          </aside>
        </>
      ) : null}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 20px",
            borderBottom: `1px solid ${LG.border}`,
            background: LG.bg,
          }}
        >
          <button
            type="button"
            aria-label="메뉴"
            onClick={() => setSidebarOpen(true)}
            style={{
              border: `1px solid ${LG.border}`,
              background: LG.surface,
              color: LG.text,
              borderRadius: "8px",
              width: "40px",
              height: "40px",
              cursor: "pointer",
              fontSize: "18px",
            }}
          >
            ☰
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 20px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            maxWidth: "720px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          {panelView === "insurance" ? (
            <LayerPanel title="내 보험" onBack={goBackToChat}>
              <CustomerInsuranceList policies={policies} loading={loadingSession} />
            </LayerPanel>
          ) : null}

          {panelView === "documents" ? (
            <LayerPanel title="내 문서" onBack={goBackToChat}>
              <CustomerDocumentsList documents={documents} loading={documentsLoading} error={documentsError} />
            </LayerPanel>
          ) : null}

          {panelView === "settings" ? (
            <LayerPanel title="설정" onBack={goBackToChat}>
              <p style={{ margin: 0 }}>{displayName}님으로 사용 중이에요.</p>
            </LayerPanel>
          ) : null}

          {panelView === "chat" && messages.length === 0 ? (
            <div style={{ marginTop: "10vh", textAlign: "center" }}>
              <div
                style={{
                  fontFamily: LG.serif,
                  fontSize: "clamp(28px, 6vw, 36px)",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  color: LG.text,
                  marginBottom: "28px",
                }}
              >
                {greeting.title}
              </div>
              {greeting.lines.map((line) => (
                <p
                  key={line}
                  style={{
                    margin: "0 0 6px",
                    fontSize: "17px",
                    lineHeight: 1.65,
                    color: LG.text,
                    fontWeight: line.includes("반가워") || line.includes("도와") ? 400 : 400,
                  }}
                >
                  {line}
                </p>
              ))}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  justifyContent: "center",
                  marginTop: "32px",
                }}
              >
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={isDisabled || loading}
                    onClick={() => submitQuestion(example)}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "999px",
                      border: `1px solid ${LG.chipBorder}`,
                      background: LG.chipBg,
                      color: LG.textMuted,
                      fontSize: "13px",
                      lineHeight: 1.45,
                      cursor: "pointer",
                      fontFamily: LG.sans,
                      maxWidth: "280px",
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {panelView === "chat"
            ? messages.map((msg, index) => (
                <div
                  key={`${index}-${msg.role}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    padding: msg.role === "user" ? "14px 0 6px" : "6px 0 22px",
                  }}
                >
                  <div
                    style={{
                      maxWidth: msg.role === "user" ? "88%" : "92%",
                      textAlign: msg.role === "user" ? "right" : "left",
                      color: LG.text,
                      fontSize: msg.role === "user" ? "15px" : "16px",
                      fontWeight: msg.role === "user" ? 400 : 450,
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            : null}

          {loading && panelView === "chat" ? (
            <div
              style={{
                alignSelf: "flex-start",
                color: LG.textMuted,
                fontSize: "15px",
                lineHeight: 1.75,
                fontWeight: 400,
                padding: "6px 0 16px",
              }}
            >
              답변 중…
            </div>
          ) : null}
        </div>

        {panelView === "chat" ? (
          <div
            style={{
              padding: "12px 20px 28px",
              borderTop: `1px solid ${LG.border}`,
              maxWidth: "720px",
              width: "100%",
              margin: "0 auto",
              background: LG.bg,
            }}
          >
            {error ? <div style={{ color: "#B91C1C", fontSize: "13px", marginBottom: "8px" }}>{error}</div> : null}
            {attachHint ? (
              <div style={{ color: LG.textMuted, fontSize: "13px", marginBottom: "8px" }}>{attachHint}</div>
            ) : null}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                borderRadius: "24px",
                border: `1px solid ${LG.borderStrong}`,
                background: LG.surface,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <input ref={fileInputRef} type="file" hidden onChange={() => setAttachHint("")} />
              <button
                type="button"
                aria-label="첨부"
                onClick={handleAttachClick}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: LG.textMuted,
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontFamily: LG.sans,
                }}
              >
                첨부
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                readOnly={false}
                disabled={isDisabled}
                aria-label="질문 입력"
                placeholder="무엇이든 편하게 물어보세요"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion(input);
                  }
                }}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  color: LG.text,
                  fontSize: "15px",
                  fontFamily: LG.sans,
                  outline: "none",
                  minWidth: 0,
                  resize: "none",
                  lineHeight: 1.5,
                  padding: "6px 0",
                  maxHeight: "120px",
                }}
              />
              <button
                type="button"
                disabled={isDisabled || loading || !input.trim()}
                onClick={() => submitQuestion(input)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: input.trim() ? LG.text : LG.textSoft,
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: input.trim() ? "pointer" : "default",
                  fontFamily: LG.sans,
                  padding: "6px 8px",
                }}
              >
                보내기
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
