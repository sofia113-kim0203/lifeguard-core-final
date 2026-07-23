import KeyClaimProgress from "./KeyClaimProgress.jsx";
import KeyDiagnosisCoverageSummary from "./KeyDiagnosisCoverageSummary.jsx";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

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
          padding: "10px 0",
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

  const metrics = Array.isArray(shell?.coreMetrics) ? shell.coreMetrics : [];
  const diagnosis = Array.isArray(shell?.diagnosis) ? shell.diagnosis : [];
  const gap = shell?.coverageGap || null;
  const familyHint =
    String(shell?.familyMemory?.hint || "").trim() || "기억한 가족 · 아직 기록 없음";
  const familyCount = Number(shell?.familyMemory?.count);
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
          /* Below unified shell header — pad inside rail only (no second brand row) */
          margin: `${C.heroPadPx}px ${Math.max(0, C.leftColPx - C.heroX - C.heroW)}px 0 ${C.heroX}px`,
          width: `${C.heroW}px`,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: `${C.cardPadY}px ${C.cardPadX}px`,
          borderRadius: "16px",
          background: C.heroGradient,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "-20px",
            top: "-24px",
            width: "90px",
            height: "90px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.12)",
          }}
        />
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", opacity: 0.85 }}>
          KEY가 곁에서 보는 것
        </div>
        <div
          style={{
            marginTop: "6px",
            fontFamily: C.gothic,
            fontSize: `${C.heroTitleSize}px`,
            fontWeight: 700,
            lineHeight: `${C.heroTitleLine}px`,
          }}
        >
          보장 · 일상 · 지금
          <br />
          필요한 일까지
        </div>
        <div style={{ marginTop: "6px", fontSize: "12px", lineHeight: 1.5, opacity: 0.9 }}>
          청구만이 아니라, 고객님 보험 전체를 같이 봅니다
        </div>
        <div style={{ marginTop: "12px", display: "flex", gap: "6px" }} aria-hidden="true">
          <i style={pulseStyle("#FFD7A8")} />
          <i style={pulseStyle("rgba(255,255,255,0.55)")} />
          <i style={pulseStyle("rgba(255,255,255,0.55)")} />
          <i style={pulseStyle("rgba(255,255,255,0.25)")} />
        </div>
      </div>

      <div
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
          <div style={{ display: "flex", gap: "11px", alignItems: "center" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "999px",
                background: `linear-gradient(145deg, ${C.navy}, ${C.teal})`,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: "14px",
                flexShrink: 0,
              }}
            >
              고
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: C.text }}>고객님</div>
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "3px", lineHeight: 1.4 }}>
                {familyHint}
              </div>
            </div>
          </div>
        </div>

        <div style={whiteCard}>
          <KeyClaimProgress claimProgress={shell?.claimProgress || null} embedded />
        </div>

        <div style={whiteCard}>
          <div style={secK}>가입 보험 핵심 요약</div>
          <div style={{ display: "grid", gap: "6px" }}>
            {metrics.map((m) => (
              <div
                key={m.id}
                style={{
                  border: `1px solid ${C.line}`,
                  borderRadius: "12px",
                  padding: "9px 10px",
                  background: m.tone === "warn" ? C.warnSoft : "#fff",
                }}
              >
                <div
                  style={{
                    fontSize: `${C.leftValueSize}px`,
                    fontWeight: 700,
                    color: m.tone === "warn" ? C.coral : C.text,
                    lineHeight: 1.35,
                  }}
                >
                  {m.pending ? `${m.title} · 확인 전` : m.title}
                </div>
                {m.sub ? (
                  <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{m.sub}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            borderRadius: "16px",
            padding: `${C.cardPadY}px ${C.cardPadX}px`,
            background: C.tealSoft,
          }}
        >
          <KeyDiagnosisCoverageSummary
            diagnosis={diagnosis}
            onOpenDetail={onOpenDiagnosisDetail}
            embedded
          />
        </div>

        <div
          style={{
            borderRadius: "16px",
            padding: `${C.cardPadY}px ${C.cardPadX}px`,
            background: C.coralSoft,
          }}
        >
          <div
            style={{
              fontSize: `${C.sectionTitleSize}px`,
              fontWeight: 700,
              letterSpacing: "0.03em",
              color: C.coral,
              marginBottom: `${C.sectionKMbPx}px`,
            }}
          >
            보장 공백
          </div>
          <div style={{ fontSize: "14px", fontWeight: 700, lineHeight: 1.35, color: C.text }}>
            {gap?.pending === false && gap?.title ? gap.title : "확인 전"}
          </div>
          <div style={{ marginTop: "4px", fontSize: "12px", color: C.muted, lineHeight: 1.45 }}>
            {gap?.sub || "확인된 공백이 생기면 여기에 모읍니다"}
          </div>
        </div>

        <div style={whiteCard}>
          <div style={secK}>알아둔 것</div>
          <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.5 }}>
            {String(shell?.notesMemory?.text || "").trim() || "아직 기록 없음"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "2px 0" }}>
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
        <div style={{ padding: "8px 12px 12px" }}>
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
  borderRadius: "16px",
  padding: `${C.cardPadY}px ${C.cardPadX}px`,
};

const secK = {
  fontSize: `${C.sectionTitleSize}px`,
  fontWeight: 700,
  letterSpacing: "0.03em",
  color: C.muted,
  marginBottom: `${C.sectionKMbPx}px`,
};

const iconBtnStyle = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: `1px solid ${C.line}`,
  background: C.surface,
  cursor: "pointer",
  color: C.muted,
};

function pulseStyle(bg) {
  return { flex: 1, height: "5px", borderRadius: "999px", background: bg, display: "block" };
}

function NavBtn({ label, onClick, count = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        textAlign: "left",
        padding: "8px 8px",
        borderRadius: "10px",
        fontSize: `${C.bodySize}px`,
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
            minWidth: "18px",
            height: "18px",
            marginLeft: "6px",
            padding: "0 5px",
            borderRadius: "999px",
            background: C.skySoft,
            color: C.sky,
            fontSize: "11px",
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
