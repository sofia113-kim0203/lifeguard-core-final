import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import KeyVisualBlocks from "./KeyVisualBlocks.jsx";
import KeyMyInsuranceRail from "./KeyMyInsuranceRail.jsx";
import KeyCoverageBaselineRail from "./KeyCoverageBaselineRail.jsx";
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
import { buildLifeguardHomeGreeting } from "../lib/lifeguardGreeting.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
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
  buildPolicyDetailForDrawer,
} from "../lib/keyInsuranceScreenFacts.js";

const EXAMPLE_QUESTIONS = [
  "보험료 너무 비싼가?",
  "암보험 부족한가?",
  "대장 선종 제거했는데 보험금 받을 수 있나?",
  "분당에서 가족이랑 갈 만한 곳 추천해줘",
];

const ROOM_MID_BREAKPOINT = 768;
const ROOM_WIDE_BREAKPOINT = 1200;

const KEY_WAIT_STATUS = "KEY가 확인하고 있어요.";
const KEY_WAIT_ACK_FALLBACK = KEY_WAIT_STATUS;

function KeyPresentationStatusStripView({ chips = [], claimProgress = null }) {
  if ((!chips || chips.length === 0) && !claimProgress) return null;
  const toneColor = (tone) => {
    if (tone === "green") return "#166534";
    if (tone === "amber") return "#92400E";
    if (tone === "rose") return "#9F1239";
    if (tone === "muted") return LG.textMuted;
    return LG.navy;
  };
  return (
    <div
      style={{
        marginTop: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "100%",
      }}
    >
      {chips.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
          }}
        >
          {chips.map((chip) => (
            <span
              key={chip.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                maxWidth: "100%",
                padding: "3px 9px",
                borderRadius: "999px",
                border: `1px solid ${LG.border}`,
                background: "#fff",
                color: toneColor(chip.tone),
                fontSize: "11px",
                lineHeight: 1.35,
                fontFamily: LG.sans,
                fontWeight: 600,
              }}
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
      {claimProgress ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            alignItems: "center",
            fontSize: "11px",
            color: LG.textMuted,
            fontFamily: LG.sans,
          }}
        >
          {claimProgress.stages.map((st) => (
            <span
              key={st.key}
              style={{
                padding: "2px 8px",
                borderRadius: "999px",
                border: `1px solid ${st.on ? LG.navy : LG.border}`,
                background: st.on ? "rgba(15, 23, 42, 0.06)" : "transparent",
                color: st.on ? LG.navy : LG.textSoft,
                fontWeight: st.on ? 700 : 500,
              }}
            >
              {st.label}
            </span>
          ))}
          {claimProgress.reason_source_label &&
          (claimProgress.reason_verbatim || claimProgress.reason_customer_stated) ? (
            <span style={{ width: "100%", marginTop: "2px", lineHeight: 1.45 }}>
              {claimProgress.reason_source_label}:{" "}
              {claimProgress.reason_verbatim || claimProgress.reason_customer_stated}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
    background: active ? "rgba(37, 99, 235, 0.08)" : "transparent",
    color: active ? LG.navy : LG.textMuted,
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
            color: LG.navy,
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
    // Fixed panels on desktop breakpoints — no header toggles.
    if (isMidRoom) setInsuranceRailOpen(true);
    if (isWideRoom) setMirrorRailOpen(true);
  }, [isMidRoom, isWideRoom]);

  const coverageBaseline = useMemo(
    () => buildIndustryCoverageBaseline(policies),
    [policies],
  );

  const showInsuranceInline = panelView === "chat" && isMidRoom;
  const showInsuranceDrawer =
    panelView === "chat" && insuranceRailOpen && !isMidRoom;
  const showMirrorInline = panelView === "chat" && isWideRoom;
  const showMirrorDrawer =
    panelView === "chat" && mirrorRailOpen && !isWideRoom;

  const greeting = useMemo(
    () => buildLifeguardHomeGreeting(displayName, session?.unifiedState),
    [displayName, session?.unifiedState],
  );

  const presentationStrip = useMemo(
    () =>
      buildKeyPresentationStatusStrip({
        handSnapshot,
        doneStatus: doneStatusOverlay,
        viewMode,
        entityId: selectedEntityId,
      }),
    [handSnapshot, doneStatusOverlay, viewMode, selectedEntityId],
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
    let cancelled = false;
    void fetchMyCorporateEntities().then((result) => {
      if (cancelled) return;
      setCorporateEntities(Array.isArray(result?.entities) ? result.entities : []);
      // Never auto-select even when exactly one entity exists.
    });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

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
    setInsuranceRailOpen(isMidRoom);
    setMirrorRailOpen(isWideRoom);
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
      // Narrow: open overlay drawer. Mid+: fixed left rail already visible.
      setPanelView("chat");
      setSidebarOpen(false);
      setInsuranceRailOpen(true);
    },
    onOpenBaselinePanel: () => {
      // Narrow/mid: open baseline drawer via hamburger. Wide: fixed right rail.
      setPanelView("chat");
      setSidebarOpen(false);
      setMirrorRailOpen(true);
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

  const roomGridColumns = showMirrorInline
    ? "245px minmax(780px, 1fr) 280px"
    : showInsuranceInline
      ? "245px minmax(0, 1fr)"
      : "minmax(0, 1fr)";

  const openPolicyDetail = (row) => {
    const full = (policies || []).find((p) => String(p?.id ?? "") === String(row?.id ?? ""));
    setDetailDrawer(buildPolicyDetailForDrawer(full || row));
  };

  const openBaselineDetail = (item) => {
    setDetailDrawer(buildBaselineDetailForDrawer(item));
  };

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        overflowX: "hidden",
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
            style={{ position: "fixed", inset: 0, background: "rgba(26,43,75,0.28)", zIndex: 35 }}
          />
          <SidebarNav {...sidebarProps} style={menuDrawerStyle} />
        </>
      ) : null}

      {showInsuranceDrawer ? (
        <>
          <div
            role="presentation"
            onClick={() => setInsuranceRailOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(26,43,75,0.28)", zIndex: 30 }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: "min(300px, 90vw)",
              zIndex: 31,
              background: LG.bg,
              boxShadow: LG.shadowSoft,
            }}
          >
            <KeyMyInsuranceRail
              policies={policies}
              loading={loadingSession}
              displayName={displayName}
              onClose={() => setInsuranceRailOpen(false)}
              onSelectPolicy={openPolicyDetail}
              style={{ height: "100%", maxWidth: "none", width: "245px" }}
            />
          </div>
        </>
      ) : null}

      {showMirrorDrawer ? (
        <>
          <div
            role="presentation"
            onClick={() => setMirrorRailOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(26,43,75,0.28)", zIndex: 30 }}
          />
          <div
            style={{
              position: "fixed",
              top: isMidRoom ? 0 : "auto",
              right: 0,
              bottom: 0,
              left: isMidRoom ? "auto" : 0,
              width: isMidRoom ? "min(340px, 90vw)" : "100%",
              maxHeight: isMidRoom ? "100%" : "78vh",
              zIndex: 31,
              background: LG.bg,
              boxShadow: LG.shadowSoft,
              borderTopLeftRadius: isMidRoom ? 0 : "18px",
              borderTopRightRadius: isMidRoom ? 0 : "18px",
            }}
          >
            <KeyCoverageBaselineRail
              baseline={coverageBaseline}
              onClose={() => setMirrorRailOpen(false)}
              onSelectItem={openBaselineDetail}
              style={{ height: "100%", maxWidth: "none", width: "280px" }}
            />
          </div>
        </>
      ) : null}

      <div
        style={{
          width: "100%",
          maxWidth: "1600px",
          margin: "0 auto",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: "10px",
            padding: "14px 20px 12px",
            height: "82px",
            boxSizing: "border-box",
            background: LG.bg,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", justifySelf: "start" }}>
            <button
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              style={{
                border: "none",
                background: "transparent",
                color: LG.navy,
                borderRadius: "8px",
                width: "40px",
                height: "40px",
                cursor: "pointer",
                fontSize: "22px",
              }}
            >
              ☰
            </button>
            <span
              style={{
                fontFamily: LG.serif,
                fontSize: "16px",
                fontWeight: 600,
                color: LG.navy,
                letterSpacing: "0.04em",
              }}
            >
              LIFEGUARD
            </span>
          </div>

          <div style={{ textAlign: "center", justifySelf: "center" }}>
            <div
              style={{
                fontFamily: LG.serif,
                fontSize: "28px",
                fontWeight: 650,
                color: LG.navy,
                letterSpacing: "0.04em",
                lineHeight: 1.05,
              }}
            >
              LIFEGUARD
            </div>
            <div style={{ fontSize: "13px", color: LG.textMuted, marginTop: "2px", letterSpacing: "0.02em" }}>
              보험 AI KEY
            </div>
          </div>

          <div style={{ justifySelf: "end", minWidth: "40px" }} aria-hidden="true" />
        </header>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: roomGridColumns,
            gap: "12px",
            padding: "0 16px 14px",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            overflowX: "hidden",
          }}
        >
          {showInsuranceInline ? (
            <KeyMyInsuranceRail
              policies={policies}
              loading={loadingSession}
              displayName={displayName}
              onSelectPolicy={openPolicyDetail}
              style={{
                width: "245px",
                maxWidth: "245px",
                borderRadius: "16px",
                background: LG.bg,
                border: `1px solid ${LG.border}`,
              }}
            />
          ) : null}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              background: LG.bg,
              borderRadius: "16px",
              border: `1px solid ${LG.border}`,
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
            padding: "28px 24px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            width: "100%",
            maxWidth: "920px",
            margin: "0 auto",
          }}
        >
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
            <div style={{ marginTop: "10vh", textAlign: "center" }}>
              <div
                style={{
                  fontFamily: LG.serif,
                  fontSize: "30px",
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
                    fontSize: "16px",
                    lineHeight: 1.7,
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
                    padding: msg.role === "user" ? "10px 0 6px" : "8px 0 18px",
                  }}
                >
                  {msg.role === "user" ? (
                    <div
                      style={{
                        maxWidth: "min(72%, 520px)",
                        textAlign: "left",
                        color: LG.navy,
                        fontSize: "16px",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        background: LG.userBubble,
                        borderRadius: "18px 18px 6px 18px",
                        padding: "14px 18px",
                      }}
                    >
                      {msg.content}
                    </div>
                  ) : (
                    <div
                      style={{
                        maxWidth: "min(92%, 640px)",
                        display: "flex",
                        gap: "12px",
                        alignItems: "flex-start",
                      }}
                      aria-live={msg.thinking ? "polite" : undefined}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "999px",
                          background: LG.navy,
                          color: "#fff",
                          display: "grid",
                          placeItems: "center",
                          fontSize: "13px",
                          fontWeight: 700,
                          flexShrink: 0,
                          marginTop: "2px",
                        }}
                      >
                        K
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: LG.navy,
                            marginBottom: "8px",
                          }}
                        >
                          KEY
                        </div>
                        <div
                          style={{
                            color: msg.thinking ? LG.textMuted : LG.text,
                            fontSize: "16px",
                            fontWeight: 450,
                            lineHeight: 1.7,
                            whiteSpace: msg.thinking ? "pre-wrap" : "normal",
                            background: "transparent",
                            border: "none",
                            borderRadius: 0,
                            padding: 0,
                            boxShadow: "none",
                          }}
                        >
                          {!msg.thinking ? (
                            <LifeguardAssistantMarkdown
                              text={msg.content}
                              muted={false}
                              fontFamily={LG.sans}
                            />
                          ) : (
                            <>
                              <div>{msg.content}</div>
                              {msg.wait_secondary ? (
                                <div
                                  style={{
                                    marginTop: "6px",
                                    fontSize: "13px",
                                    color: LG.textSoft,
                                  }}
                                >
                                  {msg.wait_secondary}
                                </div>
                              ) : null}
                            </>
                          )}
                          {!msg.thinking &&
                          Array.isArray(msg.visual_blocks) &&
                          msg.visual_blocks.length > 0 ? (
                            <KeyVisualBlocks blocks={msg.visual_blocks} variant="home" />
                          ) : null}
                          {!msg.thinking
                            ? (() => {
                                const isLast =
                                  index === messages.length - 1 && msg.role === "assistant";
                                const strip = msg.key_status_strip?.chips?.length
                                  ? msg.key_status_strip
                                  : isLast
                                    ? presentationStrip
                                    : null;
                                if (!strip || (!strip.chips?.length && !strip.claimProgress)) {
                                  return null;
                                }
                                return (
                                  <KeyPresentationStatusStripView
                                    chips={strip.chips || []}
                                    claimProgress={strip.claimProgress || null}
                                  />
                                );
                              })()
                            : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            : null}
        </div>

        {panelView === "chat" ? (
          <div
            style={{
              padding: "14px 28px 24px",
              width: "100%",
              maxWidth: "820px",
              margin: "0 auto",
              background: "transparent",
              flexShrink: 0,
            }}
          >
            {corporateEntities.length > 0 ? (
              <div
                role="group"
                aria-label="상담 문맥"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "10px",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("personal");
                    setSelectedEntityId(null);
                  }}
                  style={{
                    border: `1px solid ${viewMode === "personal" ? LG.text : LG.border}`,
                    background: viewMode === "personal" ? "#fff" : "transparent",
                    borderRadius: "999px",
                    padding: "4px 10px",
                    fontSize: "12px",
                    color: LG.text,
                    cursor: "pointer",
                  }}
                >
                  개인
                </button>
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
                      style={{
                        border: `1px solid ${active ? LG.text : LG.border}`,
                        background: active ? "#fff" : "transparent",
                        borderRadius: "999px",
                        padding: "4px 10px",
                        fontSize: "12px",
                        color: LG.text,
                        cursor: "pointer",
                      }}
                    >
                      {String(row?.display_name ?? "법인").trim() || "법인"}
                    </button>
                  );
                })}
                {selectedEntityId ? (
                  <button
                    type="button"
                    onClick={() => setViewMode("both")}
                    style={{
                      border: `1px solid ${viewMode === "both" ? LG.text : LG.border}`,
                      background: viewMode === "both" ? "#fff" : "transparent",
                      borderRadius: "999px",
                      padding: "4px 10px",
                      fontSize: "12px",
                      color: LG.text,
                      cursor: "pointer",
                    }}
                  >
                    개인+법인 비교
                  </button>
                ) : null}
              </div>
            ) : null}
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
                padding: "10px 12px 10px 14px",
                borderRadius: "999px",
                border: `1px solid ${LG.border}`,
                background: LG.surface,
                boxShadow: LG.shadowSoft,
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
                  fontSize: "20px",
                  fontWeight: 500,
                  color: LG.textMuted,
                  cursor: chatAttachUploading ? "default" : "pointer",
                  padding: "0 4px",
                  fontFamily: LG.sans,
                  lineHeight: 1,
                }}
              >
                +
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                readOnly={false}
                disabled={isDisabled || chatAttachUploading}
                aria-label="질문 입력"
                placeholder="무엇이든 편하게 말씀해 주세요."
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
                  fontSize: "16px",
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
                    input.trim() && !chatAttachUploading ? LG.accent : LG.borderStrong,
                  color: "#fff",
                  fontSize: "16px",
                  fontWeight: 700,
                  cursor: input.trim() && !chatAttachUploading ? "pointer" : "default",
                  fontFamily: LG.sans,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                ↑
              </button>
            </div>
            <p
              style={{
                margin: "12px 0 0",
                textAlign: "center",
                fontSize: "13px",
                color: LG.textSoft,
                lineHeight: 1.45,
              }}
            >
              개인정보는 안전하게 보호되며, KEY 답변은 참고용입니다.
            </p>
          </div>
        ) : null}
          </div>

          {showMirrorInline ? (
            <div
              data-key-baseline-outer-panel="1"
              style={{
                width: "280px",
                maxWidth: "280px",
                minWidth: "280px",
                minHeight: 0,
                height: "100%",
                alignSelf: "stretch",
                boxSizing: "border-box",
                borderRadius: "16px",
                background: LG.bg,
                border: `1px solid ${LG.border}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <KeyCoverageBaselineRail
                baseline={coverageBaseline}
                onClose={() => setMirrorRailOpen(false)}
                onSelectItem={openBaselineDetail}
                style={{
                  width: "100%",
                  maxWidth: "none",
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                  background: "transparent",
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <KeyInsuranceDetailDrawer detail={detailDrawer} onClose={() => setDetailDrawer(null)} />
    </div>
  );
}
