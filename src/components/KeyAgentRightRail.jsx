/**
 * Agent RIGHT rail — identical chrome to KeyCustomerRightRail; content only differs.
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
        className="lg-v31-rail"
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
  const statusLabel = isGeneral ? "고객 자료 없음" : assignmentStatusLabel(selected);
  const contextUsed = turnMeta?.customer_context_used === true;
  const modeLabel =
    turnMeta?.mode === "customer_scoped"
      ? "고객 문맥 사용"
      : turnMeta?.mode === "customer_denied"
        ? "고객 문맥 제한"
        : turnMeta?.mode === "general"
          ? "일반 지식"
          : null;
  const briefingText = String(briefing?.briefing_text ?? briefing?.text ?? "").trim();

  return (
    <aside
      className="lg-v31-rail"
      aria-label="KEY가 계속 관리하는 것"
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
          overflowY: "visible",
          padding: `${C.railInnerPadPx}px`,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <Block tone="money" title="현재 선택" dot={C.sky}>
          <MoneyRow label="범위" value={scopeName} />
          <MoneyRow label="상태" value={statusLabel} />
          <MoneyRow
            label="자료 권한"
            value={
              isGeneral
                ? "사용 안 함"
                : eligible
                  ? "허용 자료 사용 가능"
                  : "권한 부족 · 자료 제한"
            }
          />
        </Block>

        <Block tone="schedule" title="이번 KEY 응답" dot={C.amber}>
          {modeLabel ? (
            <>
              <MoneyRow label="모드" value={modeLabel} />
              <MoneyRow label="고객 문맥" value={contextUsed ? "사용함" : "사용하지 않음"} />
            </>
          ) : (
            <EmptyLine
              primary="아직 응답 없음"
              secondary="질문을 보내면 권한에 맞는 KEY 응답 범위가 여기에 표시됩니다"
            />
          )}
        </Block>

        <Block tone="activity" title="상담 브리핑" dot={C.teal}>
          {isGeneral ? (
            <EmptyLine
              primary="담당 고객을 선택하세요"
              secondary="권한 허용 범위에서 브리핑을 받을 수 있습니다"
            />
          ) : !eligible ? (
            <EmptyLine
              primary="브리핑 준비 전"
              secondary="배정·동의·권한이 갖춰진 뒤 요청할 수 있습니다"
            />
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
              {briefingText ? (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                    {briefingText}
                  </div>
                  {briefing?.created_at ? (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: C.muted }}>
                      {formatBriefingCreatedAt(briefing.created_at)}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginTop: "8px", fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
                  요청하면 KEY 상담 브리핑이 여기에 모입니다
                </div>
              )}
            </>
          )}
        </Block>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px", borderTop: "1px solid rgba(18,50,95,0.06)" }}>
          <button
            type="button"
            aria-label="우측 패널 접기"
            onClick={onToggleCollapse}
            style={{ ...iconBtnStyle, marginLeft: "auto", display: "block" }}
          >
            ›
          </button>
        </div>
      ) : null}
    </aside>
  );
}

const iconBtnStyle = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  cursor: "pointer",
  color: C.muted,
};

function Block({ tone, title, dot, children }) {
  const bg =
    tone === "money"
      ? "linear-gradient(160deg, #EAF3FB 0%, #FFFFFF 55%)"
      : tone === "schedule"
        ? "linear-gradient(160deg, #FFF6E8 0%, #FFFFFF 60%)"
        : tone === "activity"
          ? "linear-gradient(160deg, #E6F7F3 0%, #FFFFFF 60%)"
          : tone === "result"
            ? "linear-gradient(160deg, #FFF0EB 0%, #FFFFFF 60%)"
            : "linear-gradient(160deg, #FAF7F2 0%, #FFFFFF 60%)";
  return (
    <div
      style={{
        background: bg,
        borderRadius: "18px",
        padding: `${C.cardPadY}px ${C.cardPadX}px`,
      }}
    >
      <div
        style={{
          margin: `0 0 ${C.cardHeadGapPx}px`,
          fontSize: "13px",
          fontWeight: 800,
          color: C.navy,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "999px",
            background: dot,
            display: "inline-block",
          }}
        />
        {title}
      </div>
      {children}
    </div>
  );
}

function MoneyRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "5px 0",
        borderBottom: "1px solid rgba(59,130,196,0.12)",
        fontSize: "13px",
      }}
    >
      <span style={{ color: C.text }}>{label}</span>
      <span style={{ fontSize: `${C.rightValueSize}px`, fontWeight: 700, color: C.muted }}>{value}</span>
    </div>
  );
}

function EmptyLine({ primary, secondary = null }) {
  return (
    <div>
      <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.5 }}>{primary}</div>
      {secondary ? (
        <div style={{ marginTop: "6px", fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
