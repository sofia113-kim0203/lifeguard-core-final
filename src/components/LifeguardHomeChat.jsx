import { useMemo, useState } from "react";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import { supabase } from "../lib/supabase.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';
const SERIF = 'var(--font-serif, "Playfair Display", Georgia, "Times New Roman", serif)';

const EXAMPLE_QUESTIONS = ["분당 맛집 알려줘", "너 누구야?", "암보험 부족해?"];

const TEAL = "#0d9488";
const TEAL_HOVER = "#0f766e";

function pickGreeting(displayName = "고객") {
  const hour = new Date().getHours();
  const pool = [
    `${displayName}님, 오늘 뭐든 편하게 말해 주세요.`,
    `안녕하세요. 저는 LIFEGUARD예요 — 궁금한 걸 편하게 물어보세요.`,
    `${displayName}님, 가벼운 얘기부터 진지한 얘기까지 같이 볼게요.`,
  ];
  if (hour < 12) return pool[1];
  if (hour < 18) return pool[0];
  return pool[2];
}

function sidebarBtnStyle(active) {
  return {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: "10px",
    border: active ? "1px solid rgba(13, 148, 136, 0.35)" : "1px solid rgba(148, 163, 184, 0.12)",
    background: active ? "rgba(13, 148, 136, 0.12)" : "rgba(30, 41, 59, 0.55)",
    color: active ? "#99f6e4" : "#cbd5e1",
    fontSize: "13px",
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    fontFamily: FONT,
  };
}

function LayerPanel({ title, children, onBack }) {
  return (
    <div style={{ padding: "8px 0" }}>
      <button type="button" onClick={onBack} style={{ ...sidebarBtnStyle(false), width: "auto", marginBottom: "16px" }}>
        ← 대화로 돌아가기
      </button>
      <h3 style={{ margin: "0 0 12px", color: "#e2e8f0", fontSize: "18px" }}>{title}</h3>
      <div style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

export default function LifeguardHomeChat({ layer1Only = true, disabled = false, displayName: displayNameProp }) {
  const session = useOptionalCustomerSession();
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
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(() => `thread-${Date.now()}`);

  const greeting = useMemo(() => pickGreeting(displayName), [displayName]);
  const isDisabled = disabled || loadingSession;

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || isDisabled || loading) return;

    setPanelView("chat");
    const userMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
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

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: FONT,
        background: "linear-gradient(145deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
        color: "#e2e8f0",
      }}
    >
      {sidebarOpen ? (
        <aside
          style={{
            width: "240px",
            flexShrink: 0,
            borderRight: "1px solid rgba(148, 163, 184, 0.12)",
            background: "rgba(15, 23, 42, 0.92)",
            padding: "20px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <button type="button" onClick={startNewChat} style={sidebarBtnStyle(panelView === "chat" && messages.length === 0)}>
            새 대화
          </button>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", marginTop: "10px", letterSpacing: "0.06em" }}>
            최근
          </div>
          {threads.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#64748b", padding: "6px 4px" }}>아직 대화가 없어요</div>
          ) : (
            threads.slice(0, 8).map((thread) => (
              <button key={thread.id} type="button" style={sidebarBtnStyle(false)} onClick={() => { setThreadId(thread.id); setPanelView("chat"); }}>
                {thread.preview}
              </button>
            ))
          )}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
            <button type="button" style={sidebarBtnStyle(panelView === "insurance")} onClick={() => setPanelView("insurance")}>
              내 보험
            </button>
            <button type="button" style={sidebarBtnStyle(panelView === "documents")} onClick={() => setPanelView("documents")}>
              내 문서
            </button>
            <button type="button" style={sidebarBtnStyle(panelView === "settings")} onClick={() => setPanelView("settings")}>
              설정
            </button>
          </div>
        </aside>
      ) : null}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
          }}
        >
          <button
            type="button"
            aria-label="메뉴"
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.2)",
              background: "rgba(15, 23, 42, 0.6)",
              color: "#e2e8f0",
              borderRadius: "10px",
              width: "40px",
              height: "40px",
              cursor: "pointer",
              fontSize: "18px",
            }}
          >
            ☰
          </button>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: "22px", fontWeight: 700, letterSpacing: "0.04em", color: "#f8fafc" }}>
              LIFEGUARD
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>당신의 보험을 이해하는 AI</div>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px 20px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            maxWidth: "760px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          {panelView === "insurance" ? (
            <LayerPanel title="내 보험" onBack={() => setPanelView("chat")}>
              {policyCount > 0
                ? `지금 등록된 보험 정보가 있어요. 궁금한 점은 대화로 물어보시면 같이 볼게요.`
                : `아직 등록된 보험이 없어요. 증권이나 보장내역서를 올리면 더 정확히 도와드릴 수 있어요.`}
            </LayerPanel>
          ) : null}

          {panelView === "documents" ? (
            <LayerPanel title="내 문서" onBack={() => setPanelView("chat")}>
              {documentCount > 0
                ? `업로드된 문서가 있어요. 필요하면 대화에서 "이 문서 봐줘"처럼 편하게 말해 주세요.`
                : `아직 업로드된 문서가 없어요. 보장내역서나 증권을 올리면 도움이 돼요.`}
            </LayerPanel>
          ) : null}

          {panelView === "settings" ? (
            <LayerPanel title="설정" onBack={() => setPanelView("chat")}>
              <p style={{ margin: "0 0 12px" }}>{displayName}님으로 사용 중이에요.</p>
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                style={{ ...sidebarBtnStyle(false), width: "auto" }}
              >
                로그아웃
              </button>
            </LayerPanel>
          ) : null}

          {panelView === "chat" && messages.length === 0 ? (
            <div style={{ marginTop: "12vh", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.65, color: "#e2e8f0", maxWidth: "520px", marginInline: "auto" }}>
                {greeting}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: "24px" }}>
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={isDisabled || loading}
                    onClick={() => submitQuestion(example)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "999px",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                      background: "rgba(15, 23, 42, 0.55)",
                      color: "#cbd5e1",
                      fontSize: "13px",
                      cursor: "pointer",
                      fontFamily: FONT,
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
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    padding: "12px 16px",
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: msg.role === "user" ? "rgba(13, 148, 136, 0.2)" : "rgba(30, 41, 59, 0.75)",
                    border: `1px solid ${msg.role === "user" ? "rgba(13, 148, 136, 0.35)" : "rgba(148, 163, 184, 0.15)"}`,
                    color: "#e2e8f0",
                    fontSize: "15px",
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.content}
                </div>
              ))
            : null}

          {loading && panelView === "chat" ? (
            <div style={{ alignSelf: "flex-start", color: "#94a3b8", fontSize: "14px" }}>답변 중…</div>
          ) : null}
        </div>

        {panelView === "chat" ? (
          <div
            style={{
              padding: "16px 20px 24px",
              borderTop: "1px solid rgba(148, 163, 184, 0.1)",
              maxWidth: "760px",
              width: "100%",
              margin: "0 auto",
            }}
          >
            {error ? <div style={{ color: "#fca5a5", fontSize: "13px", marginBottom: "8px" }}>{error}</div> : null}
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                type="text"
                value={input}
                disabled={isDisabled || loading}
                placeholder="무엇이든 편하게 물어보세요"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitQuestion(input);
                }}
                style={{
                  flex: 1,
                  padding: "14px 16px",
                  borderRadius: "12px",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "rgba(15, 23, 42, 0.65)",
                  color: "#f1f5f9",
                  fontSize: "15px",
                  fontFamily: FONT,
                  outline: "none",
                }}
              />
              <button
                type="button"
                disabled={isDisabled || loading || !input.trim()}
                onClick={() => submitQuestion(input)}
                style={{
                  padding: "14px 20px",
                  borderRadius: "12px",
                  border: "none",
                  background: TEAL,
                  color: "#fff",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) e.currentTarget.style.background = TEAL_HOVER;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = TEAL;
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
