import KeyClaimProgress from "./KeyClaimProgress.jsx";
import KeyDiagnosisCoverageSummary from "./KeyDiagnosisCoverageSummary.jsx";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: C.overviewClampLines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
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
          aria-label="좌측 패널 펼치기"
          onClick={onToggleCollapse}
          style={iconBtnStyle}
        >
          ›
        </button>
      </aside>
    );
  }

  const metrics = Array.isArray(shell?.coreMetrics) ? shell.coreMetrics.slice(0, 3) : [];
  const diagnosis = Array.isArray(shell?.diagnosis) ? shell.diagnosis : [];
  const gap = shell?.coverageGap || null;
  const familyHint =
    String(shell?.familyMemory?.hint || "").trim() || "기억한 가족 · 아직 기록 없음";
  const familyCount = Number(shell?.familyMemory?.count);
  const notes = String(shell?.notesMemory?.text || "").trim() || "아직 기록 없음";
  const col = `${C.leftColPx}px`;

  return (
    <aside
      className="lg-v31-rail"
      aria-label="고객의 지금 상태"
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
          margin: `${C.heroPadPx}px ${Math.max(0, C.leftColPx - C.heroX - C.heroW)}px 0 ${C.heroX}px`,
          width: `${C.heroW}px`,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          borderRadius: "14px",
          background: C.heroGradient,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", opacity: 0.85 }}>
          KEY가 곁에서 보는 것
        </div>
        <div
          style={{
            marginTop: "3px",
            fontFamily: C.gothic,
            fontSize: `${C.heroTitleSize}px`,
            fontWeight: 700,
            lineHeight: `${C.heroTitleLine}px`,
          }}
        >
          보장 · 일상 · 지금 · 필요한 일
        </div>
      </div>

      <div
        className="lg-v31-rail-scroll"
        style={{
          flex: 1,
          overflowY: "visible",
          minHeight: 0,
          padding: `${C.railInnerPadPx}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${C.railStackGapPx}px`,
        }}
      >
        <div style={whiteCard}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "999px",
                background: `linear-gradient(145deg, ${C.navy}, ${C.teal})`,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: "12px",
                flexShrink: 0,
              }}
            >
              고
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: C.text }}>고객님</div>
              <div
                style={{
                  fontSize: "12px",
                  color: C.muted,
                  marginTop: "1px",
                  lineHeight: 1.35,
                  ...clamp2,
                }}
              >
                {familyHint}
              </div>
            </div>
          </div>
        </div>

        <div style={whiteCard}>
          <KeyClaimProgress claimProgress={shell?.claimProgress || null} embedded overview />
        </div>

        <div style={whiteCard}>
          <div style={secK}>가입 보험 핵심 요약</div>
          <div style={{ display: "grid", gap: "3px" }}>
            {metrics.length > 0 ? (
              metrics.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "6px",
                    fontSize: "12px",
                    lineHeight: 1.35,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: m.tone === "warn" ? C.coral : C.text,
                      minWidth: 0,
                      ...clamp2,
                    }}
                  >
                    {m.pending ? `${m.title} · 확인 전` : m.title}
                  </span>
                  {m.sub ? (
                    <span style={{ color: C.muted, flexShrink: 0, fontSize: "12px" }}>{m.sub}</span>
                  ) : null}
                </div>
              ))
            ) : (
              <div style={{ fontSize: "12px", color: C.muted }}>확인 전</div>
            )}
          </div>
        </div>

        <div
          style={{
            borderRadius: "14px",
            padding: `${C.cardPadY}px ${C.cardPadX}px`,
            background: C.tealSoft,
          }}
        >
          <KeyDiagnosisCoverageSummary
            diagnosis={diagnosis}
            onOpenDetail={onOpenDiagnosisDetail}
            embedded
            overview
          />
        </div>

        <div
          style={{
            borderRadius: "14px",
            padding: `${C.cardPadY}px ${C.cardPadX}px`,
            background: C.coralSoft,
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.03em",
              color: C.coral,
              marginBottom: "2px",
            }}
          >
            보장 공백
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.3, color: C.text }}>
            {gap?.pending === false && gap?.title ? gap.title : "확인 전"}
          </div>
          <div style={{ marginTop: "2px", fontSize: "12px", color: C.muted, lineHeight: 1.35, ...clamp2 }}>
            {gap?.sub || "확인된 공백이 생기면 여기에 모읍니다"}
          </div>
        </div>

        <div style={whiteCard}>
          <div style={secK}>알아둔 것</div>
          <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.35, ...clamp2 }}>{notes}</div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "2px 8px",
            padding: "0",
            marginTop: "auto",
          }}
        >
          <NavBtn
            label="가족"
            count={Number.isFinite(familyCount) ? familyCount : 0}
            onClick={onOpenFamily}
          />
          <NavBtn label="지난 상담" onClick={onOpenSessions} />
          <NavBtn label="내 자료 금고" onClick={onOpenVault} />
        </div>
      </div>

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "4px 8px 6px" }}>
          <button type="button" aria-label="좌측 패널 접기" onClick={onToggleCollapse} style={iconBtnStyle}>
            ‹
          </button>
        </div>
      ) : null}
    </aside>
  );
}

const whiteCard = {
  background: C.surface,
  borderRadius: "14px",
  padding: `${C.cardPadY}px ${C.cardPadX}px`,
};

const secK = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.03em",
  color: C.muted,
  marginBottom: `${C.sectionKMbPx}px`,
};

const iconBtnStyle = {
  width: "28px",
  height: "28px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  cursor: "pointer",
  color: C.muted,
};

function NavBtn({ label, onClick, count = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        textAlign: "left",
        padding: "4px 2px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 650,
        color: C.text,
        cursor: typeof onClick === "function" ? "pointer" : "default",
        fontFamily: C.sans,
      }}
    >
      {label}
      {count != null ? (
        <span
          style={{
            display: "inline-flex",
            minWidth: "16px",
            height: "16px",
            marginLeft: "4px",
            padding: "0 4px",
            borderRadius: "999px",
            background: C.skySoft,
            color: C.sky,
            fontSize: "10px",
            fontWeight: 800,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
