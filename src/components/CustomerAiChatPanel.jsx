import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCustomerConversations,
  sendCustomerConversationMessage,
} from "../lib/customerConversations.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  title: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 700,
    color: "#f8fafc",
  },
  desc: {
    margin: "8px 0 0",
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  history: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxHeight: "360px",
    overflowY: "auto",
    padding: "16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    padding: "12px 14px",
    borderRadius: "14px 14px 4px 14px",
    background: "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "#f8fafc",
    fontSize: "14px",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    padding: "12px 14px",
    borderRadius: "14px 14px 14px 4px",
    background: "rgba(30, 41, 59, 0.9)",
    border: "1px solid rgba(148, 163, 184, 0.15)",
    color: "#e2e8f0",
    fontSize: "14px",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  bubbleSystem: {
    alignSelf: "center",
    maxWidth: "90%",
    padding: "8px 12px",
    borderRadius: "10px",
    background: "rgba(51, 65, 85, 0.5)",
    color: "#94a3b8",
    fontSize: "12px",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  meta: {
    marginTop: "6px",
    fontSize: "11px",
    color: "rgba(148, 163, 184, 0.75)",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
    minHeight: "72px",
  },
  btn: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  btnSecondary: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(30, 41, 59, 0.8)",
    color: "#e2e8f0",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    border: "1px solid rgba(248, 113, 113, 0.25)",
  },
  empty: {
    color: "#64748b",
    fontSize: "14px",
    textAlign: "center",
    padding: "24px 12px",
    lineHeight: 1.6,
  },
};

function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return value;
  }
}

function MessageBubble({ item }) {
  const style =
    item.role === "user"
      ? S.bubbleUser
      : item.role === "assistant"
        ? S.bubbleAssistant
        : S.bubbleSystem;

  return (
    <div style={style}>
      <div>{item.message}</div>
      <div style={S.meta}>{formatTimestamp(item.createdAt)}</div>
    </div>
  );
}

export default function CustomerAiChatPanel({ user }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef(null);

  const loadMessages = useCallback(async () => {
    if (!user) {
      setMessages([]);
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const rows = await loadCustomerConversations(user);
      setMessages(rows);
    } catch (err) {
      setMessages([]);
      setError(err.message || "대화 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user || sending) return;

    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError("");
    try {
      await sendCustomerConversationMessage(user, text);
      setDraft("");
      await loadMessages();
    } catch (err) {
      setError(err.message || "메시지를 저장하지 못했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h2 style={S.title}>AI 상담</h2>
        <p style={S.desc}>
          로그인한 고객의 AI 상담 메시지가 Supabase에 저장됩니다. 새로고침 후에도 대화 기록이
          유지됩니다. (현재는 저장 확인용 응답만 제공합니다.)
        </p>
      </div>

      <div style={S.card}>
        {error ? <div style={{ ...S.error, marginBottom: "16px" }}>{error}</div> : null}

        <div ref={historyRef} style={S.history}>
          {loading ? (
            <div style={S.empty}>대화 기록을 불러오는 중…</div>
          ) : messages.length === 0 ? (
            <div style={S.empty}>
              아직 저장된 대화가 없습니다.
              <br />
              아래에 메시지를 입력해 보세요.
            </div>
          ) : (
            messages.map((item) => <MessageBubble key={item.id} item={item} />)
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}
        >
          <textarea
            style={S.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="보험 상담 내용을 입력해 주세요."
            disabled={sending || loading}
          />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button type="submit" style={S.btn} disabled={sending || loading || !draft.trim()}>
              {sending ? "저장 중…" : "메시지 보내기"}
            </button>
            <button
              type="button"
              style={S.btnSecondary}
              onClick={loadMessages}
              disabled={sending || loading}
            >
              새로고침
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
