/** Diagnosis coverage bars — industry baseline path; pending rows show 확인 전. */

import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

export default function KeyDiagnosisCoverageSummary({
  diagnosis = [],
  onOpenDetail = null,
  embedded = false,
  overview = false,
}) {
  if (!Array.isArray(diagnosis) || diagnosis.length === 0) {
    if (!overview) return null;
    return (
      <section style={embedded ? { padding: "0" } : undefined}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.03em",
            color: C.teal,
            marginBottom: "4px",
            fontFamily: C.sans,
          }}
        >
          주요 진단비 보장
        </div>
        <div style={{ fontSize: "12px", color: C.muted }}>확인 전</div>
      </section>
    );
  }

  const rows = overview ? diagnosis.slice(0, 4) : diagnosis;
  const extra = overview && diagnosis.length > 4 ? diagnosis.length - 4 : 0;

  return (
    <section
      style={
        embedded
          ? { padding: "0" }
          : { padding: "12px 16px 10px", borderBottom: `1px solid ${C.line}` }
      }
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.03em",
          color: C.teal,
          marginBottom: overview ? "4px" : "10px",
          fontFamily: C.sans,
        }}
      >
        {overview ? "주요 진단비 보장" : "주요 진단비 보장 현황"}
      </div>
      <div style={{ display: "grid", gap: overview ? "4px" : "10px" }}>
        {rows.map((row) => {
          const pending = Boolean(row.pending);
          const barColor = pending
            ? C.pendingBar
            : row.tone === "warn"
              ? C.coral
              : row.tone === "ok"
                ? C.teal
                : C.sky;
          return (
            <div key={row.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: overview ? "2px" : "4px",
                  fontFamily: C.sans,
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 700, color: C.text }}>{row.label}</span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    color: pending ? C.muted : barColor,
                  }}
                >
                  {pending ? "확인 전" : `${row.ratio}%`}
                </span>
              </div>
              <div
                style={{
                  height: overview ? "5px" : "7px",
                  borderRadius: "999px",
                  background: C.barTrack,
                  overflow: "hidden",
                }}
              >
                <i
                  style={{
                    display: "block",
                    height: "100%",
                    width: pending
                      ? "0%"
                      : `${Math.max(0, Math.min(100, Number(row.ratio) || 0))}%`,
                    background: barColor,
                    borderRadius: "999px",
                  }}
                />
              </div>
              {!overview && !pending && (row.currentDisplay || row.baselineDisplay) ? (
                <div
                  style={{
                    marginTop: "5px",
                    fontSize: "11px",
                    color: C.muted,
                    fontFamily: C.sans,
                  }}
                >
                  {row.currentDisplay || "확인 전"}
                  {row.baselineDisplay ? ` / 기준 ${row.baselineDisplay}` : ""}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {extra > 0 ? (
        <div style={{ marginTop: "4px", fontSize: "12px", color: C.muted }}>외 {extra}항목</div>
      ) : null}
      {typeof onOpenDetail === "function" ? (
        <button
          type="button"
          onClick={onOpenDetail}
          style={{
            marginTop: overview ? "6px" : "12px",
            border: "none",
            background: "transparent",
            color: C.teal,
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            padding: 0,
            fontFamily: C.sans,
          }}
        >
          상세 보기 ›
        </button>
      ) : null}
    </section>
  );
}
