import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

export default function KeyCustomerRightRail({
  shell = null,
  collapsed = false,
  onToggleCollapse = null,
  style = null,
}) {
  if (collapsed) {
    return (
      <aside
        className="lg-v31-rail"
        style={{
          width: "48px",
          minWidth: "48px",
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
          style={iconBtnStyle}
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
  const results = Array.isArray(shell?.paymentResults) ? shell.paymentResults : [];
  const reviewing = Number(money.reviewingCount) || 0;
  const col = `${C.rightColPx}px`;

  return (
    <aside
      className="lg-v31-rail"
      aria-label="KEY가 계속 관리하는 것"
      style={{
        width: col,
        minWidth: col,
        maxWidth: col,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: C.sans,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `${C.heroPadPx}px 10px 10px`,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "9px",
        }}
      >
        <Block tone="money" title="돈의 흐름" dot={C.sky}>
          <MoneyRow label="심사 중 청구" value={reviewing > 0 ? `${reviewing}건` : "없음"} />
          <MoneyRow label="올해 받은 보험금" value={money.yearPaidDisplay || "집계 전"} />
        </Block>

        <Block tone="schedule" title="다가오는 날짜" dot={C.amber}>
          {schedules.length > 0 ? (
            schedules.map((s) => (
              <div
                key={s.id}
                style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "8px 0" }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    minWidth: "42px",
                    textAlign: "center",
                    borderRadius: "12px",
                    padding: "6px",
                    background: "#fff",
                    color: C.coral,
                    fontSize: "11px",
                    fontWeight: 800,
                    lineHeight: 1.2,
                  }}
                >
                  {s.dLabel}
                  {s.dueAt ? (
                    <span style={{ display: "block", fontSize: "10px", color: C.muted, fontWeight: 600 }}>
                      {String(s.dueAt).slice(5, 10).replace("-", "/")}
                    </span>
                  ) : null}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.35, color: C.text }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>{s.dueAt}</div>
                </div>
              </div>
            ))
          ) : (
            <EmptyLine primary="없음" secondary="납입·전환·점검 일정이 생기면 여기" />
          )}
        </Block>

        <Block tone="activity" title="최근 활동과 증거" dot={C.teal}>
          {activities.length > 0 ? (
            activities.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: "10px", padding: "7px 0" }}>
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "10px",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "12px",
                    fontWeight: 800,
                    flexShrink: 0,
                    background: "#fff",
                    color: C.teal,
                  }}
                >
                  활
                </div>
                <div>
                  {a.when ? (
                    <div style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>{a.when}</div>
                  ) : null}
                  <div style={{ fontSize: "13px", lineHeight: 1.45, color: C.text, fontWeight: 650 }}>
                    {a.title}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyLine primary="아직 기록 없음" />
          )}
        </Block>

        <Block tone="goal" title="KEY가 기억한 목표" dot={C.navy}>
          {goals.length > 0 ? (
            goals.map((g) => (
              <div
                key={g.id}
                style={{ fontSize: "13px", lineHeight: 1.55, color: C.text, marginBottom: "6px" }}
              >
                “{g.text}”
              </div>
            ))
          ) : (
            <EmptyLine primary="아직 기록 없음" />
          )}
        </Block>

        <Block tone="result" title="지급·거절 결과" dot={C.coral}>
          {results.length > 0 ? (
            results.map((r) => (
              <div key={r.id} style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{r.title}</div>
                {r.reason ? (
                  <div style={{ fontSize: "12px", color: C.muted, marginTop: "4px", lineHeight: 1.45 }}>
                    {r.reason}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <EmptyLine
              primary="없음"
              secondary="실제 결과가 오면 이유와 함께 여기에만 둡니다"
            />
          )}
        </Block>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px", borderTop: "1px solid rgba(18,50,95,0.06)" }}>
          <button
            type="button"
            aria-label="우측 패널 접기"
            onClick={onToggleCollapse}
            style={{ ...iconBtnStyle, marginLeft: "auto", display: "block" }}
          >
            ›
          </button>
        </div>
      ) : null}
    </aside>
  );
}

const iconBtnStyle = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  cursor: "pointer",
  color: C.muted,
};

function Block({ tone, title, dot, children }) {
  const bg =
    tone === "money"
      ? "linear-gradient(160deg, #EAF3FB 0%, #FFFFFF 55%)"
      : tone === "schedule"
        ? "linear-gradient(160deg, #FFF6E8 0%, #FFFFFF 60%)"
        : tone === "activity"
          ? "linear-gradient(160deg, #E6F7F3 0%, #FFFFFF 60%)"
          : tone === "result"
            ? "linear-gradient(160deg, #FFF0EB 0%, #FFFFFF 60%)"
            : "linear-gradient(160deg, #FAF7F2 0%, #FFFFFF 60%)";
  return (
    <div
      style={{
        background: bg,
        borderRadius: "18px",
        padding: "15px 14px",
      }}
    >
      <div
        style={{
          margin: "0 0 12px",
          fontSize: "13px",
          fontWeight: 800,
          color: C.navy,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "999px",
            background: dot,
            display: "inline-block",
          }}
        />
        {title}
      </div>
      {children}
    </div>
  );
}

function MoneyRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "8px 0",
        borderBottom: "1px solid rgba(59,130,196,0.12)",
        fontSize: "13px",
      }}
    >
      <span style={{ color: C.text }}>{label}</span>
      <span style={{ fontSize: `${C.rightValueSize}px`, fontWeight: 700, color: C.muted }}>{value}</span>
    </div>
  );
}

function EmptyLine({ primary, secondary = null }) {
  return (
    <div>
      <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.5 }}>{primary}</div>
      {secondary ? (
        <div style={{ marginTop: "6px", fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
