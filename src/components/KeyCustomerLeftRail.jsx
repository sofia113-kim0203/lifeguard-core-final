import KeyClaimProgress from "./KeyClaimProgress.jsx";
import KeyDiagnosisCoverageSummary from "./KeyDiagnosisCoverageSummary.jsx";

const C = {
  bg: "#FFFFFF",
  text: "#151823",
  muted: "#74798A",
  line: "#E7E8EE",
  purple: "#6C55E6",
  purpleSoft: "#F2EFFF",
  warn: "#F05A28",
  warnSoft: "#FFF1EB",
  amberSoft: "#FFF6E8",
  sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", system-ui, sans-serif',
};

export default function KeyCustomerLeftRail({
  shell = null,
  collapsed = false,
  onToggleCollapse = null,
  onOpenFamily = null,
  onOpenSessions = null,
  onOpenVault = null,
  onOpenDiagnosisDetail = null,
  style = null,
}) {
  if (collapsed) {
    return (
      <aside
        style={{
          width: "48px",
          borderRight: `1px solid ${C.line}`,
          background: C.bg,
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
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: `1px solid ${C.line}`,
            background: "#fff",
            cursor: "pointer",
            color: C.muted,
          }}
        >
          ›
        </button>
      </aside>
    );
  }

  const metrics = Array.isArray(shell?.coreMetrics) ? shell.coreMetrics : [];
  const diagnosis = Array.isArray(shell?.diagnosis) ? shell.diagnosis : [];

  return (
    <aside
      style={{
        width: "330px",
        maxWidth: "330px",
        borderRight: `1px solid ${C.line}`,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <KeyClaimProgress claimProgress={shell?.claimProgress || null} />

        {metrics.length > 0 ? (
          <section style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 800,
                color: C.muted,
                marginBottom: "10px",
                fontFamily: C.sans,
              }}
            >
              핵심 현황
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              {metrics.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border: `1px solid ${C.line}`,
                    background: m.tone === "warn" ? C.warnSoft : "#fff",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 750,
                        color: m.tone === "warn" ? C.warn : C.text,
                        fontFamily: C.sans,
                      }}
                    >
                      {m.title}
                    </div>
                    {m.sub ? (
                      <div style={{ fontSize: "11px", color: C.muted, marginTop: "3px", fontFamily: C.sans }}>
                        {m.sub}
                      </div>
                    ) : null}
                  </div>
                  <span style={{ color: C.muted, fontSize: "14px" }}>›</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <KeyDiagnosisCoverageSummary
          diagnosis={diagnosis}
          onOpenDetail={onOpenDiagnosisDetail}
        />
      </div>

      <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 12px 12px" }}>
        <div style={{ display: "grid", gap: "4px", marginBottom: "8px" }}>
          <NavBtn label="가족" onClick={onOpenFamily} />
          <NavBtn label="지난 상담" onClick={onOpenSessions} />
          <NavBtn label="내 자료 금고" onClick={onOpenVault} />
        </div>
        <button
          type="button"
          aria-label="좌측 패널 접기"
          onClick={onToggleCollapse}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: `1px solid ${C.line}`,
            background: "#fff",
            cursor: "pointer",
            color: C.muted,
          }}
        >
          ‹
        </button>
      </div>
    </aside>
  );
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
        borderRadius: "8px",
        fontSize: "13px",
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
