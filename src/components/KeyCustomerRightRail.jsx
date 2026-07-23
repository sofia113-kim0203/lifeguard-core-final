import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: C.overviewClampLines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
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
        className="lg-v31-rail"
        style={{
          width: "48px",
          minWidth: "48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "8px 0",
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
        className="lg-v31-rail-scroll"
        style={{
          flex: 1,
          overflowY: "visible",
          padding: `${C.railInnerPadPx}px`,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <Block tone="money" title="돈의 흐름" dot={C.sky}>
          <MoneyRow label="심사 중 청구" value={reviewing > 0 ? `${reviewing}건` : "없음"} />
          <MoneyRow label="올해 받은 보험금" value={money.yearPaidDisplay || "집계 전"} />
        </Block>

        <Block tone="schedule" title="다가오는 날짜" dot={C.amber}>
          {schedules.length > 0 ? (
            <>
              {schedules.slice(0, 1).map((s) => (
                <div key={s.id} style={{ fontSize: "12px", lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 700, color: C.text, ...clamp2 }}>{s.title}</div>
                  <div style={{ color: C.muted, marginTop: "1px" }}>{s.dueAt || s.dLabel || ""}</div>
                </div>
              ))}
              {schedules.length > 1 ? (
                <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
                  외 {schedules.length - 1}건 · 상세에서 확인
                </div>
              ) : null}
            </>
          ) : (
            <EmptyLine primary="없음" secondary="일정이 생기면 여기" />
          )}
        </Block>

        <Block tone="activity" title="최근 활동과 증거" dot={C.teal}>
          {activities.length > 0 ? (
            <>
              {activities.slice(0, 1).map((a) => (
                <div key={a.id} style={{ fontSize: "12px", lineHeight: 1.35, color: C.text, ...clamp2 }}>
                  {a.when ? `${a.when} · ` : ""}
                  {a.title}
                </div>
              ))}
              {activities.length > 1 ? (
                <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
                  외 {activities.length - 1}건 · 상세에서 확인
                </div>
              ) : null}
            </>
          ) : (
            <EmptyLine primary="아직 기록 없음" />
          )}
        </Block>

        <Block tone="goal" title="KEY가 기억한 목표" dot={C.navy}>
          {goals.length > 0 ? (
            <>
              {goals.slice(0, 1).map((g) => (
                <div
                  key={g.id}
                  style={{ fontSize: "12px", lineHeight: 1.4, color: C.text, ...clamp2 }}
                >
                  “{g.text}”
                </div>
              ))}
              {goals.length > 1 ? (
                <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
                  외 {goals.length - 1}건 · 상세에서 확인
                </div>
              ) : null}
            </>
          ) : (
            <EmptyLine primary="아직 기록 없음" />
          )}
        </Block>

        <Block tone="result" title="지급·거절 결과" dot={C.coral}>
          {results.length > 0 ? (
            <>
              {results.slice(0, 1).map((r) => (
                <div key={r.id}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, ...clamp2 }}>
                    {r.title}
                  </div>
                  {r.reason ? (
                    <div
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        marginTop: "2px",
                        lineHeight: 1.35,
                        ...clamp2,
                      }}
                    >
                      {r.reason}
                    </div>
                  ) : null}
                </div>
              ))}
              {results.length > 1 ? (
                <div style={{ marginTop: "3px", fontSize: "12px", color: C.muted }}>
                  외 {results.length - 1}건 · 상세에서 확인
                </div>
              ) : null}
            </>
          ) : (
            <EmptyLine primary="없음" secondary="결과가 오면 이유와 함께" />
          )}
        </Block>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "4px 8px 6px", borderTop: "1px solid rgba(18,50,95,0.06)" }}>
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
  width: "28px",
  height: "28px",
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
        borderRadius: "14px",
        padding: `${C.cardPadY}px ${C.cardPadX}px`,
      }}
    >
      <div
        style={{
          margin: `0 0 ${C.cardHeadGapPx}px`,
          fontSize: "12px",
          fontWeight: 800,
          color: C.navy,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            width: "7px",
            height: "7px",
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
        padding: "2px 0",
        borderBottom: "1px solid rgba(59,130,196,0.12)",
        fontSize: "12px",
      }}
    >
      <span style={{ color: C.text }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: 700, color: C.muted }}>{value}</span>
    </div>
  );
}

function EmptyLine({ primary, secondary = null }) {
  return (
    <div>
      <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.35 }}>{primary}</div>
      {secondary ? (
        <div style={{ marginTop: "2px", fontSize: "12px", color: C.muted, lineHeight: 1.35 }}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
