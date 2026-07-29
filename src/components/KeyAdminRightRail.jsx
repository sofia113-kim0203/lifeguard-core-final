/**
 * Admin RIGHT rail — identical chrome to KeyAgentRightRail; content only differs.
 */
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";
import { adminV31PanelLabel } from "../lib/adminV31Panels.jsx";
import { assignmentStatusLabelKo } from "../lib/adminAgentAssignment.js";

const C = FINAL_UI;

export default function KeyAdminRightRail({
  collapsed = false,
  onToggleCollapse = null,
  activePanelId = "agent_assignment",
  workspaceMeta = null,
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
  const panelLabel = adminV31PanelLabel(activePanelId);
  const meta = workspaceMeta && typeof workspaceMeta === "object" ? workspaceMeta : {};
  const statusLabel = meta.status ? assignmentStatusLabelKo(meta.status) : "선택 없음";
  const resultLine = Array.isArray(meta.resultLines) && meta.resultLines.length
    ? meta.resultLines[0]
    : null;
  const caution = meta.errorMessage || meta.loadError || null;

  return (
    <aside
      className="lg-v31-rail"
      aria-label="관리자 현황"
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
          <MoneyRow label="업무" value={panelLabel} />
          <MoneyRow label="고객" value={meta.customerLabel || "—"} />
          <MoneyRow label="설계사" value={meta.agentLabel || "—"} />
        </Block>

        <Block tone="schedule" title="배정 상태" dot={C.amber}>
          <MoneyRow label="상태" value={statusLabel} />
          <MoneyRow label="배정 ID" value={meta.assignmentId ? shortId(meta.assignmentId) : "—"} />
        </Block>

        <Block tone="activity" title="동의·연결" dot={C.teal}>
          <MoneyRow label="동의" value={meta.consentLabel || "조회 전"} />
          <MoneyRow label="Binding" value={meta.bindingLabel || "조회 전"} />
          <EmptyLine primary="배정 API 조회·작업 후에만 갱신됩니다" />
        </Block>

        <Block tone="result" title="작업 결과 · 주의" dot={C.coral}>
          {caution ? (
            <EmptyLine primary={caution} />
          ) : resultLine ? (
            <EmptyLine primary={resultLine} secondary="중앙 패널에도 동일하게 표시됩니다" />
          ) : (
            <EmptyLine
              primary="아직 작업 결과 없음"
              secondary="조회·배정 결과는 여기에 모입니다"
            />
          )}
        </Block>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px" }}>
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

function shortId(id) {
  const s = String(id);
  return s.length > 10 ? `${s.slice(0, 8)}…` : s;
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
        gap: "8px",
      }}
    >
      <span style={{ color: C.text, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: `${C.rightValueSize}px`,
          fontWeight: 700,
          color: C.muted,
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {value}
      </span>
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
