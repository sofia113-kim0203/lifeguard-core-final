/**
 * Local visual seat that mirrors LifeguardHomeChat room chrome
 * (same rails, drawer, layout tokens) for 1600×900 captures — no API/Claude.
 */
import { useMemo, useState } from "react";
import KeyMyInsuranceRail from "./KeyMyInsuranceRail.jsx";
import KeyCoverageBaselineRail from "./KeyCoverageBaselineRail.jsx";
import KeyInsuranceDetailDrawer from "./KeyInsuranceDetailDrawer.jsx";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  buildBaselineDetailForDrawer,
  buildIndustryCoverageBaseline,
  buildPolicyDetailForDrawer,
} from "../lib/keyInsuranceScreenFacts.js";

const VERIFIED_SEAT_POLICIES = [
  {
    id: "v1",
    insurer_name: "KB손해보험",
    product_name: "KB 금쪽같은 자녀보험",
    monthly_premium: 42860,
    coverage_summary: {
      rider_details: [
        { rider_name: "암진단비", coverage_amount: 50000000 },
        { rider_name: "뇌출혈 진단비", coverage_amount: 10000000 },
      ],
    },
  },
  {
    id: "v2",
    insurer_name: "한화생명",
    product_name: "LIFEPLUS 심플한 종신보험",
    monthly_premium: 73000,
    coverage_summary: {
      rider_details: [{ rider_name: "암진단비", coverage_amount: 30000000 }],
    },
  },
  {
    id: "v3",
    insurer_name: "DB손해보험",
    product_name: null,
    monthly_premium: null,
  },
];

function headerToggleBtn(active) {
  return {
    border: `1px solid ${active ? LG.accent : LG.border}`,
    background: active ? LG.accentSoft : LG.surface,
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
  const [baselineOpen, setBaselineOpen] = useState(true);
  const [detail, setDetail] = useState(null);
  const baseline = useMemo(() => buildIndustryCoverageBaseline(VERIFIED_SEAT_POLICIES), []);
  const columns = "245px minmax(780px, 1fr) 280px";

  return (
    <div style={{ minHeight: "100vh", background: LG.bg, padding: "16px", fontFamily: LG.sans }}>
      <div
        data-lifeguard-home-chat="1"
        data-key-room-visual-seat="1"
        style={{
          width: "100%",
          maxWidth: 1600,
          margin: "0 auto",
          height: 900,
          background: LG.bg,
          borderRadius: "16px",
          overflow: "hidden",
          border: `1px solid ${LG.border}`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: "10px",
            padding: "14px 20px 12px",
            height: "82px",
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px", color: LG.navy }}>☰</span>
            <span style={{ fontFamily: LG.serif, fontWeight: 600, color: LG.navy, fontSize: "16px" }}>
              LIFEGUARD
            </span>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: LG.serif,
                fontSize: "28px",
                fontWeight: 650,
                color: LG.navy,
                letterSpacing: "0.04em",
                lineHeight: 1.05,
              }}
            >
              LIFEGUARD
            </div>
            <div style={{ fontSize: "13px", color: LG.textMuted, marginTop: "2px" }}>보험 AI KEY</div>
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button type="button" style={headerToggleBtn(insuranceOpen)} onClick={() => setInsuranceOpen((v) => !v)}>
              나의 보험
            </button>
            <button type="button" style={headerToggleBtn(baselineOpen)} onClick={() => setBaselineOpen((v) => !v)}>
              기준선
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: columns,
            gap: "12px",
            padding: "0 16px 14px",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {insuranceOpen ? (
            <KeyMyInsuranceRail
              policies={VERIFIED_SEAT_POLICIES}
              displayName="진우"
              onSelectPolicy={(row) => {
                const full = VERIFIED_SEAT_POLICIES.find((p) => p.id === row.id);
                setDetail(buildPolicyDetailForDrawer(full || row));
              }}
              style={{
                width: "245px",
                maxWidth: "245px",
                borderRadius: "16px",
                border: `1px solid ${LG.border}`,
                background: LG.bg,
              }}
            />
          ) : null}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              borderRadius: "16px",
              border: `1px solid ${LG.border}`,
              background: LG.bg,
            }}
          >
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "28px 24px 16px",
                maxWidth: "920px",
                width: "100%",
                margin: "0 auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <div
                  style={{
                    maxWidth: "72%",
                    background: LG.userBubble,
                    borderRadius: "18px 18px 6px 18px",
                    padding: "12px 16px",
                    color: LG.navy,
                    fontSize: "16px",
                    lineHeight: 1.7,
                    border: `1px solid ${LG.border}`,
                  }}
                >
                  내 암 보장은 어때?
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "999px",
                    background: LG.navy,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  K
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: LG.navy, marginBottom: "8px" }}>KEY</div>
                  <div
                    style={{
                      fontSize: "16px",
                      lineHeight: 1.7,
                      color: LG.text,
                      background: LG.assistantBubble,
                      borderRadius: "6px 18px 18px 18px",
                      padding: "14px 16px",
                      border: `1px solid ${LG.border}`,
                    }}
                  >
                    확인된 계약 기준으로 암진단비 합산이 보입니다. 오른쪽 기준선은 업계 자료가 채워지기 전에는 「기준 확인
                    중」으로만 표시됩니다. 뇌출혈만 확인된 금액은 뇌혈관질환 기준에 넣지 않습니다.
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: "12px 24px 20px", maxWidth: "920px", width: "100%", margin: "0 auto" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 16px",
                  borderRadius: "999px",
                  border: `1px solid ${LG.border}`,
                  background: LG.surface,
                  color: LG.textMuted,
                  fontSize: "16px",
                }}
              >
                <span>+</span>
                <span style={{ flex: 1 }}>무엇이든 편하게 말씀해 주세요.</span>
                <span
                  style={{
                    width: "40px",
                    height: "40px",
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

          {baselineOpen ? (
            <KeyCoverageBaselineRail
              baseline={baseline}
              onSelectItem={(item) => setDetail(buildBaselineDetailForDrawer(item))}
              style={{
                width: "280px",
                maxWidth: "280px",
                borderRadius: "16px",
                border: `1px solid ${LG.border}`,
                background: LG.bg,
              }}
            />
          ) : null}
        </div>
      </div>
      <KeyInsuranceDetailDrawer detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

export function isLocalKeyRoomVisualSeat() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  return new URLSearchParams(window.location.search).get("key-room-seat") === "1";
}
