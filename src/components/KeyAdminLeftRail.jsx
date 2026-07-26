/**
 * Admin LEFT rail — identical chrome to KeyAgentLeftRail; content only differs.
 * Ops tools collapse by work group; spacing tokens = FINAL_UI only.
 */
import { useMemo, useState } from "react";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";
import {
  ADMIN_V31_OPS_GROUPS,
  ADMIN_V31_PANELS,
  ADMIN_V31_PRIMARY_MENU,
  adminV31PanelById,
} from "../lib/adminV31Panels.jsx";

const C = FINAL_UI;

export default function KeyAdminLeftRail({
  collapsed = false,
  onToggleCollapse = null,
  selectedMenuKey = "assignment",
  onSelectMenu = null,
  style = null,
}) {
  const selectedPanelId = useMemo(() => {
    if (String(selectedMenuKey).startsWith("ops:")) {
      return String(selectedMenuKey).slice(4);
    }
    return ADMIN_V31_PRIMARY_MENU.find((m) => m.menuKey === selectedMenuKey)?.panelId ?? null;
  }, [selectedMenuKey]);

  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {};
    for (const g of ADMIN_V31_OPS_GROUPS) initial[g.id] = false;
    return initial;
  });

  const effectiveOpen = useMemo(() => {
    const next = { ...openGroups };
    for (const g of ADMIN_V31_OPS_GROUPS) {
      if (selectedPanelId && g.panelIds.includes(selectedPanelId)) {
        next[g.id] = true;
      }
    }
    return next;
  }, [openGroups, selectedPanelId]);

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

  return (
    <aside
      className="lg-v31-rail lg-admin-left-rail"
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
          borderRadius: `${C.cardRadius}px`,
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
        className="lg-admin-left-stack"
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
          <div style={secK}>관리 업무</div>
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
          <div style={secK}>운영·약관 도구</div>
          <div style={{ display: "grid", gap: `${C.railStackGapPx}px` }}>
            {ADMIN_V31_OPS_GROUPS.map((group) => {
              const open = effectiveOpen[group.id] === true;
              const items = group.panelIds
                .map((id) => adminV31PanelById(id) || ADMIN_V31_PANELS.find((p) => p.id === id))
                .filter(Boolean);
              return (
                <div key={group.id} className="lg-admin-ops-group">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [group.id]: !prev[group.id],
                      }))
                    }
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      border: "none",
                      background: "transparent",
                      padding: "6px 2px",
                      cursor: "pointer",
                      fontFamily: C.sans,
                      fontSize: `${C.sectionTitleSize}px`,
                      fontWeight: 700,
                      color: C.navy,
                    }}
                  >
                    <span>{group.label}</span>
                    <span style={{ color: C.muted, fontSize: "11px" }}>{open ? "▾" : "▸"}</span>
                  </button>
                  {open ? (
                    <div
                      role="listbox"
                      aria-label={group.label}
                      style={{ display: "grid", gap: "6px" }}
                    >
                      {items.map((item) => (
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
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px" }}>
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
        border: `1px solid ${C.line}`,
        borderRadius: "12px",
        padding: compact ? "8px 10px" : "9px 10px",
        background: active ? C.tealSoft : "#fff",
        cursor: "pointer",
        fontFamily: C.sans,
        fontSize: compact ? "12px" : `${C.leftValueSize}px`,
        fontWeight: active ? 700 : 650,
        color: active ? C.teal : C.text,
        lineHeight: 1.35,
      }}
    >
      {label}
    </button>
  );
}

const whiteCard = {
  background: C.surface,
  borderRadius: `${C.cardRadius}px`,
  padding: `${C.cardPadY}px ${C.cardPadX}px`,
};

const secK = {
  fontSize: `${C.sectionTitleSize}px`,
  fontWeight: 700,
  letterSpacing: "0.03em",
  color: C.muted,
  marginBottom: `${C.sectionKMbPx}px`,
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
  return { flex: 1, height: "5px", borderRadius: "999px", background: bg, display: "block" };
}
