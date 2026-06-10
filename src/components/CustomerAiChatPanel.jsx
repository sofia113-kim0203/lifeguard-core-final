import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCustomerConversations,
  sendCustomerConversationMessage,
} from "../lib/customerConversations.js";
import {
  fetchLatestAnalysisJob,
  processAnalysisJobUntilComplete,
} from "../lib/customerConversationalAnalysis.js";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const CONVERSATION_LOAD_TIMEOUT_MS = 12_000;

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
  progressCard: {
    marginTop: "12px",
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(59, 130, 246, 0.25)",
  },
  progressTitle: {
    margin: "0 0 10px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#bfdbfe",
  },
  progressItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: "#cbd5e1",
    marginBottom: "6px",
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

function AnalysisProgressPanel({ analysisJob, initialResponseTimeMs }) {
  if (!analysisJob) return null;

  const timing = analysisJob.timing_metrics ?? {};
  const progress = Array.isArray(analysisJob.progress) ? analysisJob.progress : [];

  return (
    <div style={S.progressCard}>
      <p style={S.progressTitle}>
        백그라운드 정밀 분석{" "}
        {analysisJob.status === "completed"
          ? "완료"
          : analysisJob.status === "failed"
            ? "실패"
            : "진행 중"}
        {initialResponseTimeMs ? ` · 즉시 응답 ${initialResponseTimeMs}ms` : ""}
      </p>
      {progress.map((item) => (
        <div key={item.stage} style={S.progressItem}>
          <span>
            {item.status === "completed" ? "✓" : item.status === "processing" ? "…" : "○"}
          </span>
          <span>{item.label}</span>
        </div>
      ))}
      {timing.total_analysis_time_ms ? (
        <div style={{ ...S.progressItem, marginTop: "8px", color: "#94a3b8" }}>
          총 분석 시간: {timing.total_analysis_time_ms}ms
        </div>
      ) : null}
      {analysisJob.error_message ? (
        <div style={{ ...S.error, marginTop: "8px" }}>{analysisJob.error_message}</div>
      ) : null}
    </div>
  );
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export default function CustomerAiChatPanel({ user, onAnalysisJobUpdate }) {
  const session = useOptionalCustomerSession();
  const customerId = session?.dashboardData?.customerId ?? null;

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [analysisJob, setAnalysisJob] = useState(null);
  const [initialResponseTimeMs, setInitialResponseTimeMs] = useState(0);
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const historyRef = useRef(null);
  const pollAbortControllerRef = useRef(null);

  const loadMessages = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) {
        setMessages([]);
        setLoading(false);
        setError("로그인이 필요합니다.");
        return;
      }

      if (!silent) {
        setLoading(true);
      }
      setError("");
      try {
        const rows = await withTimeout(
          loadCustomerConversations(user, { customerId }),
          CONVERSATION_LOAD_TIMEOUT_MS,
          "대화 기록 요청 시간이 초과되었습니다. 아래에서 질문을 입력해 주세요.",
        );
        setMessages(rows);
      } catch (err) {
        if (!silent) {
          setMessages([]);
        }
        setError(toCustomerErrorMessage(err, "대화 기록을 불러오지 못했습니다."));
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [user, customerId],
  );

  const resumeBackgroundPolling = useCallback(
    async (jobId) => {
      if (!jobId) return;

      pollAbortControllerRef.current?.abort();
      const controller = new AbortController();
      pollAbortControllerRef.current = controller;

      setBackgroundRunning(true);
      try {
        const finalJob = await processAnalysisJobUntilComplete({
          jobId,
          signal: controller.signal,
          onProgress: (job) => {
            if (controller.signal.aborted) return;
            setAnalysisJob(job);
            if (typeof onAnalysisJobUpdate === "function") {
              onAnalysisJobUpdate(job);
            }
          },
        });
        if (controller.signal.aborted) return;
        if (finalJob) {
          setAnalysisJob(finalJob);
          if (typeof onAnalysisJobUpdate === "function") {
            onAnalysisJobUpdate(finalJob);
          }
        }
        await loadMessages({ silent: true });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(toCustomerErrorMessage(err, "백그라운드 분석 상태를 확인하지 못했습니다."));
        }
      } finally {
        if (pollAbortControllerRef.current === controller) {
          setBackgroundRunning(false);
        }
      }
    },
    [loadMessages, onAnalysisJobUpdate],
  );

  useEffect(() => {
    if (!user || !customerId) return;
    loadMessages();
  }, [user, customerId, loadMessages]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const latestJob = await fetchLatestAnalysisJob();
        if (cancelled) return;
        if (latestJob && latestJob.status !== "completed" && latestJob.status !== "failed") {
          setAnalysisJob(latestJob);
          void resumeBackgroundPolling(latestJob.id);
        } else if (latestJob) {
          setAnalysisJob(latestJob);
        }
      } catch {
        // no active job is fine on first load
      }
    })();

    return () => {
      cancelled = true;
      pollAbortControllerRef.current?.abort();
    };
  }, [user, customerId, resumeBackgroundPolling]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, loading, analysisJob]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user || sending) return;

    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError("");
    try {
      const result = await sendCustomerConversationMessage(user, text, {
        customerId,
        onAnalysisJob: ({ analysisJobId, analysisJob: job, initialResponseTimeMs: responseMs }) => {
          setAnalysisJob(job);
          setInitialResponseTimeMs(responseMs ?? 0);
          if (typeof onAnalysisJobUpdate === "function") {
            onAnalysisJobUpdate(job);
          }
          if (analysisJobId) {
            resumeBackgroundPolling(analysisJobId);
          }
        },
      });
      setInitialResponseTimeMs(result.initialResponseTimeMs ?? 0);
      setDraft("");
      await loadMessages();
    } catch (err) {
      setError(toCustomerErrorMessage(err, "상담 메시지를 처리하지 못했습니다."));
    } finally {
      setSending(false);
    }
  };

  return (
    <section style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h2 style={S.title}>AI 상담</h2>
        <p style={S.desc}>
          질문 즉시 상담 응답을 제공하고, Coverage Gap · Underwriting · Recommendation · 보험설계안
          정밀 분석은 백그라운드에서 실행됩니다. 분석이 완료되면 결과가 자동으로 연결됩니다.
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

        <AnalysisProgressPanel
          analysisJob={analysisJob}
          initialResponseTimeMs={initialResponseTimeMs}
        />

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}
        >
          <textarea
            style={S.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="보험 상담 내용을 입력해 주세요."
            disabled={sending}
          />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="submit"
              style={S.btn}
              disabled={sending || loading || backgroundRunning || !draft.trim()}
            >
              {sending ? "즉시 응답 생성 중…" : "상담 질문 보내기"}
            </button>
            <button
              type="button"
              style={S.btnSecondary}
              onClick={() => loadMessages()}
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
