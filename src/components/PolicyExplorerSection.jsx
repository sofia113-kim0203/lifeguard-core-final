import { useMemo, useState } from "react";
import {
  computePolicyExplorerStats,
  formatInsurerName,
  formatOcrConfidence,
  formatPolicyPremium,
  formatPolicySource,
  formatPolicyStatus,
  formatPolicyType,
  formatProductName,
  formatRiderLines,
  hasStructuredRiders,
  mergePolicyRecords,
  RIDER_UNAVAILABLE_MESSAGE,
} from "../lib/policyExplorer.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  title: {
    margin: 0,
    fontSize: "17px",
    fontWeight: 700,
    color: "#f1f5f9",
  },
  desc: {
    margin: "8px 0 0",
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
    marginTop: "16px",
  },
  summaryItem: {
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  summaryLabel: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 600,
    marginBottom: "6px",
  },
  summaryValue: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#e2e8f0",
  },
  policyList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "16px",
  },
  policyCard: {
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    overflow: "hidden",
  },
  policyHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "16px 18px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: FONT,
    color: "#f1f5f9",
  },
  policyBody: {
    padding: "0 18px 18px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "14px",
  },
  fieldLabel: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 600,
    marginBottom: "4px",
  },
  fieldValue: {
    fontSize: "14px",
    color: "#e2e8f0",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  riderBox: {
    gridColumn: "1 / -1",
    padding: "14px 16px",
    borderRadius: "10px",
    background: "rgba(30, 41, 59, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    fontSize: "13px",
    color: "#cbd5e1",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  muted: {
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  footerNote: {
    marginTop: "14px",
    fontSize: "13px",
    color: "#64748b",
    lineHeight: 1.5,
  },
};

function Field({ label, value }) {
  return (
    <div>
      <div style={S.fieldLabel}>{label}</div>
      <div style={S.fieldValue}>{value}</div>
    </div>
  );
}

function PolicyCard({ policy, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const insurer = formatInsurerName(policy);
  const product = formatProductName(policy);
  const riderLines = formatRiderLines(policy);
  const structuredRiders = hasStructuredRiders(policy);

  return (
    <article style={S.policyCard}>
      <button
        type="button"
        style={S.policyHeader}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <div>
          <div style={{ fontSize: "15px", fontWeight: 700 }}>{insurer}</div>
          <div style={{ marginTop: "4px", fontSize: "14px", color: "#94a3b8" }}>{product}</div>
        </div>
        <span style={{ fontSize: "13px", color: "#60a5fa", flexShrink: 0 }}>
          {expanded ? "접기" : "펼치기"}
        </span>
      </button>

      {expanded ? (
        <div style={S.policyBody}>
          <Field label="보험사" value={insurer} />
          <Field label="상품명" value={product} />
          <Field label="월 보험료" value={formatPolicyPremium(policy)} />
          <Field label="상태" value={formatPolicyStatus(policy)} />
          <Field label="유형/카테고리" value={formatPolicyType(policy)} />
          <Field label="출처" value={formatPolicySource(policy.source)} />
          <Field label="OCR 신뢰도" value={formatOcrConfidence(policy)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={S.fieldLabel}>특약 정보</div>
            {structuredRiders ? (
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px", color: "#cbd5e1", fontSize: "13px" }}>
                {riderLines.map((rider) => (
                  <li key={`${policy.id}-${rider.label}`} style={{ marginBottom: "4px" }}>
                    {rider.label}
                    {rider.detail ? ` · ${rider.detail}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={S.riderBox}>{RIDER_UNAVAILABLE_MESSAGE}</div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PolicyExplorerSummary({ policies, loading = false, footer }) {
  const stats = useMemo(() => computePolicyExplorerStats(policies), [policies]);

  if (loading) {
    return <div style={S.muted}>보험 목록을 불러오는 중…</div>;
  }

  return (
    <div>
      <div style={S.summaryGrid}>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>가입 보험</div>
          <div style={S.summaryValue}>{stats.totalCount}건</div>
        </div>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>월 보험료 확인 가능</div>
          <div style={S.summaryValue}>{stats.premiumKnownCount}건</div>
        </div>
        <div style={S.summaryItem}>
          <div style={S.summaryLabel}>특약 구조화</div>
          <div style={S.summaryValue}>{stats.riderStructuredCount}건</div>
        </div>
      </div>
      {footer ? <div style={S.footerNote}>{footer}</div> : null}
    </div>
  );
}

export default function PolicyExplorerSection({
  dashboardPolicies = [],
  unifiedPolicies = [],
  variant = "full",
  loading = false,
  summaryFooter = null,
  defaultExpandFirst = false,
}) {
  const policies = useMemo(
    () => mergePolicyRecords(dashboardPolicies, unifiedPolicies),
    [dashboardPolicies, unifiedPolicies],
  );
  const stats = useMemo(() => computePolicyExplorerStats(policies), [policies]);

  if (variant === "summary") {
    return (
      <section style={S.card}>
        <h2 style={S.title}>가입 보험 요약</h2>
        <p style={S.desc}>등록된 보험 계약 현황입니다. 상세 목록은 고객분석에서 확인하세요.</p>
        <PolicyExplorerSummary
          policies={policies}
          loading={loading}
          footer={summaryFooter ?? "고객분석 메뉴에서 보험별 카드를 펼쳐 볼 수 있습니다."}
        />
      </section>
    );
  }

  return (
    <section style={S.card}>
      <h2 style={S.title}>내 보험 펼쳐보기</h2>
      <p style={S.desc}>
        등록된 보험 계약을 상품별 카드로 확인합니다. 없는 항목은 추정하지 않고 확인 필요로 표시합니다.
      </p>

      {loading ? (
        <div style={S.muted}>보험 목록을 불러오는 중…</div>
      ) : policies.length === 0 ? (
        <div style={S.muted}>등록된 보험이 없습니다. 보장내역서나 증권을 업로드하면 계약이 표시됩니다.</div>
      ) : (
        <>
          <PolicyExplorerSummary policies={policies} />

          <div
            style={{
              marginTop: "16px",
              padding: "14px 16px",
              borderRadius: "12px",
              background: "rgba(37, 99, 235, 0.12)",
              border: "1px solid rgba(96, 165, 250, 0.25)",
              color: "#dbeafe",
              fontSize: "14px",
              lineHeight: 1.55,
            }}
          >
            <strong>월 보험료 합계</strong>
            <div style={{ marginTop: "6px" }}>
              {stats.premiumKnownCount > 0
                ? `${stats.premiumTotal.toLocaleString("ko-KR")}원 (${stats.premiumKnownCount}건 합산)`
                : "확인 가능한 보험료가 없습니다."}
            </div>
            {stats.premiumUnknownCount > 0 ? (
              <div style={{ marginTop: "4px", fontSize: "13px", color: "#bfdbfe" }}>
                보험료 미확인 {stats.premiumUnknownCount}건
              </div>
            ) : null}
          </div>

          <div style={S.policyList}>
            {policies.map((policy, index) => (
              <PolicyCard
                key={policy.id}
                policy={policy}
                defaultExpanded={defaultExpandFirst && index === 0}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
