/** Claim progress stepper — verified Claim Guardian rows only. */

const C = {
  text: "#151823",
  muted: "#74798A",
  line: "#E7E8EE",
  purple: "#6C55E6",
  purpleSoft: "#F2EFFF",
  green: "#4D8A43",
  sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", system-ui, sans-serif',
};

export default function KeyClaimProgress({ claimProgress = null }) {
  if (!claimProgress || !Array.isArray(claimProgress.steps) || !claimProgress.steps.length) {
    return null;
  }
  const count = Number(claimProgress.activeCount) || 1;
  return (
    <section style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, fontFamily: C.sans }}>
          청구 진행 현황
        </div>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: C.purple,
            background: C.purpleSoft,
            borderRadius: "999px",
            padding: "2px 8px",
          }}
        >
          {count}건 진행 중
        </span>
      </div>
      {(claimProgress.kindLabel || claimProgress.receivedAt) && (
        <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px", fontFamily: C.sans }}>
          {[claimProgress.kindLabel, claimProgress.receivedAt].filter(Boolean).join(" · ")}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${claimProgress.steps.length}, 1fr)`,
          gap: "4px",
          position: "relative",
        }}
      >
        {claimProgress.steps.map((step) => {
          const done = step.state === "done";
          const current = step.state === "current";
          return (
            <div key={step.key} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  margin: "0 auto 6px",
                  borderRadius: "999px",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "11px",
                  fontWeight: 800,
                  color: done || current ? "#fff" : C.muted,
                  background: done ? C.green : current ? C.purple : "#fff",
                  border: current
                    ? `2px solid ${C.purple}`
                    : done
                      ? `2px solid ${C.green}`
                      : `2px solid ${C.line}`,
                  boxShadow: current ? `0 0 0 3px ${C.purpleSoft}` : "none",
                }}
              >
                {done ? "✓" : current ? "●" : ""}
              </div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: current ? 800 : 600,
                  color: current ? C.purple : done ? C.green : C.muted,
                  fontFamily: C.sans,
                }}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
