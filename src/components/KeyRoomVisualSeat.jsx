/**
 * Local visual seat for KEY ROOM layout captures.
 * Reuses production rails + theme only — no API / Claude / second KEY.
 * Host must be localhost / 127.0.0.1.
 */
import { useMemo, useState } from "react";
import KeyMyInsuranceRail from "./KeyMyInsuranceRail.jsx";
import KeyTurnMirrorRail from "./KeyTurnMirrorRail.jsx";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { buildKeyTurnMirror } from "../lib/keyInsuranceScreenFacts.js";

const MOCK_POLICIES = [
  {
    id: "v1",
    insurer_name: "KB손해보험",
    product_name: "KB 금쪽같은 자녀보험",
    monthly_premium: 42860,
  },
  {
    id: "v2",
    insurer_name: "한화생명",
    product_name: "LIFEPLUS 심플한 종신보험",
    monthly_premium: 73000,
  },
];

const MOCK_ANSWER =
  "확인된 계약은 현재 2건입니다. KB손해보험과 한화생명 계약을 확인했습니다. " +
  "월 보험료는 확인된 금액 기준으로 정리해 드리겠습니다.";

function headerToggleBtn(active) {
  return {
    border: `1px solid ${active ? "rgba(37, 99, 235, 0.35)" : LG.border}`,
    background: active ? "rgba(37, 99, 235, 0.08)" : LG.surface,
    color: active ? LG.navy : LG.textMuted,
    borderRadius: "999px",
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    fontFamily: LG.sans,
  };
}

export default function KeyRoomVisualSeat() {
  const [insuranceOpen, setInsuranceOpen] = useState(true);
  const [mirrorOpen, setMirrorOpen] = useState(true);
  const [widthMode, setWidthMode] = useState("desktop");

  const mirror = useMemo(
    () =>
      buildKeyTurnMirror({
        answerText: MOCK_ANSWER,
        visualBlocks: [],
        policies: MOCK_POLICIES,
      }),
    [],
  );

  const frameWidth = widthMode === "mobile" ? 390 : widthMode === "mid" ? 900 : 1440;
  const showInsuranceInline = insuranceOpen && widthMode !== "mobile";
  const showMirrorInline = mirrorOpen && widthMode === "desktop" && !mirror.empty;
  const columns = showMirrorInline
    ? "300px minmax(0, 1fr) 340px"
    : showInsuranceInline
      ? "300px minmax(0, 1fr)"
      : "minmax(0, 1fr)";

  return (
    <div style={{ minHeight: "100vh", background: "#E8E6E1", padding: "16px", fontFamily: LG.sans }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {[
          ["desktop", "데스크톱"],
          ["mid", "중간"],
          ["mobile", "모바일"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setWidthMode(id)}
            style={headerToggleBtn(widthMode === id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        data-key-room-visual-seat="1"
        style={{
          width: "100%",
          maxWidth: frameWidth,
          margin: "0 auto",
          height: "860px",
          background: LG.bg,
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: LG.shadowSoft,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px", color: LG.navy }}>☰</span>
            <span style={{ fontFamily: LG.serif, fontWeight: 600, color: LG.navy }}>LIFEGUARD</span>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: LG.serif,
                fontSize: "26px",
                fontWeight: 650,
                color: LG.navy,
                letterSpacing: "0.04em",
              }}
            >
              LIFEGUARD
            </div>
            <div style={{ fontSize: "12px", color: LG.textMuted }}>보험 AI KEY</div>
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              type="button"
              style={headerToggleBtn(insuranceOpen)}
              onClick={() => setInsuranceOpen((v) => !v)}
            >
              나의 보험
            </button>
            <button
              type="button"
              style={headerToggleBtn(mirrorOpen)}
              onClick={() => setMirrorOpen((v) => !v)}
            >
              KEY 확인
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: columns,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {showInsuranceInline ? (
            <KeyMyInsuranceRail
              policies={MOCK_POLICIES}
              displayName="진우"
              style={{ borderRight: `1px solid ${LG.border}`, maxWidth: "none", width: "100%" }}
            />
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", maxWidth: "820px", width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "14px" }}>
                <div
                  style={{
                    maxWidth: "72%",
                    background: LG.userBubble,
                    borderRadius: "18px 18px 6px 18px",
                    padding: "12px 16px",
                    color: LG.navy,
                    fontSize: "15px",
                  }}
                >
                  내보험 건수는?
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "999px",
                    background: LG.navy,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  K
                </div>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 650, color: LG.navy, marginBottom: "4px" }}>KEY</div>
                  <div style={{ fontSize: "15px", lineHeight: 1.75, color: LG.text }}>{MOCK_ANSWER}</div>
                </div>
              </div>
            </div>
            <div style={{ padding: "12px 20px 20px", maxWidth: "820px", width: "100%", margin: "0 auto" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "999px",
                  border: `1px solid ${LG.border}`,
                  background: LG.surface,
                  boxShadow: LG.shadowSoft,
                  color: LG.textSoft,
                  fontSize: "15px",
                }}
              >
                <span>+</span>
                <span style={{ flex: 1 }}>무엇이든 편하게 말씀해 주세요.</span>
                <span
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "999px",
                    background: LG.accent,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  ↑
                </span>
              </div>
            </div>
          </div>

          {showMirrorInline ? (
            <KeyTurnMirrorRail
              mirror={mirror}
              style={{ borderLeft: `1px solid ${LG.border}`, maxWidth: "none", width: "100%" }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function isLocalKeyRoomVisualSeat() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  return new URLSearchParams(window.location.search).get("key-room-seat") === "1";
}
