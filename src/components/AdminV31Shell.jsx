/**
 * Admin Full-Shell V3.1 — same FINAL_UI chrome as /agent; admin work in L/C/R only.
 * No dark backoffice frame. No second brand header.
 */
import { useEffect, useState } from "react";
import { FINAL_UI, FINAL_UI_ROOM_CSS, FINAL_UI_SCROLLBAR_CSS } from "../lib/customerUiFinalTokens.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  ADMIN_V31_DEFAULT_PANEL,
  ADMIN_V31_PRIMARY_MENU,
  adminV31PanelLabel,
  renderAdminV31Panel,
} from "../lib/adminV31Panels.jsx";
import KeyAdminLeftRail from "./KeyAdminLeftRail.jsx";
import KeyAdminRightRail from "./KeyAdminRightRail.jsx";

const ROOM_WIDE_BREAKPOINT = 1280;

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

export default function AdminV31Shell({ user: _user = null, onLogout = null }) {
  const isWideRoom = useMediaQuery(`(min-width: ${ROOM_WIDE_BREAKPOINT}px)`);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [selectedMenuKey, setSelectedMenuKey] = useState("assignment");
  const [activePanelId, setActivePanelId] = useState(ADMIN_V31_DEFAULT_PANEL);
  const [workspaceMeta, setWorkspaceMeta] = useState(null);

  const shellHeaderPx = isWideRoom ? FINAL_UI.headerPx : FINAL_UI.headerPxMobile;
  const leftCol = leftRailCollapsed ? "48px" : `${FINAL_UI.leftColPx}px`;
  const rightCol = rightRailCollapsed ? "48px" : `${FINAL_UI.rightColPx}px`;
  const roomGridColumns = isWideRoom
    ? `${leftCol} minmax(0, 1fr) ${rightCol}`
    : "minmax(0, 1fr)";

  const handleSelectMenu = (item) => {
    if (!item?.panelId) return;
    setSelectedMenuKey(item.menuKey);
    setActivePanelId(item.panelId);
    if (item.panelId !== "agent_assignment") {
      setWorkspaceMeta(null);
    }
  };

  const panelProps =
    activePanelId === "agent_assignment"
      ? {
          tone: "light",
          onWorkspaceMeta: setWorkspaceMeta,
        }
      : {};

  return (
    <div
      className="lg-final-shell lg-admin-v31-shell"
      style={{
        minHeight: "100vh",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: FINAL_UI.sans,
        background: FINAL_UI.bg,
        color: FINAL_UI.text,
        overflow: "hidden",
      }}
    >
      <style>{`${FINAL_UI_SCROLLBAR_CSS}\n${FINAL_UI_ROOM_CSS}`}</style>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
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
              width: isWideRoom ? leftCol : "auto",
              maxWidth: isWideRoom ? leftCol : "46%",
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
            <span
              className="lg-admin-key-badge"
              style={{
                fontSize: `${FINAL_UI.brandTagSize}px`,
                color: FINAL_UI.muted,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                flexShrink: 0,
                marginLeft: "4px",
                fontWeight: 700,
              }}
            >
              관리자
            </span>
          </div>

          <div
            style={{
              width: isWideRoom ? rightCol : "auto",
              minWidth: isWideRoom ? rightCol : 0,
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
            {isWideRoom ? (
              <div style={{ textAlign: "right", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 800,
                    color: FINAL_UI.navy,
                    lineHeight: 1.15,
                    whiteSpace: "nowrap",
                  }}
                >
                  배정 · 동의
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: FINAL_UI.muted,
                    marginTop: "1px",
                    lineHeight: 1.2,
                  }}
                >
                  {adminV31PanelLabel(activePanelId)}
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
            {typeof onLogout === "function" ? (
              <button
                type="button"
                aria-label="로그아웃"
                onClick={() => void onLogout()}
                style={{
                  border: `1px solid ${FINAL_UI.line}`,
                  background: FINAL_UI.surface,
                  borderRadius: "999px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: FINAL_UI.muted,
                  cursor: "pointer",
                  fontFamily: FINAL_UI.sans,
                }}
              >
                로그아웃
              </button>
            ) : null}
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
                관
              </div>
              <span style={{ fontSize: "12px", fontWeight: 700, color: FINAL_UI.text }}>
                관리자
              </span>
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
          {isWideRoom ? (
            <KeyAdminLeftRail
              collapsed={leftRailCollapsed}
              onToggleCollapse={() => setLeftRailCollapsed((v) => !v)}
              selectedMenuKey={selectedMenuKey}
              onSelectMenu={handleSelectMenu}
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
              maxWidth: `${FINAL_UI.centerColPx}px`,
              width: "100%",
              margin: "0 auto",
            }}
          >
            {!isWideRoom ? (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "10px 12px",
                  flexWrap: "wrap",
                  borderBottom: `1px solid ${FINAL_UI.line}`,
                }}
              >
                {ADMIN_V31_PRIMARY_MENU.map((item) => (
                  <button
                    key={item.menuKey}
                    type="button"
                    onClick={() => handleSelectMenu(item)}
                    style={{
                      border:
                        selectedMenuKey === item.menuKey
                          ? `1px solid ${FINAL_UI.teal}`
                          : `1px solid ${FINAL_UI.line}`,
                      background:
                        selectedMenuKey === item.menuKey ? FINAL_UI.tealSoft : FINAL_UI.surface,
                      borderRadius: "999px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: FINAL_UI.sans,
                      color: FINAL_UI.text,
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className="lg-admin-v31-center-work"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "16px 18px",
              }}
            >
              {renderAdminV31Panel(activePanelId, panelProps)}
            </div>
          </div>

          {isWideRoom ? (
            <KeyAdminRightRail
              collapsed={rightRailCollapsed}
              onToggleCollapse={() => setRightRailCollapsed((v) => !v)}
              activePanelId={activePanelId}
              workspaceMeta={workspaceMeta}
              style={{ height: "100%" }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
