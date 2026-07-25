/**
 * Agent slot for V3.1 left rail — same box, agent menu + scope list.
 * Not a separate shell; rendered inside LifeguardHomeChat grid only.
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
        className="lg-v31-rail lg-agent-left-rail"
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
      className="lg-v31-rail lg-agent-left-rail"
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
          flex: 1,
          overflowY: "auto",
          padding: `${C.railInnerPadPx}px`,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
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
              설계사 메뉴
            </div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
              일반 질문 · 담당 고객
            </div>
          </div>
          {typeof onToggleCollapse === "function" ? (
            <button
              type="button"
              aria-label="좌측 패널 접기"
              onClick={onToggleCollapse}
              style={iconBtnStyle}
            >
              ‹
            </button>
          ) : null}
        </div>

        {typeof onOpenMenu === "function" ? (
          <button
            type="button"
            onClick={onOpenMenu}
            style={{
              border: `1px solid ${C.line}`,
              background: C.surface,
              borderRadius: "12px",
              padding: "10px 12px",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: C.sans,
              fontSize: "13px",
              fontWeight: 700,
              color: C.text,
            }}
          >
            대화 · 설정 열기
          </button>
        ) : null}

        <div
          role="listbox"
          aria-label="담당 고객 선택"
          className="lg-agent-scope-listbox"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            marginTop: "4px",
          }}
        >
          <button
            type="button"
            role="option"
            aria-selected={isGeneral}
            className="lg-agent-scope-selector"
            onClick={() => onSelectScope?.(generalId)}
            style={scopeBtnStyle(isGeneral)}
          >
            <div style={{ fontSize: "14px", fontWeight: 700, color: C.text }}>
              일반 질문
            </div>
            <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
              고객 자료 없이 보험·상담 지식
            </div>
          </button>

          {listLoading ? (
            <div style={{ padding: "10px 8px", fontSize: "12px", color: C.muted }}>
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
                style={scopeBtnStyle(active)}
              >
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.text }}>
                  {customerDisplayLabel(item)}
                </div>
                <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
                  {assignmentStatusLabel(item)}
                </div>
              </button>
            );
          })}

          {listError ? (
            <div style={{ padding: "8px", fontSize: "12px", color: C.amber }}>
              {listError}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function scopeBtnStyle(active) {
  return {
    width: "100%",
    textAlign: "left",
    border: `1px solid ${active ? C.teal : C.line}`,
    borderRadius: "12px",
    padding: "10px 12px",
    background: active ? C.tealSoft : C.surface,
    cursor: "pointer",
    fontFamily: C.sans,
  };
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
