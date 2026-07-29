/** Claim progress stepper — verified Claim Guardian rows only; empty keeps V3.1 slot. */

import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

const EMPTY_STEPS = [
  { key: "prep", label: "준비" },
  { key: "docs", label: "서류검토" },
  { key: "filed", label: "접수" },
  { key: "review", label: "심사중" },
  { key: "paid", label: "지급완료" },
];

export default function KeyClaimProgress({
  claimProgress = null,
  embedded = false,
  overview = false,
}) {
  const mode = String(claimProgress?.mode || "");
  const isCandidate =
    mode === "candidate" ||
    (Number(claimProgress?.candidateCount) > 0 &&
      !(Number(claimProgress?.activeCount) > 0) &&
      (!Array.isArray(claimProgress?.steps) || claimProgress.steps.length === 0));
  const empty =
    !claimProgress ||
    claimProgress.empty === true ||
    ((!Array.isArray(claimProgress.steps) || claimProgress.steps.length === 0) &&
      !isCandidate);

  const pad = embedded
    ? { padding: "0" }
    : { padding: "14px 16px 12px", borderBottom: `1px solid ${C.line}` };
  const titleMb = overview ? "4px" : "8px";
  const gridMb = overview ? "4px" : "8px";

  if (isCandidate && !empty) {
    const candidateCount = Number(claimProgress.candidateCount) || 1;
    return (
      <section style={pad}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <div
            style={{
              fontSize: `${C.bodySize}px`,
              fontWeight: 700,
              color: C.text,
              fontFamily: C.sans,
            }}
          >
            확인 필요
          </div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: C.muted,
              background: C.barTrack,
              borderRadius: "999px",
              padding: "2px 8px",
            }}
          >
            후보 {candidateCount}건
          </span>
        </div>
        <div
          style={{
            fontSize: "12px",
            color: C.muted,
            fontFamily: C.sans,
            lineHeight: 1.4,
          }}
        >
          보험사에 접수된 청구는 아닙니다. 사실 확인이 필요한 후보입니다.
        </div>
      </section>
    );
  }

  if (empty) {
    return (
      <section style={pad}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 800,
            letterSpacing: "0.03em",
            color: C.muted,
            marginBottom: titleMb,
            fontFamily: C.sans,
          }}
        >
          진행 중인 청구
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "4px",
            marginBottom: gridMb,
          }}
        >
          {EMPTY_STEPS.map((step, i) => (
            <div key={step.key} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  margin: "0 auto 4px",
                  borderRadius: "999px",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "10px",
                  fontWeight: 800,
                  background: C.barTrack,
                  color: C.muted,
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: "10px", color: C.muted, fontWeight: 600 }}>{step.label}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            fontSize: "12px",
            color: C.muted,
            fontFamily: C.sans,
            lineHeight: 1.35,
          }}
        >
          진행 중인 청구 없음
        </div>
      </section>
    );
  }

  const count = Number(claimProgress.activeCount) || 1;
  return (
    <section style={pad}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <div
          style={{
            fontSize: `${C.bodySize}px`,
            fontWeight: 700,
            color: C.text,
            fontFamily: C.sans,
          }}
        >
          청구 진행 현황
        </div>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: C.teal,
            background: C.tealSoft,
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
                  color: done || current ? C.surface : C.muted,
                  background: done || current ? C.teal : C.surface,
                  border: current
                    ? `2px solid ${C.teal}`
                    : done
                      ? `2px solid ${C.teal}`
                      : `2px solid ${C.line}`,
                  boxShadow: current ? `0 0 0 3px ${C.tealSoft}` : "none",
                }}
              >
                {done ? "✓" : current ? "●" : ""}
              </div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: current ? 800 : 600,
                  color: current || done ? C.teal : C.muted,
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
