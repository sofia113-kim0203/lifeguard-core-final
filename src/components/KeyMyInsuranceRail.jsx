/**
 * Left rail — my insurance status (verified customer data only, no separate API).
 */
import { useState } from "react";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import {
  KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL,
  KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT,
  buildMyInsuranceStatus,
  formatWonMonthly,
  sumConfirmedMonthlyPremium,
} from "../lib/keyInsuranceScreenFacts.js";

function StatusTag({ confirmed }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "11px",
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: "999px",
        color: confirmed ? LG.verified : LG.needs,
        background: confirmed ? "rgba(37, 99, 235, 0.08)" : "rgba(217, 119, 6, 0.10)",
      }}
    >
      {confirmed ? "확인됨" : "확인 필요"}
    </span>
  );
}

export default function KeyMyInsuranceRail({
  policies = [],
  loading = false,
  displayName = "고객",
  style = {},
  onClose = null,
}) {
  const status = buildMyInsuranceStatus(policies);
  const confirmedPremium = sumConfirmedMonthlyPremium(status.policies);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const nameLabel = String(displayName || "고객").trim() || "고객";
  const monogram = nameLabel.slice(0, 1);

  return (
    <aside
      aria-label="나의 보험 현황"
      style={{
        width: "100%",
        maxWidth: "300px",
        flexShrink: 0,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "18px 16px 10px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontFamily: LG.serif,
              fontSize: "16px",
              fontWeight: 600,
              color: LG.navy,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: "15px" }}>
              {"\uD83D\uDEE1"}
            </span>
            나의 보험 현황
          </div>
          {typeof onClose === "function" ? (
            <button
              type="button"
              aria-label="나의 보험 닫기"
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                color: LG.textSoft,
                cursor: "pointer",
                fontSize: "18px",
                lineHeight: 1,
                padding: "2px 4px",
              }}
            >
              {"\u2715"}
            </button>
          ) : null}
        </div>
        {loading ? (
          <p style={{ margin: 0, fontSize: "13px", color: LG.textMuted }}>불러오는 중…</p>
        ) : (
          <p style={{ margin: 0, fontSize: "13px", color: LG.textMuted, lineHeight: 1.5 }}>
            확인된 계약{" "}
            <strong style={{ color: LG.verified }}>{status.confirmedCount}</strong>건
            {" / "}
            확인 필요{" "}
            <strong style={{ color: status.needsCount ? LG.needs : LG.textMuted }}>
              {status.needsCount}
            </strong>
            건
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px",
            marginBottom: "12px",
            borderRadius: "14px",
            background: LG.surface,
            border: `1px solid ${LG.border}`,
            boxShadow: LG.shadow,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "999px",
              background: LG.navy,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: "14px",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {monogram}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "14px", color: LG.navy }}>{nameLabel}님</div>
            <div style={{ fontSize: "12px", color: LG.textSoft, marginTop: "2px" }}>
              KEY가 현재 확인한 계약 기준
            </div>
          </div>
        </div>

        {!loading && status.totalCount === 0 ? (
          <p style={{ margin: "4px 4px 12px", fontSize: "13px", color: LG.textMuted, lineHeight: 1.55 }}>
            아직 확인된 보험이 없어요. 서류를 올리면 KEY가 확인합니다.
          </p>
        ) : null}

        {status.policies.map((row) => {
          const premium = formatWonMonthly(row.monthly_premium);
          const confirmed = row.status === "확인됨";
          return (
            <div
              key={row.id || `${row.insurer_name}-${row.product_name}`}
              style={{
                border: `1px solid ${LG.border}`,
                borderRadius: "14px",
                padding: "14px",
                background: LG.surface,
                marginBottom: "10px",
                boxShadow: LG.shadow,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <div style={{ fontWeight: 650, fontSize: "14px", color: LG.navy, minWidth: 0 }}>
                  {row.insurer_name ?? "보험사 미확인"}
                </div>
                <StatusTag confirmed={confirmed} />
              </div>
              {row.product_name ? (
                <div style={{ fontSize: "13px", color: LG.textMuted, marginBottom: "8px", lineHeight: 1.4 }}>
                  {row.product_name}
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: LG.needs, marginBottom: "8px" }}>상품명 확인 필요</div>
              )}
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: premium ? 600 : 500,
                  color: premium ? LG.navy : LG.needs,
                }}
              >
                {premium || "월 보험료 확인 필요"}
              </div>
            </div>
          );
        })}

        {!loading ? (
          <div
            style={{
              marginTop: "4px",
              marginBottom: "12px",
              padding: "12px",
              borderRadius: "12px",
              background: "rgba(26, 43, 75, 0.03)",
              border: `1px solid ${LG.border}`,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: LG.textMuted,
                lineHeight: 1.55,
                whiteSpace: "pre-line",
              }}
            >
              {guidanceOpen ? KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL : KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT}
            </p>
            <button
              type="button"
              onClick={() => setGuidanceOpen((open) => !open)}
              style={{
                marginTop: "8px",
                border: "none",
                background: "transparent",
                color: LG.accent,
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                padding: 0,
                fontFamily: LG.sans,
              }}
            >
              {guidanceOpen ? "접기" : "자세히"}
            </button>
          </div>
        ) : null}

        <div
          style={{
            marginTop: "4px",
            padding: "14px",
            borderRadius: "14px",
            background: "rgba(59, 130, 246, 0.08)",
            border: "1px solid rgba(59, 130, 246, 0.18)",
          }}
        >
          <div style={{ fontSize: "12px", color: LG.textMuted, marginBottom: "6px" }}>
            현재 월 보험료 확인분
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: LG.navy, letterSpacing: "-0.02em" }}>
            {confirmedPremium != null
              ? `${Math.round(confirmedPremium).toLocaleString("ko-KR")} 원`
              : "확인 필요"}
          </div>
          <div style={{ marginTop: "8px", fontSize: "11px", color: LG.textSoft }}>
            확인된 보험료만 합산합니다
          </div>
        </div>
      </div>
    </aside>
  );
}
