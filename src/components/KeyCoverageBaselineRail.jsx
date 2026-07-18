/**
 * Right rail — KEY industry cumulative coverage baseline (read-only).
 * Amount cards: current sum + horizontal graph (no invented industry numbers).
 * Structured cards: axis 확인됨/미확인 only — no money bar graphs.
 * major_treatment: A 암 주요치료비 / B 뇌·심 주요치료비 (never summed).
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  BASELINE_STATUS,
  formatManwonAmount,
} from "../lib/keyInsuranceScreenFacts.js";
import {
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS,
  BASELINE_STRUCTURED_AXES,
  MAJOR_TREATMENT_REGIONS,
} from "../lib/keyIndustryCoverageBaselineTable.js";

const ROW_ICONS = {
  cancer_diagnosis: "◆",
  cerebrovascular_diagnosis: "◇",
  ischemic_heart_diagnosis: "◇",
  caregiving: "○",
  hospital_daily: "○",
  surgery: "□",
  major_treatment: "□",
};

const VIEW_STATUS = {
  SHORT: "부족 가능성",
  MET: "적정 구간",
  OVERLAP: "중복·보험료 점검",
  CURRENT_UNKNOWN: "현재 미확인",
  TABLE_PENDING: "기준 확인 중",
};

const VIEW_STATUS_COLOR = {
  [VIEW_STATUS.SHORT]: LG.needs,
  [VIEW_STATUS.MET]: LG.verified,
  [VIEW_STATUS.OVERLAP]: LG.overlap,
  [VIEW_STATUS.CURRENT_UNKNOWN]: LG.needCheck,
  [VIEW_STATUS.TABLE_PENDING]: LG.needCheck,
};

const VIEW_STATUS_BG = {
  [VIEW_STATUS.SHORT]: LG.needsBg,
  [VIEW_STATUS.MET]: LG.verifiedBg,
  [VIEW_STATUS.OVERLAP]: LG.overlapBg,
  [VIEW_STATUS.CURRENT_UNKNOWN]: LG.needCheckBg,
  [VIEW_STATUS.TABLE_PENDING]: LG.needCheckBg,
};

function resolveRows(baseline) {
  const byId = new Map(
    (Array.isArray(baseline?.items) ? baseline.items : []).map((row) => [row.id, row]),
  );
  return KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.map((def) => {
    const hit = byId.get(def.id);
    if (hit) return { ...hit, label: def.label, shortLabel: def.shortLabel };
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
      isAmountMode: def.compareMode === "lump_sum",
      structuredAxes:
        def.compareMode === "lump_sum"
          ? null
          : def.id === "major_treatment"
            ? MAJOR_TREATMENT_REGIONS.map((region) => ({
                id: region.id,
                label: region.label,
                axes: region.axes.map((axis) => ({
                  id: axis.id,
                  label: axis.label,
                  status: "미확인",
                })),
              }))
            : (BASELINE_STRUCTURED_AXES[def.id] || []).map((axis) => ({
                id: axis.id,
                label: axis.label,
                status: "미확인",
              })),
    };
  });
}

function isAmountItem(item) {
  return item?.isAmountMode === true || item?.compareMode === "lump_sum";
}

function mapAmountViewStatus(item, currentAmount) {
  const status = item?.status;
  if (status === BASELINE_STATUS.SHORT) return VIEW_STATUS.SHORT;
  if (status === BASELINE_STATUS.MET) return VIEW_STATUS.MET;
  if (status === BASELINE_STATUS.OVERLAP) return VIEW_STATUS.OVERLAP;
  if (status === BASELINE_STATUS.TABLE_PENDING) return VIEW_STATUS.TABLE_PENDING;
  if (currentAmount == null) return VIEW_STATUS.CURRENT_UNKNOWN;
  return VIEW_STATUS.TABLE_PENDING;
}

function formatCompactAmount(value) {
  return formatManwonAmount(value) || "—";
}

function BaselineCompareGraph({
  currentAmount = null,
  baselineAmount = null,
  rangeHigh = null,
  accent = LG.needCheck,
  muted = false,
}) {
  const max = Math.max(currentAmount || 0, baselineAmount || 0, rangeHigh || 0, 1);
  const currentPct =
    currentAmount != null ? Math.max(2, Math.min(100, (currentAmount / max) * 100)) : null;
  const baselinePct =
    baselineAmount != null ? Math.max(2, Math.min(100, (baselineAmount / max) * 100)) : null;
  const fillPct = currentPct ?? 0;

  return (
    <div style={{ marginTop: "4px", width: "100%" }} aria-hidden="true">
      <div
        style={{
          position: "relative",
          height: "7px",
          borderRadius: "999px",
          background: muted ? "#E8ECF2" : "#E7EAF0",
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
              background: muted ? "#CBD5E1" : accent,
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
              height: "11px",
              background: muted ? "#94A3B8" : LG.navy,
              opacity: 0.55,
            }}
          />
        ) : null}
        {currentPct != null ? (
          <div
            style={{
              position: "absolute",
              left: `calc(${currentPct}% - 4px)`,
              top: "-1px",
              width: "9px",
              height: "9px",
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
          marginTop: "2px",
          fontSize: "9px",
          color: LG.textMuted,
        }}
      >
        <span>0</span>
        <span>{baselineAmount != null ? "대표" : currentAmount != null ? "현재" : ""}</span>
      </div>
    </div>
  );
}

function AxisRow({ label, status }) {
  const ok = status === "확인됨";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        fontSize: "10px",
        lineHeight: 1.25,
        color: LG.textMuted,
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: LG.navy,
        }}
      >
        {label}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontSize: "9px",
          fontWeight: 700,
          color: ok ? LG.verified : LG.needCheck,
          background: ok ? LG.verifiedBg : LG.needCheckBg,
          borderRadius: "999px",
          padding: "1px 6px",
        }}
      >
        {ok ? "확인됨" : "미확인"}
      </span>
    </div>
  );
}

function StructuredAxesBlock({ item }) {
  const axes = item?.structuredAxes;
  if (item?.id === "major_treatment" && Array.isArray(axes)) {
    return (
      <div style={{ paddingLeft: "24px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {axes.map((region) => (
          <div key={region.id}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 750,
                color: LG.navy,
                marginBottom: "2px",
              }}
            >
              {region.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
              {(region.axes || []).map((axis) => (
                <AxisRow key={`${region.id}-${axis.id}`} label={axis.label} status={axis.status} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!Array.isArray(axes) || !axes.length) return null;
  return (
    <div
      style={{
        paddingLeft: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "1px",
      }}
    >
      {axes.map((axis) => (
        <AxisRow key={axis.id} label={axis.label} status={axis.status} />
      ))}
    </div>
  );
}

function AmountCardBody({ item }) {
  const currentAmount =
    item?.currentAmount != null && Number.isFinite(Number(item.currentAmount))
      ? Number(item.currentAmount)
      : null;
  const representative =
    item?.industry_representative != null &&
    Number.isFinite(Number(item.industry_representative))
      ? Number(item.industry_representative)
      : null;
  const rangeHigh =
    item?.industry_range_high != null && Number.isFinite(Number(item.industry_range_high))
      ? Number(item.industry_range_high)
      : null;
  const tableReady = item?.tableReady === true || item?.showCompareBar === true;
  const viewStatus = mapAmountViewStatus(item, currentAmount);
  const badgeColor = VIEW_STATUS_COLOR[viewStatus];
  const badgeBg = VIEW_STATUS_BG[viewStatus];
  const currentLabel =
    currentAmount != null ? formatCompactAmount(currentAmount) : "미확인";
  const baselineLabel = tableReady
    ? formatCompactAmount(representative) || item?.industryRangeDisplay || "—"
    : "기준 확인 중";
  const footnote = !tableReady
    ? currentAmount != null
      ? "기준 확인 중 · 업계 구간 자료 등록 후 비교"
      : "현재 미확인 / 자료 등록 후 비교 가능"
    : currentAmount == null
      ? "현재 미확인 · 해지 권유 아님"
      : viewStatus === VIEW_STATUS.OVERLAP
        ? "중복·보험료 점검 · 해지 권유 아님"
        : `${item?.industryRangeDisplay || "비교 구간"} · 해지 권유 아님`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          aria-hidden="true"
          style={{
            width: "18px",
            height: "18px",
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
            fontSize: "11px",
            fontWeight: 700,
            color: LG.navy,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.label || item.shortLabel}
        </div>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            color: badgeColor,
            background: badgeBg,
            borderRadius: "999px",
            padding: "2px 6px",
            flexShrink: 0,
          }}
        >
          {viewStatus}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "6px",
          paddingLeft: "24px",
          fontSize: "10px",
          color: LG.textMuted,
        }}
      >
        <span>
          현재 <strong style={{ color: LG.navy }}>{currentLabel}</strong>
        </span>
        <span>
          기준 <strong style={{ color: LG.navy }}>{baselineLabel}</strong>
        </span>
      </div>
      <div style={{ paddingLeft: "24px" }}>
        <BaselineCompareGraph
          currentAmount={currentAmount}
          baselineAmount={tableReady ? representative : null}
          rangeHigh={tableReady ? rangeHigh : null}
          accent={badgeColor}
          muted={!tableReady}
        />
      </div>
      <div
        style={{
          paddingLeft: "24px",
          fontSize: "9px",
          color: LG.textMuted,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {footnote}
      </div>
    </>
  );
}

function StructuredCardBody({ item }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
        <span
          aria-hidden="true"
          style={{
            width: "18px",
            height: "18px",
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
            fontSize: "11px",
            fontWeight: 700,
            color: LG.navy,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.label || item.shortLabel}
        </div>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            color: LG.needCheck,
            background: LG.needCheckBg,
            borderRadius: "999px",
            padding: "2px 6px",
            flexShrink: 0,
          }}
        >
          구조 확인
        </span>
      </div>
      <StructuredAxesBlock item={item} />
    </>
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
    ? "7개 항목 · 업계 비교 기준 확인 중"
    : `7개 항목 · 적정 ${baseline?.counts?.met ?? 0} · 부족 가능성 ${baseline?.counts?.short ?? 0} · 중복점검 ${baseline?.counts?.overlap ?? 0}`;

  return (
    <aside
      aria-label="KEY 업계 비교 기준선"
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
          padding: "10px 10px 4px",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "6px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 750, color: LG.navy, lineHeight: 1.25 }}>
            KEY 업계 비교 기준선
          </div>
          <div style={{ marginTop: "3px", fontSize: "10px", color: LG.textMuted }}>
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
              fontSize: "16px",
              lineHeight: 1,
              padding: "2px",
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
          padding: "2px 8px 0",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {items.map((item) => {
          const amount = isAmountItem(item);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem?.(item)}
              style={{
                flex: amount ? "0.9 1 0" : item.id === "major_treatment" ? "1.6 1 0" : "1.15 1 0",
                minHeight: 0,
                width: "100%",
                textAlign: "left",
                border: `1px solid ${LG.border}`,
                cursor: "pointer",
                background: LG.surface,
                borderRadius: "10px",
                padding: "6px 8px",
                fontFamily: LG.sans,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: "2px",
                overflow: "hidden",
              }}
            >
              {amount ? <AmountCardBody item={item} /> : <StructuredCardBody item={item} />}
            </button>
          );
        })}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "5px 10px 8px",
          fontSize: "9px",
          color: LG.textMuted,
          lineHeight: 1.3,
        }}
      >
        미확인은 부족·0원이 아닙니다. 판매 권유를 하지 않습니다.
      </div>
    </aside>
  );
}
