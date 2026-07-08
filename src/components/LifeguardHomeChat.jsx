import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import KeyVisualBlocks from "./KeyVisualBlocks.jsx";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { useCustomerDocumentUpload } from "../hooks/useCustomerDocumentUpload.js";
import { useKeyAnalysisCompleteSessionTransition } from "../hooks/useKeyAnalysisCompleteSessionTransition.js";
import { useKeyBridgeSessionTransition } from "../hooks/useKeyBridgeSessionTransition.js";
import { useKeyReturnJudgmentSessionTransition } from "../hooks/useKeyReturnJudgmentSessionTransition.js";
import { listDocuments } from "../lib/customerDocuments.js";
import { fetchHomeBrainFactStream, mapHomeBrainFactPayload } from "../lib/customerHomeBrainFact.js";
import {
  createLifeguardSessionId,
  listLifeguardRecentSessions,
  loadLifeguardSessionMessages,
  persistKeyPresenceMessage,
  persistLifeguardChatTurn,
  readActiveSessionId,
  resolveActiveLifeguardSessionId,
  writeActiveSessionId,
} from "../lib/lifeguardChatSessions.js";
import { supabase } from "../lib/supabase.js";
import { buildKeyChatPresenceMessage } from "../lib/keyChatPresenceWire.js";
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

const DESKTOP_SIDEBAR_BREAKPOINT = 768;

const KEY_WAIT_ACK_FALLBACK = "말씀 주신 내용 잘 받았어요. 함께 확인해 볼게요.";

const THINKING_PROGRESS_MESSAGES = [
  KEY_WAIT_ACK_FALLBACK,
  "가입 정보와 상담 내용을 살펴보고 있어요.",
  "확인한 내용을 정리해서 이어 말씀드릴게요.",
];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

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

function SidebarNav({
  sessionId,
  threads,
  panelView,
  onNewChat,
  onOpenSession,
  onPanelChange,
  onSignOut,
  style = {},
}) {
  return (
    <aside style={style}>
      <button type="button" onClick={onNewChat} style={sidebarBtn(false)}>
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
            onClick={() => onOpenSession(thread.id)}
          >
            {thread.preview}
          </button>
        ))
      )}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
        <button type="button" style={sidebarBtn(panelView === "insurance")} onClick={() => onPanelChange("insurance")}>
          내 보험
        </button>
        <button type="button" style={sidebarBtn(panelView === "documents")} onClick={() => onPanelChange("documents")}>
          내 문서
        </button>
        <button type="button" style={sidebarBtn(panelView === "settings")} onClick={() => onPanelChange("settings")}>
          설정
        </button>
        <button
          type="button"
          style={{ ...sidebarBtn(false), marginTop: "8px", color: LG.textMuted }}
          onClick={onSignOut}
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}

function patchLastAssistantMessage(prev, patch) {
  const copy = [...prev];
  const last = copy[copy.length - 1];
  if (last?.role !== "assistant") return prev;
  copy[copy.length - 1] = { ...last, ...patch };
  return copy;
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
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [attachHint, setAttachHint] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [sessionId, setSessionId] = useState(() => createLifeguardSessionId());
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const [threadRestoreReady, setThreadRestoreReady] = useState(false);
  const [bridgeSettled, setBridgeSettled] = useState(false);
  const loadDocumentsRef = useRef(async () => {});

  const focusChatInputRef = useRef(() => {});
  const sessionIdRef = useRef(sessionId);
  const authUserRef = useRef(authUser);
  const customerIdRef = useRef(customerId);
  const trackedAnalysisJobIdRef = useRef(session?.trackedAnalysisJobId ?? null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    customerIdRef.current = customerId;
  }, [customerId]);

  useEffect(() => {
    trackedAnalysisJobIdRef.current = session?.trackedAnalysisJobId ?? null;
  }, [session?.trackedAnalysisJobId]);

  const handleKeyChatPresence = useCallback(
    ({
      keyFirstSentence = null,
      keyFollowUpSentence = null,
      keyInitiativeSentence = null,
      keyBridgeSentence = null,
      keyReturnJudgmentSentence = null,
      anchorJobId = null,
    } = {}) => {
      const presenceMessage = buildKeyChatPresenceMessage({
        keyFirstSentence,
        keyFollowUpSentence,
        keyInitiativeSentence,
        keyBridgeSentence,
        keyReturnJudgmentSentence,
      });
      if (!presenceMessage) return;

      const resolvedAnchorJobId =
        keyBridgeSentence || keyReturnJudgmentSentence
          ? anchorJobId
          : keyInitiativeSentence
            ? trackedAnalysisJobIdRef.current
            : null;

      setPanelView("chat");
      setSidebarOpen(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last?.role === "assistant" &&
          last?.keyPresence === true &&
          last?.content === presenceMessage.content
        ) {
          return prev;
        }
        const nextMessage = resolvedAnchorJobId
          ? { ...presenceMessage, anchorJobId: resolvedAnchorJobId }
          : presenceMessage;
        return [...prev, nextMessage];
      });
      focusChatInputRef.current();

      const user = authUserRef.current;
      const cid = customerIdRef.current;
      const sid = sessionIdRef.current;
      if (!user || !cid || !sid) return;

      void persistKeyPresenceMessage(user, {
        sessionId: sid,
        customerId: cid,
        content: presenceMessage.content,
        keyPresenceSource: presenceMessage.keyPresenceSource,
        anchorJobId: resolvedAnchorJobId,
      })
        .then(() => {
          if (presenceMessage.keyPresenceSource === "key_bridge") {
            setBridgeSettled(true);
          }
          writeActiveSessionId(cid, sid);
          return listLifeguardRecentSessions(user, { customerId: cid });
        })
        .then((recent) => {
          setThreads(recent);
        })
        .catch(() => {
          // UI bubble already shown; persist failure must not block chat
        });
    },
    [],
  );

  useKeyAnalysisCompleteSessionTransition({
    trackedAnalysisJobId: session?.trackedAnalysisJobId ?? null,
    setActiveAnalysisJob: session?.setActiveAnalysisJob,
    onKeyChatPresence: handleKeyChatPresence,
    onTrackedJobComplete: session?.clearTrackedAnalysisJob,
    enabled: Boolean(authUser && (!loadingSession || session?.trackedAnalysisJobId)),
  });

  const uploadFlow = useCustomerDocumentUpload({
    user: authUser,
    refreshSession: session?.refreshSession,
    setActiveAnalysisJob: session?.setActiveAnalysisJob,
    trackAnalysisJobFromUpload: session?.trackAnalysisJobFromUpload,
    onKeyChatPresence: handleKeyChatPresence,
    onUploadComplete: async () => {
      await loadDocumentsRef.current();
    },
  });

  const trackedJobStatus =
    session?.trackedAnalysisJobId &&
    session?.activeAnalysisJob?.id === session.trackedAnalysisJobId
      ? session.activeAnalysisJob.status
      : null;

  useKeyBridgeSessionTransition({
    sessionId,
    customerId,
    messages,
    threadRestoreReady,
    panelView,
    onKeyChatPresence: handleKeyChatPresence,
    enabled: Boolean(authUser && customerId && !loadingSession),
    uploadInProgress: uploadFlow.uploading,
    trackedAnalysisJobStatus: trackedJobStatus,
  });

  useEffect(() => {
    if (messages.some((msg) => msg?.keyPresenceSource === "key_bridge")) {
      setBridgeSettled(true);
    }
  }, [messages]);

  useEffect(() => {
    setBridgeSettled(false);
  }, [sessionId, customerId, loadingSession]);

  useKeyReturnJudgmentSessionTransition({
    sessionId,
    customerId,
    messages,
    threadRestoreReady,
    bridgeSettled,
    panelView,
    onKeyChatPresence: handleKeyChatPresence,
    enabled: Boolean(authUser && customerId && !loadingSession),
    uploadInProgress: uploadFlow.uploading,
    trackedAnalysisJobStatus: trackedJobStatus,
  });

  const reloadDocuments = useCallback(async () => {
    if (!authUser) return;
    setDocumentsLoading(true);
    setDocumentsError("");
    try {
      const result = await listDocuments(authUser, { categoryKey: "all" });
      setDocuments(result.documents ?? []);
      uploadFlow.syncFromListResult(result);
    } catch (err) {
      setDocuments([]);
      setDocumentsError(toCustomerErrorMessage(err, "문서 목록을 불러오지 못했습니다."));
    } finally {
      setDocumentsLoading(false);
    }
  }, [authUser, uploadFlow.syncFromListResult]);

  useEffect(() => {
    loadDocumentsRef.current = reloadDocuments;
  }, [reloadDocuments]);

  const isDesktopSidebar = useMediaQuery(`(min-width: ${DESKTOP_SIDEBAR_BREAKPOINT}px)`);

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

  useEffect(() => {
    focusChatInputRef.current = focusChatInput;
  }, [focusChatInput]);

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
    if (!loading || streaming) return undefined;
    const timer = window.setInterval(() => {
      setThinkingIndex((current) => (current + 1) % THINKING_PROGRESS_MESSAGES.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [loading, streaming]);

  useEffect(() => {
    if (!loading || streaming) return;
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role !== "assistant" || !last.thinking) return prev;
      copy[copy.length - 1] = {
        ...last,
        content: THINKING_PROGRESS_MESSAGES[thinkingIndex],
      };
      return copy;
    });
  }, [thinkingIndex, loading, streaming]);

  useEffect(() => {
    if (panelView !== "documents" || !authUser) return undefined;
    reloadDocuments();
    return undefined;
  }, [panelView, authUser, reloadDocuments]);

  useEffect(() => {
    if (!authUser || !customerId || loadingSession) return undefined;
    let cancelled = false;
    setThreadRestoreReady(false);

    (async () => {
      try {
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        if (cancelled) return;
        setThreads(recent);

        const storedSessionId = readActiveSessionId(customerId);
        const activeId = resolveActiveLifeguardSessionId({
          recentSessions: recent,
          storedId: storedSessionId,
        });
        setSessionId(activeId);
        writeActiveSessionId(customerId, activeId);

        if (recent.some((entry) => entry.id === activeId)) {
          const restored = await loadLifeguardSessionMessages(authUser, activeId, { customerId });
          if (!cancelled && restored.length > 0) {
            setMessages(restored);
            setPanelView("chat");
          }
        }
        if (!cancelled) {
          setThreadRestoreReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(toCustomerErrorMessage(err, "대화 기록을 불러오지 못했습니다."));
          setThreadRestoreReady(true);
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
      writeActiveSessionId(customerId, targetSessionId);
      setThreadRestoreReady(false);

      try {
        const restored = await loadLifeguardSessionMessages(authUser, targetSessionId, { customerId });
        setMessages(restored);
      } catch (err) {
        setMessages([]);
        setError(toCustomerErrorMessage(err, "대화를 불러오지 못했습니다."));
      } finally {
        setThreadRestoreReady(true);
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
    setStreaming(false);
    setThinkingIndex(0);
    setError("");

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      setMessages([
        ...nextMessages,
        { role: "assistant", content: THINKING_PROGRESS_MESSAGES[0], thinking: true },
      ]);

      let streamedText = "";
      const result = await fetchHomeBrainFactStream(trimmed, history, {
        onAck: (ackText) => {
          const text = String(ackText ?? "").trim() || KEY_WAIT_ACK_FALLBACK;
          setMessages((prev) =>
            patchLastAssistantMessage(prev, { content: text, thinking: true }),
          );
        },
        onDelta: (chunk) => {
          streamedText += chunk;
          setStreaming(true);
          setLoading(false);
          setMessages((prev) =>
            patchLastAssistantMessage(prev, { content: streamedText, thinking: false }),
          );
        },
        onReplace: (text) => {
          streamedText = String(text ?? "");
          setLoading(false);
          setStreaming(false);
          setMessages((prev) =>
            patchLastAssistantMessage(prev, { content: streamedText, thinking: false }),
          );
        },
        onDone: (payload) => {
          const mapped = mapHomeBrainFactPayload(payload ?? {});
          const visualBlocks = Array.isArray(mapped.visualBlocks) ? mapped.visualBlocks : [];
          if (visualBlocks.length === 0) return;
          setMessages((prev) =>
            patchLastAssistantMessage(prev, {
              visual_blocks: visualBlocks,
              visual_blocks_gate: mapped.visualBlocksGate ?? null,
              thinking: false,
            }),
          );
        },
      });

      const finalText = result.answerText || streamedText;
      const visualBlocks = Array.isArray(result.visualBlocks) ? result.visualBlocks : [];
      const visualBlocksGate = result.visualBlocksGate ?? null;
      setMessages((prev) =>
        patchLastAssistantMessage(prev, {
          content: finalText,
          thinking: false,
          visual_blocks: visualBlocks,
          visual_blocks_gate: visualBlocksGate,
        }),
      );

      if (authUser && customerId) {
        await persistLifeguardChatTurn(authUser, {
          sessionId,
          customerId,
          userMessage: trimmed,
          assistantMessage: finalText,
        });
        writeActiveSessionId(customerId, sessionId);
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        setThreads(recent);
      }
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.thinking) {
          copy.pop();
        }
        return copy;
      });
      setError(toCustomerErrorMessage(err, "질문에 답변하지 못했습니다."));
    } finally {
      setLoading(false);
      setStreaming(false);
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
      writeActiveSessionId(customerId, newSessionId);
    }
    focusChatInput();
  };

  const handleAttachClick = () => {
    setAttachHint("문서는 대화에서 편하게 말씀해 주세요. 예: \"이 증권 봐줘\"");
    window.setTimeout(() => setAttachHint(""), 4000);
  };

  const sidebarProps = {
    sessionId,
    threads,
    panelView,
    onNewChat: startNewChat,
    onOpenSession: openSession,
    onPanelChange: (view) => {
      setPanelView(view);
      if (!isDesktopSidebar) setSidebarOpen(false);
    },
    onSignOut: () => supabase.auth.signOut(),
  };

  const desktopSidebarStyle = {
    width: "280px",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    alignSelf: "flex-start",
    height: "100vh",
    overflowY: "auto",
    borderRight: `1px solid ${LG.border}`,
    background: LG.sidebarBg,
    padding: "20px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  };

  const mobileSidebarStyle = {
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
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        fontFamily: LG.sans,
        background: LG.bg,
        color: LG.text,
      }}
    >
      {isDesktopSidebar ? <SidebarNav {...sidebarProps} style={desktopSidebarStyle} /> : null}

      {!isDesktopSidebar && sidebarOpen ? (
        <>
          <div
            role="presentation"
            onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.18)", zIndex: 20 }}
          />
          <SidebarNav {...sidebarProps} style={mobileSidebarStyle} />
        </>
      ) : null}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 20px",
            borderBottom: `1px solid ${LG.border}`,
            background: LG.bg,
            flexShrink: 0,
          }}
        >
          {!isDesktopSidebar ? (
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
          ) : null}
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
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
              <CustomerDocumentUploadFlow
                variant="customer"
                user={authUser}
                refreshSession={session?.refreshSession}
                setActiveAnalysisJob={session?.setActiveAnalysisJob}
                uploadHook={uploadFlow}
              />
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
                    disabled={isDisabled || loading || streaming}
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
                      color: msg.thinking ? LG.textMuted : LG.text,
                      fontSize: msg.role === "user" ? "15px" : "16px",
                      fontWeight: msg.role === "user" ? 400 : 450,
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                    aria-live={msg.thinking ? "polite" : undefined}
                  >
                    {msg.content}
                    {msg.role === "assistant" &&
                    Array.isArray(msg.visual_blocks) &&
                    msg.visual_blocks.length > 0 ? (
                      <KeyVisualBlocks blocks={msg.visual_blocks} variant="home" />
                    ) : null}
                  </div>
                </div>
              ))
            : null}
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
              flexShrink: 0,
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
                disabled={isDisabled || loading || streaming || !input.trim()}
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
