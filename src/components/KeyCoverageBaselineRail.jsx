/**
 * Right rail — KEY industry cumulative coverage baseline (read-only gauge).
 * Fixed 7-row instrument panel: no internal scroll, no second judgment engine.
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { BASELINE_STATUS } from "../lib/keyInsuranceScreenFacts.js";
import { KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS } from "../lib/keyIndustryCoverageBaselineTable.js";

const ROW_ICONS = {
  cancer_diagnosis: "◆",
  cerebrovascular_diagnosis: "◇",
  ischemic_heart_diagnosis: "◇",
  caregiving: "○",
  hospital_daily: "○",
  surgery: "□",
  major_treatment: "□",
};

function resolveRows(baseline) {
  const byId = new Map(
    (Array.isArray(baseline?.items) ? baseline.items : []).map((row) => [row.id, row]),
  );
  return KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.map((def) => {
    const hit = byId.get(def.id);
    if (hit) return hit;
    return {
      id: def.id,
      label: def.label,
      shortLabel: def.shortLabel,
      status: BASELINE_STATUS.TABLE_PENDING,
      statusColor: LG.needCheck,
      statusBg: LG.needCheckBg,
      currentDisplay: "확인 필요",
      showCompareBar: false,
    };
  });
}

function currentLine(item) {
  const raw = String(item?.currentDisplay ?? "").trim() || "확인 필요";
  if (raw === "확인 필요" || raw.startsWith("일당") || raw.startsWith("범위")) {
    return "현재 확인 필요";
  }
  return `현재 ${raw}`;
}

export default function KeyCoverageBaselineRail({
  baseline = null,
  style = {},
  onClose = null,
  onSelectItem = null,
}) {
  const items = resolveRows(baseline);
  const allPending = items.every(
    (row) => row.status === BASELINE_STATUS.TABLE_PENDING || !row.showCompareBar,
  );
  const summaryLine = allPending
    ? "7개 항목 · 업계 기준 확인 중"
    : `7개 항목 · 충족 ${baseline?.counts?.met ?? 0} · 미달 ${baseline?.counts?.short ?? 0}`;

  return (
    <aside
      aria-label="KEY 업계누적 보장 기준선"
      style={{
        width: "280px",
        maxWidth: "280px",
        flexShrink: 0,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "14px 12px 8px",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 750,
              color: LG.navy,
              lineHeight: 1.3,
            }}
          >
            KEY 업계누적 보장 기준선
          </div>
          <div style={{ marginTop: "5px", fontSize: "12px", color: LG.textMuted, lineHeight: 1.35 }}>
            {summaryLine}
          </div>
        </div>
        {typeof onClose === "function" ? (
          <button
            type="button"
            aria-label="기준선 닫기"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: LG.textMuted,
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: "4px 10px 0",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectItem?.(item)}
            style={{
              flex: "1 1 0",
              minHeight: 0,
              maxHeight: "72px",
              width: "100%",
              textAlign: "left",
              border: `1px solid ${LG.border}`,
              cursor: "pointer",
              background: LG.surface,
              borderRadius: "12px",
              padding: "8px 10px",
              fontFamily: LG.sans,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "7px",
                background: LG.accentSoft,
                color: LG.accent,
                display: "grid",
                placeItems: "center",
                fontSize: "11px",
                flexShrink: 0,
              }}
            >
              {ROW_ICONS[item.id] || "·"}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: LG.navy,
                    lineHeight: 1.25,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.label || item.shortLabel}
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: item.statusColor || LG.needCheck,
                    background: item.statusBg || LG.needCheckBg,
                    borderRadius: "999px",
                    padding: "2px 7px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.status || BASELINE_STATUS.TABLE_PENDING}
                </span>
              </div>
              <div
                style={{
                  marginTop: "3px",
                  fontSize: "12px",
                  color: LG.textMuted,
                  lineHeight: 1.25,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {currentLine(item)}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "8px 12px 12px",
          fontSize: "11px",
          color: LG.textMuted,
          lineHeight: 1.4,
        }}
      >
        미확인은 미달·0원이 아닙니다. 판매 권유를 하지 않습니다.
      </div>
    </aside>
  );
}
