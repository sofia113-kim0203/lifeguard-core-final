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
  canSubmitAgentBriefing,
  createAgentKeyBriefingRequest,
  customerDisplayLabel,
  listAgentKeyBriefings,
  pickInitialAssignment,
} from "../lib/agentKeyBriefing.js";

const DEFAULT_PURPOSE = "담당 고객 KEY 브리핑";
const WAIT_COPY = "KEY가 확인하고 있어요.";

function AgentDeskConsultRoom() {
  const [items, setItems] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [purpose, setPurpose] = useState(DEFAULT_PURPOSE);
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
        setSelectedId(null);
        setListError(listed.error_message);
        setListLoading(false);
        return;
      }
      const nextItems = listed.items;
      const initial = pickInitialAssignment(nextItems);
      setItems(nextItems);
      setSelectedId(initial?.assignment_id ?? null);
      setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => items.find((row) => row.assignment_id === selectedId) ?? null,
    [items, selectedId],
  );

  const statusLabel = selected ? assignmentStatusLabel(selected) : null;
  const eligible = selected?.briefing_eligible === true;
  const composerEnabled = canSubmitAgentBriefing({
    selected,
    purpose,
    question,
    submitting,
  });

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, submitting]);

  function selectAssignment(assignmentId) {
    if (assignmentId === selectedId) {
      setSelectorOpen(false);
      return;
    }
    setSelectedId(assignmentId);
    setSelectorOpen(false);
    setSubmitError(null);
    setQuestion("");
    setMessages([]);
  }

  async function onSend(e) {
    e?.preventDefault?.();
    if (!canSubmitAgentBriefing({ selected, purpose, question, submitting })) return;
    const asked = String(question).trim();
    const purposeTrim = String(purpose).trim();
    setSubmitting(true);
    setSubmitError(null);
    setQuestion("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: asked },
      { role: "assistant", content: WAIT_COPY, thinking: true },
    ]);
    try {
      const created = await createAgentKeyBriefingRequest({
        assignmentId: selected.assignment_id,
        purpose: purposeTrim,
        question: asked,
      });
      if (!created.ok) {
        setMessages((prev) =>
          prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
        );
        setSubmitError(created.error_message);
        return;
      }
      const briefingText = String(created.briefing?.briefing_text ?? "");
      setMessages((prev) => {
        const withoutThinking = prev.filter(
          (m) => !(m.role === "assistant" && m.thinking === true),
        );
        return [
          ...withoutThinking,
          {
            role: "assistant",
            content: briefingText,
            thinking: false,
            briefing_text: briefingText,
          },
        ];
      });
    } catch {
      setMessages((prev) =>
        prev.filter((m) => !(m.role === "assistant" && m.thinking === true)),
      );
      setSubmitError("브리핑 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
            설계사 데스크 · 설계사
          </div>
        </div>

        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setSelectorOpen((v) => !v)}
            disabled={listLoading || items.length === 0}
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
              cursor: listLoading || items.length === 0 ? "default" : "pointer",
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
              {listLoading
                ? "배정 불러오는 중…"
                : selected
                  ? customerDisplayLabel(selected)
                  : "배정 고객 선택"}
            </span>
            {statusLabel ? (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: "999px",
                  background: eligible ? FINAL_UI.tealSoft : FINAL_UI.amberSoft,
                  color: eligible ? FINAL_UI.teal : FINAL_UI.amber,
                  whiteSpace: "nowrap",
                }}
              >
                {statusLabel}
              </span>
            ) : null}
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
              {items.map((item) => {
                const active = item.assignment_id === selectedId;
                return (
                  <li key={item.assignment_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectAssignment(item.assignment_id)}
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

          {!listLoading && !listError && items.length === 0 ? (
            <div
              className="lg-v31-content-rail"
              style={finalUiContentRailStyle({
                color: FINAL_UI.muted,
                fontSize: "15px",
                paddingTop: "24px",
              })}
            >
              현재 배정된 고객이 없습니다.
            </div>
          ) : null}

          {selected && messages.length === 0 && !listLoading ? (
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
                어떤 고객 상담을 준비할까요?
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  color: FINAL_UI.muted,
                  lineHeight: 1.55,
                }}
              >
                고객은 KEY 진료실, 설계사는 같은 디자인의 설계사 데스크입니다. 선택한 고객에 대해
                KEY에게 상담 준비를 요청하세요.
              </p>
              {!eligible && statusLabel ? (
                <p
                  style={{
                    margin: "14px 0 0",
                    fontSize: "13px",
                    fontWeight: 650,
                    color: FINAL_UI.amber,
                  }}
                >
                  {statusLabel}
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
            const speaker = isUser ? "설계사" : "KEY";
            return (
              <div
                key={`${index}-${msg.role}`}
                className="lg-v31-content-rail"
                style={finalUiContentRailStyle({
                  display: "flex",
                  justifyContent: "flex-start",
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
                    width: "100%",
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
                    {!isUser && !msg.thinking ? (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: FINAL_UI.teal,
                        }}
                      >
                        KEY 내부 브리핑
                      </span>
                    ) : null}
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
                        text={msg.briefing_text ?? msg.content}
                        muted={false}
                        fontFamily={FINAL_UI.sans}
                      />
                    ) : (
                      <div>{msg.content}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="lg-v31-composer-wrap"
          style={{
            padding: `0 ${FINAL_UI.contentRailInsetPx}px ${FINAL_UI.composerWrapPadBottomPx}px`,
            width: "100%",
            maxWidth: `${FINAL_UI.centerColPx}px`,
            margin: "0 auto",
            flexShrink: 0,
            boxSizing: "border-box",
          }}
        >
          {selected && !eligible ? (
            <div
              style={{
                marginBottom: "10px",
                fontSize: "13px",
                fontWeight: 650,
                color: FINAL_UI.amber,
              }}
            >
              {statusLabel}
            </div>
          ) : null}

          {submitError ? (
            <div
              style={{
                marginBottom: "8px",
                color: FINAL_UI.coral,
                fontSize: "13px",
              }}
            >
              {submitError}
            </div>
          ) : null}

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "12px",
              fontWeight: 650,
              color: FINAL_UI.muted,
            }}
          >
            업무 목적
            <input
              value={purpose}
              onChange={(ev) => setPurpose(ev.target.value)}
              maxLength={200}
              disabled={!eligible || submitting || !selected}
              style={{
                display: "block",
                width: "100%",
                marginTop: "6px",
                boxSizing: "border-box",
                border: `1px solid ${FINAL_UI.line}`,
                borderRadius: "12px",
                padding: "8px 12px",
                fontFamily: FINAL_UI.sans,
                fontSize: "13px",
                color: FINAL_UI.text,
                background: FINAL_UI.surface,
              }}
            />
          </label>

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
              opacity: !selected || !eligible ? 0.55 : 1,
            }}
          >
            <textarea
              value={question}
              onChange={(ev) => setQuestion(ev.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={2000}
              rows={1}
              placeholder={
                !selected
                  ? "배정 고객을 선택해 주세요"
                  : !eligible
                    ? statusLabel || "지금은 브리핑을 요청할 수 없습니다"
                    : "KEY에게 브리핑 질문을 적어 주세요"
              }
              disabled={!eligible || submitting || !selected}
              aria-label="KEY 브리핑 질문"
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
              aria-label="KEY에게 상담 준비 요청"
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
