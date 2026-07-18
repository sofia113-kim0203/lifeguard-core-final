/**
 * Right rail — KEY industry cumulative coverage baseline (read-only gauge).
 * Card UI: current vs baseline with a compact horizontal compare graph.
 * No internal scroll, no second judgment engine, no invented personal estimates.
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  BASELINE_STATUS,
  formatManwonAmount,
} from "../lib/keyInsuranceScreenFacts.js";
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

/** Display badge tokens — UI labels only; underlying BASELINE_STATUS unchanged. */
const VIEW_STATUS = {
  SHORT: "부족",
  MET: "적정",
  OVERLAP: "초과",
  UNKNOWN: "미확인",
};

const VIEW_STATUS_COLOR = {
  [VIEW_STATUS.SHORT]: LG.needs,
  [VIEW_STATUS.MET]: LG.verified,
  [VIEW_STATUS.OVERLAP]: LG.overlap,
  [VIEW_STATUS.UNKNOWN]: LG.needCheck,
};

const VIEW_STATUS_BG = {
  [VIEW_STATUS.SHORT]: LG.needsBg,
  [VIEW_STATUS.MET]: LG.verifiedBg,
  [VIEW_STATUS.OVERLAP]: LG.overlapBg,
  [VIEW_STATUS.UNKNOWN]: LG.needCheckBg,
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
      currentAmount: null,
      currentDisplay: "확인 필요",
      industry_range_low: null,
      industry_range_high: null,
      industryRangeDisplay: "기준 확인 중",
      showCompareBar: false,
      tableReady: false,
      compareMode: def.compareMode,
    };
  });
}

function mapViewStatus(item) {
  const status = item?.status;
  if (status === BASELINE_STATUS.SHORT) return VIEW_STATUS.SHORT;
  if (status === BASELINE_STATUS.MET) return VIEW_STATUS.MET;
  if (status === BASELINE_STATUS.OVERLAP) return VIEW_STATUS.OVERLAP;
  return VIEW_STATUS.UNKNOWN;
}

function resolveBaselineAmount(item) {
  const high = Number(item?.industry_range_high);
  const low = Number(item?.industry_range_low);
  if (Number.isFinite(high) && high > 0) return high;
  if (Number.isFinite(low) && low > 0) return low;
  return null;
}

function formatCompactAmount(value) {
  const text = formatManwonAmount(value);
  return text || "—";
}

function formatDeltaAmount(diffWon) {
  const n = Math.abs(Number(diffWon));
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatManwonAmount(n) || `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function buildCardModel(item) {
  const viewStatus = mapViewStatus(item);
  const currentAmount =
    item?.currentAmount != null && Number.isFinite(Number(item.currentAmount))
      ? Number(item.currentAmount)
      : null;
  const baselineAmount = resolveBaselineAmount(item);
  const tableReady = item?.tableReady === true || item?.showCompareBar === true;
  const canCompare =
    tableReady &&
    currentAmount != null &&
    baselineAmount != null &&
    (viewStatus === VIEW_STATUS.SHORT ||
      viewStatus === VIEW_STATUS.MET ||
      viewStatus === VIEW_STATUS.OVERLAP);

  const currentLabel =
    currentAmount != null
      ? formatCompactAmount(currentAmount)
      : String(item?.currentDisplay ?? "").trim() &&
          String(item.currentDisplay).trim() !== "확인 필요"
        ? String(item.currentDisplay).trim()
        : "미확인";

  const baselineLabel =
    baselineAmount != null
      ? formatCompactAmount(baselineAmount)
      : item?.industryRangeDisplay && item.industryRangeDisplay !== "기준 확인 중"
        ? String(item.industryRangeDisplay)
        : "—";

  let footnote = "현재 미확인 / 자료 등록 후 비교 가능";
  if (canCompare && viewStatus === VIEW_STATUS.MET) {
    footnote = "기준 대비 적정";
  } else if (canCompare && viewStatus === VIEW_STATUS.SHORT) {
    const low = Number(item.industry_range_low);
    const delta = formatDeltaAmount(low - currentAmount);
    footnote = delta ? `기준 대비 ${delta} 부족` : "기준 대비 부족";
  } else if (canCompare && viewStatus === VIEW_STATUS.OVERLAP) {
    const high = Number(item.industry_range_high);
    const delta = formatDeltaAmount(currentAmount - high);
    footnote = delta ? `기준 대비 ${delta} 초과` : "기준 대비 초과";
  } else if (currentAmount != null && !tableReady) {
    footnote = "현재 미확인 / 자료 등록 후 비교 가능";
  }

  return {
    viewStatus,
    currentAmount,
    baselineAmount,
    currentLabel,
    baselineLabel,
    footnote,
    showGraph: currentAmount != null || baselineAmount != null,
    canCompare,
  };
}

function BaselineCompareGraph({
  currentAmount = null,
  baselineAmount = null,
  accent = LG.needCheck,
  muted = false,
}) {
  const max = Math.max(currentAmount || 0, baselineAmount || 0, 1);
  const currentPct =
    currentAmount != null ? Math.max(2, Math.min(100, (currentAmount / max) * 100)) : null;
  const baselinePct =
    baselineAmount != null ? Math.max(2, Math.min(100, (baselineAmount / max) * 100)) : null;
  const fillPct = currentPct ?? 0;
  const trackColor = muted ? "#E8ECF2" : "#E7EAF0";
  const fillColor = muted ? "#CBD5E1" : accent;

  return (
    <div style={{ marginTop: "5px", width: "100%" }} aria-hidden="true">
      <div
        style={{
          position: "relative",
          height: "8px",
          borderRadius: "999px",
          background: trackColor,
          overflow: "visible",
        }}
      >
        {currentPct != null ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${fillPct}%`,
              borderRadius: "999px",
              background: fillColor,
              opacity: muted ? 0.45 : 0.35,
            }}
          />
        ) : null}
        {baselinePct != null ? (
          <div
            style={{
              position: "absolute",
              left: `calc(${baselinePct}% - 1px)`,
              top: "-2px",
              width: "2px",
              height: "12px",
              borderRadius: "1px",
              background: muted ? "#94A3B8" : LG.navy,
              opacity: 0.55,
            }}
          />
        ) : null}
        {currentPct != null ? (
          <div
            style={{
              position: "absolute",
              left: `calc(${currentPct}% - 5px)`,
              top: "-1px",
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: muted ? "#94A3B8" : accent,
              border: `2px solid ${LG.surface}`,
              boxSizing: "border-box",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "3px",
          fontSize: "9px",
          color: LG.textMuted,
          lineHeight: 1.2,
        }}
      >
        <span>0</span>
        <span>{baselineAmount != null ? "기준" : currentAmount != null ? "현재" : ""}</span>
      </div>
    </div>
  );
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
    : `7개 항목 · 적정 ${baseline?.counts?.met ?? 0} · 부족 ${baseline?.counts?.short ?? 0}`;

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
          padding: "12px 12px 6px",
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
          <div style={{ marginTop: "4px", fontSize: "11px", color: LG.textMuted, lineHeight: 1.35 }}>
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
          padding: "2px 10px 0",
          display: "flex",
          flexDirection: "column",
          gap: "5px",
        }}
      >
        {items.map((item) => {
          const model = buildCardModel(item);
          const badgeColor = VIEW_STATUS_COLOR[model.viewStatus];
          const badgeBg = VIEW_STATUS_BG[model.viewStatus];
          const graphMuted = !model.canCompare;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem?.(item)}
              style={{
                flex: "1 1 0",
                minHeight: 0,
                width: "100%",
                textAlign: "left",
                border: `1px solid ${LG.border}`,
                cursor: "pointer",
                background: LG.surface,
                borderRadius: "12px",
                padding: "7px 9px 6px",
                fontFamily: LG.sans,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: "2px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "6px",
                    background: LG.accentSoft,
                    color: LG.accent,
                    display: "grid",
                    placeItems: "center",
                    fontSize: "10px",
                    flexShrink: 0,
                  }}
                >
                  {ROW_ICONS[item.id] || "·"}
                </span>
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: "12px",
                    fontWeight: 700,
                    color: LG.navy,
                    lineHeight: 1.2,
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
                    color: badgeColor,
                    background: badgeBg,
                    borderRadius: "999px",
                    padding: "2px 7px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {model.viewStatus}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  paddingLeft: "27px",
                  fontSize: "11px",
                  lineHeight: 1.25,
                  color: LG.textMuted,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  현재{" "}
                  <strong style={{ color: LG.navy, fontWeight: 700 }}>{model.currentLabel}</strong>
                </span>
                <span style={{ minWidth: 0, textAlign: "right" }}>
                  기준{" "}
                  <strong style={{ color: LG.navy, fontWeight: 700 }}>{model.baselineLabel}</strong>
                </span>
              </div>

              {model.showGraph ? (
                <div style={{ paddingLeft: "27px" }}>
                  <BaselineCompareGraph
                    currentAmount={model.currentAmount}
                    baselineAmount={model.canCompare ? model.baselineAmount : null}
                    accent={badgeColor}
                    muted={graphMuted}
                  />
                </div>
              ) : (
                <div style={{ paddingLeft: "27px" }}>
                  <BaselineCompareGraph muted />
                </div>
              )}

              <div
                style={{
                  paddingLeft: "27px",
                  fontSize: "10px",
                  color: model.canCompare ? badgeColor : LG.textMuted,
                  lineHeight: 1.25,
                  fontWeight: model.canCompare ? 650 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {model.footnote}
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "6px 12px 10px",
          fontSize: "10px",
          color: LG.textMuted,
          lineHeight: 1.35,
        }}
      >
        미확인은 미달·0원이 아닙니다. 판매 권유를 하지 않습니다.
      </div>
    </aside>
  );
}
