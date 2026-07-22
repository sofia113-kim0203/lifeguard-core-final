/** Diagnosis coverage bars — industry baseline path; pending rows show 확인 전. */

const C = {
  text: "#151823",
  muted: "#74798A",
  line: "#E7E8EE",
  purple: "#6C55E6",
  purpleSoft: "#F2EFFF",
  warn: "#F05A28",
  green: "#4D8A43",
  sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", system-ui, sans-serif',
};

export default function KeyDiagnosisCoverageSummary({ diagnosis = [], onOpenDetail = null }) {
  if (!Array.isArray(diagnosis) || diagnosis.length === 0) return null;
  return (
    <section style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${C.line}` }}>
      <div
        style={{
          fontSize: "12px",
          fontWeight: 800,
          color: C.muted,
          marginBottom: "10px",
          letterSpacing: "0.02em",
          fontFamily: C.sans,
        }}
      >
        주요 진단비 보장 현황
      </div>
      <div style={{ display: "grid", gap: "12px" }}>
        {diagnosis.map((row) => {
          const pending = Boolean(row.pending);
          const barColor = pending
            ? "#D7D9E2"
            : row.tone === "warn"
              ? C.warn
              : row.tone === "ok"
                ? C.green
                : C.purple;
          return (
            <div key={row.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "5px",
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
                  height: "6px",
                  borderRadius: "999px",
                  background: "#EEF0F5",
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
              <div
                style={{
                  marginTop: "4px",
                  fontSize: "11px",
                  color: C.muted,
                  fontFamily: C.sans,
                }}
              >
                {row.currentDisplay || "확인 전"}
                {row.baselineDisplay ? ` / 기준 ${row.baselineDisplay}` : ""}
              </div>
            </div>
          );
        })}
      </div>
      {typeof onOpenDetail === "function" ? (
        <button
          type="button"
          onClick={onOpenDetail}
          style={{
            marginTop: "10px",
            border: "none",
            background: "transparent",
            color: C.purple,
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
