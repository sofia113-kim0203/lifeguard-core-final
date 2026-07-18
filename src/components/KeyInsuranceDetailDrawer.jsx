/**
 * Shared detail drawer for left insurance cards and right baseline items.
 * Overlay only — does not occupy main layout width when closed.
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { formatManwonAmount, formatWonMonthly } from "../lib/keyInsuranceScreenFacts.js";

function Section({ title, children }) {
  if (children == null || children === "") return null;
  return (
    <section style={{ marginBottom: "16px" }}>
      <div
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color: LG.textMuted,
          marginBottom: "6px",
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "14px", color: LG.text, lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}

function formatLimit(value) {
  if (value == null) return "기준 확인 중";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "기준 확인 중";
  return formatManwonAmount(n) || "기준 확인 중";
}

export default function KeyInsuranceDetailDrawer({ detail = null, onClose = null }) {
  if (!detail) return null;

  const isBaseline = detail.kind === "baseline";

  return (
    <>
      <div
        role="presentation"
        onClick={() => onClose?.()}
        style={{ position: "fixed", inset: 0, background: "rgba(20,36,74,0.24)", zIndex: 50 }}
      />
      <aside
        role="dialog"
        aria-label="보험 상세"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 92vw)",
          zIndex: 51,
          background: LG.surface,
          borderLeft: `1px solid ${LG.border}`,
          boxShadow: LG.shadowSoft,
          display: "flex",
          flexDirection: "column",
          fontFamily: LG.sans,
        }}
      >
        <div
          style={{
            padding: "18px 18px 12px",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "flex-start",
            flexShrink: 0,
            borderBottom: `1px solid ${LG.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: "18px", fontWeight: 750, color: LG.navy }}>{detail.title}</div>
            {detail.subtitle ? (
              <div style={{ marginTop: "4px", fontSize: "13px", color: LG.textMuted }}>{detail.subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="상세 닫기"
            onClick={() => onClose?.()}
            style={{
              border: "none",
              background: "transparent",
              color: LG.textMuted,
              cursor: "pointer",
              fontSize: "20px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 24px", background: LG.bg }}>
          {isBaseline ? (
            <>
              <Section title="담보 정의">{detail.definition}</Section>
              <Section title="현재 확인 합계">{detail.currentDisplay}</Section>
              <Section title="포함된 계약과 특약">
                {(detail.includedCoverages ?? []).length === 0 ? (
                  <span style={{ color: LG.textMuted }}>아직 verified로 연결된 특약이 없습니다.</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {detail.includedCoverages.map((row) => (
                      <li key={`${row.policy_id}-${row.coverage_name}`} style={{ marginBottom: "6px" }}>
                        {[row.insurer_name, row.coverage_name].filter(Boolean).join(": ")}
                        {row.coverage_amount_display
                          ? ` ${row.coverage_amount_display}`
                          : row.coverage_amount != null
                            ? ` ${formatManwonAmount(row.coverage_amount)}`
                            : " · 금액 확인 필요"}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="업계 일반 구간">{detail.industryRangeDisplay}</Section>
              <Section title="업계 누적 인수한도">{formatLimit(detail.industry_cumulative_limit)}</Section>
              <Section title="판정 이유">{detail.reason}</Section>
              <Section title="확인되지 않은 부분">
                {(detail.unclearParts ?? []).length
                  ? detail.unclearParts.join(", ")
                  : detail.status === "기준 확인 중"
                    ? "업계 기준자료 자체가 아직 부족합니다."
                    : "해당 없음 또는 추가 확인 대기"}
              </Section>
              <Section title="근거 출처">{detail.sourceDisplay || (detail.source_kind === "none" ? "미확보" : detail.source)}</Section>
              <Section title="기준일">
                {detail.as_of}
                {detail.version ? ` · 버전 ${detail.version}` : ""}
              </Section>
              <Section title="적용 조건">{detail.apply_conditions}</Section>
            </>
          ) : (
            <>
              <Section title="보험사">{detail.title}</Section>
              <Section title="상품명">{detail.subtitle}</Section>
              <Section title="월 보험료">
                {detail.monthly_premium_display || formatWonMonthly(detail.monthly_premium) || "확인 필요"}
              </Section>
              <Section title="확인된 특약·담보">
                {(detail.coverages ?? []).length === 0 ? (
                  <span style={{ color: LG.textMuted }}>담보 금액이 아직 확인되지 않았습니다.</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {detail.coverages.map((row) => (
                      <li key={`${row.coverage_name}-${row.coverage_amount ?? "x"}`} style={{ marginBottom: "6px" }}>
                        {row.coverage_name}
                        {row.coverage_amount != null
                          ? ` · ${formatManwonAmount(row.coverage_amount)}`
                          : " · 금액 확인 필요"}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="참고">{detail.note}</Section>
            </>
          )}
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: LG.textMuted, lineHeight: 1.5 }}>
            이 화면은 판매 권유가 아닙니다. 추가 가입·구매·예상 보험료 문구를 만들지 않습니다.
          </p>
        </div>
      </aside>
    </>
  );
}
