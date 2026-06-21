import { useMemo, useState } from "react";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';
const SERIF = 'var(--font-serif, "Playfair Display", Georgia, "Times New Roman", serif)';

const EXAMPLE_QUESTIONS = ["암보험 부족해?", "내 보험료 괜찮을까?", "보장내역서 어떻게 올려?"];

const TEAL = "#0d9488";
const TEAL_HOVER = "#0f766e";

function pickGreeting(displayName = "고객") {
  const hour = new Date().getHours();
  const pool = [
    `${displayName}님, 오늘도 편하게 물어보세요. 보험 얘기든 가벼운 얘기든 괜찮아요.`,
    `안녕하세요, ${displayName}님. 궁금한 걸 편하게 물어보세요 — 보장내역서가 있으면 더 정확히 볼게요.`,
    `${displayName}님, 무엇이든 같이 생각해 볼게요. 보험 관련이면 자료를 주시면 더 도와드릴 수 있어요.`,
  ];
  if (hour < 12) return pool[1];
  if (hour < 18) return pool[0];
  return pool[2];
}

function LifeguardSidebar({ open, onNavigate, onNewChat, recentThreads, onSelectThread }) {
  if (!open) return null;
  return (
    <aside
      style={{
        width: "240px",
        flexShrink: 0,
        borderRight: "1px solid rgba(148, 163, 184, 0.12)",
        background: "rgba(15, 23, 42, 0.92)",
        padding: "20px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <button type="button" onClick={onNewChat} style={sidebarBtnStyle(true)}>
        새 대화
      </button>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", marginTop: "12px", letterSpacing: "0.06em" }}>
        최근
      </div>
      {recentThreads.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#64748b", padding: "8px 4px" }}>아직 대화가 없어요</div>
      ) : (
        recentThreads.slice(0, 8).map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => onSelectThread(thread.id)}
            style={sidebarBtnStyle(false)}
          >
            {thread.preview}
          </button>
        ))
      )}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
        <button type="button" onClick={() => onNavigate?.("customer")} style={sidebarBtnStyle(false)}>
          내 보험
        </button>
        <button type="button" onClick={() => onNavigate?.("documents")} style={sidebarBtnStyle(false)}>
          내 문서
        </button>
      </div>
    </aside>
  );
}

function sidebarBtnStyle(emphasis) {
  return {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: "10px",
    border: emphasis ? "1px solid rgba(13, 148, 136, 0.35)" : "1px solid rgba(148, 163, 184, 0.12)",
    background: emphasis ? "rgba(13, 148, 136, 0.12)" : "rgba(30, 41, 59, 0.55)",
    color: emphasis ? "#99f6e4" : "#cbd5e1",
    fontSize: "13px",
    fontWeight: emphasis ? 600 : 500,
    cursor: "pointer",
    fontFamily: FONT,
  };
}

export default function LifeguardHomeChat({ displayName = "고객", disabled = false, onNavigate }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(() => `thread-${Date.now()}`);

  const greeting = useMemo(() => pickGreeting(displayName), [displayName]);

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || disabled || loading) return;

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
        const existing = prev.filter((t) => t.id !== threadId);
        return [{ id: threadId, preview }, ...existing].slice(0, 12);
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
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "calc(100vh - 48px)",
        fontFamily: FONT,
        margin: "-8px -12px",
      }}
    >
      <LifeguardSidebar
        open={sidebarOpen}
        onNavigate={onNavigate}
        onNewChat={startNewChat}
        recentThreads={threads}
        onSelectThread={(id) => setThreadId(id)}
      />

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
            <div
              style={{
                fontFamily: SERIF,
                fontSize: "22px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "#f8fafc",
              }}
            >
              LIFEGUARD
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
              당신의 보험을 이해하는 AI
            </div>
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
          {messages.length === 0 ? (
            <div style={{ marginTop: "12vh", textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "18px",
                  lineHeight: 1.65,
                  color: "#e2e8f0",
                  maxWidth: "520px",
                  marginInline: "auto",
                }}
              >
                {greeting}
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  justifyContent: "center",
                  marginTop: "24px",
                }}
              >
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={disabled || loading}
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
          ) : (
            messages.map((msg, index) => (
              <div
                key={`${index}-${msg.role}`}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "12px 16px",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background:
                    msg.role === "user"
                      ? "rgba(13, 148, 136, 0.2)"
                      : "rgba(30, 41, 59, 0.75)",
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
          )}
          {loading ? (
            <div style={{ alignSelf: "flex-start", color: "#94a3b8", fontSize: "14px" }}>답변 중…</div>
          ) : null}
        </div>

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
              disabled={disabled || loading}
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
              disabled={disabled || loading || !input.trim()}
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
      </div>
    </div>
  );
}
