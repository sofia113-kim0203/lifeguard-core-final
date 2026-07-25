import { useCallback, useEffect, useState } from "react";
import AdminAssignmentConfirmCard from "./AdminAssignmentConfirmCard.jsx";
import {
  buildActivateBody,
  buildCloseBody,
  buildCreatePendingBody,
  loadAdminLiveAssignments,
  mapAssignmentSuccessLines,
  postAdminAssignmentAction,
  postAdminKeyAssignmentChat,
} from "../lib/adminAgentAssignment.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  shell: {
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minHeight: "420px",
  },
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "20px 22px",
  },
  thread: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxHeight: "480px",
    overflowY: "auto",
  },
  bubbleKey: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    background: "rgba(15, 23, 42, 0.7)",
    border: "1px solid rgba(148, 163, 184, 0.16)",
    borderRadius: "14px",
    padding: "12px 14px",
    color: "#e2e8f0",
    fontSize: "14px",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  bubbleAdmin: {
    alignSelf: "flex-end",
    maxWidth: "92%",
    background: "rgba(37, 99, 235, 0.28)",
    border: "1px solid rgba(59, 130, 246, 0.35)",
    borderRadius: "14px",
    padding: "12px 14px",
    color: "#f8fafc",
    fontSize: "14px",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  inputRow: { display: "flex", gap: "8px" },
  input: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
  },
  btn: {
    padding: "12px 18px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};

function buildHistory(messages) {
  return messages
    .filter((m) => m.role === "admin" || m.role === "key")
    .map((m) => ({
      role: m.role === "key" ? "assistant" : "user",
      content: String(m.text ?? "").trim(),
    }))
    .filter((m) => m.content);
}

function bodyFromCard(card) {
  if (!card) return null;
  if (card.action === "create_pending") {
    return buildCreatePendingBody({
      customerId: card.customer_id,
      agentUserId: card.agent_user_id,
      notes: card.notes || "",
    });
  }
  if (card.action === "activate") {
    return buildActivateBody({ assignmentId: card.assignment_id });
  }
  if (card.action === "close") {
    return buildCloseBody({ assignmentId: card.assignment_id });
  }
  return null;
}

export default function AdminKeyAssignmentChatPanel() {
  const [messages, setMessages] = useState([
    {
      id: "hello",
      role: "key",
      text: "어떤 고객의 설계사 배정을 도와드릴까요?",
      card: null,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [error, setError] = useState("");

  const refreshLive = useCallback(async () => {
    const live = await loadAdminLiveAssignments();
    if (live.ok) setLiveCount(live.assignments.length);
  }, []);

  useEffect(() => {
    void refreshLive();
  }, [refreshLive]);

  async function sendQuestion() {
    const question = draft.trim();
    if (!question || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    const adminMsg = {
      id: `a-${Date.now()}`,
      role: "admin",
      text: question,
      card: null,
    };
    const nextMessages = [...messages, adminMsg];
    setMessages(nextMessages);

    const result = await postAdminKeyAssignmentChat({
      question,
      history: buildHistory(nextMessages.slice(0, -1)),
    });

    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: `k-${Date.now()}`,
          role: "key",
          text: result.text || result.error_message || "요청을 처리하지 못했습니다.",
          card: null,
        },
      ]);
      setBusy(false);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `k-${Date.now()}`,
        role: "key",
        text: result.text || "확인이 필요합니다.",
        card: result.card,
      },
    ]);
    if (Array.isArray(result.assignments)) {
      setLiveCount(result.assignments.length);
    }
    setBusy(false);
  }

  async function confirmCard(messageId, card) {
    if (busy) return;
    const body = bodyFromCard(card);
    if (!body) return;
    setBusy(true);
    setError("");
    const result = await postAdminAssignmentAction(body);
    if (!result.ok) {
      setError(result.error_message || "요청에 실패했습니다.");
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, card: null } : m)),
      );
      setBusy(false);
      return;
    }
    const lines = mapAssignmentSuccessLines({
      action: card.action,
      binding_created: result.binding_created,
      binding_skipped_no_consent: result.binding_skipped_no_consent,
    });
    setMessages((prev) => [
      ...prev.map((m) => (m.id === messageId ? { ...m, card: null } : m)),
      {
        id: `k-result-${Date.now()}`,
        role: "key",
        text: lines.join("\n"),
        card: null,
      },
    ]);
    await refreshLive();
    setBusy(false);
  }

  function cancelCard(messageId) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, card: null } : m)),
    );
  }

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <h2 style={{ margin: "0 0 6px", fontSize: "18px", color: "#f8fafc" }}>
          KEY 배정 상담
        </h2>
        <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
          KEY와 대화한 뒤 확인 카드에서만 배정이 실행됩니다. 진행 중 배정{" "}
          {liveCount}건.
        </p>
      </div>

      <div style={{ ...S.card, ...S.thread }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={m.role === "admin" ? S.bubbleAdmin : S.bubbleKey}
          >
            <div>{m.text}</div>
            {m.card ? (
              <AdminAssignmentConfirmCard
                card={m.card}
                busy={busy}
                onConfirm={() => void confirmCard(m.id, m.card)}
                onCancel={() => cancelCard(m.id)}
              />
            ) : null}
          </div>
        ))}
      </div>

      {error ? (
        <div style={{ ...S.card, borderColor: "rgba(248, 113, 113, 0.4)", color: "#fecaca" }}>
          {error}
        </div>
      ) : null}

      <div style={S.inputRow}>
        <input
          style={S.input}
          value={draft}
          disabled={busy}
          placeholder="예: qa-customer-b를 e2-3 설계사에게 배정해줘"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void sendQuestion();
            }
          }}
        />
        <button
          type="button"
          style={{
            ...S.btn,
            opacity: busy || !draft.trim() ? 0.45 : 1,
            cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
          }}
          disabled={busy || !draft.trim()}
          onClick={() => void sendQuestion()}
        >
          보내기
        </button>
      </div>
    </div>
  );
}
