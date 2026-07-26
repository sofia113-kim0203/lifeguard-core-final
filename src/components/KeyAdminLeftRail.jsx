/**
 * Admin LEFT rail — identical chrome to KeyAgentLeftRail; content only differs.
 */
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";
import {
  ADMIN_V31_PANELS,
  ADMIN_V31_PRIMARY_MENU,
} from "../lib/adminV31Panels.jsx";

const C = FINAL_UI;

export default function KeyAdminLeftRail({
  collapsed = false,
  onToggleCollapse = null,
  selectedMenuKey = "assignment",
  onSelectMenu = null,
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
          aria-label="좌측 패널 펼치기"
          onClick={onToggleCollapse}
          style={iconBtnStyle}
        >
          ›
        </button>
      </aside>
    );
  }

  const col = `${C.leftColPx}px`;
  const ops = ADMIN_V31_PANELS.filter((p) => p.group === "ops");

  return (
    <aside
      className="lg-v31-rail"
      aria-label="관리자 메뉴"
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
          margin: `${C.heroPadPx}px ${Math.max(0, C.leftColPx - C.heroX - C.heroW)}px 0 ${C.heroX}px`,
          width: `${C.heroW}px`,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: `${C.cardPadY}px ${C.cardPadX}px`,
          borderRadius: "16px",
          background: C.heroGradient,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "-20px",
            top: "-24px",
            width: "90px",
            height: "90px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.12)",
          }}
        />
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", opacity: 0.85 }}>
          KEY가 곁에서 보는 것
        </div>
        <div
          style={{
            marginTop: "6px",
            fontFamily: C.gothic,
            fontSize: `${C.heroTitleSize}px`,
            fontWeight: 700,
            lineHeight: `${C.heroTitleLine}px`,
          }}
        >
          관리자 메뉴
          <br />
          배정까지
        </div>
        <div style={{ marginTop: "6px", fontSize: "12px", lineHeight: 1.5, opacity: 0.9 }}>
          고객·설계사·배정·동의 상태를 여기서 고릅니다
        </div>
        <div style={{ marginTop: "12px", display: "flex", gap: "6px" }} aria-hidden="true">
          <i style={pulseStyle("#FFD7A8")} />
          <i style={pulseStyle("rgba(255,255,255,0.55)")} />
          <i style={pulseStyle("rgba(255,255,255,0.55)")} />
          <i style={pulseStyle("rgba(255,255,255,0.25)")} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          padding: `${C.railInnerPadPx}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <div style={whiteCard} className="lg-admin-menu-primary">
          <div style={{ fontSize: "12px", fontWeight: 800, color: C.navy, marginBottom: "8px" }}>
            관리 업무
          </div>
          <div role="listbox" aria-label="관리자 주요 메뉴" style={{ display: "grid", gap: "6px" }}>
            {ADMIN_V31_PRIMARY_MENU.map((item) => (
              <MenuRow
                key={item.menuKey}
                label={item.label}
                active={selectedMenuKey === item.menuKey}
                onClick={() => onSelectMenu?.(item)}
              />
            ))}
          </div>
        </div>

        <div style={whiteCard} className="lg-admin-menu-ops">
          <div style={{ fontSize: "12px", fontWeight: 800, color: C.navy, marginBottom: "8px" }}>
            운영·약관 도구
          </div>
          <div role="listbox" aria-label="관리자 운영 메뉴" style={{ display: "grid", gap: "4px" }}>
            {ops.map((item) => (
              <MenuRow
                key={item.id}
                label={item.label}
                active={selectedMenuKey === `ops:${item.id}`}
                onClick={() =>
                  onSelectMenu?.({
                    menuKey: `ops:${item.id}`,
                    panelId: item.id,
                    label: item.label,
                  })
                }
                compact
              />
            ))}
          </div>
        </div>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px", borderTop: "1px solid rgba(18,50,95,0.06)" }}>
          <button
            type="button"
            aria-label="좌측 패널 접기"
            onClick={onToggleCollapse}
            style={iconBtnStyle}
          >
            ‹
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function MenuRow({ label, active, onClick, compact = false }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border: active ? `1px solid ${C.teal}` : `1px solid ${C.line}`,
        background: active ? C.tealSoft : C.surface,
        borderRadius: "12px",
        padding: compact ? "8px 10px" : "10px 12px",
        cursor: "pointer",
        fontFamily: C.sans,
        fontSize: compact ? "12px" : "13px",
        fontWeight: active ? 700 : 600,
        color: active ? C.navy : C.text,
        lineHeight: 1.35,
      }}
    >
      {label}
    </button>
  );
}

const whiteCard = {
  background: C.surface,
  borderRadius: "18px",
  padding: `${C.cardPadY}px ${C.cardPadX}px`,
  border: `1px solid ${C.line}`,
};

const iconBtnStyle = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  cursor: "pointer",
  color: C.muted,
};

function pulseStyle(bg) {
  return {
    width: "8px",
    height: "8px",
    borderRadius: "999px",
    background: bg,
    display: "inline-block",
  };
}
