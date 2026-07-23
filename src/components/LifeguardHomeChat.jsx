import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import KeyVisualBlocks from "./KeyVisualBlocks.jsx";
import KeyCustomerLeftRail from "./KeyCustomerLeftRail.jsx";
import KeyCustomerRightRail from "./KeyCustomerRightRail.jsx";
import KeyNowActionCard from "./KeyNowActionCard.jsx";
import KeyInsuranceDetailDrawer from "./KeyInsuranceDetailDrawer.jsx";
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
  clearActiveAttachmentIfDocumentDeleted,
  extractActiveAttachmentFromSessionMessages,
  isReusableActiveAttachmentId,
  normalizeActiveAttachment,
  scrubDeletedDocumentFromMessageActiveAttachments,
  shouldClearActiveAttachmentAfterTurn,
} from "../lib/chatActiveAttachment.js";
import { fetchHomeBrainFactStream, mapHomeBrainFactPayload } from "../lib/customerHomeBrainFact.js";
import { fetchMyCorporateEntities } from "../lib/keyMyCorporateEntities.js";
import {
  buildCustomerUiFinalShellModel,
  buildHandSnapshotFromDetailsJson,
  buildKeyPresentationStatusStrip,
  formatCustomerDocumentFactoryStatus,
  formatCustomerDocumentStorageStatus,
  resolvePdfWaitStatusText,
} from "../lib/keyPresentationStatusStrip.js";
import {
  getReadyCardHandoffToken,
  warmKeyReadyCard,
  warmKeyReadyCardFireAndForget,
  clearReadyCardHandoffToken,
} from "../lib/keyReadyCardWarm.js";
import {
  hasPresenceRanThisSession,
  markPresenceRanThisSession,
} from "../lib/keyPresenceSession.js";
import {
  beginInflightHomeChatTurn,
  clearLifeguardChatSnapshot,
  createLifeguardSessionId,
  endInflightHomeChatTurn,
  isInflightHomeChatTurnActive,
  listLifeguardRecentSessions,
  loadLifeguardSessionMessages,
  mergeRestoredSessionMessages,
  patchInflightHomeChatTurn,
  persistKeyPresenceMessage,
  persistLifeguardChatTurn,
  persistLifeguardPresenceTurn,
  readActiveSessionId,
  readInflightHomeChatTurn,
  readLifeguardChatSnapshot,
  rejectClearedActiveAttachment,
  rememberClearedActiveAttachmentId,
  resolveActiveLifeguardSessionId,
  subscribeInflightHomeChatTurn,
  writeActiveSessionId,
  writeLifeguardChatSnapshot,
} from "../lib/lifeguardChatSessions.js";
import { appendHomeChatStreamTrace } from "../lib/keyAnalysisCompleteSessionTransition.js";
import { supabase } from "../lib/supabase.js";
import { buildKeyChatPresenceMessage } from "../lib/keyChatPresenceWire.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  FINAL_UI,
  FINAL_UI_ROOM_CSS,
  FINAL_UI_SCROLLBAR_CSS,
} from "../lib/customerUiFinalTokens.js";
import {
  DOCUMENT_UI_MESSAGES,
  formatDocClass,
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
import {
  buildBaselineDetailForDrawer,
  buildIndustryCoverageBaseline,
  buildKeyTurnMirror,
  buildMyInsuranceStatus,
  sumConfirmedMonthlyPremium,
} from "../lib/keyInsuranceScreenFacts.js";

const ROOM_MID_BREAKPOINT = 1024;
const ROOM_WIDE_BREAKPOINT = 1280;

function HeaderLogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 19.5 5.2v5.4c0 5.1-3.4 8.9-7.5 10.9C8 19.5 4.5 15.7 4.5 10.6V5.2L12 2.5Z"
        fill={FINAL_UI.teal}
      />
      <path
        d="M9.2 12.1 11 13.9l3.8-4.2"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeaderIconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeaderIconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 .1 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    borderRadius: "10px",
    border: "none",
    background: active ? "rgba(15, 138, 122, 0.12)" : "transparent",
    color: active ? FINAL_UI.text : FINAL_UI.muted,
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontFamily: FINAL_UI.sans,
  };
}

function scopeBtnStyle(active) {
  return {
    border: "1px solid transparent",
    background: active
      ? `linear-gradient(135deg, ${FINAL_UI.navy}, #176B60)`
      : "rgba(255,255,255,0.75)",
    borderRadius: "999px",
    padding: "6px 14px",
    fontSize: `${FINAL_UI.tabSize}px`,
    color: active ? "#fff" : FINAL_UI.text,
    fontWeight: 700,
    cursor: "pointer",
    /* V3.1 SSOT .scope button: no font-family → UA (Arial) */
    height: `${Math.max(28, FINAL_UI.tabsH - 8)}px`,
    boxSizing: "border-box",
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

function formatDocumentStatusLines(document) {
  const storage = formatCustomerDocumentStorageStatus(document);
  const factory = formatCustomerDocumentFactoryStatus(document);
  return { storage, factory };
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

function CustomerInsuranceList({ policies, loading, emptyHint = null }) {
  if (loading) {
    return <p style={{ margin: 0, color: LG.textMuted }}>보험 정보를 불러오는 중…</p>;
  }
  if (!policies.length) {
    return (
      <p style={{ margin: 0, color: LG.textMuted }}>
        {emptyHint ||
          "아직 등록된 보험이 없어요. 필요하면 대화에서 편하게 말씀해 주세요."}
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
              {(() => {
                const lines = formatDocumentStatusLines(document);
                return (
                  <>
                    {lines.storage ? <div>원본: {lines.storage}</div> : null}
                    {lines.factory ? <div>자동 정리: {lines.factory}</div> : null}
                    {!lines.storage && document.ingest_status === "failed" ? (
                      <div style={{ color: "#B91C1C" }}>업로드 실패</div>
                    ) : null}
                  </>
                );
              })()}
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
  onOpenInsurancePanel = null,
  onOpenBaselinePanel = null,
  onSignOut,
  onClose = null,
  style = {},
}) {
  return (
    <aside style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <div
          style={{
            flex: 1,
            fontFamily: LG.serif,
            fontSize: "18px",
            fontWeight: 600,
            color: FINAL_UI.text,
            letterSpacing: "0.04em",
          }}
        >
          LIFEGUARD
        </div>
        {typeof onClose === "function" ? (
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: LG.textSoft,
              borderRadius: "8px",
              width: "36px",
              height: "36px",
              cursor: "pointer",
              flexShrink: 0,
              fontSize: "18px",
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <button type="button" onClick={onNewChat} style={{ ...sidebarBtn(false), flex: 1 }}>
          새 대화
        </button>
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
        <button
          type="button"
          style={sidebarBtn(panelView === "insurance")}
          onClick={() => {
            if (typeof onOpenInsurancePanel === "function") onOpenInsurancePanel();
            else onPanelChange("insurance");
          }}
        >
          내 보험 점검
        </button>
        {typeof onOpenBaselinePanel === "function" ? (
          <button type="button" style={sidebarBtn(false)} onClick={() => onOpenBaselinePanel()}>
            기준선
          </button>
        ) : null}
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
  const messagesRef = useRef([]);
  const threadRestoreReadyRef = useRef(false);
  const inflightTurnIdRef = useRef(null);
  /** T6 — abort Presence when customer question wins. */
  const presenceAbortRef = useRef(null);
  const presenceTurnIdRef = useRef(null);
  const presenceActiveRef = useRef(false);
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
  // Unified view — React state only; new session defaults personal (no auto entity restore).
  const [viewMode, setViewMode] = useState("personal");
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [corporateEntities, setCorporateEntities] = useState([]);
  const [handSnapshot, setHandSnapshot] = useState(null);
  const [doneStatusOverlay, setDoneStatusOverlay] = useState(null);
  const [turnMirror, setTurnMirror] = useState(null);
  const [detailDrawer, setDetailDrawer] = useState(null);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [insuranceRailOpen, setInsuranceRailOpen] = useState(false);
  const [mirrorRailOpen, setMirrorRailOpen] = useState(false);
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
  // Conversation-scoped active attachment (survives composer clear).
  const [activeAttachmentId, setActiveAttachmentId] = useState(null);
  const [activeAttachmentMime, setActiveAttachmentMime] = useState(null);
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
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    threadRestoreReadyRef.current = threadRestoreReady;
  }, [threadRestoreReady]);

  useEffect(() => {
    appendHomeChatStreamTrace("home_chat_mount");
    const unsubscribe = subscribeInflightHomeChatTurn((turn) => {
      const cid = customerIdRef.current;
      if (!turn || !cid || String(turn.customerId) !== String(cid)) return;
      if (String(turn.sessionId) !== String(sessionIdRef.current)) {
        setSessionId(turn.sessionId);
      }
      setMessages(turn.messages);
      setLoading(Boolean(turn.loading));
      setStreaming(Boolean(turn.streaming));
      if (turn.activeAttachment?.active_attachment_id) {
        setActiveAttachmentId(turn.activeAttachment.active_attachment_id);
        setActiveAttachmentMime(turn.activeAttachment.active_attachment_mime ?? null);
      }
    });
    return () => {
      appendHomeChatStreamTrace("home_chat_unmount");
      unsubscribe();
    };
  }, []);

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
      // HomeChat: never inject document-intake / upload acknowledgment bubbles.
      // Original + customer question go to Claude-first; only that answer is shown.
      const hasNonUploadPresence =
        String(keyInitiativeSentence ?? "").trim() ||
        String(keyBridgeSentence ?? "").trim() ||
        String(keyReturnJudgmentSentence ?? "").trim();
      if (!hasNonUploadPresence) return;

      const presenceMessage = buildKeyChatPresenceMessage({
        keyFirstSentence: null,
        keyFollowUpSentence: null,
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

  const isMidRoom = useMediaQuery(`(min-width: ${ROOM_MID_BREAKPOINT}px)`);
  const isWideRoom = useMediaQuery(`(min-width: ${ROOM_WIDE_BREAKPOINT}px)`);

  useEffect(() => {
    // Inline rails on mid/wide — close mobile/tablet sheets so they never cover the shell.
    if (isMidRoom) setInsuranceRailOpen(false);
    if (isWideRoom) setMirrorRailOpen(false);
  }, [isMidRoom, isWideRoom]);

  const coverageBaseline = useMemo(
    () => buildIndustryCoverageBaseline(policies),
    [policies],
  );
  const insuranceStatus = useMemo(() => buildMyInsuranceStatus(policies), [policies]);
  const monthlyPremiumSum = useMemo(() => sumConfirmedMonthlyPremium(policies), [policies]);

  const showInsuranceInline = panelView === "chat" && isMidRoom;
  const showLeftSheet = panelView === "chat" && insuranceRailOpen && !isMidRoom;
  const showMirrorInline = panelView === "chat" && isWideRoom;
  const showRightSheet = panelView === "chat" && mirrorRailOpen && !isWideRoom;

  const finalShell = useMemo(
    () =>
      buildCustomerUiFinalShellModel({
        insuranceStatus,
        monthlyPremiumSum,
        coverageBaseline,
        handSnapshot,
        viewMode,
        entityId: selectedEntityId,
      }),
    [
      insuranceStatus,
      monthlyPremiumSum,
      coverageBaseline,
      handSnapshot,
      viewMode,
      selectedEntityId,
    ],
  );
  const nameInitial = String(displayName || "고").trim().slice(0, 1) || "고";
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
    setSidebarOpen(false);
    focusChatInput();
  }, [focusChatInput]);

  useEffect(() => {
    if (panelView === "chat") focusChatInput();
  }, [panelView, focusChatInput]);

  useEffect(() => {
    if (panelView === "chat" && !loading) focusChatInput();
  }, [loading, panelView, messages.length, focusChatInput]);

  // Menu is always an overlay drawer — never occupies main layout width.
  useEffect(() => {
    setSidebarOpen(false);
  }, [isMidRoom]);

  useEffect(() => {
    if (panelView !== "documents" || !authUser) return undefined;
    reloadDocuments();
    return undefined;
  }, [panelView, authUser, reloadDocuments]);

  useEffect(() => {
    if (!authUser) {
      setCorporateEntities([]);
      setSelectedEntityId(null);
      setViewMode("personal");
      setHandSnapshot(null);
      return undefined;
    }
    // Wait for session bootstrap — early token race left corporateEntities stuck at [].
    if (loadingSession) return undefined;
    let cancelled = false;
    void fetchMyCorporateEntities()
      .then((result) => {
        if (cancelled) return;
        setCorporateEntities(Array.isArray(result?.entities) ? result.entities : []);
        // Never auto-select even when exactly one entity exists.
      })
      .catch(() => {
        if (cancelled) return;
        setCorporateEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, loadingSession]);

  // KEY Hand SSOT (profile_health) — display-only strip; no Claude / no new judgment.
  const reloadHandSnapshot = useCallback(async () => {
    if (!customerId) {
      setHandSnapshot(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("profile_health")
        .select("details_json")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (error) return;
      setHandSnapshot(buildHandSnapshotFromDetailsJson(data?.details_json ?? null));
    } catch {
      /* non-blocking */
    }
  }, [customerId]);

  useEffect(() => {
    void reloadHandSnapshot();
  }, [reloadHandSnapshot, viewMode, selectedEntityId, messages.length]);

  // Home chat: hydrate document_storage consent from DB (never treat unknown as denied).
  useEffect(() => {
    if (!authUser) return undefined;
    void uploadFlow.hydrateStorageConsent();
    return undefined;
  }, [authUser, uploadFlow.hydrateStorageConsent]);

  useEffect(() => {
    if (!authUser || !customerId || loadingSession) return undefined;
    let cancelled = false;

    // A: in-flight turn — keep central chat messages; do not reboot the thread.
    const inflight = readInflightHomeChatTurn(customerId);
    if (inflight && isInflightHomeChatTurnActive(customerId)) {
      setSessionId(inflight.sessionId);
      writeActiveSessionId(customerId, inflight.sessionId);
      setMessages(inflight.messages);
      setLoading(Boolean(inflight.loading));
      setStreaming(Boolean(inflight.streaming));
      if (inflight.activeAttachment?.active_attachment_id) {
        setActiveAttachmentId(inflight.activeAttachment.active_attachment_id);
        setActiveAttachmentMime(inflight.activeAttachment.active_attachment_mime ?? null);
      }
      setPanelView("chat");
      setThreadRestoreReady(true);
      restoreForceScrollRef.current = true;
      warmKeyReadyCardFireAndForget({
        sessionId: inflight.sessionId,
        customerId,
      });
      // Rails/thread index may refresh; message list stays on inflight.
      void listLifeguardRecentSessions(authUser, { customerId })
        .then((recent) => {
          if (!cancelled) setThreads(recent);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    const keepVisibleThread =
      threadRestoreReadyRef.current && Array.isArray(messagesRef.current) && messagesRef.current.length > 0;
    if (!keepVisibleThread) {
      setThreadRestoreReady(false);
      restoreForceScrollRef.current = true;
    }

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
          if (restored.length > 0) {
            appendHomeChatStreamTrace("persisted_answer_reload");
          }
        }

        if (cancelled) return;

        // Re-check: a turn may have started while restore was in flight.
        if (isInflightHomeChatTurnActive(customerId)) {
          const live = readInflightHomeChatTurn(customerId);
          if (live) {
            setMessages(live.messages);
            setLoading(Boolean(live.loading));
            setStreaming(Boolean(live.streaming));
            setThreadRestoreReady(true);
            warmKeyReadyCardFireAndForget({
              sessionId: live.sessionId || activeId,
              customerId,
            });
            return;
          }
        }

        if (restored.length > 0) {
          setMessages((prev) => {
            const base = seed.length > 0 ? seed : prev;
            // B: merge keeps streamed customer_answer; restored may only refresh older rows.
            return mergeRestoredSessionMessages(base, restored);
          });
          const fromRestored = extractActiveAttachmentFromSessionMessages(restored);
          const fromSnap = normalizeActiveAttachment(snapshot?.activeAttachment ?? null);
          const candidate =
            fromRestored ||
            (String(snapshot?.sessionId) === String(activeId) ? fromSnap : null);
          // Soft-deleted document_ids stay cleared across refresh (message metadata may still name them).
          const active = rejectClearedActiveAttachment(candidate, customerId);
          if (active) {
            setActiveAttachmentId(active.active_attachment_id);
            setActiveAttachmentMime(active.active_attachment_mime);
          } else if (!keepVisibleThread) {
            setActiveAttachmentId(null);
            setActiveAttachmentMime(null);
          }
          setPanelView("chat");
        } else if (seed.length > 0) {
          // Remount before DB indexed the just-completed turn — keep local snapshot.
          setMessages((prev) => mergeRestoredSessionMessages(seed.length > 0 ? seed : prev, []));
          const fromSnap = normalizeActiveAttachment(snapshot?.activeAttachment ?? null);
          const active =
            fromSnap && String(snapshot?.sessionId) === String(activeId)
              ? rejectClearedActiveAttachment(fromSnap, customerId)
              : null;
          if (active) {
            setActiveAttachmentId(active.active_attachment_id);
            setActiveAttachmentMime(active.active_attachment_mime);
          } else {
            setActiveAttachmentId(null);
            setActiveAttachmentMime(null);
          }
          setPanelView("chat");
        } else if (!keepVisibleThread) {
          setActiveAttachmentId(null);
          setActiveAttachmentMime(null);
        }

        setThreadRestoreReady(true);
        warmKeyReadyCardFireAndForget({ sessionId: activeId, customerId });
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

  // Triangle T6 — KEY Presence (listen_focus) after READY CARD warm; cancel on customer question.
  useEffect(() => {
    if (!authUser || !customerId || loadingSession || !threadRestoreReady) return undefined;
    if (!sessionId) return undefined;
    if (loading || streaming) return undefined;
    if (isInflightHomeChatTurnActive(customerId)) return undefined;
    if (hasPresenceRanThisSession(customerId, sessionId)) return undefined;

    let cancelled = false;
    const ac = new AbortController();
    presenceAbortRef.current = ac;

    (async () => {
      try {
        const warm = await warmKeyReadyCard({ sessionId, customerId });
        if (cancelled || ac.signal.aborted) return;
        markPresenceRanThisSession(customerId, sessionId);
        const candidates = Number(warm?.presence_candidate_count ?? 0) || 0;
        if (!warm?.ok || candidates < 1 || !warm?.handoff_token_present) {
          return;
        }
        if (loading || streaming || isInflightHomeChatTurnActive(customerId)) return;

        const turnId = createLifeguardSessionId();
        presenceTurnIdRef.current = turnId;
        presenceActiveRef.current = true;
        const handoffToken = getReadyCardHandoffToken({ customerId, sessionId });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "",
            thinking: true,
            turnId,
            presenceTurn: true,
          },
        ]);

        let streamedText = "";
        const result = await fetchHomeBrainFactStream(
          "",
          [],
          {
            onDelta: (chunk) => {
              if (ac.signal.aborted) return;
              const piece = String(chunk ?? "");
              if (!piece) return;
              streamedText += piece;
              setMessages((prev) =>
                prev.map((m) =>
                  m.turnId === turnId && m.presenceTurn === true
                    ? { ...m, content: streamedText, thinking: false }
                    : m,
                ),
              );
            },
            onDone: () => {},
          },
          {
            sessionId,
            presence: true,
            signal: ac.signal,
            ...(handoffToken ? { readyCardHandoffToken: handoffToken } : {}),
          },
        );

        if (cancelled || ac.signal.aborted) {
          setMessages((prev) =>
            prev.filter(
              (m) =>
                !(
                  m.turnId === turnId &&
                  m.presenceTurn === true &&
                  !String(m.content ?? "").trim()
                ),
            ),
          );
          return;
        }

        const finalText = String(result?.answerText ?? streamedText ?? "").trim();
        presenceActiveRef.current = false;
        presenceTurnIdRef.current = null;
        if (!finalText || result?.presenceQuiet === true) {
          setMessages((prev) =>
            prev.filter((m) => !(m.turnId === turnId && m.presenceTurn === true)),
          );
          return;
        }

        setMessages((prev) => {
          const next = prev.map((m) =>
            m.turnId === turnId && m.presenceTurn === true
              ? { ...m, content: finalText, thinking: false, presenceTurn: true }
              : m,
          );
          if (customerId) {
            writeLifeguardChatSnapshot(customerId, {
              sessionId,
              messages: next,
              activeAttachment: activeAttachmentId
                ? {
                    active_attachment_id: activeAttachmentId,
                    active_attachment_mime: activeAttachmentMime,
                    active_rotation_quarter_turns: 0,
                  }
                : null,
            });
          }
          return next;
        });

        // T4 — persist must not block customer stream (already done).
        void persistLifeguardPresenceTurn(authUser, {
          sessionId,
          customerId,
          assistantMessage: finalText,
          keyConsultationRecord: result?.keyConsultationRecord ?? null,
        }).catch(() => {});
      } catch (err) {
        presenceActiveRef.current = false;
        presenceTurnIdRef.current = null;
        if (err?.name === "AbortError" || ac.signal.aborted || cancelled) {
          setMessages((prev) =>
            prev.filter(
              (m) =>
                !(m.presenceTurn === true && (!String(m.content ?? "").trim() || m.thinking)),
            ),
          );
          return;
        }
        setMessages((prev) => prev.filter((m) => m.presenceTurn !== true || String(m.content ?? "").trim()));
      } finally {
        if (presenceAbortRef.current === ac) presenceAbortRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    };
  }, [
    authUser,
    customerId,
    loadingSession,
    threadRestoreReady,
    sessionId,
    loading,
    streaming,
    activeAttachmentId,
    activeAttachmentMime,
  ]);

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
      restoreForceScrollRef.current = true;
      stickToBottomRef.current = true;

      try {
        const restored = await loadLifeguardSessionMessages(authUser, targetSessionId, { customerId });
        setMessages(restored);
        const active = rejectClearedActiveAttachment(
          extractActiveAttachmentFromSessionMessages(restored),
          customerId,
        );
        if (active) {
          setActiveAttachmentId(active.active_attachment_id);
          setActiveAttachmentMime(active.active_attachment_mime);
        } else {
          setActiveAttachmentId(null);
          setActiveAttachmentMime(null);
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
        clearLifeguardChatSnapshot(customerId);
        setError(toCustomerErrorMessage(err, "대화를 불러오지 못했습니다."));
      } finally {
        setThreadRestoreReady(true);
        clearReadyCardHandoffToken();
        warmKeyReadyCardFireAndForget({ sessionId: targetSessionId, customerId });
        focusChatInput();
      }
    },
    [authUser, customerId, focusChatInput],
  );

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || isDisabled || loading || !threadRestoreReady) return;
    if (chatAttachUploading) {
      setError("파일 업로드가 끝난 뒤 보내 주세요.");
      return;
    }

    // T6 — customer question always wins over Presence (single active stream).
    if (presenceAbortRef.current) {
      try {
        presenceAbortRef.current.abort();
      } catch {
        /* ignore */
      }
      presenceAbortRef.current = null;
    }
    presenceActiveRef.current = false;
    const presenceTurnId = presenceTurnIdRef.current;
    presenceTurnIdRef.current = null;
    if (presenceTurnId) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last?.role === "assistant" &&
          last?.presenceTurn === true &&
          last?.turnId === presenceTurnId &&
          (last?.thinking === true || !String(last?.content ?? "").trim())
        ) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }

    const composerDocumentId = chatAttachDocumentId;
    const composerIsImage = chatAttachIsImage;
    const composerFilename = chatAttachFilename;

    let documentIdForTurn = composerDocumentId;
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
        attachMimeForTurn = activeAttachmentMime;
        attachIsImageForTurn =
          !activeAttachmentMime || String(activeAttachmentMime).startsWith("image/");
        reusedActiveAttachment = true;
      } else {
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
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
    setSidebarOpen(false);
    const turnId = createLifeguardSessionId();
    inflightTurnIdRef.current = turnId;
    appendHomeChatStreamTrace("chat_submit");
    const activeAttachmentForTurn = activeAttachmentId
      ? {
          active_attachment_id: activeAttachmentId,
          active_attachment_mime: activeAttachmentMime,
          active_rotation_quarter_turns: 0,
        }
      : null;
    const userMessage = {
      role: "user",
      content: composerDocumentId
        ? `${trimmed}\n\n(첨부: ${composerFilename || "파일"})`
        : trimmed,
      turnId,
    };
    const nextMessages = [...messages, userMessage];
    let liveMessages = [
      ...nextMessages,
      (() => {
        const wait = resolvePdfWaitStatusText({
          hasDocumentAttach: Boolean(composerDocumentId || documentIdForTurn),
        });
        return {
          role: "assistant",
          content: wait.primary,
          thinking: true,
          turnId,
          wait_secondary: wait.secondary,
        };
      })(),
    ];
    const syncLiveMessages = (nextLive, extra = {}) => {
      liveMessages = nextLive;
      setMessages(nextLive);
      if (customerId) {
        patchInflightHomeChatTurn(turnId, {
          messages: nextLive,
          activeAttachment: activeAttachmentForTurn,
          ...extra,
        });
      }
    };
    setMessages(liveMessages);
    setInput("");
    focusChatInput();
    setLoading(true);
    setStreaming(false);
    setError("");
    if (customerId) {
      beginInflightHomeChatTurn({
        customerId,
        sessionId,
        turnId,
        messages: liveMessages,
        activeAttachment: activeAttachmentForTurn,
      });
    }

    try {
      const historyMessages = nextMessages.slice(0, -1);
      const history = historyMessages.map((m) => ({ role: m.role, content: m.content }));
      appendHomeChatStreamTrace("home_brain_request_start");

      let streamedText = "";
      let receivedDelta = false;
      let sawFirstSseEvent = false;
      let sawSseDone = false;
      // GO3: session_id only — server SSOT loads session_goal; never send prior_session_goal.
      const handoffToken = getReadyCardHandoffToken({ customerId, sessionId });
      let attachOptions = {
        sessionId,
        ...(documentIdForTurn ? { documentId: documentIdForTurn } : {}),
        ...(handoffToken ? { readyCardHandoffToken: handoffToken } : {}),
        viewMode,
        ...(viewMode !== "personal" && selectedEntityId
          ? { entityId: selectedEntityId, entityType: "corporate" }
          : {}),
      };
      // Reused active attachment — server re-verifies ownership (no latest-doc invent).
      if (reusedActiveAttachment) {
        attachOptions = { ...attachOptions, priorAttachFollowUp: true };
      }
      const markFirstSse = () => {
        if (sawFirstSseEvent) return;
        sawFirstSseEvent = true;
        appendHomeChatStreamTrace("sse_first_event");
      };
      const markSseDone = () => {
        if (sawSseDone) return;
        sawSseDone = true;
        appendHomeChatStreamTrace("sse_done");
      };
      const patchAssistantContent = (text, extra = {}) => {
        syncLiveMessages(
          patchLastAssistantMessage(liveMessages, {
            content: text,
            thinking: false,
            turnId,
            ...extra,
          }),
          { phase: "streaming", loading: false, streaming: true, streamedCommitted: true },
        );
      };
      const result = await fetchHomeBrainFactStream(
        trimmed,
        history,
        {
          onAck: (ackText) => {
            markFirstSse();
            // Short customer status only — do not list internal search/doc stage names.
            const pdfWait = resolvePdfWaitStatusText({
              hasDocumentAttach: Boolean(documentIdForTurn),
            });
            const text = String(ackText ?? "").trim() || pdfWait.primary;
            const safe =
              text.length > 80 || /SSE|Claude|tool|phase|trace/i.test(text)
                ? pdfWait.primary
                : text;
            syncLiveMessages(
              patchLastAssistantMessage(liveMessages, {
                content: safe,
                thinking: true,
                turnId,
                wait_secondary: pdfWait.secondary,
              }),
              { phase: "awaiting", loading: true, streaming: false },
            );
          },
          onDelta: (chunk) => {
            markFirstSse();
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
            markFirstSse();
            markSseDone();
            const mapped = mapHomeBrainFactPayload(payload ?? {});
            const visualBlocks = Array.isArray(mapped.visualBlocks) ? mapped.visualBlocks : [];
            if (visualBlocks.length === 0) return;
            syncLiveMessages(
              patchLastAssistantMessage(liveMessages, {
                visual_blocks: visualBlocks,
                visual_blocks_gate: mapped.visualBlocksGate ?? null,
                thinking: false,
                turnId,
              }),
              { phase: "committing", loading: false, streaming: true, streamedCommitted: true },
            );
          },
        },
        attachOptions,
      );
      if (!sawFirstSseEvent) {
        appendHomeChatStreamTrace("sse_first_event");
      }
      markSseDone();

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
      const turnSessionGoal =
        result.sessionGoal && typeof result.sessionGoal === "object"
          ? result.sessionGoal
          : null;
      if (result.keyStatus) setDoneStatusOverlay(result.keyStatus);
      void reloadHandSnapshot();
      const stripForTurn = buildKeyPresentationStatusStrip({
        handSnapshot,
        doneStatus: result.keyStatus ?? doneStatusOverlay,
        viewMode,
        entityId: selectedEntityId,
      });
      const completedMessages = [
        ...nextMessages,
        {
          role: "assistant",
          content: finalText,
          thinking: false,
          turnId,
          visual_blocks: visualBlocks,
          visual_blocks_gate: visualBlocksGate,
          key_status_strip: stripForTurn,
          ...(turnSessionGoal
            ? {
                session_goal: turnSessionGoal,
                metadata: { session_goal: turnSessionGoal },
              }
            : {}),
        },
      ];
      appendHomeChatStreamTrace("streamed_answer_commit");
      syncLiveMessages(completedMessages, {
        phase: "committing",
        loading: false,
        streaming: false,
        streamedCommitted: true,
      });
      // Turn mirror kept for internal continuity; right rail shows baseline (non-blocking).
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
        nextActive = null;
      } else if (documentIdForTurn) {
        nextActive = {
          active_attachment_id: documentIdForTurn,
          active_attachment_mime: attachMimeForTurn,
          active_rotation_quarter_turns: 0,
        };
        setActiveAttachmentId(documentIdForTurn);
        setActiveAttachmentMime(attachMimeForTurn);
      } else if (activeAttachmentId) {
        nextActive = {
          active_attachment_id: activeAttachmentId,
          active_attachment_mime: activeAttachmentMime,
          active_rotation_quarter_turns: 0,
        };
      }

      if (customerId) {
        patchInflightHomeChatTurn(turnId, {
          messages: completedMessages,
          activeAttachment: nextActive,
          phase: "committing",
          loading: false,
          streaming: false,
          streamedCommitted: true,
        });
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages: completedMessages,
          activeAttachment: nextActive,
          preserveThinking: false,
          turnId,
          phase: "committed",
        });
      }
      // Composer only — conversation active attachment stays.
      clearComposerAttach();

      if (authUser && customerId) {
        try {
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
            sessionGoal: turnSessionGoal,
            keyConsultationRecord: result.keyConsultationRecord ?? null,
          });
        } catch {
          // Fail-soft: customer answer already on screen; do not retry (would duplicate rows).
        }
        writeActiveSessionId(customerId, sessionId);
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages: completedMessages,
          activeAttachment: nextActive,
          turnId,
          phase: "committed",
        });
        const recent = await listLifeguardRecentSessions(authUser, { customerId });
        setThreads(recent);
      }

      // KEY persist + deferred factory may update chart/baseline — refresh left/right rails only.
      // B: do not let unified-state refresh replace the streamed customer_answer for this turn.
      if (
        documentIdForTurn &&
        typeof session?.refreshSession === "function" &&
        !shouldClearActiveAttachmentAfterTurn(result)
      ) {
        try {
          await session.refreshSession({
            event: "claude_first_attach_persisted",
            reloadJob: false,
          });
          // Rails-only refresh: keep this turn's streamed answer as the screen value.
          setMessages(completedMessages);
        } catch {
          /* next session load refreshes; do not block customer answer */
        }
      }
      endInflightHomeChatTurn(turnId);
      inflightTurnIdRef.current = null;
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.thinking) {
          copy.pop();
        }
        return copy;
      });
      endInflightHomeChatTurn(turnId);
      inflightTurnIdRef.current = null;
      setError(toCustomerErrorMessage(err, "질문에 답변하지 못했습니다."));
    } finally {
      setLoading(false);
      setStreaming(false);
      focusChatInput();
    }
  };

  const startNewChat = () => {
    const newSessionId = createLifeguardSessionId();
    endInflightHomeChatTurn(inflightTurnIdRef.current);
    inflightTurnIdRef.current = null;
    setSessionId(newSessionId);
    setMessages([]);
    setTurnMirror(null);
    setInput("");
    setError("");
    setActiveAttachmentId(null);
    setActiveAttachmentMime(null);
    clearComposerAttach();
    setPanelView("chat");
    setSidebarOpen(false);
    setInsuranceRailOpen(false);
    setMirrorRailOpen(false);
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
    setChatAttachPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearActiveAttachment = () => {
    setActiveAttachmentId(null);
    setActiveAttachmentMime(null);
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
      // Always tombstone + scrub message metadata — refresh reloads DB metadata otherwise.
      if (customerId) {
        rememberClearedActiveAttachmentId(customerId, deleted);
      }
      const nextActive = clearActiveAttachmentIfDocumentDeleted(
        {
          active_attachment_id: activeAttachmentId,
          active_attachment_mime: activeAttachmentMime,
          active_rotation_quarter_turns: 0,
        },
        deleted,
      );
      if (!nextActive) {
        setActiveAttachmentId(null);
        setActiveAttachmentMime(null);
      }
      setMessages((prev) => {
        const scrubbed = scrubDeletedDocumentFromMessageActiveAttachments(prev, deleted);
        if (customerId && sessionId) {
          writeLifeguardChatSnapshot(customerId, {
            sessionId,
            messages: scrubbed,
            activeAttachment: nextActive,
          });
        }
        return scrubbed;
      });
    },
    [
      chatAttachDocumentId,
      activeAttachmentId,
      activeAttachmentMime,
      customerId,
      sessionId,
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
      if (
        result?.reason === DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED ||
        result?.reason === DOCUMENT_DELETE_REASON.POLICY_RETIRE_FAILED ||
        result?.reason === DOCUMENT_DELETE_REASON.MEMORY_SCRUB_FAILED
      ) {
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
        // Store original only — Claude-first question turn reads first; factory after seal.
        deferFactoryUntilClaude: true,
        ...(viewMode === "corporate" && selectedEntityId
          ? { entityId: selectedEntityId }
          : {}),
      });
      const doc = uploadResult?.document ?? null;
      const documentId = String(doc?.id ?? "").trim();
      if (!documentId) {
        throw new Error("문서 업로드 후 식별자를 받지 못했습니다.");
      }
      const mime =
        String(doc?.mime_type ?? file.type ?? "").trim() ||
        (isImage ? "image/jpeg" : "application/pdf");
      setChatAttachDocumentId(documentId);
      setChatAttachFilename(String(doc?.original_filename ?? file.name ?? "파일").trim());
      // Seed conversation active attach at upload — do not wait for a successful turn.
      // Follow-ups ("방금 올린/내 문서") must resend document_id even if composer chip is cleared.
      setActiveAttachmentId(documentId);
      setActiveAttachmentMime(mime);
      if (customerId) {
        writeLifeguardChatSnapshot(customerId, {
          sessionId,
          messages,
          activeAttachment: {
            active_attachment_id: documentId,
            active_attachment_mime: mime,
            active_rotation_quarter_turns: 0,
          },
        });
      }
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
      setSidebarOpen(false);
    },
    onOpenInsurancePanel: () => {
      // Narrow: final-shell left sheet. Mid+: left rail already inline.
      setPanelView("chat");
      setSidebarOpen(false);
      if (!isMidRoom) setInsuranceRailOpen(true);
    },
    onOpenBaselinePanel: () => {
      // Narrow/mid: final-shell right sheet. Wide: right rail already inline.
      setPanelView("chat");
      setSidebarOpen(false);
      if (!isWideRoom) setMirrorRailOpen(true);
    },
    onClose: () => setSidebarOpen(false),
    onSignOut: () => supabase.auth.signOut(),
  };

  const menuDrawerStyle = {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "min(300px, 86vw)",
    zIndex: 40,
    borderRight: `1px solid ${LG.border}`,
    background: LG.surface,
    padding: "20px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    boxShadow: LG.shadowSoft,
  };

  const leftCol = leftRailCollapsed ? "48px" : `${FINAL_UI.leftColPx}px`;
  const rightCol = rightRailCollapsed ? "48px" : `${FINAL_UI.rightColPx}px`;
  const roomGridColumns = showMirrorInline
    ? `${leftCol} minmax(0, 1fr) ${rightCol}`
    : showInsuranceInline
      ? `${leftCol} minmax(0, 1fr)`
      : "minmax(0, 1fr)";

  const openBaselineDetail = (item) => {
    setDetailDrawer(buildBaselineDetailForDrawer(item));
  };

  return (
    <div
      className="lg-final-shell"
      style={{
        height: "100vh",
        overflow: "hidden",
        overflowX: "hidden",
        fontFamily: FINAL_UI.sans,
        background: FINAL_UI.bg,
        color: FINAL_UI.text,
      }}
    >
      <style>{`${FINAL_UI_SCROLLBAR_CSS}\n${FINAL_UI_ROOM_CSS}`}</style>
      {sidebarOpen ? (
        <>
          <div
            role="presentation"
            onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(29,29,31,0.28)", zIndex: 35 }}
          />
          <SidebarNav {...sidebarProps} style={menuDrawerStyle} />
        </>
      ) : null}

      {showLeftSheet ? (
        <>
          <div
            role="presentation"
            onClick={() => setInsuranceRailOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(29,29,31,0.28)", zIndex: 30 }}
          />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "82vh",
              zIndex: 31,
              background: FINAL_UI.surface,
              boxShadow: LG.shadowSoft,
              borderTopLeftRadius: "18px",
              borderTopRightRadius: "18px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <KeyCustomerLeftRail
              shell={finalShell}
              collapsed={false}
              onToggleCollapse={() => setInsuranceRailOpen(false)}
              onOpenFamily={() => {
                setInsuranceRailOpen(false);
                setSidebarOpen(true);
              }}
              onOpenSessions={() => {
                setInsuranceRailOpen(false);
                setSidebarOpen(true);
              }}
              onOpenVault={() => {
                setInsuranceRailOpen(false);
                setPanelView("documents");
              }}
              onOpenDiagnosisDetail={() => {
                setInsuranceRailOpen(false);
                setMirrorRailOpen(true);
              }}
              style={{ width: "100%", maxWidth: "none", height: "100%" }}
            />
          </div>
        </>
      ) : null}

      {showRightSheet ? (
        <>
          <div
            role="presentation"
            onClick={() => setMirrorRailOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(29,29,31,0.28)", zIndex: 30 }}
          />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "82vh",
              zIndex: 31,
              background: FINAL_UI.surface,
              boxShadow: LG.shadowSoft,
              borderTopLeftRadius: "18px",
              borderTopRightRadius: "18px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <KeyCustomerRightRail
              shell={finalShell}
              collapsed={false}
              onToggleCollapse={() => setMirrorRailOpen(false)}
              style={{ width: "100%", maxWidth: "none", height: "100%" }}
            />
          </div>
        </>
      ) : null}

      <div
        style={{
          width: "100%",
          maxWidth: "none",
          margin: "0",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {/* Single V3.1 shell header — one DOM header spanning L/C/R */}
        <header
          className="lg-v31-shell-header"
          style={{
            flexShrink: 0,
            height: `${FINAL_UI.headerPx}px`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: `${FINAL_UI.gutterPx}px`,
            padding: `0 ${FINAL_UI.roomInlinePx}px`,
            background: "rgba(255, 255, 255, 0.92)",
            borderBottom: "1px solid rgba(18,50,95,0.06)",
            borderRadius: `0 0 ${FINAL_UI.shellRadius}px ${FINAL_UI.shellRadius}px`,
            boxShadow: "0 8px 20px rgba(18, 50, 95, 0.04)",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: showInsuranceInline ? leftCol : "auto",
              minWidth: showInsuranceInline ? leftCol : 0,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              paddingLeft: "4px",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              style={{
                border: "none",
                background: "transparent",
                color: FINAL_UI.navy,
                borderRadius: "8px",
                width: "32px",
                height: "32px",
                cursor: "pointer",
                fontSize: "18px",
                padding: 0,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ☰
            </button>
            <span
              style={{
                fontFamily: LG.serif,
                fontSize: `${FINAL_UI.headerLeftSize}px`,
                fontWeight: FINAL_UI.headerLeftWeight,
                color: FINAL_UI.navyDeep,
                letterSpacing: "0.06em",
                lineHeight: 1.1,
              }}
            >
              LIFEGUARD
            </span>
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              className="lg-v31-center-brand-mark"
              style={{
                fontFamily: LG.serif,
                fontSize: `${FINAL_UI.logoSize}px`,
                fontWeight: 600,
                color: FINAL_UI.navyDeep,
                letterSpacing: "0.06em",
                lineHeight: 1.1,
              }}
            >
              LIFEGUARD
            </div>
            <div style={{ fontSize: "12px", color: FINAL_UI.muted, marginTop: "2px" }}>
              늘 곁에 있는 보험 주치의
            </div>
          </div>

          <div
            style={{
              width: showMirrorInline ? rightCol : "auto",
              minWidth: showMirrorInline ? rightCol : 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "10px",
              paddingRight: "4px",
              flexShrink: 0,
            }}
          >
            {showMirrorInline ? (
              <div style={{ textAlign: "right", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 800,
                    color: FINAL_UI.navy,
                    lineHeight: 1.25,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  KEY가 계속 관리하는 것
                </div>
                <div style={{ fontSize: "11px", color: FINAL_UI.muted, marginTop: "2px", lineHeight: 1.3 }}>
                  돈 · 일정 · 활동 · 결과
                </div>
              </div>
            ) : null}
            <button
              type="button"
              aria-label="알림"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: FINAL_UI.muted,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <HeaderIconBell />
            </button>
            <button
              type="button"
              aria-label="설정"
              onClick={() => setPanelView("settings")}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: FINAL_UI.muted,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <HeaderIconGear />
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 8px 3px 3px",
                borderRadius: "999px",
                background: FINAL_UI.tealSoft,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: "999px",
                  background: `linear-gradient(145deg, ${FINAL_UI.navy}, ${FINAL_UI.teal})`,
                  color: FINAL_UI.surface,
                  display: "grid",
                  placeItems: "center",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {nameInitial}
              </div>
              <span style={{ fontSize: "12px", fontWeight: 700, color: FINAL_UI.text }}>
                {displayName}님
              </span>
              <span style={{ color: FINAL_UI.muted, fontSize: "10px" }}>▾</span>
            </div>
          </div>
        </header>

        <div
          className="lg-v31-room"
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: roomGridColumns,
            gap: `${FINAL_UI.gutterPx}px`,
            padding: `${FINAL_UI.bodyGapPx}px ${FINAL_UI.roomInlinePx}px 0`,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            overflowX: "hidden",
            background: "transparent",
          }}
        >
          {showInsuranceInline ? (
            <KeyCustomerLeftRail
              shell={finalShell}
              collapsed={leftRailCollapsed}
              onToggleCollapse={() => setLeftRailCollapsed((v) => !v)}
              onOpenFamily={() => setSidebarOpen(true)}
              onOpenSessions={() => setSidebarOpen(true)}
              onOpenVault={() => {
                setPanelView("documents");
                setSidebarOpen(false);
              }}
              onOpenDiagnosisDetail={() => {
                const item = (coverageBaseline?.items || []).find(
                  (it) => it.id === "cancer_diagnosis",
                );
                if (item) openBaselineDetail(item);
                else if (!isWideRoom) setMirrorRailOpen(true);
              }}
              style={{ height: "100%" }}
            />
          ) : null}

          <div
            className="lg-v31-center"
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            minHeight: 0,
            padding: "0",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            width: "100%",
            maxWidth: "100%",
            margin: "0",
          }}
        >
          {panelView === "chat" && messages.length === 0 ? (
            <div
              className="lg-v31-action-slot"
              style={{
                /* Empty seat: action at frame Y=295 under unified header + body gap */
                paddingTop: `${Math.max(
                  0,
                  FINAL_UI.actionY - FINAL_UI.headerPx - FINAL_UI.bodyGapPx,
                )}px`,
                paddingLeft: 0,
                paddingRight: 0,
                flexShrink: 0,
              }}
            >
              <KeyNowActionCard
                action={finalShell?.nowAction || null}
                disabled={isDisabled || loading || streaming}
                onCta={() => {
                  const text =
                    String(finalShell?.nowAction?.submitText || "").trim() ||
                    "준비가 되면 알려주기";
                  submitQuestion(text);
                }}
              />
            </div>
          ) : null}
          {panelView === "insurance" ? (
            <LayerPanel title="내 보험 점검" onBack={goBackToChat}>
              <CustomerInsuranceList
                policies={viewMode === "corporate" ? [] : policies}
                loading={loadingSession}
                emptyHint={
                  viewMode === "corporate"
                    ? "이 법인에 연결된 보험 자료가 아직 없습니다. 문서를 추가하거나 보험 현황을 질문해 주세요."
                    : null
                }
              />
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
                documents={documents.filter((doc) => {
                  const docEntityId = String(doc?.entity_id ?? "").trim();
                  if (viewMode === "corporate") {
                    return Boolean(selectedEntityId) && docEntityId === selectedEntityId;
                  }
                  if (viewMode === "both") {
                    return !docEntityId || (selectedEntityId && docEntityId === selectedEntityId);
                  }
                  return !docEntityId;
                })}
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
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
                paddingTop: `${FINAL_UI.emptyGuidePadTopPx}px`,
                paddingLeft: "42px",
                textAlign: "left",
                width: "100%",
                maxWidth: "640px",
              }}
            >
              <p
                style={{
                  margin: `0 0 ${FINAL_UI.emptyGuideTitleMbPx}px`,
                  fontSize: "22px",
                  lineHeight: 1.35,
                  color: FINAL_UI.navyDeep,
                  fontWeight: 750,
                  letterSpacing: "-0.02em",
                }}
              >
                무엇을 도와드릴까요?
              </p>
              <p
                style={{
                  margin: `0 0 ${FINAL_UI.emptyGuideSubMbPx}px`,
                  fontSize: "13px",
                  lineHeight: FINAL_UI.msgLineHeight,
                  color: FINAL_UI.muted,
                  maxWidth: "440px",
                }}
              >
                대화가 쌓이면 여기에 문서형으로 이어집니다.
              </p>
            </div>
          ) : null}

          {panelView === "chat" && messages.length > 0 ? (
            <div
              style={{
                alignSelf: "center",
                margin: `4px 0 ${FINAL_UI.msgDateMbPx}px`,
                padding: "6px 14px",
                borderRadius: "999px",
                background: "#F1F2F6",
                color: FINAL_UI.muted,
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              }).replace(/\./g, "").replace(/\s+/g, " · ")}
            </div>
          ) : null}

          {panelView === "chat"
            ? messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const speaker = isUser ? displayName || "고객" : "KEY";
                return (
                  <div
                    key={`${index}-${msg.role}`}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "flex-start",
                      padding: isUser
                        ? `${FINAL_UI.msgPadYUser}px 0`
                        : `${FINAL_UI.msgPadYAssistant}px 0`,
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: "680px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                      aria-live={!isUser && msg.thinking ? "polite" : undefined}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: isUser ? FINAL_UI.muted : FINAL_UI.navy,
                          }}
                        >
                          {speaker}
                        </span>
                      </div>
                      <div
                        style={{
                          color: !isUser && msg.thinking ? FINAL_UI.muted : FINAL_UI.text,
                          fontSize: "15px",
                          fontWeight: 450,
                          lineHeight: FINAL_UI.msgLineHeight,
                          whiteSpace: isUser || msg.thinking ? "pre-wrap" : "normal",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                        }}
                      >
                        {isUser ? (
                          msg.content
                        ) : !msg.thinking ? (
                          <LifeguardAssistantMarkdown
                            text={msg.content}
                            muted={false}
                            fontFamily={FINAL_UI.sans}
                          />
                        ) : (
                          <>
                            <div>{msg.content}</div>
                            {msg.wait_secondary ? (
                              <div
                                style={{
                                  marginTop: "6px",
                                  fontSize: "13px",
                                  color: FINAL_UI.muted,
                                }}
                              >
                                {msg.wait_secondary}
                              </div>
                            ) : null}
                          </>
                        )}
                        {!isUser &&
                        !msg.thinking &&
                        Array.isArray(msg.visual_blocks) &&
                        msg.visual_blocks.length > 0 ? (
                          <KeyVisualBlocks blocks={msg.visual_blocks} variant="home" />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            : null}
          {panelView === "chat" && messages.length > 0 ? (
            <div
              className="lg-v31-action-slot"
              style={{
                paddingTop: `${FINAL_UI.actionSlotPadTopPx}px`,
                paddingBottom: `${FINAL_UI.actionSlotPadBottomPx}px`,
                paddingLeft: 0,
                paddingRight: 0,
                flexShrink: 0,
              }}
            >
              <KeyNowActionCard
                action={finalShell?.nowAction || null}
                disabled={isDisabled || loading || streaming}
                onCta={() => {
                  const text =
                    String(finalShell?.nowAction?.submitText || "").trim() ||
                    "준비가 되면 알려주기";
                  submitQuestion(text);
                }}
              />
            </div>
          ) : null}
        </div>

        {panelView === "chat" ? (
          <div
            className="lg-v31-composer-wrap"
            style={{
              padding: `0 0 ${FINAL_UI.composerWrapPadBottomPx}px`,
              width: "100%",
              maxWidth: `${FINAL_UI.centerColPx}px`,
              margin: "0 auto",
              background: "transparent",
              flexShrink: 0,
              boxSizing: "border-box",
            }}
          >
            {!isMidRoom || !isWideRoom ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                {!isMidRoom ? (
                  <button
                    type="button"
                    onClick={() => setInsuranceRailOpen(true)}
                    style={{
                      border: `1px solid ${FINAL_UI.line}`,
                      background: FINAL_UI.surface,
                      borderRadius: "999px",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: FINAL_UI.text,
                      cursor: "pointer",
                      fontFamily: FINAL_UI.sans,
                    }}
                  >
                    내 현황
                  </button>
                ) : null}
                {!isWideRoom ? (
                  <button
                    type="button"
                    onClick={() => setMirrorRailOpen(true)}
                    style={{
                      border: `1px solid ${FINAL_UI.line}`,
                      background: FINAL_UI.surface,
                      borderRadius: "999px",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: FINAL_UI.text,
                      cursor: "pointer",
                      fontFamily: FINAL_UI.sans,
                    }}
                  >
                    일정·흐름
                  </button>
                ) : null}
              </div>
            ) : null}
            <div
              role="group"
              aria-label="상담 문맥"
              className="lg-v31-scope"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                gap: "8px",
                marginBottom: `${Math.max(0, FINAL_UI.composerY - FINAL_UI.tabsY - FINAL_UI.tabsH)}px`,
                marginLeft: `${Math.max(0, FINAL_UI.tabsX - (FINAL_UI.leftColPx + FINAL_UI.gutterPx))}px`,
                width: `${FINAL_UI.tabsW}px`,
                height: `${FINAL_UI.tabsH}px`,
                alignItems: "center",
                boxSizing: "border-box",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setViewMode("personal");
                  setSelectedEntityId(null);
                }}
                style={scopeBtnStyle(viewMode === "personal")}
              >
                개인
              </button>
              {corporateEntities.length > 0 ? (
                <>
                  {corporateEntities.slice(0, 6).map((row) => {
                    const eid = String(row?.entity_id ?? "").trim();
                    const active = viewMode === "corporate" && selectedEntityId === eid;
                    return (
                      <button
                        key={eid}
                        type="button"
                        onClick={() => {
                          setViewMode("corporate");
                          setSelectedEntityId(eid);
                        }}
                        style={scopeBtnStyle(active)}
                      >
                        {String(row?.display_name ?? "회사").trim() || "회사"}
                      </button>
                    );
                  })}
                  {selectedEntityId ? (
                    <button
                      type="button"
                      onClick={() => setViewMode("both")}
                      style={scopeBtnStyle(viewMode === "both")}
                    >
                      개인+회사 함께
                    </button>
                  ) : (
                    <button type="button" style={scopeBtnStyle(false)} disabled>
                      회사
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" style={scopeBtnStyle(false)} disabled>
                    회사
                  </button>
                  <button type="button" style={scopeBtnStyle(false)} disabled>
                    개인+회사 함께
                  </button>
                </>
              )}
            </div>
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
                        background: FINAL_UI.surface,
                        border: `1px solid ${LG.border}`,
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        첨부됨: {chatAttachFilename || "이미지"}
                      </span>
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
                      fontFamily: FINAL_UI.sans,
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
                    fontFamily: FINAL_UI.sans,
                  }}
                >
                  첨부 참조 해제
                </button>
              </div>
            ) : null}
            <div
              className="lg-v31-composer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "0 18px",
                borderRadius: "999px",
                border: `1px solid ${FINAL_UI.line}`,
                background: FINAL_UI.surface,
                boxShadow: "0 4px 14px rgba(18, 50, 95, 0.05)",
                width: `${FINAL_UI.composerW}px`,
                maxWidth: "100%",
                height: `${FINAL_UI.composerH}px`,
                boxSizing: "border-box",
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
                  fontSize: "18px",
                  fontWeight: 500,
                  color: FINAL_UI.muted,
                  cursor: chatAttachUploading ? "default" : "pointer",
                  padding: "0 4px",
                  fontFamily: FINAL_UI.sans,
                  lineHeight: 1,
                }}
              >
                📎
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                readOnly={false}
                disabled={isDisabled || chatAttachUploading}
                aria-label="질문 입력"
                placeholder="무엇이든 편하게 말씀해 주세요"
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
                  color: FINAL_UI.text,
                  fontSize: `${FINAL_UI.composerSize}px`,
                  fontFamily: FINAL_UI.sans,
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
                aria-label="보내기"
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
                  width: "40px",
                  height: "40px",
                  borderRadius: "999px",
                  background:
                    input.trim() && !chatAttachUploading ? FINAL_UI.teal : FINAL_UI.pendingBar,
                  color: FINAL_UI.surface,
                  fontSize: "16px",
                  fontWeight: 700,
                  cursor: input.trim() && !chatAttachUploading ? "pointer" : "default",
                  fontFamily: FINAL_UI.sans,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                ↑
              </button>
            </div>
          </div>
        ) : null}
          </div>

          {showMirrorInline ? (
            <KeyCustomerRightRail
              shell={finalShell}
              collapsed={rightRailCollapsed}
              onToggleCollapse={() => setRightRailCollapsed((v) => !v)}
              style={{ height: "100%" }}
            />
          ) : null}
        </div>
      </div>

      <KeyInsuranceDetailDrawer detail={detailDrawer} onClose={() => setDetailDrawer(null)} />
    </div>
  );
}
