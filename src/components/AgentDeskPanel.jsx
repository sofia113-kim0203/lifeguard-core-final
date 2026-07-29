import { useEffect, useMemo, useRef, useState } from "react";
import { LifeguardAssistantMarkdown } from "../lib/lifeguardChatMarkdown.jsx";
import {
  FINAL_UI,
  FINAL_UI_ROOM_CSS,
  FINAL_UI_SCROLLBAR_CSS,
  finalUiContentRailStyle,
} from "../lib/customerUiFinalTokens.js";
import {
  assignmentStatusLabel,
  customerDisplayLabel,
  listAgentKeyBriefings,
} from "../lib/agentKeyBriefing.js";
import {
  canSubmitAgentFreeKey,
  postAgentFreeKeyChat,
} from "../lib/agentFreeKey.js";

const WAIT_COPY = "KEY가 확인하고 있어요.";
const GENERAL_ID = "__general__";

function AgentDeskConsultRoom() {
  const [items, setItems] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(GENERAL_ID);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [messages, setMessages] = useState([]);
  const threadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      setListError(null);
      const listed = await listAgentKeyBriefings();
      if (cancelled) return;
      if (!listed.ok) {
        setItems([]);
        setListError(listed.error_message);
        setListLoading(false);
        return;
      }
      setItems(listed.items);
      setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () =>
      selectedId === GENERAL_ID
        ? null
        : items.find((row) => row.assignment_id === selectedId) ?? null,
    [items, selectedId],
  );

  const isGeneral = selectedId === GENERAL_ID || !selected;
  const statusLabel = selected ? assignmentStatusLabel(selected) : "일반 질문";
  const eligible = selected?.briefing_eligible === true;
  const composerEnabled = canSubmitAgentFreeKey({ question, submitting });

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, submitting]);

  function selectScope(nextId) {
    if (nextId === selectedId) {
      setSelectorOpen(false);
      return;
    }
    setSelectedId(nextId);
    setSelectorOpen(false);
    setSubmitError(null);
    setQuestion("");
    setMessages([]);
  }

  async function onSend(e) {
    e?.preventDefault?.();
    if (!canSubmitAgentFreeKey({ question, submitting })) return;
    const asked = String(question).trim();
    const historyForApi = messages
      .filter((m) => m.thinking !== true)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").trim(),
      }))
      .filter((m) => m.content);
    setSubmitting(true);
    setSubmitError(null);
    setQuestion("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: asked },
      { role: "assistant", content: WAIT_COPY, thinking: true },
    ]);
    try {
      const assignmentId =
        !isGeneral && selected?.assignment_id ? selected.assignment_id : null;
      const result = await postAgentFreeKeyChat({
        question: asked,
        history: historyForApi,
        assignmentId,
      });
      if (!result.ok) {
        setMessages((prev) =>
          prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
        );
        setSubmitError(result.error_message);
        return;
      }
      const answer = String(result.text ?? "").trim();
      setMessages((prev) => {
        const withoutThinking = prev.filter(
          (m) => !(m.role === "assistant" && m.thinking === true),
        );
        return [
          ...withoutThinking,
          {
            role: "assistant",
            content: answer,
            thinking: false,
            mode: result.mode,
            customer_context_used: result.customer_context_used === true,
          },
        ];
      });
    } catch {
      setMessages((prev) =>
        prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
      );
      setSubmitError("KEY 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  function onComposerKeyDown(ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void onSend();
    }
  }

  const datePill = new Date()
    .toLocaleDateString("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "short",
    })
    .replace(/\./g, "")
    .replace(/\s+/g, " · ");

  const scopeTitle = isGeneral
    ? "일반 질문"
    : customerDisplayLabel(selected);

  return (
    <div
      className="lg-final-shell"
      style={{
        minHeight: "calc(100vh - 48px)",
        display: "flex",
        flexDirection: "column",
        fontFamily: FINAL_UI.sans,
        color: FINAL_UI.text,
        background: FINAL_UI.bg,
        borderRadius: `${FINAL_UI.shellRadius}px`,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <style>{FINAL_UI_ROOM_CSS}</style>
      <style>{FINAL_UI_SCROLLBAR_CSS}</style>

      <header
        style={{
          height: `${FINAL_UI.headerPx}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "0 18px",
          background: FINAL_UI.surface,
          borderBottom: `1px solid ${FINAL_UI.line}`,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: FINAL_UI.gothic,
              fontSize: `${FINAL_UI.logoSize}px`,
              fontWeight: 700,
              color: FINAL_UI.navyDeep,
              lineHeight: 1.1,
            }}
          >
            LIFEGUARD
          </div>
          <div
            style={{
              fontSize: `${FINAL_UI.brandTagSize}px`,
              color: FINAL_UI.muted,
              marginTop: `${FINAL_UI.brandTagMtPx}px`,
            }}
          >
            설계사 데스크 · KEY 대화
          </div>
        </div>

        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setSelectorOpen((v) => !v)}
            disabled={listLoading}
            aria-expanded={selectorOpen}
            aria-haspopup="listbox"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              maxWidth: "min(320px, 70vw)",
              border: `1px solid ${FINAL_UI.line}`,
              background: FINAL_UI.cream,
              borderRadius: "999px",
              padding: "8px 12px",
              cursor: listLoading ? "default" : "pointer",
              fontFamily: FINAL_UI.sans,
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: FINAL_UI.navyDeep,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {listLoading ? "배정 불러오는 중…" : scopeTitle}
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: "999px",
                background: isGeneral
                  ? FINAL_UI.soft
                  : eligible
                    ? FINAL_UI.tealSoft
                    : FINAL_UI.amberSoft,
                color: isGeneral
                  ? FINAL_UI.muted
                  : eligible
                    ? FINAL_UI.teal
                    : FINAL_UI.amber,
                whiteSpace: "nowrap",
              }}
            >
              {isGeneral
                ? "고객 자료 없음"
                : eligible
                  ? "고객 자료 사용 가능"
                  : statusLabel}
            </span>
            <span style={{ color: FINAL_UI.muted, fontSize: "11px" }}>▾</span>
          </button>

          {selectorOpen ? (
            <ul
              role="listbox"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                zIndex: 20,
                margin: 0,
                padding: "6px",
                listStyle: "none",
                minWidth: "260px",
                maxWidth: "min(360px, 86vw)",
                maxHeight: "280px",
                overflowY: "auto",
                background: FINAL_UI.surface,
                border: `1px solid ${FINAL_UI.line}`,
                borderRadius: "14px",
                boxShadow: FINAL_UI.roomShadow,
              }}
            >
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={isGeneral}
                  onClick={() => selectScope(GENERAL_ID)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    background: isGeneral ? FINAL_UI.tealSoft : "transparent",
                    cursor: "pointer",
                    fontFamily: FINAL_UI.sans,
                  }}
                >
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: FINAL_UI.text,
                    }}
                  >
                    일반 질문
                  </div>
                  <div
                    style={{
                      marginTop: "4px",
                      fontSize: "12px",
                      color: FINAL_UI.muted,
                    }}
                  >
                    고객 자료 없이 보험·상담 지식
                  </div>
                </button>
              </li>
              {items.map((item) => {
                const active = item.assignment_id === selectedId;
                return (
                  <li key={item.assignment_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectScope(item.assignment_id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        borderRadius: "10px",
                        padding: "10px 12px",
                        background: active ? FINAL_UI.tealSoft : "transparent",
                        cursor: "pointer",
                        fontFamily: FINAL_UI.sans,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color: FINAL_UI.text,
                        }}
                      >
                        {customerDisplayLabel(item)}
                      </div>
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "12px",
                          color: FINAL_UI.muted,
                        }}
                      >
                        {assignmentStatusLabel(item)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </header>

      <div
        className="lg-v31-center"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          margin: `${FINAL_UI.bodyGapPx}px ${FINAL_UI.roomInlinePx}px ${FINAL_UI.shellBottomInsetPx}px`,
        }}
      >
        <div
          ref={threadRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: `${FINAL_UI.emptyActionPadTopPx}px 0 8px`,
          }}
        >
          {listError ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                color: FINAL_UI.coral,
                fontSize: "14px",
                paddingTop: "16px",
              })}
            >
              {listError}
            </div>
          ) : null}

          {messages.length === 0 && !listLoading ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                paddingTop: "28px",
              })}
            >
              <div
                style={{
                  fontFamily: FINAL_UI.gothic,
                  fontSize: "22px",
                  fontWeight: 600,
                  color: FINAL_UI.navyDeep,
                  marginBottom: "8px",
                }}
              >
                KEY에게 무엇을 물어볼까요?
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  color: FINAL_UI.muted,
                  lineHeight: 1.55,
                }}
              >
                일반 보험 지식은 언제든 물어볼 수 있습니다. 담당 고객을 고르면, 배정·동의·C1이
                있을 때만 그 고객 자료를 KEY가 사용합니다.
              </p>
              {!isGeneral && !eligible && statusLabel ? (
                <p
                  style={{
                    margin: "14px 0 0",
                    fontSize: "13px",
                    fontWeight: 650,
                    color: FINAL_UI.amber,
                  }}
                >
                  {statusLabel} · 지금은 고객 자료 없이 일반 답변만 가능합니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {messages.length > 0 ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                display: "flex",
                justifyContent: "center",
                marginBottom: `${FINAL_UI.msgDateMbPx}px`,
              })}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: FINAL_UI.soft,
                  color: FINAL_UI.muted,
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {datePill}
              </div>
            </div>
          ) : null}

          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={`msg-${index}`}
                className="lg-v31-content-rail"
                style={finalUiContentRailStyle({
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  marginBottom: "12px",
                })}
              >
                <div
                  style={{
                    maxWidth: "min(640px, 92%)",
                    padding: isUser ? "12px 14px" : "14px 16px",
                    borderRadius: isUser ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                    background: isUser ? FINAL_UI.navyDeep : FINAL_UI.surface,
                    color: isUser ? "#fff" : FINAL_UI.text,
                    border: isUser ? "none" : `1px solid ${FINAL_UI.line}`,
                    fontSize: "15px",
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {isUser ? (
                    msg.content
                  ) : msg.thinking ? (
                    msg.content
                  ) : (
                    <LifeguardAssistantMarkdown text={msg.content} />
                  )}
                </div>
              </div>
            );
          })}

          {submitError ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                color: FINAL_UI.coral,
                fontSize: "13px",
                marginTop: "4px",
              })}
            >
              {submitError}
            </div>
          ) : null}
        </div>

        <div
          className="lg-v31-content-rail"
          style={finalUiContentRailStyle({
            flexShrink: 0,
            paddingBottom: "4px",
          })}
        >
          <form
            className="lg-v31-composer"
            onSubmit={onSend}
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "8px",
              minHeight: `${FINAL_UI.composerH}px`,
              padding: "6px 8px 6px 14px",
              borderRadius: "999px",
              border: `1px solid ${FINAL_UI.line}`,
              background: FINAL_UI.surface,
            }}
          >
            <textarea
              value={question}
              onChange={(ev) => setQuestion(ev.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={2000}
              rows={1}
              placeholder="KEY에게 보험 지식이나 담당 고객 상담을 물어보세요"
              disabled={submitting}
              aria-label="KEY 질문"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                resize: "none",
                background: "transparent",
                fontFamily: FINAL_UI.sans,
                fontSize: `${FINAL_UI.composerSize}px`,
                color: FINAL_UI.text,
                lineHeight: 1.45,
                maxHeight: "120px",
                padding: "6px 0",
              }}
            />
            <button
              type="submit"
              disabled={!composerEnabled}
              aria-label="KEY에게 보내기"
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "999px",
                border: "none",
                cursor: composerEnabled ? "pointer" : "not-allowed",
                background: composerEnabled ? FINAL_UI.teal : FINAL_UI.pendingBar,
                color: "#fff",
                fontWeight: 700,
                fontSize: "16px",
                flexShrink: 0,
              }}
            >
              ↑
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** App already gates /agent to settled role=agent — no second RoleAccessPanel fetch. */
export default function AgentDeskPanel() {
  return <AgentDeskConsultRoom />;
}
