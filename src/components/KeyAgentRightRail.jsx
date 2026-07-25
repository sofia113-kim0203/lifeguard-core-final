/**
 * Agent slot for V3.1 right rail — authorized materials + briefing.
 * Same box as customer right rail; content switches by agent scope.
 */
import {
  assignmentStatusLabel,
  customerDisplayLabel,
  formatBriefingCreatedAt,
} from "../lib/agentKeyBriefing.js";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

export default function KeyAgentRightRail({
  collapsed = false,
  onToggleCollapse = null,
  isGeneral = true,
  selected = null,
  turnMeta = null,
  briefing = null,
  briefingLoading = false,
  briefingError = null,
  onRequestBriefing = null,
  style = null,
}) {
  if (collapsed) {
    return (
      <aside
        className="lg-v31-rail lg-agent-right-rail"
        style={{
          width: "48px",
          minWidth: "48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "10px 0",
          ...style,
        }}
      >
        <button
          type="button"
          aria-label="우측 패널 펼치기"
          onClick={onToggleCollapse}
          style={iconBtnStyle}
        >
          ‹
        </button>
      </aside>
    );
  }

  const col = `${C.rightColPx}px`;
  const eligible = selected?.briefing_eligible === true;
  const scopeName = isGeneral ? "일반 질문" : customerDisplayLabel(selected);
  const statusLabel = isGeneral
    ? "고객 자료 없음"
    : assignmentStatusLabel(selected);
  const contextUsed = turnMeta?.customer_context_used === true;
  const modeLabel =
    turnMeta?.mode === "customer_scoped"
      ? "고객 문맥 사용"
      : turnMeta?.mode === "customer_denied"
        ? "고객 문맥 제한"
        : turnMeta?.mode === "general"
          ? "일반 지식"
          : null;

  return (
    <aside
      className="lg-v31-rail lg-agent-right-rail"
      aria-label="선택 고객 권한·브리핑"
      style={{
        width: col,
        minWidth: col,
        maxWidth: col,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: C.sans,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `${C.railInnerPadPx}px`,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 800,
                color: C.navyDeep,
                lineHeight: 1.2,
              }}
            >
              권한 · 브리핑
            </div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
              선택 고객 자료 범위
            </div>
          </div>
          {typeof onToggleCollapse === "function" ? (
            <button
              type="button"
              aria-label="우측 패널 접기"
              onClick={onToggleCollapse}
              style={iconBtnStyle}
            >
              ›
            </button>
          ) : null}
        </div>

        <Block title="현재 선택" tone={isGeneral ? "soft" : eligible ? "ok" : "warn"}>
          <Row label="범위" value={scopeName} />
          <Row label="상태" value={statusLabel} />
          {!isGeneral ? (
            <Row
              label="자료 권한"
              value={eligible ? "허용 자료 사용 가능" : "권한 부족 · 자료 제한"}
            />
          ) : (
            <Row label="자료 권한" value="사용 안 함" />
          )}
        </Block>

        <Block title="이번 KEY 응답" tone="soft">
          {modeLabel ? (
            <>
              <Row label="모드" value={modeLabel} />
              <Row
                label="고객 문맥"
                value={contextUsed ? "사용함" : "사용하지 않음"}
              />
            </>
          ) : (
            <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
              질문을 보내면 권한에 맞는 KEY 응답 범위가 여기 표시됩니다.
            </div>
          )}
        </Block>

        <Block title="상담 브리핑" tone="soft">
          {isGeneral ? (
            <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
              담당 고객을 선택하면 권한 허용 범위에서 브리핑을 받을 수 있습니다.
            </div>
          ) : !eligible ? (
            <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
              배정·동의·권한이 갖춰진 뒤 브리핑을 요청할 수 있습니다.
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={briefingLoading || typeof onRequestBriefing !== "function"}
                onClick={() => onRequestBriefing?.()}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  background: briefingLoading ? C.pendingBar : C.teal,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: briefingLoading ? "default" : "pointer",
                  fontFamily: C.sans,
                }}
              >
                {briefingLoading ? "브리핑 준비 중…" : "상담 준비 브리핑 요청"}
              </button>
              {briefingError ? (
                <div
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    color: C.amber,
                    lineHeight: 1.45,
                  }}
                >
                  {briefingError}
                </div>
              ) : null}
              {briefing?.briefing_text || briefing?.text ? (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    background: C.cream,
                    border: `1px solid ${C.line}`,
                    fontSize: "13px",
                    color: C.text,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {String(briefing.briefing_text ?? briefing.text ?? "").trim()}
                  {briefing.created_at ? (
                    <div
                      style={{
                        marginTop: "8px",
                        fontSize: "11px",
                        color: C.muted,
                      }}
                    >
                      {formatBriefingCreatedAt(briefing.created_at)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </Block>
      </div>
    </aside>
  );
}

function Block({ title, tone = "soft", children }) {
  const bg =
    tone === "ok" ? C.tealSoft : tone === "warn" ? C.amberSoft : C.surface;
  return (
    <section
      style={{
        borderRadius: "14px",
        border: `1px solid ${C.line}`,
        background: bg,
        padding: "12px",
      }}
    >
      <div
        style={{
          fontSize: "12px",
          fontWeight: 800,
          color: C.navy,
          marginBottom: "8px",
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "8px",
        fontSize: "12px",
        lineHeight: 1.4,
        marginBottom: "4px",
      }}
    >
      <span style={{ color: C.muted, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: C.text,
          fontWeight: 600,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const iconBtnStyle = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  color: C.navy,
  cursor: "pointer",
  fontSize: "16px",
  lineHeight: 1,
};
