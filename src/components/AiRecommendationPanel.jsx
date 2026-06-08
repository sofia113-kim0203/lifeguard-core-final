import { useCallback, useEffect, useState } from "react";
import {
  analyzeCustomerCoverageGap,
  GAP_LEVEL_LABELS,
  OVERALL_RISK_LABELS,
} from "../lib/customerCoverageGap.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const GAP_TONES = {
  critical: { bg: "rgba(127, 29, 29, 0.35)", border: "rgba(248, 113, 113, 0.35)", color: "#fecaca" },
  high: { bg: "rgba(127, 29, 29, 0.25)", border: "rgba(248, 113, 113, 0.25)", color: "#fca5a5" },
  medium: { bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.35)", color: "#fbbf24" },
  low: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)", color: "#93c5fd" },
  sufficient: { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.35)", color: "#4ade80" },
};

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  title: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 700,
    color: "#f8fafc",
  },
  desc: {
    margin: "8px 0 0",
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  sectionTitle: {
    margin: "0 0 12px",
    fontSize: "15px",
    fontWeight: 700,
    color: "#e2e8f0",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
  },
  metric: {
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  metricLabel: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 600,
    marginBottom: "6px",
  },
  metricValue: {
    fontSize: "18px",
    color: "#f8fafc",
    fontWeight: 700,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  listItem: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  badge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    marginRight: "8px",
  },
  explanation: {
    whiteSpace: "pre-wrap",
    fontSize: "14px",
    lineHeight: 1.65,
    color: "#cbd5e1",
  },
  btn: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(30, 41, 59, 0.8)",
    color: "#e2e8f0",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    border: "1px solid rgba(248, 113, 113, 0.25)",
  },
  muted: {
    fontSize: "13px",
    color: "#94a3b8",
  },
};

function GapBadge({ level }) {
  const tone = GAP_TONES[level] ?? GAP_TONES.low;
  return (
    <span
      style={{
        ...S.badge,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.color,
      }}
    >
      {GAP_LEVEL_LABELS[level] ?? level}
    </span>
  );
}

function GapListItem({ item }) {
  return (
    <li style={S.listItem}>
      <div style={{ marginBottom: "6px" }}>
        <GapBadge level={item.gap_level} />
        <strong style={{ color: "#f1f5f9" }}>{item.coverage_label}</strong>
      </div>
      <div style={S.muted}>{item.reason}</div>
      <div style={{ marginTop: "6px", fontSize: "13px", color: "#cbd5e1" }}>
        {item.recommended_action}
      </div>
      {item.memory_sources_used?.length ? (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
          Memory 근거: {item.memory_sources_used.join(", ")}
        </div>
      ) : null}
    </li>
  );
}

export default function AiRecommendationPanel({ user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadAnalysis = useCallback(async () => {
    if (!user) {
      setResult(null);
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await analyzeCustomerCoverageGap();
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(toCustomerErrorMessage(err, "보장 공백 분석을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const gapResult = result?.coverageGapResult;

  return (
    <section style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h2 style={S.title}>AI 보험 추천 · 보장 공백 분석</h2>
        <p style={S.desc}>
          Customer Memory(프로필·보험·건강)를 기반으로 보장 공백을 분석하고 Claude가 결과를
          설명합니다.
        </p>
      </div>

      <div style={S.card}>
        {error ? <div style={{ ...S.error, marginBottom: "16px" }}>{error}</div> : null}

        {loading ? (
          <div style={S.muted}>Customer Memory를 불러와 보장 공백을 분석하는 중…</div>
        ) : gapResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div style={S.metricGrid}>
              <div style={S.metric}>
                <div style={S.metricLabel}>종합 위험도</div>
                <div style={S.metricValue}>
                  {OVERALL_RISK_LABELS[gapResult.overall_risk] ?? gapResult.overall_risk}
                </div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>공백 점수</div>
                <div style={S.metricValue}>{gapResult.gap_score}</div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>Memory 버전</div>
                <div style={S.metricValue}>v{result.memoryVersion}</div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>Memory fact 수</div>
                <div style={S.metricValue}>{result.memoryFactCount}</div>
              </div>
            </div>

            <div>
              <h3 style={S.sectionTitle}>부족 보장 Top 3</h3>
              {gapResult.top_gaps?.length ? (
                <ul style={S.list}>
                  {gapResult.top_gaps.map((item) => (
                    <GapListItem key={item.coverage_category} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>현재 Memory 기준 우선 보강 항목이 없습니다.</div>
              )}
            </div>

            <div>
              <h3 style={S.sectionTitle}>유지 보장</h3>
              {gapResult.maintained_coverage?.length ? (
                <ul style={S.list}>
                  {gapResult.maintained_coverage.map((item) => (
                    <GapListItem key={item.coverage_category} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>Memory 기준으로 충분하다고 판단된 보장이 없습니다.</div>
              )}
            </div>

            <div>
              <h3 style={S.sectionTitle}>우선 추천 액션</h3>
              {gapResult.priority_actions?.length ? (
                <ul style={S.list}>
                  {gapResult.priority_actions.map((item) => (
                    <GapListItem key={`action-${item.coverage_category}`} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>우선 액션이 없습니다.</div>
              )}
            </div>

            <div>
              <h3 style={S.sectionTitle}>Memory 근거</h3>
              <div style={S.muted}>
                사용 소스:{" "}
                {(result.usedMemorySources ?? [])
                  .map((source) => `${source.source}(${source.count})`)
                  .join(", ") || "없음"}
              </div>
              {result.structuredMemory?.health_memory?.length ? (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "#cbd5e1" }}>
                  건강 Memory:{" "}
                  {result.structuredMemory.health_memory.map((item) => item.value).join(" · ")}
                </div>
              ) : null}
              {result.structuredMemory?.insurance_memory?.length ? (
                <div style={{ marginTop: "6px", fontSize: "13px", color: "#cbd5e1" }}>
                  보험 Memory:{" "}
                  {result.structuredMemory.insurance_memory.map((item) => item.value).join(" · ")}
                </div>
              ) : null}
            </div>

            {result.claudeExplanation ? (
              <div>
                <h3 style={S.sectionTitle}>Claude 설명</h3>
                <div style={S.explanation}>{result.claudeExplanation}</div>
              </div>
            ) : (
              <div style={S.muted}>
                Claude 설명을 생성하지 못했습니다.
                {result.claudeMeta?.reason ? ` (${result.claudeMeta.reason})` : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={S.muted}>분석 결과가 없습니다.</div>
        )}

        <div style={{ marginTop: "20px" }}>
          <button type="button" style={S.btn} onClick={loadAnalysis} disabled={loading}>
            {loading ? "분석 중…" : "보장 공백 다시 분석"}
          </button>
        </div>
      </div>
    </section>
  );
}
