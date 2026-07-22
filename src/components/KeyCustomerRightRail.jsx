const C = {
  bg: "#FFFFFF",
  text: "#151823",
  muted: "#74798A",
  line: "#E7E8EE",
  purple: "#6C55E6",
  purpleSoft: "#F2EFFF",
  teal: "#159A9C",
  tealSoft: "#E9F7F6",
  sand: "#F7F5F2",
  sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", system-ui, sans-serif',
};

export default function KeyCustomerRightRail({
  shell = null,
  collapsed = false,
  onToggleCollapse = null,
  style = null,
}) {
  if (collapsed) {
    return (
      <aside
        style={{
          width: "48px",
          borderLeft: `1px solid ${C.line}`,
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
          aria-label="우측 패널 펼치기"
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
      </aside>
    );
  }

  const money = shell?.moneyFlow || {};
  const schedules = Array.isArray(shell?.schedules) ? shell.schedules : [];
  const activities = Array.isArray(shell?.activities) ? shell.activities : [];
  const goals = Array.isArray(shell?.goals) ? shell.goals : [];
  const reviewing = Number(money.reviewingCount) || 0;

  return (
    <aside
      style={{
        width: "340px",
        maxWidth: "340px",
        borderLeft: `1px solid ${C.line}`,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 10px", minHeight: 0 }}>
        <SectionTitle>돈의 흐름</SectionTitle>
        <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
          <Card>
            <div style={{ fontSize: "12px", color: C.muted }}>심사 중 청구</div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: C.text, marginTop: "4px" }}>
              {reviewing > 0 ? `${reviewing}건` : "없음"}
            </div>
          </Card>
          <Card soft>
            <div style={{ fontSize: "12px", color: C.muted }}>올해 받은 보험금</div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: C.teal, marginTop: "4px" }}>
              {money.yearPaidDisplay || "집계 전"}
            </div>
          </Card>
        </div>

        {schedules.length > 0 ? (
          <>
            <SectionTitle>다가오는 일정</SectionTitle>
            <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
              {schedules.map((s) => (
                <Card key={s.id} row>
                  <div
                    style={{
                      minWidth: "44px",
                      textAlign: "center",
                      borderRadius: "10px",
                      padding: "6px 4px",
                      background: C.purpleSoft,
                      color: C.purple,
                      fontSize: "12px",
                      fontWeight: 800,
                    }}
                  >
                    {s.dLabel}
                  </div>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{s.title}</div>
                    <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{s.dueAt}</div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : null}

        {activities.length > 0 ? (
          <>
            <SectionTitle>최근 활동</SectionTitle>
            <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
              {activities.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: "10px" }}>
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      marginTop: "5px",
                      borderRadius: "999px",
                      background: C.purple,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", color: C.text, fontWeight: 650 }}>{a.title}</div>
                    {a.when ? (
                      <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{a.when}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {goals.length > 0 ? (
          <>
            <SectionTitle>KEY가 기억한 목표</SectionTitle>
            <div style={{ display: "grid", gap: "8px" }}>
              {goals.map((g) => (
                <Card key={g.id} sand>
                  <div style={{ fontSize: "13px", lineHeight: 1.55, color: C.text }}>“{g.text}”</div>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div style={{ padding: "8px 12px 12px", borderTop: `1px solid ${C.line}` }}>
        <button
          type="button"
          aria-label="우측 패널 접기"
          onClick={onToggleCollapse}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: `1px solid ${C.line}`,
            background: "#fff",
            cursor: "pointer",
            color: C.muted,
            marginLeft: "auto",
            display: "block",
          }}
        >
          ›
        </button>
      </div>
    </aside>
  );
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: "12px",
        fontWeight: 800,
        color: C.muted,
        marginBottom: "8px",
        letterSpacing: "0.02em",
        fontFamily: C.sans,
      }}
    >
      {children}
    </div>
  );
}

function Card({ children, soft = false, sand = false, row = false }) {
  return (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: "14px",
        padding: "12px",
        background: soft ? C.tealSoft : sand ? C.sand : "#fff",
        display: row ? "flex" : "block",
        gap: row ? "10px" : undefined,
        alignItems: row ? "center" : undefined,
        fontFamily: C.sans,
      }}
    >
      {children}
    </div>
  );
}
