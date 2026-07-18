/**
 * Left rail — my insurance status (verified customer data only, no separate API).
 * Visual scale aligned to KEY ROOM target (300px rail, larger type/cards).
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
        fontSize: "12px",
        fontWeight: 700,
        padding: "5px 10px",
        borderRadius: "999px",
        color: confirmed ? LG.verified : LG.needs,
        background: confirmed ? LG.verifiedBg : LG.needsBg,
        lineHeight: 1.2,
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
  onSelectPolicy = null,
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
        width: "245px",
        maxWidth: "245px",
        flexShrink: 0,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "14px 12px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: "6px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "15px",
              fontWeight: 750,
              color: LG.navy,
              fontFamily: LG.sans,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "9px",
                background: LG.accentSoft,
                color: LG.accent,
                display: "grid",
                placeItems: "center",
                fontSize: "13px",
                fontWeight: 750,
              }}
            >
              保
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
                fontSize: "20px",
                lineHeight: 1,
                padding: "2px 4px",
              }}
            >
              {"\u2715"}
            </button>
          ) : null}
        </div>
        {loading ? (
          <p style={{ margin: 0, fontSize: "14px", color: LG.textMuted }}>불러오는 중…</p>
        ) : (
          <p style={{ margin: 0, fontSize: "14px", color: LG.textMuted, lineHeight: 1.5 }}>
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

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 12px",
            marginBottom: "10px",
            borderRadius: "14px",
            background: LG.surface,
            border: `1px solid ${LG.border}`,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "999px",
              background: LG.navy,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: "15px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {monogram}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: "16px", color: LG.navy }}>{nameLabel}님</div>
            <div style={{ fontSize: "13px", color: LG.textSoft, marginTop: "3px" }}>
              KEY가 현재 확인한 계약 기준
            </div>
          </div>
        </div>

        {!loading && status.totalCount === 0 ? (
          <p style={{ margin: "4px 2px 14px", fontSize: "14px", color: LG.textMuted, lineHeight: 1.55 }}>
            아직 확인된 보험이 없어요. 서류를 올리면 KEY가 확인합니다.
          </p>
        ) : null}

        {status.policies.map((row) => {
          const premium = formatWonMonthly(row.monthly_premium);
          const confirmed = row.status === "확인됨";
          const clickable = typeof onSelectPolicy === "function";
          return (
            <div
              key={row.id || `${row.insurer_name}-${row.product_name}`}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onSelectPolicy(row) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPolicy(row);
                      }
                    }
                  : undefined
              }
              style={{
                borderRadius: "14px",
                padding: "12px 12px",
                background: LG.surface,
                marginBottom: "8px",
                border: `1px solid ${LG.border}`,
                minHeight: "72px",
                cursor: clickable ? "pointer" : "default",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 750,
                      fontSize: "14px",
                      color: LG.navy,
                      marginBottom: "3px",
                      lineHeight: 1.3,
                    }}
                  >
                    {row.insurer_name ?? "보험사 미확인"}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: row.product_name ? LG.textMuted : LG.needs,
                      lineHeight: 1.35,
                      marginBottom: "8px",
                    }}
                  >
                    {row.product_name || "상품명 확인 필요"}
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 750,
                      color: premium ? LG.navy : LG.needs,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {premium || "월 보험료 확인 필요"}
                  </div>
                </div>
                <StatusTag confirmed={confirmed} />
              </div>
            </div>
          );
        })}

        <div
          style={{
            marginTop: "10px",
            padding: "18px 16px 16px",
            borderRadius: "18px",
            background: LG.summaryBg,
            border: `1px solid ${LG.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "999px",
                background: LG.accentSoft,
                color: LG.accent,
                display: "grid",
                placeItems: "center",
                fontSize: "15px",
                fontWeight: 700,
              }}
            >
              ₩
            </span>
            <div style={{ fontSize: "14px", color: LG.textMuted }}>현재 월 보험료 확인분</div>
          </div>
          <div
            style={{
              fontSize: "26px",
              fontWeight: 750,
              color: LG.navy,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
            }}
          >
            {confirmedPremium != null
              ? `${Math.round(confirmedPremium).toLocaleString("ko-KR")} 원`
              : "확인 필요"}
          </div>
          <div style={{ marginTop: "10px", fontSize: "13px", color: LG.textSoft }}>
            확인된 보험료만 합산합니다
          </div>
        </div>

        {!loading ? (
          <div style={{ marginTop: "14px", padding: "0 2px" }}>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: LG.textSoft,
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
                fontSize: "13px",
                fontWeight: 650,
                padding: 0,
                fontFamily: LG.sans,
              }}
            >
              {guidanceOpen ? "접기" : "자세히"}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
