import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import KeyVisualBlocks from "./KeyVisualBlocks.jsx";
import KeyMyInsuranceRail from "./KeyMyInsuranceRail.jsx";
import KeyTurnMirrorRail from "./KeyTurnMirrorRail.jsx";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { useCustomerDocumentUpload } from "../hooks/useCustomerDocumentUpload.js";
import { useKeyAnalysisCompleteSessionTransition } from "../hooks/useKeyAnalysisCompleteSessionTransition.js";
import { useKeyBridgeSessionTransition } from "../hooks/useKeyBridgeSessionTransition.js";
import { useKeyReturnJudgmentSessionTransition } from "../hooks/useKeyReturnJudgmentSessionTransition.js";
import {
  DOCUMENT_DELETE_REASON,
  listDocuments,
  softDeleteDocument,
  uploadDocument,
} from "../lib/customerDocuments.js";
import { CHAT_ATTACH_FILE_ACCEPT, isChatAttachFile } from "../lib/chatPdfAttach.js";
import {
  normalizeQuarterTurns,
  quarterTurnsToDegrees,
  wrapQuarterTurns,
} from "../lib/chatImageOrient.js";
import {
  clearActiveAttachmentIfDocumentDeleted,
  extractActiveAttachmentFromSessionMessages,
  isReusableActiveAttachmentId,
  normalizeActiveAttachment,
  shouldClearActiveAttachmentAfterTurn,
} from "../lib/chatActiveAttachment.js";
import { fetchHomeBrainFactStream, mapHomeBrainFactPayload } from "../lib/customerHomeBrainFact.js";
import {
  clearLifeguardChatSnapshot,
  createLifeguardSessionId,
  listLifeguardRecentSessions,
  loadLifeguardSessionMessages,
  mergeRestoredSessionMessages,
  persistKeyPresenceMessage,
  persistLifeguardChatTurn,
  readActiveSessionId,
  readLifeguardChatSnapshot,
  resolveActiveLifeguardSessionId,
  writeActiveSessionId,
  writeLifeguardChatSnapshot,
} from "../lib/lifeguardChatSessions.js";
import { supabase } from "../lib/supabase.js";
import { buildKeyChatPresenceMessage } from "../lib/keyChatPresenceWire.js";
import { buildLifeguardHomeGreeting } from "../lib/lifeguardGreeting.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  DOCUMENT_UI_MESSAGES,
  formatDocClass,
  formatIngestStatus,
  formatUploadDate,
  toCustomerErrorMessage,
} from "../lib/uiLocale.js";
import {
  isScrollNearBottom,
  scrollChatContainerToBottom,
  shouldAutoFollowChatScroll,
  resolveAppendOnlyAssistantText,
  splitKeyAnswerMeaningUnits,
} from "../lib/lifeguardChatScroll.js";
import { LifeguardAssistantMarkdown } from "../lib/lifeguardChatMarkdown.jsx";
import { buildKeyTurnMirror } from "../lib/keyInsuranceScreenFacts.js";

const EXAMPLE_QUESTIONS = [
  "보험료 너무 비싼가?",
  "암보험 부족한가?",
  "대장 선종 제거했는데 보험금 받을 수 있나?",
  "분당에서 가족이랑 갈 만한 곳 추천해줘",
];

const DESKTOP_SIDEBAR_BREAKPOINT = 768;
const INSURANCE_LAYOUT_BREAKPOINT = 1100;

const KEY_WAIT_STATUS = "KEY가 확인하고 있어요.";
const KEY_WAIT_ACK_FALLBACK = KEY_WAIT_STATUS;

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
  if (document?.ingest_status === "ready") return "KEY 확인 완료";
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
              <div>
                상태:{" "}
                {policy.insurer_name && (policy.product_name || policy.monthly_premium)
                  ? "확인됨"
                  : "확인 필요"}
              </div>
            </div>
        </div>
      ))}
    </div>
  );
}

function CustomerDocumentsList({
  documents,
  loading,
  error,
  deletingId = null,
  onDeleteDocument = null,
}) {
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
      {documents.map((document) => {
        const busy = deletingId === document.id;
        return (
          <div key={document.id} style={listCardStyle()}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <div style={{ fontWeight: 600, color: LG.text, wordBreak: "break-all" }}>
                {document.original_filename ?? "—"}
              </div>
              {typeof onDeleteDocument === "function" ? (
                <button
                  type="button"
                  aria-label={DOCUMENT_UI_MESSAGES.deleteAction}
                  title={DOCUMENT_UI_MESSAGES.deleteAction}
                  disabled={busy}
                  onClick={() => onDeleteDocument(document.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: busy ? LG.textSoft : "#B91C1C",
                    cursor: busy ? "default" : "pointer",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "2px 4px",
                    flexShrink: 0,
                  }}
                >
                  {busy ? "…" : "🗑"}
                </button>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: "4px", fontSize: "14px", color: LG.textMuted }}>
              <div>문서 유형: {formatDocClass(document.doc_class)}</div>
              <div>업로드일: {formatUploadDate(document.created_at)}</div>
              <div>확인: {formatOcrStatus(document)}</div>
              <div>분석: {formatAnalysisComplete(document)}</div>
            </div>
          </div>
        );
      })}
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
  onClose = null,
  style = {},
}) {
  return (
    <aside style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <button type="button" onClick={onNewChat} style={{ ...sidebarBtn(false), flex: 1 }}>
          새 대화
        </button>
        {typeof onClose === "function" ? (
          <button
            type="button"
            aria-label="사이드바 닫기"
            onClick={onClose}
            style={{
              border: `1px solid ${LG.border}`,
              background: LG.surface,
              color: LG.textMuted,
              borderRadius: "8px",
              width: "40px",
              height: "40px",
              cursor: "pointer",
              flexShrink: 0,
              fontSize: "16px",
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
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
          내 보험 점검
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
  const chatScrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const restoreForceScrollRef = useRef(false);
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
  const [turnMirror, setTurnMirror] = useState(null);
  const [insuranceRailOpen, setInsuranceRailOpen] = useState(true);
  const [mirrorRailOpen, setMirrorRailOpen] = useState(true);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [attachHint, setAttachHint] = useState("");
  const [chatAttachDocumentId, setChatAttachDocumentId] = useState(null);
  const [chatAttachFilename, setChatAttachFilename] = useState("");
  const [chatAttachUploading, setChatAttachUploading] = useState(false);
  const [chatAttachError, setChatAttachError] = useState("");
  const [chatAttachPreviewUrl, setChatAttachPreviewUrl] = useState("");
  const [chatAttachIsImage, setChatAttachIsImage] = useState(false);
  const [chatAttachQuarterTurns, setChatAttachQuarterTurns] = useState(0);
  // Conversation-scoped active attachment (survives composer clear).
  const [activeAttachmentId, setActiveAttachmentId] = useState(null);
  const [activeAttachmentMime, setActiveAttachmentMime] = useState(null);
  const [activeRotationQuarterTurns, setActiveRotationQuarterTurns] = useState(0);
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [sessionId, setSessionId] = useState(() => createLifeguardSessionId());
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [documentDeletingId, setDocumentDeletingId] = useState(null);
  const [documentDeleteNotice, setDocumentDeleteNotice] = useState("");
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
  const isWideInsuranceLayout = useMediaQuery(`(min-width: ${INSURANCE_LAYOUT_BREAKPOINT}px)`);

  useEffect(() => {
    if (isWideInsuranceLayout) {
      setInsuranceRailOpen(true);
      setMirrorRailOpen(true);
    } else {
      setInsuranceRailOpen(false);
      setMirrorRailOpen(false);
    }
  }, [isWideInsuranceLayout]);

  const showInsuranceRail = panelView === "chat" && insuranceRailOpen;
  const showMirrorRail = panelView === "chat" && mirrorRailOpen;

  const greeting = useMemo(
    () => buildLifeguardHomeGreeting(displayName, session?.unifiedState),
    [displayName, session?.unifiedState],
  );
  const isDisabled = disabled || loadingSession || !threadRestoreReady;

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

  const scrollChatToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    scrollChatContainerToBottom(el);
    window.requestAnimationFrame(() => {
      scrollChatContainerToBottom(el);
      window.requestAnimationFrame(() => {
        scrollChatContainerToBottom(el);
      });
    });
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = isScrollNearBottom(el);
  }, []);

  useEffect(() => () => {
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
  }, []);

  // Restore / session switch: one forced jump to latest (separate from live follow).
  useEffect(() => {
    if (!threadRestoreReady || panelView !== "chat") return undefined;
    if (!restoreForceScrollRef.current) return undefined;
    restoreForceScrollRef.current = false;
    stickToBottomRef.current = true;
    scrollChatToBottom();
    return undefined;
  }, [threadRestoreReady, panelView, sessionId, messages.length, scrollChatToBottom]);

  // Live follow only while user stays near bottom (or after restore force).
  useEffect(() => {
    if (!threadRestoreReady || panelView !== "chat") return undefined;
    if (
      !shouldAutoFollowChatScroll({
        restoreForceOnce: false,
        stickToBottom: stickToBottomRef.current,
      })
    ) {
      return undefined;
    }
    scrollChatToBottom();
    return undefined;
  }, [messages, loading, streaming, threadRestoreReady, panelView, scrollChatToBottom]);

  // Late visual-block / table height growth — follow only if still sticky.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (
        shouldAutoFollowChatScroll({
          restoreForceOnce: restoreForceScrollRef.current,
          stickToBottom: stickToBottomRef.current,
        })
      ) {
        scrollChatContainerToBottom(el);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [messages.length, sessionId, scrollChatToBottom]);

  useEffect(() => {
    focusChatInputRef.current = focusChatInput;
  }, [focusChatInput]);

  const goBackToChat = useCallback(() => {
    setPanelView("chat");
    if (!isDesktopSidebar) setSidebarOpen(false);
    focusChatInput();
  }, [focusChatInput, isDesktopSidebar]);

  useEffect(() => {
    if (panelView === "chat") focusChatInput();
  }, [panelView, focusChatInput]);

  useEffect(() => {
    if (panelView === "chat" && !loading) focusChatInput();
  }, [loading, panelView, messages.length, focusChatInput]);

  // Desktop: sidebar starts open; mobile stays closed until menu.
  useEffect(() => {
    setSidebarOpen(isDesktopSidebar);
  }, [isDesktopSidebar]);

  useEffect(() => {
    if (panelView !== "documents" || !authUser) return undefined;
    reloadDocuments();
    return undefined;
  }, [panelView, authUser, reloadDocuments]);

  // Home chat: hydrate document_storage consent from DB (never treat unknown as denied).
  useEffect(() => {
    if (!authUser) return undefined;
    void uploadFlow.hydrateStorageConsent();
    return undefined;
  }, [authUser, uploadFlow.hydrateStorageConsent]);

  useEffect(() => {
    if (!authUser || !customerId || loadingSession) return undefined;
    let cancelled = false;
    setThreadRestoreReady(false);
    restoreForceScrollRef.current = true;

    (async () => {
      try {
        const snapshot = readLifeguardChatSnapshot(customerId);
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        if (cancelled) return;
        setThreads(recent);

        const storedSessionId = readActiveSessionId(customerId);
        const activeId = resolveActiveLifeguardSessionId({
          recentSessions: recent,
          storedId: storedSessionId,
          snapshotSessionId: snapshot?.sessionId ?? null,
        });
        setSessionId(activeId);
        writeActiveSessionId(customerId, activeId);

        const seed =
          snapshot?.sessionId && String(snapshot.sessionId) === String(activeId)
            ? snapshot.messages
            : [];

        let restored = [];
        if (recent.some((entry) => entry.id === activeId)) {
          restored = await loadLifeguardSessionMessages(authUser, activeId, { customerId });
        }

        if (cancelled) return;

        if (restored.length > 0) {
          setMessages((prev) => {
            const base = seed.length > 0 ? seed : prev;
            return mergeRestoredSessionMessages(base, restored);
          });
          const fromRestored = extractActiveAttachmentFromSessionMessages(restored);
          const fromSnap = normalizeActiveAttachment(snapshot?.activeAttachment ?? null);
          const active = fromRestored || (String(snapshot?.sessionId) === String(activeId) ? fromSnap : null);
          if (active) {
            setActiveAttachmentId(active.active_attachment_id);
            setActiveAttachmentMime(active.active_attachment_mime);
            setActiveRotationQuarterTurns(active.active_rotation_quarter_turns);
          } else {
            setActiveAttachmentId(null);
            setActiveAttachmentMime(null);
            setActiveRotationQuarterTurns(0);
          }
          setPanelView("chat");
        } else if (seed.length > 0) {
          // Remount before DB indexed the just-completed turn — keep local snapshot.
          setMessages(seed);
          const fromSnap = normalizeActiveAttachment(snapshot?.activeAttachment ?? null);
          if (fromSnap && String(snapshot?.sessionId) === String(activeId)) {
            setActiveAttachmentId(fromSnap.active_attachment_id);
            setActiveAttachmentMime(fromSnap.active_attachment_mime);
            setActiveRotationQuarterTurns(fromSnap.active_rotation_quarter_turns);
          }
          setPanelView("chat");
        } else {
          setActiveAttachmentId(null);
          setActiveAttachmentMime(null);
          setActiveRotationQuarterTurns(0);
        }

        setThreadRestoreReady(true);
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
      if (!isDesktopSidebar) setSidebarOpen(false);
      if (!authUser || !customerId) {
        focusChatInput();
        return;
      }

      setSessionId(targetSessionId);
      setError("");
      writeActiveSessionId(customerId, targetSessionId);
      setThreadRestoreReady(false);
      restoreForceScrollRef.current = true;
      stickToBottomRef.current = true;

      try {
        const restored = await loadLifeguardSessionMessages(authUser, targetSessionId, { customerId });
        setMessages(restored);
        const active = extractActiveAttachmentFromSessionMessages(restored);
        if (active) {
          setActiveAttachmentId(active.active_attachment_id);
          setActiveAttachmentMime(active.active_attachment_mime);
          setActiveRotationQuarterTurns(active.active_rotation_quarter_turns);
        } else {
          setActiveAttachmentId(null);
          setActiveAttachmentMime(null);
          setActiveRotationQuarterTurns(0);
        }
        writeLifeguardChatSnapshot(customerId, {
          sessionId: targetSessionId,
          messages: restored,
          activeAttachment: active,
        });
      } catch (err) {
        setMessages([]);
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
        setActiveRotationQuarterTurns(0);
        clearLifeguardChatSnapshot(customerId);
        setError(toCustomerErrorMessage(err, "대화를 불러오지 못했습니다."));
      } finally {
        setThreadRestoreReady(true);
        focusChatInput();
      }
    },
    [authUser, customerId, focusChatInput, isDesktopSidebar],
  );

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || isDisabled || loading || !threadRestoreReady) return;
    if (chatAttachUploading) {
      setError("파일 업로드가 끝난 뒤 보내 주세요.");
      return;
    }

    const composerDocumentId = chatAttachDocumentId;
    const composerTurns = chatAttachQuarterTurns;
    const composerIsImage = chatAttachIsImage;
    const composerFilename = chatAttachFilename;

    let documentIdForTurn = composerDocumentId;
    let attachTurnsForTurn = composerTurns;
    let attachIsImageForTurn = composerIsImage;
    let attachMimeForTurn = composerIsImage
      ? "image/jpeg"
      : composerDocumentId
        ? "application/pdf"
        : null;
    let reusedActiveAttachment = false;

    // Physical conversation active attachment — every turn until cleared (no keyword pre-route).
    // Skip deleted / missing ids so insurance questions are not blocked by stale attach state.
    if (!documentIdForTurn && activeAttachmentId) {
      if (isReusableActiveAttachmentId(activeAttachmentId, documents)) {
        documentIdForTurn = activeAttachmentId;
        attachTurnsForTurn = activeRotationQuarterTurns;
        attachMimeForTurn = activeAttachmentMime;
        attachIsImageForTurn =
          !activeAttachmentMime || String(activeAttachmentMime).startsWith("image/");
        reusedActiveAttachment = true;
      } else {
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
        setActiveRotationQuarterTurns(0);
        if (customerId) {
          writeLifeguardChatSnapshot(customerId, {
            sessionId,
            messages,
            activeAttachment: null,
          });
        }
      }
    }

    setPanelView("chat");
    if (!isDesktopSidebar) setSidebarOpen(false);
    const userMessage = {
      role: "user",
      content: composerDocumentId
        ? `${trimmed}\n\n(첨부: ${composerFilename || "파일"})`
        : trimmed,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    focusChatInput();
    setLoading(true);
    setStreaming(false);
    setError("");

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      setMessages([
        ...nextMessages,
        { role: "assistant", content: KEY_WAIT_STATUS, thinking: true },
      ]);
      if (customerId) {
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages: nextMessages,
          activeAttachment: activeAttachmentId
            ? {
                active_attachment_id: activeAttachmentId,
                active_attachment_mime: activeAttachmentMime,
                active_rotation_quarter_turns: activeRotationQuarterTurns,
              }
            : null,
        });
      }

      let streamedText = "";
      let receivedDelta = false;
      let attachOptions = documentIdForTurn ? { documentId: documentIdForTurn } : {};
      if (documentIdForTurn && attachIsImageForTurn) {
        attachOptions = {
          ...attachOptions,
          rotationQuarterTurns: normalizeQuarterTurns(attachTurnsForTurn),
        };
      }
      // Reused active attachment — server re-verifies ownership (no latest-doc invent).
      if (reusedActiveAttachment) {
        attachOptions = { ...attachOptions, priorAttachFollowUp: true };
      }
      const patchAssistantContent = (text, extra = {}) => {
        setMessages((prev) =>
          patchLastAssistantMessage(prev, { content: text, thinking: false, ...extra }),
        );
      };
      const result = await fetchHomeBrainFactStream(
        trimmed,
        history,
        {
          onAck: (ackText) => {
            // Short customer status only — do not list internal search/doc stage names.
            const text = String(ackText ?? "").trim() || KEY_WAIT_STATUS;
            const safe =
              text.length > 80 || /SSE|Claude|tool|phase|trace/i.test(text)
                ? KEY_WAIT_STATUS
                : text;
            setMessages((prev) =>
              patchLastAssistantMessage(prev, { content: safe, thinking: true }),
            );
          },
          onDelta: (chunk) => {
            const piece = String(chunk ?? "");
            if (!piece) return;
            receivedDelta = true;
            streamedText += piece;
            setStreaming(true);
            setLoading(false);
            patchAssistantContent(streamedText);
          },
          // E: already-shown text is never replaced by SSE replace.
          onReplace: () => {},
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
        },
        attachOptions,
      );

      const sealedText = String(result.answerText ?? "");
      const merged = resolveAppendOnlyAssistantText(streamedText, sealedText || streamedText);
      // Prefer sealed Claude original as the authoritative full string.
      const finalText = sealedText || merged;

      if (!receivedDelta && finalText) {
        // One-blob arrival: paced meaning-unit reveal (append-only, no rewrite).
        setStreaming(true);
        setLoading(false);
        const units = splitKeyAnswerMeaningUnits(finalText);
        let shown = "";
        for (let i = 0; i < units.length; i += 1) {
          shown += units[i];
          patchAssistantContent(shown);
          if (i < units.length - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 32));
          }
        }
        streamedText = finalText;
        patchAssistantContent(finalText);
      } else if (finalText.startsWith(streamedText) && finalText.length > streamedText.length) {
        // Catch-up remaining units only — never delete shown prefix.
        const suffix = finalText.slice(streamedText.length);
        const units = splitKeyAnswerMeaningUnits(suffix);
        let shown = streamedText;
        for (let i = 0; i < units.length; i += 1) {
          shown += units[i];
          patchAssistantContent(shown);
          if (i < units.length - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 24));
          }
        }
        streamedText = finalText;
        patchAssistantContent(finalText);
      } else {
        streamedText = finalText;
        patchAssistantContent(finalText);
      }

      const visualBlocks = Array.isArray(result.visualBlocks) ? result.visualBlocks : [];
      const visualBlocksGate = result.visualBlocksGate ?? null;
      const completedMessages = [
        ...nextMessages,
        {
          role: "assistant",
          content: finalText,
          thinking: false,
          visual_blocks: visualBlocks,
          visual_blocks_gate: visualBlocksGate,
        },
      ];
      setMessages(completedMessages);
      setTurnMirror(
        buildKeyTurnMirror({
          answerText: finalText,
          visualBlocks,
          policies,
        }),
      );
      let nextActive = null;
      const clearFailedAttach = shouldClearActiveAttachmentAfterTurn(result);
      if (clearFailedAttach) {
        // Attach fail-closed / prior-attach miss — drop conversation active id so
        // the next normal question does not resend the failed document_id.
        // Keep already-shown "(첨부: …)" message text in completedMessages.
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
        setActiveRotationQuarterTurns(0);
        nextActive = null;
      } else if (documentIdForTurn) {
        nextActive = {
          active_attachment_id: documentIdForTurn,
          active_attachment_mime: attachMimeForTurn,
          active_rotation_quarter_turns: normalizeQuarterTurns(attachTurnsForTurn),
        };
        setActiveAttachmentId(documentIdForTurn);
        setActiveAttachmentMime(attachMimeForTurn);
        setActiveRotationQuarterTurns(normalizeQuarterTurns(attachTurnsForTurn));
      } else if (activeAttachmentId) {
        nextActive = {
          active_attachment_id: activeAttachmentId,
          active_attachment_mime: activeAttachmentMime,
          active_rotation_quarter_turns: activeRotationQuarterTurns,
        };
      }

      if (customerId) {
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages: completedMessages,
          activeAttachment: nextActive,
        });
      }
      // Composer only — conversation active attachment stays.
      clearComposerAttach();

      if (authUser && customerId) {
        await persistLifeguardChatTurn(authUser, {
          sessionId,
          customerId,
          userMessage: trimmed,
          assistantMessage: finalText,
          visualBlocks,
          visualBlocksGate,
          composeMode: result.composeMode ?? null,
          responseLatencyMs: result.responseLatencyMs ?? null,
          oneKeyCoreTraceSummary: result.oneKeyCoreTraceSummary ?? null,
          activeAttachment: nextActive,
        });
        writeActiveSessionId(customerId, sessionId);
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages: completedMessages,
          activeAttachment: nextActive,
        });
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
    setTurnMirror(null);
    setInput("");
    setError("");
    setActiveAttachmentId(null);
    setActiveAttachmentMime(null);
    setActiveRotationQuarterTurns(0);
    clearComposerAttach();
    setPanelView("chat");
    if (!isDesktopSidebar) setSidebarOpen(false);
    restoreForceScrollRef.current = false;
    stickToBottomRef.current = true;
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = 0;
    }
    if (customerId) {
      writeActiveSessionId(customerId, newSessionId);
      clearLifeguardChatSnapshot(customerId);
    }
    focusChatInput();
  };

  const clearComposerAttach = () => {
    setChatAttachDocumentId(null);
    setChatAttachFilename("");
    setChatAttachError("");
    setAttachHint("");
    setChatAttachIsImage(false);
    setChatAttachQuarterTurns(0);
    setChatAttachPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearActiveAttachment = () => {
    setActiveAttachmentId(null);
    setActiveAttachmentMime(null);
    setActiveRotationQuarterTurns(0);
    if (customerId) {
      writeLifeguardChatSnapshot(customerId, {
        sessionId,
        messages,
        activeAttachment: null,
      });
    }
  };

  const applyDocumentDeletedLocally = useCallback(
    (deletedDocumentId) => {
      const deleted = String(deletedDocumentId ?? "").trim();
      if (!deleted) return;
      if (chatAttachDocumentId === deleted) {
        clearComposerAttach();
      }
      const activeMatchesDeleted = String(activeAttachmentId ?? "").trim() === deleted;
      const nextActive = clearActiveAttachmentIfDocumentDeleted(
        {
          active_attachment_id: activeAttachmentId,
          active_attachment_mime: activeAttachmentMime,
          active_rotation_quarter_turns: activeRotationQuarterTurns,
        },
        deleted,
      );
      // Deleted id matches current active → clear React state and snapshot together.
      if (activeMatchesDeleted || (!nextActive && activeAttachmentId)) {
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
        setActiveRotationQuarterTurns(0);
        if (customerId) {
          writeLifeguardChatSnapshot(customerId, {
            sessionId,
            messages,
            activeAttachment: null,
          });
        }
      }
    },
    [
      chatAttachDocumentId,
      activeAttachmentId,
      activeAttachmentMime,
      activeRotationQuarterTurns,
      customerId,
      sessionId,
      messages,
    ],
  );

  const finishDocumentDeleteResult = useCallback(
    async (result, { setLocalError }) => {
      const did = String(result?.documentId ?? "").trim();
      // Soft-delete already took effect — never restore active document_id / prior_attach.
      // Success or clear flag: drop matching activeAttachment from state + snapshot immediately.
      if (did && (result?.success || result?.clear_active_attachment)) {
        applyDocumentDeletedLocally(did);
      }
      await reloadDocuments();
      // Re-hydrate customer card so left rail drops retired / deleted-source policies.
      if (typeof session?.refreshSession === "function") {
        try {
          await session.refreshSession({ event: "document_soft_deleted", reloadJob: false });
        } catch {
          /* next session load refreshes; do not block delete UX */
        }
      }
      if (result?.success) {
        setDocumentDeleteNotice(DOCUMENT_UI_MESSAGES.deleteSuccess);
        setLocalError("");
        return;
      }
      setDocumentDeleteNotice("");
      if (result?.reason === DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED) {
        setLocalError(DOCUMENT_UI_MESSAGES.deleteClaimScrubFailed);
        return;
      }
      if (result?.reason === DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED) {
        setLocalError(DOCUMENT_UI_MESSAGES.deleteStorageRetryHint);
        return;
      }
      setLocalError(
        result?.error_message || toCustomerErrorMessage(null, "문서를 삭제하지 못했습니다."),
      );
    },
    [applyDocumentDeletedLocally, reloadDocuments, session],
  );

  const handleDeleteUploadedDocument = useCallback(
    async (documentId) => {
      if (!authUser || documentDeletingId) return;
      const did = String(documentId ?? "").trim();
      if (!did) return;
      if (!window.confirm(DOCUMENT_UI_MESSAGES.deleteConfirm)) return;
      setDocumentDeletingId(did);
      setDocumentsError("");
      setDocumentDeleteNotice("");
      try {
        const result = await softDeleteDocument(authUser, did);
        await finishDocumentDeleteResult(result, { setLocalError: setDocumentsError });
      } catch (err) {
        setDocumentsError(toCustomerErrorMessage(err, "문서를 삭제하지 못했습니다."));
      } finally {
        setDocumentDeletingId(null);
      }
    },
    [authUser, documentDeletingId, finishDocumentDeleteResult],
  );

  const handleComposerRemove = async () => {
    const did = chatAttachDocumentId;
    if (!did || !authUser) {
      clearComposerAttach();
      return;
    }
    if (!window.confirm(DOCUMENT_UI_MESSAGES.deleteConfirm)) return;
    setDocumentDeletingId(did);
    setChatAttachError("");
    setDocumentDeleteNotice("");
    try {
      const result = await softDeleteDocument(authUser, did);
      await finishDocumentDeleteResult(result, { setLocalError: setChatAttachError });
    } catch (err) {
      setChatAttachError(toCustomerErrorMessage(err, "문서를 삭제하지 못했습니다."));
    } finally {
      setDocumentDeletingId(null);
    }
  };

  const handleAttachClick = () => {
    setChatAttachError("");
    setAttachHint("");
    fileInputRef.current?.click();
  };

  const handleChatAttachSelected = async (file) => {
    if (!file) return;
    if (!authUser) {
      setChatAttachError("로그인이 필요합니다.");
      return;
    }
    if (!isChatAttachFile(file)) {
      setChatAttachError("PDF, JPG, JPEG, PNG 파일만 첨부할 수 있습니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const consentGate = await uploadFlow.ensureStorageConsentForChatAttach();
    if (!consentGate.allowUpload) {
      setChatAttachError(
        consentGate.message ||
          "문서 보관 동의가 필요합니다. 「내 문서」에서 동의를 완료해 주세요.",
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setChatAttachUploading(true);
    setChatAttachError("");
    setAttachHint("");
    setChatAttachQuarterTurns(0);
    const isImage = String(file.type || "").startsWith("image/");
    setChatAttachIsImage(isImage);
    setChatAttachPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return isImage ? URL.createObjectURL(file) : "";
    });
    try {
      // Storage keeps the original bytes (no re-encode / no orientation rewrite).
      // Server uploadDocument still re-checks DB consent (SSOT).
      const uploadResult = await uploadDocument(authUser, {
        file,
        categoryKey: "insurance_policy",
      });
      const doc = uploadResult?.document ?? null;
      const documentId = String(doc?.id ?? "").trim();
      if (!documentId) {
        throw new Error("문서 업로드 후 식별자를 받지 못했습니다.");
      }
      setChatAttachDocumentId(documentId);
      setChatAttachFilename(String(doc?.original_filename ?? file.name ?? "파일").trim());
      await loadDocumentsRef.current?.();
    } catch (err) {
      clearComposerAttach();
      setChatAttachError(toCustomerErrorMessage(err, "파일 업로드에 실패했습니다."));
    } finally {
      setChatAttachUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
    onClose: () => setSidebarOpen(false),
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
      {sidebarOpen && isDesktopSidebar ? (
        <SidebarNav {...sidebarProps} style={desktopSidebarStyle} />
      ) : null}

      {sidebarOpen && !isDesktopSidebar ? (
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
          <button
            type="button"
            aria-label={sidebarOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
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
            {sidebarOpen ? "✕" : "☰"}
          </button>
          {panelView === "chat" ? (
            <>
              <button
                type="button"
                aria-pressed={insuranceRailOpen}
                onClick={() => setInsuranceRailOpen((open) => !open)}
                style={{
                  border: `1px solid ${LG.border}`,
                  background: insuranceRailOpen ? "#EFEFEB" : LG.surface,
                  color: LG.text,
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontFamily: LG.sans,
                }}
              >
                나의 보험
              </button>
              <button
                type="button"
                aria-pressed={mirrorRailOpen}
                onClick={() => setMirrorRailOpen((open) => !open)}
                style={{
                  border: `1px solid ${LG.border}`,
                  background: mirrorRailOpen ? "#EFEFEB" : LG.surface,
                  color: LG.text,
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontFamily: LG.sans,
                  marginLeft: "auto",
                }}
              >
                KEY 확인
              </button>
            </>
          ) : null}
        </header>

        <div
          style={{
            flex: 1,
            display: "flex",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {showInsuranceRail ? (
            <KeyMyInsuranceRail policies={policies} loading={loadingSession} />
          ) : null}

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
            }}
          >
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
            padding: "24px 20px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            maxWidth: showInsuranceRail || showMirrorRail ? "none" : "720px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          {panelView === "insurance" ? (
            <LayerPanel title="내 보험 점검" onBack={goBackToChat}>
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
              {documentDeleteNotice ? (
                <p style={{ margin: "0 0 12px", color: LG.text, fontSize: "14px", lineHeight: 1.55 }}>
                  {documentDeleteNotice}{" "}
                  <span style={{ color: LG.textMuted }}>{DOCUMENT_UI_MESSAGES.deleteUploadHint}</span>
                </p>
              ) : null}
              <CustomerDocumentsList
                documents={documents}
                loading={documentsLoading}
                error={documentsError}
                deletingId={documentDeletingId}
                onDeleteDocument={handleDeleteUploadedDocument}
              />
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
                      whiteSpace: msg.role === "assistant" && !msg.thinking ? "normal" : "pre-wrap",
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                    aria-live={msg.thinking ? "polite" : undefined}
                  >
                    {msg.role === "assistant" && !msg.thinking ? (
                      <LifeguardAssistantMarkdown
                        text={msg.content}
                        muted={false}
                        fontFamily={LG.sans}
                      />
                    ) : (
                      msg.content
                    )}
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
              maxWidth: showInsuranceRail || showMirrorRail ? "none" : "720px",
              width: "100%",
              margin: "0 auto",
              background: LG.bg,
              flexShrink: 0,
            }}
          >
            {error ? <div style={{ color: "#B91C1C", fontSize: "13px", marginBottom: "8px" }}>{error}</div> : null}
            {chatAttachError ? (
              <div style={{ color: "#B91C1C", fontSize: "13px", marginBottom: "8px" }}>{chatAttachError}</div>
            ) : null}
            {attachHint ? (
              <div style={{ color: LG.textMuted, fontSize: "13px", marginBottom: "8px" }}>{attachHint}</div>
            ) : null}
            {chatAttachUploading ? (
              <div style={{ color: LG.textMuted, fontSize: "13px", marginBottom: "8px" }}>
                파일 업로드 중…
              </div>
            ) : null}
            {chatAttachDocumentId && !chatAttachUploading ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: LG.text,
                }}
              >
                {chatAttachIsImage && chatAttachPreviewUrl ? (
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <img
                      src={chatAttachPreviewUrl}
                      alt="첨부 미리보기"
                      style={{
                        width: "96px",
                        height: "96px",
                        objectFit: "contain",
                        borderRadius: "8px",
                        background: "#fff",
                        border: `1px solid ${LG.border}`,
                        transform: `rotate(${quarterTurnsToDegrees(chatAttachQuarterTurns)}deg)`,
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: 1 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        첨부됨: {chatAttachFilename || "이미지"}
                      </span>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setChatAttachQuarterTurns((t) => wrapQuarterTurns(t - 1))
                          }
                          style={{
                            border: `1px solid ${LG.border}`,
                            background: LG.surface,
                            borderRadius: "8px",
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontFamily: LG.sans,
                          }}
                        >
                          왼쪽 90°
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setChatAttachQuarterTurns((t) => wrapQuarterTurns(t + 1))
                          }
                          style={{
                            border: `1px solid ${LG.border}`,
                            background: LG.surface,
                            borderRadius: "8px",
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontFamily: LG.sans,
                          }}
                        >
                          오른쪽 90°
                        </button>
                        <span style={{ color: LG.textMuted, fontSize: "12px" }}>
                          {quarterTurnsToDegrees(chatAttachQuarterTurns)}°
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    첨부됨: {chatAttachFilename || "파일"}
                  </span>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    aria-label={DOCUMENT_UI_MESSAGES.deleteAction}
                    disabled={Boolean(documentDeletingId)}
                    onClick={() => {
                      void handleComposerRemove();
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: documentDeletingId ? LG.textSoft : "#B91C1C",
                      cursor: documentDeletingId ? "default" : "pointer",
                      fontSize: "13px",
                      fontFamily: LG.sans,
                    }}
                  >
                    {documentDeletingId === chatAttachDocumentId
                      ? "삭제 중…"
                      : `🗑 ${DOCUMENT_UI_MESSAGES.deleteAction}`}
                  </button>
                </div>
              </div>
            ) : null}
            {!chatAttachDocumentId && !chatAttachUploading && activeAttachmentId ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "8px",
                  fontSize: "12px",
                  color: LG.textMuted,
                }}
              >
                <span>이 대화의 이전 첨부 사진을 참조할 수 있습니다.</span>
                <button
                  type="button"
                  onClick={clearActiveAttachment}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: LG.textMuted,
                    cursor: "pointer",
                    fontSize: "12px",
                    fontFamily: LG.sans,
                  }}
                >
                  첨부 참조 해제
                </button>
              </div>
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
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept={CHAT_ATTACH_FILE_ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleChatAttachSelected(file);
                }}
              />
              <button
                type="button"
                aria-label="첨부"
                onClick={handleAttachClick}
                disabled={isDisabled || chatAttachUploading || loading || streaming}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: LG.textMuted,
                  cursor: chatAttachUploading ? "default" : "pointer",
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
                disabled={isDisabled || chatAttachUploading}
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
                disabled={
                  isDisabled ||
                  loading ||
                  streaming ||
                  chatAttachUploading ||
                  !input.trim()
                }
                onClick={() => submitQuestion(input)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: input.trim() && !chatAttachUploading ? LG.text : LG.textSoft,
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: input.trim() && !chatAttachUploading ? "pointer" : "default",
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

          {showMirrorRail ? <KeyTurnMirrorRail mirror={turnMirror} /> : null}
        </div>
      </div>
    </div>
  );
}
