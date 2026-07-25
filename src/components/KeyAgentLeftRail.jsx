/**
 * Agent LEFT rail — identical chrome to KeyCustomerLeftRail; content only differs.
 */
import {
  assignmentStatusLabel,
  customerDisplayLabel,
} from "../lib/agentKeyBriefing.js";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

export default function KeyAgentLeftRail({
  collapsed = false,
  onToggleCollapse = null,
  items = [],
  listLoading = false,
  listError = null,
  selectedId = "__general__",
  generalId = "__general__",
  onSelectScope = null,
  onOpenMenu = null,
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
  const isGeneral = selectedId === generalId;

  return (
    <aside
      className="lg-v31-rail"
      aria-label="설계사 메뉴"
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
          설계사 메뉴
          <br />
          담당 고객까지
        </div>
        <div style={{ marginTop: "6px", fontSize: "12px", lineHeight: 1.5, opacity: 0.9 }}>
          일반 질문과 권한 허용 고객을 여기서 고릅니다
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
          overflowY: "visible",
          minHeight: 0,
          padding: `${C.railInnerPadPx}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <div style={whiteCard}>
          <div style={{ display: "flex", gap: "11px", alignItems: "center" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "999px",
                background: `linear-gradient(145deg, ${C.navy}, ${C.teal})`,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: "14px",
                flexShrink: 0,
              }}
            >
              설
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: C.text }}>설계사</div>
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "3px", lineHeight: 1.4 }}>
                {isGeneral
                  ? "일반 질문 · 고객 자료 없음"
                  : `${customerDisplayLabel(
                      (items || []).find((row) => row.assignment_id === selectedId),
                    )} · 선택됨`}
              </div>
            </div>
          </div>
        </div>

        <div style={whiteCard}>
          <div style={secK}>질문 범위</div>
          <div
            role="listbox"
            aria-label="담당 고객 선택"
            className="lg-agent-scope-listbox"
            style={{ display: "grid", gap: "6px" }}
          >
            <button
              type="button"
              role="option"
              aria-selected={isGeneral}
              className="lg-agent-scope-selector"
              onClick={() => onSelectScope?.(generalId)}
              style={scopeRowStyle(isGeneral)}
            >
              <div
                style={{
                  fontSize: `${C.leftValueSize}px`,
                  fontWeight: 700,
                  color: isGeneral ? C.teal : C.text,
                  lineHeight: 1.35,
                }}
              >
                일반 질문
              </div>
              <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                고객 자료 없이 보험·상담 지식
              </div>
            </button>

            {listLoading ? (
              <div style={{ fontSize: "12px", color: C.muted, padding: "4px 2px" }}>
                배정 불러오는 중…
              </div>
            ) : null}

            {(items || []).map((item) => {
              const active = item.assignment_id === selectedId;
              return (
                <button
                  key={item.assignment_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelectScope?.(item.assignment_id)}
                  style={scopeRowStyle(active)}
                >
                  <div
                    style={{
                      fontSize: `${C.leftValueSize}px`,
                      fontWeight: 700,
                      color: active ? C.teal : C.text,
                      lineHeight: 1.35,
                    }}
                  >
                    {customerDisplayLabel(item)}
                  </div>
                  <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                    {assignmentStatusLabel(item)}
                  </div>
                </button>
              );
            })}

            {listError ? (
              <div style={{ fontSize: "12px", color: C.amber, lineHeight: 1.45 }}>{listError}</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "2px 0" }}>
          <NavBtn label="대화 · 설정" onClick={onOpenMenu} />
        </div>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px" }}>
          <button type="button" aria-label="좌측 패널 접기" onClick={onToggleCollapse} style={iconBtnStyle}>
            ‹
          </button>
        </div>
      ) : null}
    </aside>
  );
}

const whiteCard = {
  background: C.surface,
  borderRadius: "16px",
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

function scopeRowStyle(active) {
  return {
    width: "100%",
    textAlign: "left",
    border: `1px solid ${C.line}`,
    borderRadius: "12px",
    padding: "9px 10px",
    background: active ? C.tealSoft : "#fff",
    cursor: "pointer",
    fontFamily: C.sans,
  };
}

function NavBtn({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        textAlign: "left",
        padding: "8px 8px",
        borderRadius: "10px",
        fontSize: `${C.bodySize}px`,
        fontWeight: 650,
        color: C.text,
        cursor: typeof onClick === "function" ? "pointer" : "default",
        fontFamily: C.sans,
      }}
    >
      {label}
    </button>
  );
}
