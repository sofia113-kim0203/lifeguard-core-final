import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import KeyVisualBlocks from "./KeyVisualBlocks.jsx";
import KeyCustomerLeftRail from "./KeyCustomerLeftRail.jsx";
import KeyCustomerRightRail from "./KeyCustomerRightRail.jsx";
import KeyAgentLeftRail from "./KeyAgentLeftRail.jsx";
import KeyAgentRightRail from "./KeyAgentRightRail.jsx";
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
  listSelectedUploadFiles,
  processSelectedUploadFiles,
} from "../lib/customerMultiFileUpload.js";
import {
  formatChatComposerAttachLabel,
  listChatComposerDocumentIds,
  removeChatComposerAttachment,
  revokeChatComposerPreviewUrls,
  snapshotChatComposerAttachments,
} from "../lib/chatComposerAttachments.js";
import {
  armExplicitReopenOneShot,
  beginExplicitReopenFlight,
  createExplicitReopenOneShot,
  EXPLICIT_REOPEN_STATUS,
  markExplicitReopenAck,
  resolveExplicitReopenFlightFailure,
  shouldBlockSendForIncompleteUpload,
} from "../lib/originalAttachmentOneShot.js";
import {
  consumePendingDocumentDelivery,
  createEmptyPendingDocumentDelivery,
  discardComposerUploadTransit,
  planUploadTransitCleanupAfterDocumentStore,
  planUploadTransitOnMemoryCommitFailure,
} from "../lib/uploadTransitCleanup.js";
import AttachmentTray from "./AttachmentTray.jsx";
import {
  clearActiveAttachmentIfDocumentDeleted,
  extractActiveAttachmentFromSessionMessages,
  isInsuranceDocumentRecallQuestion,
  isReusableActiveAttachmentId,
  isRestorableAttachmentCandidateInScope,
  normalizeActiveAttachment,
  normalizeRestorableAttachmentCandidate,
  pickRestorableAttachmentCandidate,
  scrubDeletedDocumentFromMessageActiveAttachments,
  shouldClearActiveAttachmentAfterTurn,
  wantsOwnedInsuranceVaultEvidence,
} from "../lib/chatActiveAttachment.js";
import { fetchHomeBrainFactStream, mapHomeBrainFactPayload } from "../lib/customerHomeBrainFact.js";
import { resolveC1InsurancePanelEntryAction } from "../lib/keyC1InsurancePanelEntry.js";
import {
  applyPointedContractSelection,
  buildPointedContractIdsPayload,
  listUniqueContractCards,
  resolveCanonicalContractId,
  shouldClearPointedContractOnLifecycle,
  resolveContractCardSelectionState,
} from "../lib/keyContractFocusSsot.js";
import {
  createAgentKeyBriefingRequest,
  listAgentKeyBriefings,
} from "../lib/agentKeyBriefing.js";
import {
  canSubmitAgentFreeKey,
  postAgentFreeKeyChatStream,
} from "../lib/agentFreeKey.js";
import {
  AGENT_HOME_SCOPE_GENERAL as AGENT_SCOPE_GENERAL,
  clearAllAgentKeyChatSessions,
  readAgentKeyChatSession,
  writeAgentKeyChatSession,
} from "../lib/agentKeyChatSession.js";
import { createAgentStreamPaintController } from "../lib/agentKeyChatStreamPaint.js";
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
  finalUiContentRailStyle,
} from "../lib/customerUiFinalTokens.js";
import {
  DOCUMENT_UI_MESSAGES,
  formatDocClass,
  formatUploadDate,
  toCustomerErrorMessage,
} from "../lib/uiLocale.js";
import {
  createCoalescedScrollToBottom,
  isScrollNearBottom,
  scrollChatContainerToBottom,
  shouldAutoFollowChatScroll,
  shouldShowJumpToLatestAnswer,
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
/** Composer ? one comfortable line; grow with content up to ~5 lines. */
const COMPOSER_TEXTAREA_MIN_PX = 44;
const COMPOSER_TEXTAREA_MAX_PX = 132;
const COMPOSER_SHELL_MIN_PX = 64;
/** Ignore 1?2px browser scrollTop jitter as user scroll-up. */
const CHAT_SCROLL_UP_DEADZONE_PX = 2;

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
    /* V3.1 SSOT .scope button: no font-family ? UA (Arial) */
    height: `${Math.max(28, FINAL_UI.tabsH - 8)}px`,
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    flexShrink: 0,
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
  return `? ${Math.round(numeric).toLocaleString("ko-KR")}?`;
}

function listCardStyle() {
  return {
    border: `1px solid ${LG.border}`,
    borderRadius: "10px",
    padding: "14px 16px",
    background: LG.surface,
  };
}

function CustomerInsuranceList({
  policies,
  loading,
  emptyHint = null,
  selectedPolicyId = null,
  onSelectPolicy = null,
}) {
  if (loading) {
    return <p style={{ margin: 0, color: LG.textMuted }}>보험 정보를 불러오는 중…</p>;
  }
  // CONTRACT FOCUS SSOT — unique contract_id cards only (no name matching).
  const contractCards = listUniqueContractCards(policies);
  if (!contractCards.length) {
    return (
      <p style={{ margin: 0, color: LG.textMuted }}>
        {emptyHint ||
          "아직 등록된 보험이 없어요. 필요하면 대화에서 편하게 말씀해 주세요."}
      </p>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      data-contract-card-list="true"
      data-contract-card-count={String(contractCards.length)}
    >
      {contractCards.map((policy) => {
        const contractId = resolveCanonicalContractId(policy);
        const selection = resolveContractCardSelectionState({
          pointedContractId: selectedPolicyId,
          contractId,
        });
        const selected = selection.selected;
        const selectable =
          typeof onSelectPolicy === "function" && Boolean(contractId);
        return (
          <button
            key={contractId}
            type="button"
            data-contract-id={contractId}
            data-contract-card="true"
            data-contract-selected={selection.data_contract_selected}
            disabled={!selectable}
            aria-pressed={selection.aria_pressed === "true"}
            aria-label={selection.aria_label}
            onClick={() => {
              if (!selectable) return;
              onSelectPolicy(
                applyPointedContractSelection({
                  pointedContractId: selectedPolicyId,
                  contractId,
                }),
              );
            }}
            style={{
              ...listCardStyle(),
              textAlign: "left",
              cursor: selectable ? "pointer" : "default",
              borderColor: selected ? FINAL_UI.teal : LG.border,
              boxShadow: selected ? "0 0 0 1px rgba(15,118,110,0.35)" : "none",
              font: "inherit",
              width: "100%",
            }}
          >
            <div style={{ fontWeight: 600, color: LG.text, marginBottom: "6px" }}>
              {policy.insurer_name ?? "—"}
              {selected ? (
                <span style={{ marginLeft: "8px", fontSize: "12px", color: FINAL_UI.teal }}>
                  선택됨
                </span>
              ) : null}
            </div>
            {policy.product_name ? (
              <div style={{ fontSize: "14px", color: LG.textMuted, marginBottom: "4px" }}>
                {policy.product_name}
              </div>
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
          </button>
        );
      })}
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

const AGENT_HOME_SCOPE_GENERAL = AGENT_SCOPE_GENERAL;

const AGENT_NOW_ACTION = Object.freeze({
  pending: true,
  title: "일반 질문 또는 담당 고객을 선택하세요",
  body: "왼쪽에서 질문 범위를 고른 뒤, KEY에게 상담·보장을 물어보세요.",
  ctaLabel: "KEY에게 물어보기",
  ctaHint: "고객 자료는 권한 허용 범위에서만 사용합니다",
  submitText: "상담 준비를 도와주세요",
});

export default function LifeguardHomeChat({
  layer1Only = true,
  disabled = false,
  displayName: displayNameProp,
  audience = "customer",
}) {
  const isAgentAudience = audience === "agent";
  const session = useOptionalCustomerSession();
  const authUser = session?.user ?? null;
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const focusTimerRef = useRef(null);
  const chatScrollRef = useRef(null);
  /** Growing message list ? observed for sticky follow (viewport height is fixed). */
  const chatScrollContentRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const restoreForceScrollRef = useRef(false);
  const lastChatScrollTopRef = useRef(0);
  const coalescedScrollRef = useRef(null);
  if (!coalescedScrollRef.current) {
    coalescedScrollRef.current = createCoalescedScrollToBottom({
      shouldFollow: () => stickToBottomRef.current === true,
    });
  }
  const [showLatestAnswerBtn, setShowLatestAnswerBtn] = useState(false);
  const messagesRef = useRef([]);
  const threadRestoreReadyRef = useRef(false);
  const inflightTurnIdRef = useRef(null);
  /** T6 ? abort Presence when customer question wins. */
  const presenceAbortRef = useRef(null);
  const presenceTurnIdRef = useRef(null);
  const presenceActiveRef = useRef(false);
  const displayName =
    displayNameProp ??
    (isAgentAudience
      ? "설계사"
      : session?.dashboardData?.displayName ??
        session?.unifiedState?.profile?.display_name ??
        "고객");
  const policies = session?.unifiedState?.policies ?? [];
  // Agent mode never binds to a customer chat identity ? local thread only.
  const customerId = isAgentAudience
    ? null
    : session?.dashboardData?.customerId ?? session?.unifiedState?.customer_id ?? null;
  const loadingSession = Boolean(session?.loading);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelView, setPanelView] = useState("chat");
  // Unified view ? React state only; new session defaults personal (no auto entity restore).
  const [viewMode, setViewMode] = useState("personal");
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  /** C1 Pointer Hand — internal contract id for Selective (0..1). */
  const [pointedContractId, setPointedContractId] = useState(null);
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
  // Composer attach chips — cleared immediately after vault store (upload transit only).
  const [chatAttachments, setChatAttachments] = useState([]);
  /** Pending vault document_ids for one chat send; never File/preview authority. */
  const [pendingDocumentDelivery, setPendingDocumentDelivery] = useState(() =>
    createEmptyPendingDocumentDelivery(),
  );
  const pendingDocumentDeliveryRef = useRef(pendingDocumentDelivery);
  const [chatAttachUploading, setChatAttachUploading] = useState(false);
  const [chatAttachError, setChatAttachError] = useState("");
  // Must not authorize follow-up original delivery (one-shot). Cleared after vault store.
  const [activeAttachmentId, setActiveAttachmentId] = useState(null);
  const [activeAttachmentIds, setActiveAttachmentIds] = useState([]);
  const [activeAttachmentMime, setActiveAttachmentMime] = useState(null);
  // Chip reopen one-shot: armed → in_flight → ack/consumed (pre-ack fail → re-arm).
  const [explicitReopenDocumentIds, setExplicitReopenDocumentIds] = useState([]);
  const explicitReopenFlightRef = useRef(createExplicitReopenOneShot());
  const syncExplicitReopenFlight = (nextState) => {
    const state =
      nextState && typeof nextState === "object"
        ? nextState
        : createExplicitReopenOneShot();
    explicitReopenFlightRef.current = state;
    if (state.status === EXPLICIT_REOPEN_STATUS.ARMED) {
      setExplicitReopenDocumentIds(
        Array.isArray(state.documentIds) ? state.documentIds.slice() : [],
      );
    } else {
      setExplicitReopenDocumentIds([]);
    }
  };
  const clearExplicitReopenFlight = () => {
    syncExplicitReopenFlight(createExplicitReopenOneShot());
  };
  // Past attach bundle for explicit reactivation UI only — never request authority.
  const [restorableAttachmentCandidate, setRestorableAttachmentCandidate] = useState(null);
  const userAttachActionEpochRef = useRef(0);
  const prevCustomerIdRef = useRef(customerId);
  const markUserAttachAction = () => {
    userAttachActionEpochRef.current += 1;
  };
  const setConversationActiveAttachment = (id, mime = null, ids = null) => {
    const primary = String(id ?? "").trim() || null;
    const list = Array.isArray(ids)
      ? [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))]
      : primary
        ? [primary]
        : [];
    setActiveAttachmentId(primary || (list.length ? list[list.length - 1] : null));
    setActiveAttachmentIds(list);
    setActiveAttachmentMime(mime != null ? String(mime).trim() || null : null);
  };
  const clearConversationActiveAttachment = () => {
    setActiveAttachmentId(null);
    setActiveAttachmentIds([]);
    setActiveAttachmentMime(null);
  };
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [sessionId, setSessionId] = useState(() => createLifeguardSessionId());
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [documentDeletingId, setDocumentDeletingId] = useState(null);
  const [documentDeleteNotice, setDocumentDeleteNotice] = useState("");
  const [threadRestoreReady, setThreadRestoreReady] = useState(() => isAgentAudience);
  const [bridgeSettled, setBridgeSettled] = useState(false);
  const [agentAssignments, setAgentAssignments] = useState([]);
  const [agentListLoading, setAgentListLoading] = useState(false);
  const [agentListError, setAgentListError] = useState(null);
  const [agentSelectedId, setAgentSelectedId] = useState(AGENT_HOME_SCOPE_GENERAL);
  const [agentTurnMeta, setAgentTurnMeta] = useState(null);
  const [agentBriefing, setAgentBriefing] = useState(null);
  const [agentBriefingLoading, setAgentBriefingLoading] = useState(false);
  const [agentBriefingError, setAgentBriefingError] = useState(null);
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
    pendingDocumentDeliveryRef.current = pendingDocumentDelivery;
  }, [pendingDocumentDelivery]);

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
        setConversationActiveAttachment(
          turn.activeAttachment.active_attachment_id,
          turn.activeAttachment.active_attachment_mime ?? null,
          turn.activeAttachment.active_attachment_ids,
        );
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

  const rememberRestorableCandidateFromBundle = useCallback((bundle, scope = {}) => {
    const candidate = normalizeRestorableAttachmentCandidate(bundle, {
      customerId: scope.customerId ?? customerIdRef.current,
      sessionId: scope.sessionId ?? sessionIdRef.current,
    });
    if (candidate) setRestorableAttachmentCandidate(candidate);
  }, []);

  useEffect(() => {
    if (prevCustomerIdRef.current === customerId) return;
    prevCustomerIdRef.current = customerId;
    clearConversationActiveAttachment();
    clearExplicitReopenFlight();
    setRestorableAttachmentCandidate(null);
    setPendingDocumentDelivery(createEmptyPendingDocumentDelivery());
    pendingDocumentDeliveryRef.current = createEmptyPendingDocumentDelivery();
    setChatAttachments((prev) => discardComposerUploadTransit(prev));
    if (shouldClearPointedContractOnLifecycle({ event: "customer_change" })) {
      setPointedContractId(null);
    }
  }, [customerId]);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    customerIdRef.current = customerId;
  }, [customerId]);

  useEffect(() => {
    trackedAnalysisJobIdRef.current = session?.trackedAnalysisJobId ?? null;
  }, [session?.trackedAnalysisJobId]);

  // Agent V3.1: sessionStorage restore per scope ? never customer conversations DB.
  const agentRestoringRef = useRef(false);
  useEffect(() => {
    if (!isAgentAudience) return undefined;
    if (!authUser?.id) {
      setMessages([]);
      setThreadRestoreReady(true);
      return undefined;
    }
    agentRestoringRef.current = true;
    const snap = readAgentKeyChatSession(authUser.id, agentSelectedId);
    setMessages(Array.isArray(snap?.messages) ? snap.messages : []);
    setThreadRestoreReady(true);
    queueMicrotask(() => {
      agentRestoringRef.current = false;
    });
    return undefined;
  }, [isAgentAudience, authUser?.id, agentSelectedId]);

  useEffect(() => {
    if (!isAgentAudience || !authUser?.id || !threadRestoreReady) return undefined;
    if (agentRestoringRef.current) return undefined;
    writeAgentKeyChatSession(authUser.id, agentSelectedId, messages);
    return undefined;
  }, [isAgentAudience, authUser?.id, agentSelectedId, messages, threadRestoreReady]);

  useEffect(() => {
    if (!isAgentAudience || !authUser) return undefined;
    let cancelled = false;
    (async () => {
      setAgentListLoading(true);
      setAgentListError(null);
      const listed = await listAgentKeyBriefings();
      if (cancelled) return;
      if (!listed.ok) {
        setAgentAssignments([]);
        setAgentListError(listed.error_message);
        setAgentListLoading(false);
        return;
      }
      setAgentAssignments(listed.items ?? []);
      setAgentListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAgentAudience, authUser]);

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
  const shellHeaderPx = isWideRoom ? FINAL_UI.headerPx : FINAL_UI.headerPxMobile;

  useEffect(() => {
    // Inline rails on mid/wide ? close mobile/tablet sheets so they never cover the shell.
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
  // Agent mode must not wait on customer session hydrate / restore.
  const isDisabled = isAgentAudience
    ? disabled || !threadRestoreReady
    : disabled || loadingSession || !threadRestoreReady;

  const agentSelected = useMemo(
    () =>
      !isAgentAudience || agentSelectedId === AGENT_HOME_SCOPE_GENERAL
        ? null
        : agentAssignments.find((row) => row.assignment_id === agentSelectedId) ?? null,
    [isAgentAudience, agentAssignments, agentSelectedId],
  );
  const agentIsGeneral =
    !isAgentAudience || agentSelectedId === AGENT_HOME_SCOPE_GENERAL || !agentSelected;

  const selectAgentScope = useCallback((nextId) => {
    setAgentSelectedId((prev) => {
      if (prev === nextId) return prev;
      const agentId = authUserRef.current?.id;
      if (agentId) {
        writeAgentKeyChatSession(agentId, prev, messagesRef.current);
      }
      setError("");
      setInput("");
      setAgentListError(null);
      setAgentTurnMeta(null);
      setAgentBriefing(null);
      setAgentBriefingError(null);
      return nextId;
    });
  }, []);

  const requestAgentBriefing = useCallback(async () => {
    if (!agentSelected?.assignment_id || agentSelected.briefing_eligible !== true) return;
    if (agentBriefingLoading) return;
    setAgentBriefingLoading(true);
    setAgentBriefingError(null);
    try {
      const result = await createAgentKeyBriefingRequest({
        assignmentId: agentSelected.assignment_id,
        purpose:"상담 준비",
        question: "이 고객 상담을 위해 지금 알아둘 핵심을 정리해 주세요.",
      });
      if (!result.ok) {
        setAgentBriefing(null);
        setAgentBriefingError(
          result.error_message || "브리핑 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      setAgentBriefing(result.briefing);
    } catch {
      setAgentBriefing(null);
      setAgentBriefingError("브리핑 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setAgentBriefingLoading(false);
    }
  }, [agentSelected, agentBriefingLoading]);

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

  const scheduleScrollToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    coalescedScrollRef.current?.schedule(el);
  }, []);

  /** Instant jump to bottom ? restore / submit / jump button. No glide loop. */
  const scrollChatToBottomInstant = useCallback(() => {
    coalescedScrollRef.current?.cancel();
    stickToBottomRef.current = true;
    setShowLatestAnswerBtn(false);
    const apply = () => {
      const el = chatScrollRef.current;
      if (!el) return;
      scrollChatContainerToBottom(el, { tolerancePx: 0 });
      lastChatScrollTopRef.current = Number(el.scrollTop) || 0;
    };
    apply();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(apply);
    }
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const scrollTop = Number(el.scrollTop);
    if (!Number.isFinite(scrollTop)) return;
    const prevTop = lastChatScrollTopRef.current;
    const movedUp = scrollTop < prevTop - CHAT_SCROLL_UP_DEADZONE_PX;
    const movedDown = scrollTop > prevTop;
    const pending = Boolean(coalescedScrollRef.current?.pending);
    // Programmatic sticky follow writes scrollTop downward ? do not treat as user leave.
    if (pending && movedDown) {
      lastChatScrollTopRef.current = scrollTop;
      return;
    }
    const nearBottom = isScrollNearBottom(el);
    if (movedUp || !pending) {
      stickToBottomRef.current = nearBottom;
      if (!nearBottom) {
        // Leave bottom: cancel any coalesced follow so reading position stays fixed.
        coalescedScrollRef.current?.cancel();
      }
    }
    setShowLatestAnswerBtn(
      shouldShowJumpToLatestAnswer({
        stickToBottom: stickToBottomRef.current,
        nearBottom,
      }),
    );
    lastChatScrollTopRef.current = scrollTop;
  }, []);

  const jumpToLatestAnswer = useCallback(() => {
    const el = chatScrollRef.current;
    coalescedScrollRef.current?.cancel();
    stickToBottomRef.current = true;
    setShowLatestAnswerBtn(false);
    if (el) {
      // Instant jump ? no coalesced 6px glide.
      scrollChatContainerToBottom(el, { tolerancePx: 0 });
      lastChatScrollTopRef.current = Number(el.scrollTop) || 0;
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const node = chatScrollRef.current;
        if (!node) return;
        scrollChatContainerToBottom(node, { tolerancePx: 0 });
        lastChatScrollTopRef.current = Number(node.scrollTop) || 0;
      });
    }
  }, []);

  /** Prefer current entity; else first linked corporate entity (honest empty if none). */
  const resolveCorporateEntityId = useCallback(() => {
    const current = String(selectedEntityId ?? "").trim();
    if (current) return current;
    return String(corporateEntities[0]?.entity_id ?? "").trim() || null;
  }, [selectedEntityId, corporateEntities]);

  const selectPersonalScope = useCallback(() => {
    setViewMode("personal");
    setSelectedEntityId(null);
  }, []);

  const selectCorporateScope = useCallback(() => {
    setViewMode("corporate");
    setSelectedEntityId(resolveCorporateEntityId());
  }, [resolveCorporateEntityId]);

  const selectCombinedScope = useCallback(() => {
    setViewMode("both");
    setSelectedEntityId(resolveCorporateEntityId());
  }, [resolveCorporateEntityId]);

  useEffect(() => () => {
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    coalescedScrollRef.current?.cancel();
  }, []);

  // Restore / session switch: instant jump to latest (not 6px glide).
  useEffect(() => {
    if (!threadRestoreReady || panelView !== "chat") return undefined;
    if (!restoreForceScrollRef.current) return undefined;
    restoreForceScrollRef.current = false;
    scrollChatToBottomInstant();
    return undefined;
  }, [threadRestoreReady, panelView, sessionId, messages.length, scrollChatToBottomInstant]);

  // New message row only ? never on per-grapheme content updates.
  useEffect(() => {
    if (!threadRestoreReady || panelView !== "chat") return undefined;
    if (
      !shouldAutoFollowChatScroll({
        restoreForceOnce: false,
        stickToBottom: stickToBottomRef.current,
      })
    ) {
      const el = chatScrollRef.current;
      const nearBottom = el ? isScrollNearBottom(el) : false;
      if (
        shouldShowJumpToLatestAnswer({
          stickToBottom: stickToBottomRef.current,
          nearBottom,
        })
      ) {
        setShowLatestAnswerBtn(true);
      }
      return undefined;
    }
    setShowLatestAnswerBtn(false);
    scheduleScrollToBottom();
    return undefined;
  }, [messages.length, threadRestoreReady, panelView, scheduleScrollToBottom]);

  // Streaming height growth ? observe growing content (not fixed viewport).
  useEffect(() => {
    const scrollEl = chatScrollRef.current;
    const contentEl = chatScrollContentRef.current;
    if (!scrollEl || !contentEl || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (
        !shouldAutoFollowChatScroll({
          restoreForceOnce: restoreForceScrollRef.current,
          stickToBottom: stickToBottomRef.current,
        })
      ) {
        return;
      }
      coalescedScrollRef.current?.schedule(scrollEl);
    });
    ro.observe(contentEl);
    return () => ro.disconnect();
  }, [messages.length, sessionId, panelView]);

  useEffect(() => {
    focusChatInputRef.current = focusChatInput;
  }, [focusChatInput]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = Number(el.scrollHeight) || COMPOSER_TEXTAREA_MIN_PX;
    const next = Math.min(
      COMPOSER_TEXTAREA_MAX_PX,
      Math.max(COMPOSER_TEXTAREA_MIN_PX, scrollHeight),
    );
    el.style.height = `${next}px`;
    el.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_PX ? "auto" : "hidden";
  }, [input]);

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

  // Menu is always an overlay drawer ? never occupies main layout width.
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
    // Wait for session bootstrap ? early token race left corporateEntities stuck at [].
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

  // KEY Hand SSOT (profile_health) ? display-only strip; no Claude / no new judgment.
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

    // A: in-flight turn ? keep central chat messages; do not reboot the thread.
    const inflight = readInflightHomeChatTurn(customerId);
    if (inflight && isInflightHomeChatTurnActive(customerId)) {
      setSessionId(inflight.sessionId);
      writeActiveSessionId(customerId, inflight.sessionId);
      setMessages(inflight.messages);
      setLoading(Boolean(inflight.loading));
      setStreaming(Boolean(inflight.streaming));
      if (inflight.activeAttachment?.active_attachment_id) {
        setConversationActiveAttachment(
          inflight.activeAttachment.active_attachment_id,
          inflight.activeAttachment.active_attachment_mime ?? null,
          inflight.activeAttachment.active_attachment_ids,
        );
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
      const userEpochAtStart = userAttachActionEpochRef.current;
      const sessionIdAtStart = String(sessionIdRef.current ?? "");
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
        if (
          sessionIdAtStart &&
          String(activeId) !== sessionIdAtStart &&
          userAttachActionEpochRef.current === userEpochAtStart
        ) {
          clearConversationActiveAttachment();
          clearExplicitReopenFlight();
          setRestorableAttachmentCandidate(null);
        }
        sessionIdRef.current = activeId;
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
          // Past attach → restorable candidate only. Never auto-activate originals.
          if (
            !cancelled &&
            userAttachActionEpochRef.current === userEpochAtStart &&
            String(customerIdRef.current) === String(customerId) &&
            String(sessionIdRef.current) === String(activeId)
          ) {
            const candidate = pickRestorableAttachmentCandidate({
              messages: restored,
              snapshot,
              customerId,
              sessionId: activeId,
              rejectCleared: rejectClearedActiveAttachment,
            });
            setRestorableAttachmentCandidate(candidate);
          }
          setPanelView("chat");
        } else if (seed.length > 0) {
          // Remount before DB indexed the just-completed turn — keep local snapshot.
          setMessages((prev) => mergeRestoredSessionMessages(seed.length > 0 ? seed : prev, []));
          if (
            !cancelled &&
            userAttachActionEpochRef.current === userEpochAtStart &&
            String(customerIdRef.current) === String(customerId) &&
            String(sessionIdRef.current) === String(activeId)
          ) {
            const candidate = pickRestorableAttachmentCandidate({
              messages: seed,
              snapshot,
              customerId,
              sessionId: activeId,
              rejectCleared: rejectClearedActiveAttachment,
            });
            setRestorableAttachmentCandidate(candidate);
          }
          setPanelView("chat");
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

  // Triangle T6 ? KEY Presence (listen_focus) after READY CARD warm; cancel on customer question.
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

        // T4 ? persist must not block customer stream (already done).
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
      sessionIdRef.current = targetSessionId;
      setError("");
      writeActiveSessionId(customerId, targetSessionId);
      setThreadRestoreReady(false);
      restoreForceScrollRef.current = true;
      stickToBottomRef.current = true;
      clearConversationActiveAttachment();
      clearExplicitReopenFlight();
      setRestorableAttachmentCandidate(null);

      try {
        const restored = await loadLifeguardSessionMessages(authUser, targetSessionId, { customerId });
        setMessages(restored);
        const candidate = pickRestorableAttachmentCandidate({
          messages: restored,
          snapshot: null,
          customerId,
          sessionId: targetSessionId,
          rejectCleared: rejectClearedActiveAttachment,
        });
        if (String(sessionIdRef.current) === String(targetSessionId)) {
          setRestorableAttachmentCandidate(candidate);
        }
        writeLifeguardChatSnapshot(customerId, {
          sessionId: targetSessionId,
          messages: restored,
          activeAttachment: null,
        });
      } catch (err) {
        setMessages([]);
        clearConversationActiveAttachment();
        clearExplicitReopenFlight();
        setRestorableAttachmentCandidate(null);
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

    // Advisor KEY ? same V3.1 screen; SSE local thread (never customer conversation).
    if (isAgentAudience) {
      if (!canSubmitAgentFreeKey({ question: trimmed, submitting: loading || streaming })) return;
      setPanelView("chat");
      setSidebarOpen(false);
      setError("");
      scrollChatToBottomInstant();
      const historyForApi = messages
        .filter((m) => m.thinking !== true)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? "").trim(),
        }))
        .filter((m) => m.content);
      const assignmentId =
        !agentIsGeneral && agentSelected?.assignment_id
          ? agentSelected.assignment_id
          : null;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "KEY가 확인하고 있어요.", thinking: true },
      ]);
      setInput("");
      focusChatInput();
      setLoading(true);
      setStreaming(false);
      // Same markdown renderer from first delta through seal (no live plain ? done swap).
      const paint = createAgentStreamPaintController({
        onPaint: (text, { first }) => {
          if (first) {
            setStreaming(true);
            setLoading(false);
          }
          setMessages((prev) =>
            patchLastAssistantMessage(prev, {
              content: text,
              thinking: false,
            }),
          );
        },
      });
      try {
        const result = await postAgentFreeKeyChatStream({
          question: trimmed,
          history: historyForApi,
          assignmentId,
          onDelta: (chunk) => {
            paint.append(chunk);
          },
        });
        if (!result.ok) {
          paint.cancel();
          if (!paint.hasPainted()) {
            setMessages((prev) =>
              prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
            );
          }
          setError(result.error_message || "KEY 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }
        // After server done: append-only finalize ? displayed text wins over divergent seal.
        const answer = await paint.finalize(String(result.text ?? "").trim());
        setAgentTurnMeta({
          mode: result.mode ?? null,
          customer_context_used: result.customer_context_used === true,
          access_reason: result.access_reason ?? null,
        });
        setMessages((prev) =>
          patchLastAssistantMessage(prev, {
            content: answer,
            thinking: false,
            mode: result.mode,
            customer_context_used: result.customer_context_used === true,
          }),
        );
      } catch {
        paint.cancel();
        if (!paint.hasPainted()) {
          setMessages((prev) =>
            prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
          );
        }
        setError("KEY 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setLoading(false);
        setStreaming(false);
        focusChatInput();
      }
      return;
    }

    const uploadSendGate = shouldBlockSendForIncompleteUpload({
      uploading: chatAttachUploading,
      composerAttachments: chatAttachments,
    });
    if (uploadSendGate.block) {
      setError(
        uploadSendGate.reason === "upload_ids_not_ready"
          ? "파일 업로드가 끝난 뒤 보내 주세요."
          : "파일 업로드가 끝난 뒤 보내 주세요.",
      );
      return;
    }

    // T6 ? customer question always wins over Presence (single active stream).
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

    // Pending vault ids (post-store transit) or leftover composer rows — then consume to empty.
    const pendingConsumed = consumePendingDocumentDelivery(
      pendingDocumentDeliveryRef.current,
    );
    const attachmentsForTurn = snapshotChatComposerAttachments(chatAttachments).map(
      (row) => ({
        ...row,
        previewUrl: "",
      }),
    );
    const composerDocumentIds = listChatComposerDocumentIds(attachmentsForTurn);
    const pendingIds = pendingConsumed.deliveryIds;
    const composerDocumentId = composerDocumentIds[0] || pendingIds[0] || null;
    const composerAttachLabel =
      pendingConsumed.label ||
      formatChatComposerAttachLabel(attachmentsForTurn);
    const deliveryMetaForMessage =
      pendingIds.length > 0
        ? pendingIds.map((id, i) => ({
            documentId: id,
            filename: pendingConsumed.filenames[i] || "파일",
            previewUrl: "",
            mime: pendingConsumed.mimes[i] || null,
            isImage: String(pendingConsumed.mimes[i] || "").startsWith("image/"),
          }))
        : attachmentsForTurn;

    // One-shot reopen: snapshot for wire on flight start; permanent consume only on SSE ack.
    if (
      explicitReopenFlightRef.current?.status === EXPLICIT_REOPEN_STATUS.IN_FLIGHT
    ) {
      setError("이전 문서 다시보기 요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const reopenFlightBegin = beginExplicitReopenFlight(explicitReopenFlightRef.current);
    if (reopenFlightBegin.ok === false && reopenFlightBegin.reason === "already_in_flight") {
      setError("이전 문서 다시보기 요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    syncExplicitReopenFlight(reopenFlightBegin.nextState);
    const reopenIdsForTurn = Array.isArray(reopenFlightBegin.requestSnapshotIds)
      ? reopenFlightBegin.requestSnapshotIds.slice()
      : [];
    let reopenAckSeen = false;

    // Originals only from pending store delivery or chip reopen — never past activeAttachmentIds.
    const documentIdsForTurn =
      pendingIds.length > 0
        ? pendingIds.slice()
        : composerDocumentIds.length > 0
          ? composerDocumentIds.slice()
          : reopenIdsForTurn.slice();
    const documentIdForTurn = documentIdsForTurn[0] || null;
    let attachMimeForTurn =
      (pendingIds.length && pendingConsumed.mimes[pendingConsumed.mimes.length - 1]) ||
      deliveryMetaForMessage[deliveryMetaForMessage.length - 1]?.mime ||
      (composerDocumentId ? "application/pdf" : null);
    let attachIsImageForTurn = String(attachMimeForTurn || "").startsWith("image/");
    if (!pendingIds.length && !composerDocumentIds.length && reopenIdsForTurn.length) {
      attachMimeForTurn =
        restorableAttachmentCandidate?.active_attachment_mime || attachMimeForTurn;
      attachIsImageForTurn =
        !attachMimeForTurn || String(attachMimeForTurn).startsWith("image/");
    }

    setPanelView("chat");
    setSidebarOpen(false);
    scrollChatToBottomInstant();
    const turnId = createLifeguardSessionId();
    inflightTurnIdRef.current = turnId;
    appendHomeChatStreamTrace("chat_submit");
    // Never keep upload transit / restorable authority after delivery is consumed.
    const activeAttachmentForTurn = null;
    setPendingDocumentDelivery(pendingConsumed.nextPending);
    pendingDocumentDeliveryRef.current = pendingConsumed.nextPending;
    clearConversationActiveAttachment();
    setRestorableAttachmentCandidate(null);
    if (customerId) {
      writeLifeguardChatSnapshot(customerId, {
        sessionId,
        messages,
        activeAttachment: null,
      });
    }
    const userMessage = {
      role: "user",
      content: deliveryMetaForMessage.length
        ? `${trimmed}\n\n(첨부: ${composerAttachLabel || "파일"})`
        : trimmed,
      turnId,
      ...(deliveryMetaForMessage.length
        ? { attachments: deliveryMetaForMessage }
        : {}),
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
    // Fold composer tray immediately — revoke any leftover previews (message has no blob URLs).
    setMessages(liveMessages);
    setInput("");
    setChatAttachments((prev) => discardComposerUploadTransit(prev));
    setAttachHint("");
    if (fileInputRef.current) fileInputRef.current.value = "";
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

    /** @type {ReturnType<typeof createAgentStreamPaintController> | null} */
    let paint = null;
    try {
      const historyMessages = nextMessages.slice(0, -1);
      const history = historyMessages.map((m) => ({ role: m.role, content: m.content }));
      appendHomeChatStreamTrace("home_brain_request_start");

      let streamedText = "";
      let sawFirstSseEvent = false;
      let sawSseDone = false;
      // GO3: session_id only ? server SSOT loads session_goal; never send prior_session_goal.
      const handoffToken = getReadyCardHandoffToken({ customerId, sessionId });
      // One-shot delivery: pending/composer/reopen snapshot → currentTurnDocumentIds only.
      // Do not pass legacy documentIds as original-byte authority (request body ignores them).
      const attachOptions = {
        sessionId,
        clientTurnId: turnId,
        attachmentReferenceEnabled: false,
        ...(documentIdsForTurn.length
          ? { currentTurnDocumentIds: documentIdsForTurn.slice() }
          : {}),
        ...(reopenIdsForTurn.length && !documentIdsForTurn.length
          ? { explicitReopenDocumentIds: reopenIdsForTurn.slice() }
          : {}),
        ...(handoffToken ? { readyCardHandoffToken: handoffToken } : {}),
        viewMode,
        ...(viewMode !== "personal" && selectedEntityId
          ? { entityId: selectedEntityId, entityType: "corporate" }
          : {}),
        ...(buildPointedContractIdsPayload(pointedContractId).length
          ? { pointedContractIds: buildPointedContractIdsPayload(pointedContractId) }
          : {}),
      };
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
      // Same one-grapheme paint controller as advisor (display only).
      paint = createAgentStreamPaintController({
        onPaint: (text, { first }) => {
          if (first) {
            setStreaming(true);
            setLoading(false);
          }
          streamedText = text;
          patchAssistantContent(text);
        },
      });
      const result = await fetchHomeBrainFactStream(
        trimmed,
        history,
        {
          onAck: (ackText) => {
            markFirstSse();
            // ACK = server accepted request; reopen one-shot is permanently consumed.
            if (reopenIdsForTurn.length && !reopenAckSeen) {
              reopenAckSeen = true;
              syncExplicitReopenFlight(
                markExplicitReopenAck(explicitReopenFlightRef.current),
              );
            }
            // Short customer status only ? do not list internal search/doc stage names.
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
            paint.append(chunk);
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
      if (result.documentMemoryPersistFailed) {
        const paintedNow = String(paint.getPainted() || streamedText || "");
        const memoryFailMessage =
          result.memoryPersistErrorMessage ||
          "답변은 준비됐지만 KEY 공식 기억 저장이 완료되지 않았습니다. 기억 저장을 다시 시도해 주세요.";
        // Vault store already done — never revive upload File/preview/composer authority.
        void planUploadTransitOnMemoryCommitFailure();
        setChatAttachments((prev) => discardComposerUploadTransit(prev));
        setPendingDocumentDelivery(createEmptyPendingDocumentDelivery());
        pendingDocumentDeliveryRef.current = createEmptyPendingDocumentDelivery();
        setRestorableAttachmentCandidate(null);
        if (paintedNow.trim()) {
          syncLiveMessages(
            patchLastAssistantMessage(liveMessages, {
              content: paintedNow,
              thinking: false,
              turnId,
              document_memory_persist_failed: true,
              memory_commit_id: result.memoryCommitId ?? null,
              memory_save_retry_needed: true,
            }),
            {
              phase: "memory_failed",
              loading: false,
              streaming: false,
              streamedCommitted: true,
            },
          );
        }
        setLoading(false);
        setStreaming(false);
        setError(memoryFailMessage);
        endInflightHomeChatTurn(turnId);
        inflightTurnIdRef.current = null;
        return;
      }
      if (!sawFirstSseEvent) {
        appendHomeChatStreamTrace("sse_first_event");
      }
      markSseDone();

      const sealedText = String(result.answerText ?? "");
      const paintedNow = String(paint.getPainted() || streamedText || "");
      // Append-only: sealed may extend painted; divergent sealed must not replace display.
      const finalizeInput = (() => {
        if (!paintedNow) return sealedText || String(paint.getAccumulated() || "");
        if (!sealedText) return paintedNow;
        if (sealedText === paintedNow || sealedText.startsWith(paintedNow)) return sealedText;
        return paintedNow;
      })();
      const hasCustomerAnswer = Boolean(
        String(finalizeInput || paintedNow || paint.getAccumulated() || "").trim(),
      );

      let finalText = paintedNow;
      if (hasCustomerAnswer) {
        setStreaming(true);
        setLoading(false);
        const paintedFinal = await paint.finalize(finalizeInput);
        // Customer-visible text is authoritative for screen + persist (never divergent seal).
        finalText = String(paintedFinal || paint.getPainted() || paintedNow || "");
        streamedText = finalText;
        if (finalText) {
          patchAssistantContent(finalText);
        }
      } else {
        paint.cancel();
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
      // Patch the existing assistant row ? do not delete/recreate (keep turnId).
      const completedMessages = hasCustomerAnswer
        ? patchLastAssistantMessage(liveMessages, {
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
          })
        : nextMessages;
      appendHomeChatStreamTrace("streamed_answer_commit");
      syncLiveMessages(completedMessages, {
        phase: "committing",
        loading: false,
        streaming: false,
        streamedCommitted: true,
      });
      // Turn mirror kept for internal continuity; right rail shows baseline (non-blocking).
      if (hasCustomerAnswer) {
        setTurnMirror(
          buildKeyTurnMirror({
            answerText: finalText,
            visualBlocks,
            policies,
          }),
        );
      }
      // Original-delivery authority never persists after the request — candidate chip only.
      let nextActive = null;
      clearConversationActiveAttachment();
      if (shouldClearActiveAttachmentAfterTurn(result) && documentIdsForTurn.length) {
        // Fail-closed attach: keep candidate for manual reopen, never auto-resend bytes.
      }
      if (documentIdsForTurn.length > 0 || activeDocumentIdForTurn) {
        const snapIds =
          documentIdsForTurn.length > 0
            ? documentIdsForTurn.slice()
            : [activeDocumentIdForTurn];
        rememberRestorableCandidateFromBundle(
          {
            active_attachment_id: snapIds[snapIds.length - 1] || activeDocumentIdForTurn,
            active_attachment_ids: snapIds,
            active_attachment_mime: attachMimeForTurn,
          },
          { customerId, sessionId },
        );
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
      // Composer tray already cleared at send; conversation active attachment stays.

      if (authUser && customerId) {
        if (hasCustomerAnswer) {
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

      // KEY persist may update policy SSOT / chart ? refresh left/right rails only.
      // B: do not let unified-state refresh replace the streamed customer_answer for this turn.
      // Vault recall (no composer attach) also needs rail refresh after inventory upsert.
      const shouldRefreshRailsAfterPersist =
        Boolean(documentIdForTurn) ||
        result?.pdfAttached === true ||
        Number(result?.originalAttachmentCount ?? 0) > 0 ||
        isInsuranceDocumentRecallQuestion(trimmed) === true ||
        wantsOwnedInsuranceVaultEvidence(trimmed) === true;
      if (
        shouldRefreshRailsAfterPersist &&
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
      // Successful return without ack event still consumes (server may have accepted).
      if (reopenIdsForTurn.length && !reopenAckSeen) {
        reopenAckSeen = true;
        syncExplicitReopenFlight(
          markExplicitReopenAck({
            status: EXPLICIT_REOPEN_STATUS.IN_FLIGHT,
            documentIds: reopenIdsForTurn.slice(),
            ackReceived: false,
          }),
        );
      }
      endInflightHomeChatTurn(turnId);
      inflightTurnIdRef.current = null;
    } catch (err) {
      const memoryFailSealed =
        err?.reason === "KEY_DOCUMENT_MEMORY_PERSIST_FAILED" && err?.answer_sealed === true;
      const paintedNow = String(paint?.getPainted?.() || "").trim();
      const lastAssistant = liveMessages[liveMessages.length - 1];
      const hasPaintedAnswer =
        Boolean(paintedNow) ||
        (lastAssistant?.role === "assistant" &&
          lastAssistant?.thinking !== true &&
          Boolean(String(lastAssistant?.content ?? "").trim()));

      if (memoryFailSealed && hasPaintedAnswer) {
        try {
          paint?.cancel();
        } catch {
          /* ignore */
        }
        if (reopenIdsForTurn.length) {
          if (reopenAckSeen) {
            syncExplicitReopenFlight({
              status: EXPLICIT_REOPEN_STATUS.CONSUMED,
              documentIds: [],
              ackReceived: true,
            });
          } else {
            syncExplicitReopenFlight(
              resolveExplicitReopenFlightFailure(explicitReopenFlightRef.current),
            );
          }
        }
        const displayText =
          paintedNow || String(lastAssistant?.content ?? "").trim();
        syncLiveMessages(
          patchLastAssistantMessage(liveMessages, {
            content: displayText,
            thinking: false,
            turnId,
            document_memory_persist_failed: true,
            memory_commit_id: err?.memory_commit_id ?? null,
            memory_save_retry_needed: true,
          }),
          {
            phase: "memory_failed",
            loading: false,
            streaming: false,
            streamedCommitted: true,
          },
        );
        endInflightHomeChatTurn(turnId);
        inflightTurnIdRef.current = null;
        setLoading(false);
        setStreaming(false);
        setError(
          err?.error_message ||
            "답변은 준비됐지만 KEY 공식 기억 저장이 완료되지 않았습니다. 기억 저장을 다시 시도해 주세요.",
        );
        return;
      }

      try {
        paint?.cancel();
      } catch {
        /* ignore */
      }
      // Pre-ack failure re-arms reopen; post-ack stays consumed (no second original delivery).
      if (reopenIdsForTurn.length) {
        if (reopenAckSeen) {
          syncExplicitReopenFlight({
            status: EXPLICIT_REOPEN_STATUS.CONSUMED,
            documentIds: [],
            ackReceived: true,
          });
        } else {
          syncExplicitReopenFlight(
            resolveExplicitReopenFlightFailure(explicitReopenFlightRef.current),
          );
        }
      }
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.thinking) {
          copy.pop();
        }
        return copy;
      });
      // Vault store already succeeded — never revive File/preview/composer upload authority.
      void planUploadTransitOnMemoryCommitFailure();
      setChatAttachments((prev) => discardComposerUploadTransit(prev));
      setPendingDocumentDelivery(createEmptyPendingDocumentDelivery());
      pendingDocumentDeliveryRef.current = createEmptyPendingDocumentDelivery();
      setRestorableAttachmentCandidate(null);
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
    sessionIdRef.current = newSessionId;
    setMessages([]);
    setTurnMirror(null);
    setInput("");
    setError("");
    clearConversationActiveAttachment();
    clearExplicitReopenFlight();
    setRestorableAttachmentCandidate(null);
    clearComposerAttach();
    if (shouldClearPointedContractOnLifecycle({ event: "new_chat" })) {
      setPointedContractId(null);
    }
    setPanelView("chat");
    setSidebarOpen(false);
    setInsuranceRailOpen(false);
    setMirrorRailOpen(false);
    restoreForceScrollRef.current = false;
    stickToBottomRef.current = true;
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = 0;
    }
    lastChatScrollTopRef.current = 0;
    if (customerId) {
      writeActiveSessionId(customerId, newSessionId);
      clearLifeguardChatSnapshot(customerId);
    }
    focusChatInput();
  };

  const clearComposerAttach = () => {
    setChatAttachments((prev) => discardComposerUploadTransit(prev));
    setPendingDocumentDelivery(createEmptyPendingDocumentDelivery());
    pendingDocumentDeliveryRef.current = createEmptyPendingDocumentDelivery();
    setChatAttachError("");
    setAttachHint("");
    setRestorableAttachmentCandidate(null);
    clearConversationActiveAttachment();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearActiveAttachment = () => {
    if (activeAttachmentId) {
      rememberRestorableCandidateFromBundle(
        {
          active_attachment_id: activeAttachmentId,
          active_attachment_ids: activeAttachmentIds,
          active_attachment_mime: activeAttachmentMime,
        },
        { customerId, sessionId },
      );
    }
    clearConversationActiveAttachment();
    if (customerId) {
      writeLifeguardChatSnapshot(customerId, {
        sessionId,
        messages,
        activeAttachment: null,
      });
    }
  };

  const reactivateRestorableAttachmentCandidate = () => {
    if (loading || streaming || chatAttachUploading) return;
    if (
      !isRestorableAttachmentCandidateInScope(restorableAttachmentCandidate, {
        customerId,
        sessionId,
      })
    ) {
      return;
    }
    const rejected = rejectClearedActiveAttachment(
      restorableAttachmentCandidate,
      customerId,
    );
    if (!rejected) return;
    markUserAttachAction();
    // Explicit chip reopen: arm one-shot ids only — do not restore active delivery authority.
    const reopenIds = (
      Array.isArray(rejected.active_attachment_ids) && rejected.active_attachment_ids.length
        ? rejected.active_attachment_ids
        : rejected.active_attachment_id
          ? [rejected.active_attachment_id]
          : []
    )
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    if (explicitReopenFlightRef.current?.status === EXPLICIT_REOPEN_STATUS.IN_FLIGHT) {
      return;
    }
    syncExplicitReopenFlight(armExplicitReopenOneShot(reopenIds));
    clearConversationActiveAttachment();
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
      if (listChatComposerDocumentIds(chatAttachments).includes(deleted)) {
        setChatAttachments((prev) => {
          const removed = prev.filter((row) => String(row?.documentId ?? "").trim() === deleted);
          revokeChatComposerPreviewUrls(removed);
          return removeChatComposerAttachment(prev, deleted);
        });
      }
      // Always tombstone + scrub message metadata ? refresh reloads DB metadata otherwise.
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
        clearConversationActiveAttachment();
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
      chatAttachments,
      activeAttachmentId,
      activeAttachmentMime,
      customerId,
      sessionId,
    ],
  );

  const finishDocumentDeleteResult = useCallback(
    async (result, { setLocalError }) => {
      const did = String(result?.documentId ?? "").trim();
      // Soft-delete already took effect ? never restore active document_id / prior_attach.
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

  const handleComposerRemove = async (documentId = null) => {
    const did =
      String(documentId ?? "").trim() ||
      listChatComposerDocumentIds(chatAttachments)[0] ||
      "";
    if (!did || !authUser) {
      if (!did) clearComposerAttach();
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

  const handleChatAttachSelected = async (filesInput) => {
    const files = listSelectedUploadFiles(filesInput);
    if (files.length === 0) return;
    if (!authUser) {
      setChatAttachError("로그인이 필요합니다.");
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
    const fileErrors = [];
    const storedRows = [];
    const rawFileCountBefore = files.length;
    try {
      await processSelectedUploadFiles(files, async (file) => {
        try {
          if (!isChatAttachFile(file)) {
            fileErrors.push("PDF, JPG, JPEG, PNG 파일만 첨부할 수 있습니다.");
            return { ok: false, reason: "invalid_file_type" };
          }
          const isImage = String(file.type || "").startsWith("image/");
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
          const filename = String(doc?.original_filename ?? file.name ?? "파일").trim();
          // Transit only: arm document_id for next chat send — never keep File/preview/chip.
          storedRows.push({ documentId, filename, mime });
          markUserAttachAction();
          return { ok: true, documentId };
        } catch (err) {
          fileErrors.push(toCustomerErrorMessage(err, "파일 업로드에 실패했습니다."));
          return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
        }
      });
      await loadDocumentsRef.current?.();
      if (storedRows.length > 0) {
        const planned = planUploadTransitCleanupAfterDocumentStore({
          composerAttachments: chatAttachments,
          storedRows,
          priorPending: pendingDocumentDeliveryRef.current,
          keepPendingDeliveryForNextSend: true,
        });
        setChatAttachments(planned.composerAttachments);
        setPendingDocumentDelivery(planned.pendingDelivery);
        pendingDocumentDeliveryRef.current = planned.pendingDelivery;
        setRestorableAttachmentCandidate(null);
        clearConversationActiveAttachment();
        setAttachHint("");
        if (customerId) {
          writeLifeguardChatSnapshot(customerId, {
            sessionId,
            messages,
            activeAttachment: null,
          });
        }
        try {
          console.info(
            "[upload_transit_cleanup]",
            JSON.stringify({
              ...planned.trace,
              raw_file_count_before: rawFileCountBefore,
            }),
          );
        } catch {
          /* ignore */
        }
      }
      // Failures never mix into pending delivery; do not revive UI for stored files.
      if (fileErrors.length > 0) {
        setChatAttachError(fileErrors[0]);
      }
    } catch (err) {
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
      // C1 UI ENTRY RECONNECT — panelView="insurance" is SSOT for contract selection.
      // Narrow left sheet must not replace the insurance selection panel.
      const entry = resolveC1InsurancePanelEntryAction();
      setPanelView(entry.panelView);
      setSidebarOpen(entry.sidebarOpen);
      setInsuranceRailOpen(entry.insuranceRailOpen);
    },
    onOpenBaselinePanel: () => {
      // Narrow/mid: final-shell right sheet. Wide: right rail already inline.
      setPanelView("chat");
      setSidebarOpen(false);
      if (!isWideRoom) setMirrorRailOpen(true);
    },
    onClose: () => setSidebarOpen(false),
    onSignOut: async () => {
      if (isAgentAudience && authUser?.id) {
        clearAllAgentKeyChatSessions(authUser.id);
      }
      if (shouldClearPointedContractOnLifecycle({ event: "logout" })) {
        setPointedContractId(null);
      }
      await supabase.auth.signOut();
    },
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
        height: "100dvh",
        maxHeight: "100dvh",
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
            {isAgentAudience ? (
              <KeyAgentLeftRail
                collapsed={false}
                onToggleCollapse={() => setInsuranceRailOpen(false)}
                items={agentAssignments}
                listLoading={agentListLoading}
                listError={agentListError}
                selectedId={agentSelectedId}
                generalId={AGENT_HOME_SCOPE_GENERAL}
                onSelectScope={selectAgentScope}
                onOpenMenu={() => {
                  setInsuranceRailOpen(false);
                  setSidebarOpen(true);
                }}
                style={{ width: "100%", maxWidth: "none", height: "100%" }}
              />
            ) : (
              <KeyCustomerLeftRail
                shell={finalShell}
                displayName={displayName}
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
            )}
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
            {isAgentAudience ? (
              <KeyAgentRightRail
                collapsed={false}
                onToggleCollapse={() => setMirrorRailOpen(false)}
                isGeneral={agentIsGeneral}
                selected={agentSelected}
                turnMeta={agentTurnMeta}
                briefing={agentBriefing}
                briefingLoading={agentBriefingLoading}
                briefingError={agentBriefingError}
                onRequestBriefing={requestAgentBriefing}
                style={{ width: "100%", maxWidth: "none", height: "100%" }}
              />
            ) : (
              <KeyCustomerRightRail
                shell={finalShell}
                collapsed={false}
                onToggleCollapse={() => setMirrorRailOpen(false)}
                onOpenFamily={() => {
                  setMirrorRailOpen(false);
                  setSidebarOpen(true);
                }}
                onOpenSessions={() => {
                  setMirrorRailOpen(false);
                  setSidebarOpen(true);
                }}
                onOpenVault={() => {
                  setMirrorRailOpen(false);
                  setPanelView("documents");
                  setSidebarOpen(false);
                }}
                style={{ width: "100%", maxWidth: "none", height: "100%" }}
              />
            )}
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
        {/* Single V3.1 shell header ? one DOM header spanning L/C/R */}
        <header
          className="lg-v31-shell-header"
          style={{
            flexShrink: 0,
            height: `${shellHeaderPx}px`,
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
          {/* True header-viewport center ? not between L/R flex groups. */}
          <div
            className="lg-v31-center-brand-mark"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <span
              style={{
                fontFamily: LG.serif,
                fontSize: "24px",
                fontWeight: 600,
                color: FINAL_UI.navyDeep,
                letterSpacing: "0.06em",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              LIFEGUARD
            </span>
          </div>

          <div
            style={{
              width: showInsuranceInline ? leftCol : "auto",
              maxWidth: showInsuranceInline ? leftCol : "46%",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              paddingLeft: "4px",
              flexShrink: 1,
              minWidth: 0,
              position: "relative",
              zIndex: 2,
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
            <div
              role="group"
              aria-label="메뉴 열기"
              className="lg-v31-scope lg-v31-header-scope"
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "row",
                flexWrap: "nowrap",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "8px",
                overflowX: "auto",
                overflowY: "hidden",
              }}
            >
              <button
                type="button"
                onClick={selectPersonalScope}
                style={scopeBtnStyle(viewMode === "personal")}
              >
                개인
              </button>
              <button
                type="button"
                onClick={selectCorporateScope}
                style={scopeBtnStyle(viewMode === "corporate")}
              >
                법인
              </button>
              <button
                type="button"
                onClick={selectCombinedScope}
                style={scopeBtnStyle(viewMode === "both")}
              >
                개인+법인 함께
              </button>
              {isAgentAudience ? (
                <span
                  className="lg-agent-key-badge"
                  style={{
                    fontSize: `${FINAL_UI.brandTagSize}px`,
                    color: FINAL_UI.muted,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    marginLeft: "4px",
                  }}
                >
                  설계사 KEY
                </span>
              ) : null}
            </div>
          </div>

          <div
            style={{
              width: showMirrorInline ? rightCol : "auto",
              minWidth: showMirrorInline ? rightCol : 0,
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "10px",
              paddingRight: "4px",
              flexShrink: 0,
              position: "relative",
              zIndex: 2,
            }}
          >
            {showMirrorInline ? (
              <div style={{ textAlign: "right", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 800,
                    color: FINAL_UI.navy,
                    lineHeight: 1.15,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {isAgentAudience ? "권한 · 브리핑" : "KEY가 계속 관리하는 것"}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: FINAL_UI.muted,
                    marginTop: "1px",
                    lineHeight: 1.2,
                  }}
                >
                  {isAgentAudience ? "선택 고객 자료 범위" : "돈 · 일정 · 활동 · 결과"}
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
            padding: `${FINAL_UI.bodyGapPx}px ${FINAL_UI.roomInlinePx}px ${FINAL_UI.shellBottomInsetPx}px`,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            overflowX: "hidden",
            background: "transparent",
            boxSizing: "border-box",
          }}
        >
          {showInsuranceInline ? (
            isAgentAudience ? (
              <KeyAgentLeftRail
                collapsed={leftRailCollapsed}
                onToggleCollapse={() => setLeftRailCollapsed((v) => !v)}
                items={agentAssignments}
                listLoading={agentListLoading}
                listError={agentListError}
                selectedId={agentSelectedId}
                generalId={AGENT_HOME_SCOPE_GENERAL}
                onSelectScope={selectAgentScope}
                onOpenMenu={() => setSidebarOpen(true)}
                style={{ height: "100%" }}
              />
            ) : (
              <KeyCustomerLeftRail
                shell={finalShell}
                displayName={displayName}
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
            )
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
        {panelView === "chat" ? (
          <div
            className="lg-v31-action-slot lg-v31-content-rail"
            style={finalUiContentRailStyle({
              paddingTop: `${FINAL_UI.emptyActionPadTopPx}px`,
              paddingBottom: `${FINAL_UI.actionSlotPadBottomPx}px`,
              flexShrink: 0,
            })}
          >
            <KeyNowActionCard
              action={isAgentAudience ? AGENT_NOW_ACTION : finalShell?.nowAction || null}
              disabled={isDisabled || loading || streaming}
              onCta={() => {
                if (isAgentAudience) {
                  const text =
                    String(AGENT_NOW_ACTION.submitText || "").trim() || "상담 준비를 도와주세요";
                  submitQuestion(text);
                  return;
                }
                const text =
                  String(finalShell?.nowAction?.submitText || "").trim() || "준비가 되면 알려주기";
                submitQuestion(text);
              }}
            />
          </div>
        ) : null}
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
          <div
            ref={chatScrollContentRef}
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
            }}
          >
          {panelView === "insurance" ? (
            <LayerPanel title="내 보험 점검" onBack={goBackToChat}>
              <CustomerInsuranceList
                policies={viewMode === "corporate" ? [] : policies}
                loading={loadingSession}
                selectedPolicyId={pointedContractId}
                onSelectPolicy={setPointedContractId}
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
            <LayerPanel title="내 문서" onBack={goBackToChat}>
              <p style={{ margin: 0 }}>{displayName}님으로 사용 중이에요..</p>
            </LayerPanel>
          ) : null}

          {panelView === "chat" && messages.length === 0 ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
                paddingTop: `${FINAL_UI.emptyGuidePadTopPx}px`,
                textAlign: "left",
              })}
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
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                display: "flex",
                justifyContent: "center",
                paddingTop: `${FINAL_UI.emptyActionPadTopPx}px`,
                marginTop: 0,
                marginBottom: `${FINAL_UI.msgDateMbPx}px`,
              })}
            >
            <div
              style={{
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
            </div>
          ) : null}

          {panelView === "chat"
            ? messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const speaker = isUser ? displayName || "고객" : "KEY";
                return (
                  <div
                    key={`${index}-${msg.role}`}
                    className="lg-v31-content-rail"
                    style={finalUiContentRailStyle({
                      display: "flex",
                      justifyContent: isUser ? "flex-end" : "flex-start",
                      paddingTop: isUser
                        ? `${FINAL_UI.msgPadYUser}px`
                        : `${FINAL_UI.msgPadYAssistant}px`,
                      paddingBottom: isUser
                        ? `${FINAL_UI.msgPadYUser}px`
                        : `${FINAL_UI.msgPadYAssistant}px`,
                    })}
                  >
                    <div
                      style={{
                        width: isUser ? "fit-content" : "100%",
                        maxWidth: "100%",
                        marginLeft: isUser ? "auto" : 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        alignItems: isUser ? "flex-end" : "stretch",
                      }}
                      aria-live={!isUser && msg.thinking ? "polite" : undefined}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "8px",
                          justifyContent: isUser ? "flex-end" : "flex-start",
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
                          <>
                            <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                            {Array.isArray(msg.attachments) && msg.attachments.length > 0 ? (
                              <AttachmentTray
                                attachments={msg.attachments}
                                removable={false}
                                mutedColor={FINAL_UI.muted}
                                textColor={FINAL_UI.text}
                                borderColor={FINAL_UI.line}
                                surfaceColor={FINAL_UI.surface}
                                fontFamily={FINAL_UI.sans}
                                style={{ marginTop: "6px", marginBottom: 0, alignSelf: "flex-end" }}
                              />
                            ) : null}
                          </>
                        ) : msg.thinking ? (
                          <>
                            <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
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
                        ) : (
                          <LifeguardAssistantMarkdown
                            text={msg.content}
                            muted={false}
                            fontFamily={FINAL_UI.sans}
                          />
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
          </div>
        </div>

        {panelView === "chat" && showLatestAnswerBtn ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexShrink: 0,
              padding: "6px 0 2px",
            }}
          >
            <button
              type="button"
              onClick={jumpToLatestAnswer}
              aria-label="최신 답변으로"
              style={{
                border: `1px solid ${FINAL_UI.line}`,
                background: FINAL_UI.surface,
                borderRadius: "999px",
                padding: "7px 14px",
                fontSize: "12px",
                fontWeight: 700,
                color: FINAL_UI.text,
                cursor: "pointer",
                fontFamily: FINAL_UI.sans,
              }}
            >
              최신 답변으로 ↓
            </button>
          </div>
        ) : null}

        {panelView === "chat" ? (
          <div
            className="lg-v31-composer-wrap"
            style={{
              padding: `0 ${FINAL_UI.contentRailInsetPx}px ${FINAL_UI.composerWrapPadBottomPx}px`,
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
            {chatAttachments.length > 0 && !chatAttachUploading ? (
              <AttachmentTray
                attachments={chatAttachments}
                removable
                deletingId={documentDeletingId}
                deleteLabel={DOCUMENT_UI_MESSAGES.deleteAction}
                onRemove={(did) => {
                  void handleComposerRemove(did);
                }}
                mutedColor={FINAL_UI.muted}
                textColor={FINAL_UI.text}
                borderColor={FINAL_UI.line}
                surfaceColor={FINAL_UI.surface}
                fontFamily={FINAL_UI.sans}
              />
            ) : null}
            {chatAttachments.length === 0 && !chatAttachUploading && activeAttachmentId ? (
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
            {chatAttachments.length === 0 &&
            !chatAttachUploading &&
            !activeAttachmentId &&
            activeAttachmentIds.length === 0 &&
            !loading &&
            !streaming &&
            isRestorableAttachmentCandidateInScope(restorableAttachmentCandidate, {
              customerId,
              sessionId,
            }) ? (
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
                <span>
                  {"이전 첨부 " +
                    String(
                      Array.isArray(restorableAttachmentCandidate.active_attachment_ids)
                        ? restorableAttachmentCandidate.active_attachment_ids.length
                        : 1,
                    ) +
                    "개를 다시 참조할 수 있습니다."}
                </span>
                <button
                  type="button"
                  onClick={reactivateRestorableAttachmentCandidate}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: LG.textMuted,
                    cursor: "pointer",
                    fontSize: "12px",
                    fontFamily: FINAL_UI.sans,
                  }}
                >
                  {"이전 첨부 " +
                    String(
                      Array.isArray(restorableAttachmentCandidate.active_attachment_ids)
                        ? restorableAttachmentCandidate.active_attachment_ids.length
                        : 1,
                    ) +
                    "개 참조하기"}
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
                width: "100%",
                maxWidth: "100%",
                minHeight: `${COMPOSER_SHELL_MIN_PX}px`,
                height: "auto",
                boxSizing: "border-box",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept={CHAT_ATTACH_FILE_ACCEPT}
                onChange={(e) => {
                  void handleChatAttachSelected(e.target.files);
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
                  padding: "10px 0",
                  minHeight: `${COMPOSER_TEXTAREA_MIN_PX}px`,
                  maxHeight: `${COMPOSER_TEXTAREA_MAX_PX}px`,
                  overflowY: "hidden",
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
            isAgentAudience ? (
              <KeyAgentRightRail
                collapsed={rightRailCollapsed}
                onToggleCollapse={() => setRightRailCollapsed((v) => !v)}
                isGeneral={agentIsGeneral}
                selected={agentSelected}
                turnMeta={agentTurnMeta}
                briefing={agentBriefing}
                briefingLoading={agentBriefingLoading}
                briefingError={agentBriefingError}
                onRequestBriefing={requestAgentBriefing}
                style={{ height: "100%" }}
              />
            ) : (
              <KeyCustomerRightRail
                shell={finalShell}
                collapsed={rightRailCollapsed}
                onToggleCollapse={() => setRightRailCollapsed((v) => !v)}
                onOpenFamily={() => setSidebarOpen(true)}
                onOpenSessions={() => setSidebarOpen(true)}
                onOpenVault={() => {
                  setPanelView("documents");
                  setSidebarOpen(false);
                }}
                style={{ height: "100%" }}
              />
            )
          ) : null}
        </div>
      </div>

      <KeyInsuranceDetailDrawer detail={detailDrawer} onClose={() => setDetailDrawer(null)} />
    </div>
  );
}
