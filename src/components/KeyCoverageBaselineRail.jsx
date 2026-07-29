/**
 * Right rail — KEY 업계 비교 기준선 (read-only UI).
 * No panel header — cards start at top. Major treatment shows 2 region lines only.
 * Data / amounts / Claude path unchanged — display mapping only.
 */
import {
  BASELINE_STATUS,
  formatManwonAmount,
} from "../lib/keyInsuranceScreenFacts.js";
import {
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS,
  BASELINE_STRUCTURED_AXES,
  MAJOR_TREATMENT_REGIONS,
} from "../lib/keyIndustryCoverageBaselineTable.js";

const PANEL = {
  bg: "#FFFFFF",
  outerBorder: "#E7EAF2",
  cardBorder: "#E9ECF3",
  text: "#17213C",
  textMuted: "#6B7280",
  track: "#E8ECF3",
  sans: 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
};

const ITEM_COLORS = {
  cancer_diagnosis: { main: "#EC5C76", soft: "#FFF0F4", text: "#D93D5E" },
  cerebrovascular_diagnosis: { main: "#F59A3D", soft: "#FFF4E8", text: "#D97706" },
  ischemic_heart_diagnosis: { main: "#55BE83", soft: "#EDF9F2", text: "#2D9B63" },
  caregiving: { main: "#4C8FEF", soft: "#EEF5FF", text: "#3475D4" },
  hospital_daily: { main: "#7B61E8", soft: "#F2EFFF", text: "#6547D9" },
  surgery: { main: "#F2B84B", soft: "#FFF8E8", text: "#D59621" },
  major_treatment: { main: "#D94BB7", soft: "#FFF0FA", text: "#B83294" },
};

const MAJOR_REGION_COLORS = {
  cancer: { main: "#D94BB7", soft: "#FFF0FA", text: "#B83294" },
  brain_heart: { main: "#4C8FEF", soft: "#EAF8F5", text: "#1F8F7A" },
};

const STATUS_COLORS = {
  SHORT: { text: "#E07A3A", bg: "#FFF4E8", main: "#F59A3D" },
  MET: { text: "#2D9B63", bg: "#EDF9F2", main: "#55BE83" },
  OVERLAP: { text: "#6547D9", bg: "#F2EFFF", main: "#7B61E8" },
  CURRENT_UNKNOWN: { text: "#6B7280", bg: "#F3F4F6", main: "#9CA3AF" },
  TABLE_PENDING: { text: "#5B6B8C", bg: "#EEF2F7", main: "#7B8BA8" },
};

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

function itemTone(id) {
  return ITEM_COLORS[id] || { main: "#7B8BA8", soft: "#EEF2F7", text: "#5B6B8C" };
}

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
      currentAmount: null,
      currentDisplay: "확인 필요",
      industry_range_low: null,
      industry_range_high: null,
      industry_representative: null,
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
  if (status === BASELINE_STATUS.SHORT) return "SHORT";
  if (status === BASELINE_STATUS.MET) return "MET";
  if (status === BASELINE_STATUS.OVERLAP) return "OVERLAP";
  if (status === BASELINE_STATUS.TABLE_PENDING) return "TABLE_PENDING";
  if (currentAmount == null) return "CURRENT_UNKNOWN";
  return "TABLE_PENDING";
}

function formatCompactAmount(value) {
  return formatManwonAmount(value) || "—";
}

/** UI-only: map axis status → 있음 / 없음 / 미확인 */
function displayPresence(status) {
  if (status === "확인됨" || status === "있음") return "있음";
  if (status === "없음") return "없음";
  return "미확인";
}

function regionPresence(region) {
  const axes = Array.isArray(region?.axes) ? region.axes : [];
  if (!axes.length) return "미확인";
  if (axes.some((a) => a.status === "확인됨" || a.status === "있음")) return "있음";
  if (axes.every((a) => a.status === "없음")) return "없음";
  return "미확인";
}

function ItemIcon({ itemId, size = 40 }) {
  const tone = itemTone(itemId);
  return (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "12px",
        background: tone.soft,
        color: tone.main,
        display: "grid",
        placeItems: "center",
        fontSize: "15px",
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {ROW_ICONS[itemId] || "·"}
    </span>
  );
}

function PresenceBadge({ value, tone }) {
  const ok = value === "있음";
  const none = value === "없음";
  const color = ok
    ? tone || STATUS_COLORS.MET
    : none
      ? { text: "#9CA3AF", bg: "#F3F4F6" }
      : STATUS_COLORS.CURRENT_UNKNOWN;
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "9px",
        fontWeight: 700,
        color: color.text,
        background: color.bg,
        borderRadius: "999px",
        padding: "2px 7px",
      }}
    >
      {value}
    </span>
  );
}

function BaselineCompareGraph({
  currentAmount = null,
  baselineAmount = null,
  rangeHigh = null,
  statusMain = PANEL.textMuted,
  muted = false,
}) {
  const max = Math.max(currentAmount || 0, baselineAmount || 0, rangeHigh || 0, 1);
  const currentPct =
    currentAmount != null ? Math.max(3, Math.min(100, (currentAmount / max) * 100)) : null;
  const baselinePct =
    baselineAmount != null ? Math.max(2, Math.min(100, (baselineAmount / max) * 100)) : null;
  const fillPct = currentPct ?? 0;
  const line = muted ? "#CBD5E1" : statusMain;

  return (
    <div style={{ marginTop: "5px", width: "100%" }} aria-hidden="true">
      <div
        style={{
          position: "relative",
          height: "5px",
          borderRadius: "999px",
          background: PANEL.track,
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
              background: line,
              opacity: muted ? 0.45 : 0.85,
            }}
          />
        ) : null}
        {baselinePct != null ? (
          <div
            style={{
              position: "absolute",
              left: `calc(${baselinePct}% - 1px)`,
              top: "-4px",
              width: "2px",
              height: "13px",
              background: muted ? "#94A3B8" : PANEL.text,
              opacity: 0.65,
              borderRadius: "1px",
            }}
          />
        ) : null}
        {currentPct != null ? (
          <div
            style={{
              position: "absolute",
              left: `calc(${currentPct}% - 6px)`,
              top: "-4px",
              width: "13px",
              height: "13px",
              borderRadius: "999px",
              background: line,
              border: `2px solid ${PANEL.bg}`,
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
          color: PANEL.textMuted,
        }}
      >
        <span>0</span>
        <span>{baselineAmount != null ? "대표" : currentAmount != null ? "현재" : ""}</span>
      </div>
    </div>
  );
}

function StructuredRow({ label, presence, tone, detail = null }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "8px",
        fontSize: "11px",
        lineHeight: 1.35,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            color: PANEL.text,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        {detail ? (
          <div
            style={{
              marginTop: "1px",
              fontSize: "9px",
              color: PANEL.textMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
      <PresenceBadge value={presence} tone={tone} />
    </div>
  );
}

function StructuredAxesBlock({ item }) {
  const axes = item?.structuredAxes;
  const itemConfirmed = {
    text: itemTone(item.id).text,
    bg: itemTone(item.id).soft,
    main: itemTone(item.id).main,
  };

  // Major treatment: only two region summary lines (no detailed therapy axes).
  if (item?.id === "major_treatment" && Array.isArray(axes)) {
    const regions =
      axes.length > 0
        ? axes
        : MAJOR_TREATMENT_REGIONS.map((r) => ({ id: r.id, label: r.label, axes: [] }));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "2px" }}>
        {regions.map((region, idx) => {
          const regionTone = MAJOR_REGION_COLORS[region.id] || MAJOR_REGION_COLORS.cancer;
          const presence = regionPresence(region);
          return (
            <div
              key={region.id}
              style={{
                paddingTop: idx === 0 ? 0 : "6px",
                borderTop: idx === 0 ? "none" : `1px solid ${PANEL.cardBorder}`,
              }}
            >
              <StructuredRow
                label={region.label}
                presence={presence}
                tone={{ text: regionTone.text, bg: regionTone.soft }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (!Array.isArray(axes) || !axes.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "2px" }}>
      {axes.map((axis) => {
        const presence = displayPresence(axis.status);
        const detail =
          presence === "있음" && axis.detail
            ? String(axis.detail).slice(0, 28)
            : null;
        return (
          <StructuredRow
            key={axis.id}
            label={axis.label}
            presence={presence}
            tone={itemConfirmed}
            detail={detail}
          />
        );
      })}
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
  const statusKey = mapAmountViewStatus(item, currentAmount);
  const statusTone = STATUS_COLORS[statusKey];
  const viewLabel = VIEW_STATUS[statusKey];
  const currentLabel =
    currentAmount != null ? formatCompactAmount(currentAmount) : "미확인";
  const baselineLabel = tableReady
    ? formatCompactAmount(representative) || item?.industryRangeDisplay || "—"
    : "기준 확인 중";
  const footnote = !tableReady
    ? currentAmount != null
      ? "기준 확인 중 · 업계 구간 자료 등록 후 비교"
      : "현재 미확인 · 해지 권유 아님"
    : currentAmount == null
      ? "현재 미확인 · 해지 권유 아님"
      : statusKey === "OVERLAP"
        ? "중복·보험료 점검 · 해지 권유 아님"
        : statusKey === "SHORT"
          ? "부족 가능성 · 해지 권유 아님"
          : statusKey === "MET"
            ? "적정 구간 · 해지 권유 아님"
            : `${item?.industryRangeDisplay || "비교 구간"} · 해지 권유 아님`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <ItemIcon itemId={item.id} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 750,
              color: PANEL.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label || item.shortLabel}
          </div>
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: statusTone.text,
            background: statusTone.bg,
            borderRadius: "999px",
            padding: "3px 8px",
            flexShrink: 0,
          }}
        >
          {viewLabel}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "8px",
          marginTop: "6px",
          fontSize: "11px",
          color: PANEL.textMuted,
        }}
      >
        <span>
          현재{" "}
          <strong
            style={{
              color: currentAmount == null ? STATUS_COLORS.CURRENT_UNKNOWN.text : PANEL.text,
              fontWeight: 750,
            }}
          >
            {currentLabel}
          </strong>
        </span>
        <span>
          기준{" "}
          <strong style={{ color: PANEL.text, fontWeight: 750 }}>{baselineLabel}</strong>
        </span>
      </div>
      <BaselineCompareGraph
        currentAmount={currentAmount}
        baselineAmount={tableReady ? representative : null}
        rangeHigh={tableReady ? rangeHigh : null}
        statusMain={statusTone.main}
        muted={!tableReady || currentAmount == null}
      />
      <div
        style={{
          marginTop: "2px",
          fontSize: "10px",
          fontWeight: 650,
          color: statusTone.text,
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
  const tone = itemTone(item.id);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
        <ItemIcon itemId={item.id} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 750,
              color: PANEL.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label || item.shortLabel}
          </div>
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: tone.text,
            background: tone.soft,
            borderRadius: "999px",
            padding: "3px 8px",
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

function BaselineCard({ item, onSelectItem }) {
  const amount = isAmountItem(item);
  const tone = itemTone(item.id);
  return (
    <button
      type="button"
      data-baseline-item={item.id}
      onClick={() => onSelectItem?.(item)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${tone.soft}66`;
        e.currentTarget.style.borderColor = tone.main;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = PANEL.bg;
        e.currentTarget.style.borderColor = PANEL.cardBorder;
      }}
      style={{
        flexShrink: 0,
        width: "100%",
        textAlign: "left",
        border: `1px solid ${PANEL.cardBorder}`,
        borderTop: `3px solid ${tone.main}`,
        cursor: "pointer",
        background: PANEL.bg,
        borderRadius: "16px",
        padding: "11px 12px",
        fontFamily: PANEL.sans,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        gap: "2px",
        overflow: "visible",
        boxSizing: "border-box",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      {amount ? <AmountCardBody item={item} /> : <StructuredCardBody item={item} />}
    </button>
  );
}

export default function KeyCoverageBaselineRail({
  baseline = null,
  style = {},
  onClose = null,
  onSelectItem = null,
}) {
  const items = resolveRows(baseline);
  // onClose kept for API compat — header removed, close control not rendered.
  void onClose;

  return (
    <aside
      aria-label="KEY 업계 비교 기준선"
      data-key-baseline-rail="1"
      style={{
        width: "280px",
        maxWidth: "280px",
        flexShrink: 0,
        background: PANEL.bg,
        border: `1px solid ${PANEL.outerBorder}`,
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "11px 10px 0",
          display: "flex",
          flexDirection: "column",
          gap: "9px",
          boxSizing: "border-box",
        }}
      >
        {items.map((item) => (
          <BaselineCard key={item.id} item={item} onSelectItem={onSelectItem} />
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "8px 12px 10px",
          marginTop: "4px",
          fontSize: "9px",
          color: PANEL.textMuted,
          lineHeight: 1.35,
          borderTop: `1px solid ${PANEL.cardBorder}`,
        }}
      >
        미확인은 부족·0원이 아닙니다. 판매 권유를 하지 않습니다.
      </div>
    </aside>
  );
}
