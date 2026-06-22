import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import { supabase } from "../lib/supabase.js";
import { buildLifeguardHomeGreeting } from "../lib/lifeguardGreeting.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

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

export default function LifeguardHomeChat({ layer1Only = true, disabled = false, displayName: displayNameProp }) {
  const session = useOptionalCustomerSession();
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const displayName =
    displayNameProp ??
    session?.dashboardData?.displayName ??
    session?.unifiedState?.profile?.display_name ??
    "고객";
  const policyCount = session?.unifiedState?.policy_count ?? session?.dashboardData?.insurancePolicyCount ?? 0;
  const documentCount = session?.unifiedState?.document_count ?? 0;
  const loadingSession = Boolean(session?.loading);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelView, setPanelView] = useState("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attachHint, setAttachHint] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(() => `thread-${Date.now()}`);

  const greeting = useMemo(
    () => buildLifeguardHomeGreeting(displayName, session?.unifiedState),
    [displayName, session?.unifiedState],
  );
  const isDisabled = disabled || loadingSession;

  const focusChatInput = () => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  useEffect(() => {
    if (panelView === "chat") focusChatInput();
  }, [panelView]);

  useEffect(() => {
    if (panelView === "chat" && !loading) focusChatInput();
  }, [loading, panelView]);

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
      setThreads((prev) => {
        const preview = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
        return [{ id: threadId, preview }, ...prev.filter((t) => t.id !== threadId)].slice(0, 12);
      });
    } catch (err) {
      setError(toCustomerErrorMessage(err, "질문에 답변하지 못했습니다."));
    } finally {
      setLoading(false);
      focusChatInput();
    }
  };

  const startNewChat = () => {
    setThreadId(`thread-${Date.now()}`);
    setMessages([]);
    setInput("");
    setError("");
    setPanelView("chat");
    setSidebarOpen(false);
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
                  style={sidebarBtn(false)}
                  onClick={() => {
                    setThreadId(thread.id);
                    setPanelView("chat");
                    setSidebarOpen(false);
                  }}
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
            <LayerPanel title="내 보험" onBack={() => setPanelView("chat")}>
              {policyCount > 0
                ? "등록된 보험이 있어요. 궁금한 점은 대화로 물어보시면 같이 볼게요."
                : "아직 등록된 보험이 없어요. 필요하면 대화에서 편하게 말씀해 주세요."}
            </LayerPanel>
          ) : null}

          {panelView === "documents" ? (
            <LayerPanel title="내 문서" onBack={() => setPanelView("chat")}>
              {documentCount > 0
                ? "업로드된 문서가 있어요. 대화에서 \"이 문서 봐줘\"처럼 말씀해 주세요."
                : "아직 문서가 없어요. 필요할 때 대화로 알려 주세요."}
            </LayerPanel>
          ) : null}

          {panelView === "settings" ? (
            <LayerPanel title="설정" onBack={() => setPanelView("chat")}>
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
                disabled={isDisabled}
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
