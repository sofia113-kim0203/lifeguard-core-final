/**
 * Right rail — KEY industry cumulative coverage baseline (read-only).
 * Does not call Claude, rewrite answers, or sell products.
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { BASELINE_STATUS } from "../lib/keyInsuranceScreenFacts.js";

function CountChip({ label, value, color }) {
  return (
    <div
      style={{
        flex: "1 1 46%",
        minWidth: "110px",
        borderRadius: "12px",
        background: LG.surface,
        boxShadow: LG.shadow,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: "11px", color: LG.textSoft, marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 750, color }}>{value}</div>
    </div>
  );
}

export default function KeyCoverageBaselineRail({
  baseline = null,
  style = {},
  onClose = null,
  onSelectItem = null,
}) {
  const counts = baseline?.counts || {
    met: 0,
    short: 0,
    need: 0,
    overlap: 0,
    tablePending: 0,
  };
  const items = Array.isArray(baseline?.items) ? baseline.items : [];

  return (
    <aside
      aria-label="KEY 업계누적 보장 기준선"
      style={{
        width: "290px",
        maxWidth: "290px",
        flexShrink: 0,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "18px 14px 10px",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 750,
              color: LG.navy,
              lineHeight: 1.35,
            }}
          >
            KEY 업계누적 보장 기준선
          </div>
          <div style={{ marginTop: "4px", fontSize: "11px", color: LG.textSoft }}>
            읽기 전용 · 답변을 바꾸지 않습니다
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
              color: LG.textSoft,
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          padding: "0 14px 12px",
          flexShrink: 0,
        }}
      >
        <CountChip label="충족" value={counts.met} color="#2563EB" />
        <CountChip label="미달" value={counts.short} color="#D97706" />
        <CountChip label="확인 필요" value={counts.need} color="#64748B" />
        <CountChip label="중복 점검" value={counts.overlap} color="#7C3AED" />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectItem?.(item)}
            style={{
              width: "100%",
              textAlign: "left",
              border: "none",
              cursor: "pointer",
              background: LG.surface,
              borderRadius: "14px",
              boxShadow: LG.shadow,
              padding: "12px 12px",
              marginBottom: "8px",
              fontFamily: LG.sans,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                alignItems: "center",
                marginBottom: "6px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: LG.navy }}>{item.shortLabel}</div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: item.statusColor,
                  background: `${item.statusColor}18`,
                  borderRadius: "999px",
                  padding: "3px 8px",
                  flexShrink: 0,
                }}
              >
                {item.status}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: LG.textMuted, lineHeight: 1.45 }}>
              {item.compareMode === "lump_sum"
                ? `${item.currentDisplay} / ${item.industryRangeDisplay}`
                : item.compareMode === "daily_structured"
                  ? `${item.currentDisplay}`
                  : `${item.currentDisplay}`}
            </div>
          </button>
        ))}
        <p style={{ margin: "8px 4px 0", fontSize: "11px", color: LG.textSoft, lineHeight: 1.5 }}>
          기준자료가 없는 항목은 「{BASELINE_STATUS.TABLE_PENDING}」입니다. 미확인을 미달·0원으로 보지 않습니다.
        </p>
      </div>
    </aside>
  );
}
