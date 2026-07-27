import { useCallback, useEffect, useRef, useState } from "react";
import KeyClaimProgress from "./KeyClaimProgress.jsx";
import KeyDiagnosisCoverageSummary from "./KeyDiagnosisCoverageSummary.jsx";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;
const RAIL_BOTTOM_EPS_PX = 8;

/** Shared: show sticky “more below” when a rail scrollport has overflow and is not at bottom. */
export function useRailOverflowMore(scrollRef, contentKey = "") {
  const [showMoreBelow, setShowMoreBelow] = useState(false);

  const refreshMoreBelow = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) {
      setShowMoreBelow(false);
      return;
    }
    const scrollHeight = Number(el.scrollHeight) || 0;
    const clientHeight = Number(el.clientHeight) || 0;
    const scrollTop = Number(el.scrollTop) || 0;
    const hasOverflow = scrollHeight > clientHeight + 1;
    const distance = scrollHeight - scrollTop - clientHeight;
    setShowMoreBelow(hasOverflow && distance > RAIL_BOTTOM_EPS_PX);
  }, [scrollRef]);

  useEffect(() => {
    refreshMoreBelow();
    const el = scrollRef?.current;
    if (!el || typeof ResizeObserver === "undefined") {
      if (typeof window !== "undefined") {
        window.addEventListener("resize", refreshMoreBelow);
        return () => window.removeEventListener("resize", refreshMoreBelow);
      }
      return undefined;
    }
    const ro = new ResizeObserver(() => refreshMoreBelow());
    ro.observe(el);
    window.addEventListener("resize", refreshMoreBelow);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refreshMoreBelow);
    };
  }, [refreshMoreBelow, scrollRef, contentKey]);

  return { showMoreBelow, refreshMoreBelow };
}

/** Lightweight sticky rail affordance — does not move chat or the other rail. */
export function RailMoreBelowHint({ scrollRef, show }) {
  if (!show) return null;
  return (
    <div
      style={{
        flexShrink: 0,
        position: "relative",
        padding: "0 10px 6px",
        background: "linear-gradient(180deg, rgba(243,246,251,0) 0%, rgba(243,246,251,0.92) 36%, rgba(243,246,251,0.98) 100%)",
      }}
    >
      <button
        type="button"
        aria-label="아래 내용 더 보기"
        onClick={() => {
          const el = scrollRef?.current;
          if (!el) return;
          const step = Math.max(80, Math.round(el.clientHeight * 0.8));
          if (typeof el.scrollBy === "function") {
            el.scrollBy({ top: step, behavior: "smooth" });
          } else {
            el.scrollTop = Math.min(
              el.scrollHeight - el.clientHeight,
              (Number(el.scrollTop) || 0) + step,
            );
          }
        }}
        style={{
          width: "100%",
          border: `1px solid ${C.line}`,
          borderRadius: "999px",
          background: "rgba(255,255,255,0.88)",
          color: C.muted,
          fontSize: "12px",
          fontWeight: 700,
          fontFamily: C.sans,
          lineHeight: 1.3,
          padding: "7px 12px",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(18, 50, 95, 0.06)",
        }}
      >
        아래 내용 더 있어요 ↓
      </button>
    </div>
  );
}

/** Left rail — hero + core insurance summary only (aux cards live on the right). */
export default function KeyCustomerLeftRail({
  shell = null,
  displayName = null,
  collapsed = false,
  onToggleCollapse = null,
  onOpenDiagnosisDetail = null,
  style = null,
}) {
  const scrollRef = useRef(null);
  const metrics = Array.isArray(shell?.coreMetrics) ? shell.coreMetrics : [];
  const diagnosis = Array.isArray(shell?.diagnosis) ? shell.diagnosis : [];
  const contentKey = collapsed
    ? "collapsed"
    : `${metrics.length}:${diagnosis.length}:${String(shell?.claimProgress?.status || "")}`;
  const { showMoreBelow, refreshMoreBelow } = useRailOverflowMore(scrollRef, contentKey);

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

  const customerDisplayName = String(displayName || "").trim() || "고객";
  const nameInitial = customerDisplayName.slice(0, 1) || "고";
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
        boxSizing: "border-box",
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
        ref={scrollRef}
        onScroll={refreshMoreBelow}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
          padding: `${C.railInnerPadPx}px`,
          paddingBottom: showMoreBelow ? "10px" : `${C.railInnerPadPx}px`,
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
              {nameInitial}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: C.text }}>
                {customerDisplayName}님
              </div>
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "3px", lineHeight: 1.4 }}>
                내 보험 주치의 KEY
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
      </div>

      <RailMoreBelowHint scrollRef={scrollRef} show={showMoreBelow} />

      {typeof onToggleCollapse === "function" ? (
        <div style={{ padding: "8px 12px 12px", flexShrink: 0 }}>
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
