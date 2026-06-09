import { useCallback, useEffect, useState } from "react";
import {
  analyzeCustomerCoverageGap,
  GAP_LEVEL_LABELS,
  OVERALL_RISK_LABELS,
} from "../lib/customerCoverageGap.js";
import {
  analyzeCustomerUnderwritingRisk,
  RISK_LEVEL_LABELS,
  UNDERWRITING_STATUS_LABELS,
} from "../lib/customerUnderwritingRisk.js";
import {
  loadCustomerRecommendations,
  PRIORITY_LABELS,
  RECOMMENDATION_TYPE_LABELS,
} from "../lib/customerRecommendations.js";
import { loadCustomerInsuranceDesign } from "../lib/customerInsuranceDesign.js";
import { loadCustomerRebalancing } from "../lib/customerRebalancing.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import {
  fetchLatestAnalysisJob,
  mapJobResultsToAnalysisPanels,
  processAnalysisJobUntilComplete,
} from "../lib/customerConversationalAnalysis.js";

function panelNeedsClaudeHydration(claudeExplanations, hasPanelResult, claudeKey) {
  return Boolean(hasPanelResult) && !claudeExplanations?.[claudeKey];
}

/**
 * Track A (UI): job result_json does not carry per-panel claude_explanations.
 * Fetch Claude via existing panel APIs so API failures surface with claude_meta — never hidden.
 */
async function hydrateMissingClaudeExplanations(job, setters) {
  const mapped = mapJobResultsToAnalysisPanels(job);
  if (!mapped) return;

  const claude = mapped.claudeExplanations ?? {};
  const tasks = [];

  if (panelNeedsClaudeHydration(claude, mapped.coverageGapResult, "coverage_gap")) {
    tasks.push(
      analyzeCustomerCoverageGap()
        .then((data) => ({
          panel: "gap",
          claudeExplanation: data.claudeExplanation,
          claudeMeta: data.claudeMeta,
        }))
        .catch(() => null),
    );
  }

  if (panelNeedsClaudeHydration(claude, mapped.underwritingResult, "underwriting")) {
    tasks.push(
      analyzeCustomerUnderwritingRisk()
        .then((data) => ({
          panel: "uw",
          claudeExplanation: data.claudeExplanation,
          claudeMeta: data.claudeMeta,
        }))
        .catch(() => null),
    );
  }

  if (panelNeedsClaudeHydration(claude, mapped.recommendationResult, "recommendation")) {
    tasks.push(
      loadCustomerRecommendations()
        .then((data) => ({
          panel: "rec",
          claudeExplanation: data.claudeExplanation,
          claudeMeta: data.claudeMeta,
        }))
        .catch(() => null),
    );
  }

  if (panelNeedsClaudeHydration(claude, mapped.designBundle, "insurance_design")) {
    tasks.push(
      loadCustomerInsuranceDesign()
        .then((data) => ({
          panel: "design",
          claudeExplanation: data.claudeExplanation,
          claudeMeta: data.claudeMeta,
        }))
        .catch(() => null),
    );
  }

  if (!tasks.length) return;

  const results = await Promise.all(tasks);
  for (const result of results) {
    if (!result) continue;
    if (result.panel === "gap") {
      setters.setGapResult((prev) =>
        prev
          ? {
              ...prev,
              claudeExplanation: result.claudeExplanation,
              claudeMeta: result.claudeMeta,
            }
          : prev,
      );
    }
    if (result.panel === "uw") {
      setters.setUwResult((prev) =>
        prev
          ? {
              ...prev,
              claudeExplanation: result.claudeExplanation,
              claudeMeta: result.claudeMeta,
            }
          : prev,
      );
    }
    if (result.panel === "rec") {
      setters.setRecResult((prev) =>
        prev
          ? {
              ...prev,
              claudeExplanation: result.claudeExplanation,
              claudeMeta: result.claudeMeta,
            }
          : prev,
      );
    }
    if (result.panel === "design") {
      setters.setDesignResult((prev) =>
        prev
          ? {
              ...prev,
              claudeExplanation: result.claudeExplanation,
              claudeMeta: result.claudeMeta,
            }
          : prev,
      );
    }
  }
}

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const GAP_TONES = {
  critical: { bg: "rgba(127, 29, 29, 0.35)", border: "rgba(248, 113, 113, 0.35)", color: "#fecaca" },
  high: { bg: "rgba(127, 29, 29, 0.25)", border: "rgba(248, 113, 113, 0.25)", color: "#fca5a5" },
  medium: { bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.35)", color: "#fbbf24" },
  low: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)", color: "#93c5fd" },
  sufficient: { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.35)", color: "#4ade80" },
};

const UW_TONES = {
  likely_decline: GAP_TONES.critical,
  likely_exclusion: GAP_TONES.high,
  likely_surcharge: GAP_TONES.high,
  likely_additional_review: GAP_TONES.medium,
  unknown: GAP_TONES.low,
  likely_standard: GAP_TONES.sufficient,
};

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  title: { margin: 0, fontSize: "22px", fontWeight: 700, color: "#f8fafc" },
  desc: { margin: "8px 0 0", fontSize: "14px", color: "#94a3b8", lineHeight: 1.55 },
  sectionTitle: { margin: "0 0 12px", fontSize: "15px", fontWeight: 700, color: "#e2e8f0" },
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
  metricLabel: { fontSize: "12px", color: "#64748b", fontWeight: 600, marginBottom: "6px" },
  metricValue: { fontSize: "18px", color: "#f8fafc", fontWeight: 700 },
  list: { display: "flex", flexDirection: "column", gap: "10px", margin: 0, padding: 0, listStyle: "none" },
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
  explanation: { whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: 1.65, color: "#cbd5e1" },
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
  muted: { fontSize: "13px", color: "#94a3b8" },
};

function ToneBadge({ toneMap, level, labels }) {
  const tone = toneMap[level] ?? toneMap.low ?? UW_TONES.unknown;
  return (
    <span
      style={{
        ...S.badge,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.color,
      }}
    >
      {labels[level] ?? level}
    </span>
  );
}

function GapListItem({ item }) {
  return (
    <li style={S.listItem}>
      <div style={{ marginBottom: "6px" }}>
        <ToneBadge toneMap={GAP_TONES} level={item.gap_level} labels={GAP_LEVEL_LABELS} />
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

function UnderwritingListItem({ item }) {
  return (
    <li style={S.listItem}>
      <div style={{ marginBottom: "6px" }}>
        <ToneBadge
          toneMap={UW_TONES}
          level={item.underwriting_status}
          labels={UNDERWRITING_STATUS_LABELS}
        />
        <strong style={{ color: "#f1f5f9" }}>{item.coverage_label}</strong>
        <span style={{ marginLeft: "8px", fontSize: "12px", color: "#94a3b8" }}>
          위험 {RISK_LEVEL_LABELS[item.risk_level] ?? item.risk_level}
        </span>
      </div>
      <div style={S.muted}>{item.reason}</div>
      <div style={{ marginTop: "6px", fontSize: "13px", color: "#cbd5e1" }}>
        {item.recommended_next_step}
      </div>
      {item.related_memory_sources?.length ? (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
          Memory 근거: {item.related_memory_sources.join(", ")}
        </div>
      ) : null}
    </li>
  );
}


function applyJobResultsToPanelState(job, setters) {
  const mapped = mapJobResultsToAnalysisPanels(job);
  if (!mapped) return false;

  const claude = mapped.claudeExplanations ?? {};
  if (mapped.coverageGapResult) {
    setters.setGapResult({
      coverageGapResult: mapped.coverageGapResult,
      claudeExplanation: claude.coverage_gap ?? null,
      memoryUsed: true,
    });
  }
  if (mapped.underwritingResult) {
    setters.setUwResult({
      underwritingResult: mapped.underwritingResult,
      coverageGapResult: mapped.coverageGapResult,
      claudeExplanation: claude.underwriting ?? null,
      memoryUsed: true,
      coverageGapUsed: true,
    });
  }
  if (mapped.recommendationResult) {
    setters.setRecResult({
      recommendationResult: mapped.recommendationResult,
      customerVisibleTop2: mapped.recommendationResult.customer_visible_top2 ?? [],
      recommendations: mapped.recommendationResult.recommendations ?? [],
      claudeExplanation: claude.recommendation ?? null,
      memoryUsed: true,
      coverageGapUsed: true,
      underwritingUsed: true,
    });
  }
  if (mapped.designBundle) {
    setters.setDesignResult({
      insuranceDesign: mapped.designBundle.insurance_design ?? null,
      customerVisibleDesign: mapped.designBundle.customer_visible_design ?? null,
      claudeExplanation: claude.insurance_design ?? null,
      memoryUsed: true,
      coverageGapUsed: true,
      underwritingUsed: true,
      recommendationUsed: true,
    });
  }
  return Boolean(
    mapped.coverageGapResult ||
      mapped.underwritingResult ||
      mapped.recommendationResult ||
      mapped.designBundle,
  );
}

function AnalysisJobProgressBanner({ analysisJob }) {
  if (!analysisJob || analysisJob.status === "completed") return null;
  const progress = Array.isArray(analysisJob.progress) ? analysisJob.progress : [];
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "12px",
        background: "rgba(30, 64, 175, 0.18)",
        border: "1px solid rgba(96, 165, 250, 0.35)",
        color: "#dbeafe",
        fontSize: "13px",
        lineHeight: 1.6,
      }}
    >
      <strong>백그라운드 정밀 분석 진행 중</strong>
      <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {progress.map((item) => (
          <div key={item.stage}>
            {item.status === "completed" ? "✓" : item.status === "processing" ? "…" : "○"} {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}


export default function AiRecommendationPanel({ user, analysisJob: externalAnalysisJob = null, useSessionJob = false }) {
  const session = useOptionalCustomerSession();
  const sessionAnalysisJob = useSessionJob ? session?.activeAnalysisJob ?? null : null;
  const resolvedExternalJob = externalAnalysisJob ?? sessionAnalysisJob;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gapResult, setGapResult] = useState(null);
  const [uwResult, setUwResult] = useState(null);
  const [recResult, setRecResult] = useState(null);
  const [designResult, setDesignResult] = useState(null);
  const [rebalancingResult, setRebalancingResult] = useState(null);
  const [analysisJob, setAnalysisJob] = useState(null);

  const panelSetters = {
    setGapResult,
    setUwResult,
    setRecResult,
    setDesignResult,
  };

  const applyJobToState = useCallback((job) => {
    return applyJobResultsToPanelState(job, panelSetters);
  }, []);

  const loadAnalysis = useCallback(async () => {
    if (!user) {
      setGapResult(null);
      setUwResult(null);
      setRecResult(null);
      setDesignResult(null);
      setRebalancingResult(null);
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const latestJob = resolvedExternalJob ?? (await fetchLatestAnalysisJob());
      if (latestJob) {
        setAnalysisJob(latestJob);
        const applied = applyJobToState(latestJob);
        if (latestJob.status === "processing" || latestJob.status === "queued") {
          setLoading(false);
          const finalJob = await processAnalysisJobUntilComplete({
            jobId: latestJob.id,
            onProgress: (job) => {
              setAnalysisJob(job);
              applyJobToState(job);
            },
          });
          const jobForPanels = finalJob ?? latestJob;
          if (finalJob) {
            setAnalysisJob(finalJob);
          }
          const appliedFromJob = applyJobToState(jobForPanels);
          if (appliedFromJob) {
            await hydrateMissingClaudeExplanations(jobForPanels, panelSetters);
          } else {
            const [gapData, uwData, recData, designData, rebalancingData] = await Promise.all([
              analyzeCustomerCoverageGap({ skipClaude: true }),
              analyzeCustomerUnderwritingRisk({ skipClaude: true }),
              loadCustomerRecommendations({ skipClaude: true }),
              loadCustomerInsuranceDesign({ skipClaude: true }),
              loadCustomerRebalancing({ skipClaude: true }),
            ]);
            setGapResult(gapData);
            setUwResult(uwData);
            setRecResult(recData);
            setDesignResult(designData);
            setRebalancingResult(rebalancingData);
          }
          return;
        }
        if (applied && latestJob.status === "completed") {
          await hydrateMissingClaudeExplanations(latestJob, panelSetters);
          return;
        }
      }

      const [gapData, uwData, recData, designData, rebalancingData] = await Promise.all([
        analyzeCustomerCoverageGap(),
        analyzeCustomerUnderwritingRisk(),
        loadCustomerRecommendations(),
        loadCustomerInsuranceDesign(),
        loadCustomerRebalancing(),
      ]);
      setGapResult(gapData);
      setUwResult(uwData);
      setRecResult(recData);
      setDesignResult(designData);
      setRebalancingResult(rebalancingData);
    } catch (err) {
      setGapResult(null);
      setUwResult(null);
      setRecResult(null);
      setDesignResult(null);
      setRebalancingResult(null);
      setError(toCustomerErrorMessage(err, "보장·인수 분석을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user, resolvedExternalJob, applyJobToState]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  useEffect(() => {
    if (!resolvedExternalJob) return;
    setAnalysisJob(resolvedExternalJob);
    if (!applyJobToState(resolvedExternalJob)) return;
    if (resolvedExternalJob.status === "completed") {
      void hydrateMissingClaudeExplanations(resolvedExternalJob, panelSetters);
    }
  }, [resolvedExternalJob, applyJobToState]);

  const coverageGap = gapResult?.coverageGapResult ?? uwResult?.coverageGapResult;
  const underwriting = uwResult?.underwritingResult;

  return (
    <section style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h2 style={S.title}>AI 보험 추천 · 보장 공백 · 인수 위험 · Top 2 추천 · 보험설계안</h2>
        <p style={S.desc}>
          Customer Memory부터 Coverage Gap, Underwriting, Recommendation까지 연결해 고객별 보험설계안을 생성합니다.
        </p>
      </div>

      {error ? <div style={S.error}>{error}</div> : null}

      <AnalysisJobProgressBanner analysisJob={analysisJob} />

      <div style={S.card}>
        <h3 style={S.sectionTitle}>보장 공백 분석</h3>
        {loading ? (
          <div style={S.muted}>Customer Memory를 불러와 보장 공백을 분석하는 중…</div>
        ) : coverageGap ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={S.metricGrid}>
              <div style={S.metric}>
                <div style={S.metricLabel}>종합 위험도</div>
                <div style={S.metricValue}>
                  {OVERALL_RISK_LABELS[coverageGap.overall_risk] ?? coverageGap.overall_risk}
                </div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>공백 점수</div>
                <div style={S.metricValue}>{coverageGap.gap_score}</div>
              </div>
            </div>
            <div>
              <h4 style={S.sectionTitle}>부족 보장 Top 3</h4>
              {coverageGap.top_gaps?.length ? (
                <ul style={S.list}>
                  {coverageGap.top_gaps.map((item) => (
                    <GapListItem key={item.coverage_category} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>우선 보강 항목이 없습니다.</div>
              )}
            </div>
            {gapResult?.claudeExplanation ? (
              <div>
                <h4 style={S.sectionTitle}>보장 공백 Claude 설명</h4>
                <div style={S.explanation}>{gapResult.claudeExplanation}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={S.muted}>보장 공백 결과가 없습니다.</div>
        )}
      </div>

      <div style={S.card}>
        <h3 style={S.sectionTitle}>인수 위험 분석</h3>
        {loading ? (
          <div style={S.muted}>Health Memory와 Coverage Gap을 반영해 인수 위험을 분석하는 중…</div>
        ) : underwriting ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={S.metricGrid}>
              <div style={S.metric}>
                <div style={S.metricLabel}>종합 인수 위험도</div>
                <div style={S.metricValue}>
                  {RISK_LEVEL_LABELS[underwriting.overall_underwriting_risk] ??
                    underwriting.overall_underwriting_risk}
                </div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>인수 위험 점수</div>
                <div style={S.metricValue}>{underwriting.risk_score}</div>
              </div>
              <div style={S.metric}>
                <div style={S.metricLabel}>Coverage Gap 연동</div>
                <div style={S.metricValue}>{uwResult?.coverageGapUsed ? "사용" : "미사용"}</div>
              </div>
            </div>

            <div>
              <h4 style={S.sectionTitle}>가입 가능 항목</h4>
              {underwriting.likely_standard?.length ? (
                <ul style={S.list}>
                  {underwriting.likely_standard.map((item) => (
                    <UnderwritingListItem key={`std-${item.coverage_category}`} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>표준 인수 가능 항목이 없습니다.</div>
              )}
            </div>

            <div>
              <h4 style={S.sectionTitle}>할증 가능 항목</h4>
              {underwriting.likely_surcharge?.length ? (
                <ul style={S.list}>
                  {underwriting.likely_surcharge.map((item) => (
                    <UnderwritingListItem key={`sur-${item.coverage_category}`} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>할증 가능 항목이 없습니다.</div>
              )}
            </div>

            <div>
              <h4 style={S.sectionTitle}>부담보 가능 항목</h4>
              {underwriting.likely_exclusion?.length ? (
                <ul style={S.list}>
                  {underwriting.likely_exclusion.map((item) => (
                    <UnderwritingListItem key={`exc-${item.coverage_category}`} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>부담보 가능 항목이 없습니다.</div>
              )}
            </div>

            <div>
              <h4 style={S.sectionTitle}>추가심사 항목</h4>
              {underwriting.likely_additional_review?.length ? (
                <ul style={S.list}>
                  {underwriting.likely_additional_review.map((item) => (
                    <UnderwritingListItem key={`rev-${item.coverage_category}`} item={item} />
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>추가심사 항목이 없습니다.</div>
              )}
            </div>

            <div>
              <h4 style={S.sectionTitle}>필요 서류</h4>
              {(uwResult?.requiredDocuments ?? []).length ? (
                <ul style={S.list}>
                  {uwResult.requiredDocuments.map((doc) => (
                    <li key={doc} style={S.listItem}>
                      {doc}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={S.muted}>추가 서류가 필요하지 않습니다.</div>
              )}
            </div>

            <div>
              <h4 style={S.sectionTitle}>Memory 근거</h4>
              <div style={S.muted}>
                사용 소스:{" "}
                {(uwResult?.usedMemorySources ?? [])
                  .map((source) => `${source.source}(${source.count})`)
                  .join(", ") || "없음"}
              </div>
              {uwResult?.structuredMemory?.health_memory?.length ? (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "#cbd5e1" }}>
                  건강 Memory:{" "}
                  {uwResult.structuredMemory.health_memory.map((item) => item.value).join(" · ")}
                </div>
              ) : null}
            </div>

            {uwResult?.claudeExplanation ? (
              <div>
                <h4 style={S.sectionTitle}>인수 위험 Claude 설명</h4>
                <div style={S.explanation}>{uwResult.claudeExplanation}</div>
              </div>
            ) : (
              <div style={S.muted}>
                인수 위험 Claude 설명을 생성하지 못했습니다.
                {uwResult?.claudeMeta?.reason ? ` (${uwResult.claudeMeta.reason})` : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={S.muted}>인수 위험 결과가 없습니다.</div>
        )}
      </div>

      <div style={S.card}>
        <h3 style={S.sectionTitle}>AI 보험 추천 Top 2</h3>
        {loading ? (
          <div style={S.muted}>Coverage Gap과 인수 위험을 반영해 추천을 생성하는 중…</div>
        ) : recResult?.customerVisibleTop2?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <ul style={S.list}>
              {recResult.customerVisibleTop2.map((item) => (
                <li key={item.coverage_category} style={S.listItem}>
                  <div style={{ marginBottom: "6px" }}>
                    <span style={{ ...S.badge, background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.35)", color: "#93c5fd" }}>
                      #{item.recommendation_rank}
                    </span>
                    <strong style={{ color: "#f1f5f9" }}>{item.coverage_label}</strong>
                    <span style={{ marginLeft: "8px", fontSize: "12px", color: "#94a3b8" }}>
                      {RECOMMENDATION_TYPE_LABELS[item.recommendation_type] ?? item.recommendation_type}
                      · 우선순위 {PRIORITY_LABELS[item.priority] ?? item.priority}
                    </span>
                  </div>
                  <div style={S.muted}>{item.reason}</div>
                  <div style={{ marginTop: "6px", fontSize: "13px", color: "#cbd5e1" }}>
                    인수 고려: {item.underwriting_consideration}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "13px", color: "#cbd5e1" }}>
                    예산 고려: {item.budget_consideration}
                  </div>
                  {item.required_documents?.length ? (
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>
                      필요 서류: {item.required_documents.join(", ")}
                    </div>
                  ) : null}
                  {item.memory_sources_used?.length ? (
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>
                      Memory 근거: {item.memory_sources_used.join(", ")}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {recResult.keepExistingRecommendations?.length ? (
              <div>
                <h4 style={S.sectionTitle}>유지 보장</h4>
                <div style={{ fontSize: "13px", color: "#cbd5e1" }}>
                  {recResult.keepExistingRecommendations.map((item) => item.coverage_label).join(", ")}
                </div>
              </div>
            ) : null}

            {recResult.requiredDocuments?.length ? (
              <div>
                <h4 style={S.sectionTitle}>필요 서류</h4>
                <ul style={S.list}>
                  {recResult.requiredDocuments.map((doc) => (
                    <li key={doc} style={S.listItem}>{doc}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recResult.claudeExplanation ? (
              <div>
                <h4 style={S.sectionTitle}>추천 Claude 설명</h4>
                <div style={S.explanation}>{recResult.claudeExplanation}</div>
              </div>
            ) : (
              <div style={S.muted}>
                추천 Claude 설명을 생성하지 못했습니다.
                {recResult.claudeMeta?.reason ? ` (${recResult.claudeMeta.reason})` : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={S.muted}>추천 결과가 없습니다.</div>
        )}
      </div>

      <div style={S.card}>
        <h3 style={S.sectionTitle}>보험설계안</h3>
        {loading ? (
          <div style={S.muted}>추천 결과를 반영해 보험설계안을 생성하는 중…</div>
        ) : designResult?.customerVisibleDesign ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <h4 style={{ ...S.sectionTitle, fontSize: "18px", color: "#f8fafc" }}>
                {designResult.customerVisibleDesign.design_title}
              </h4>
              <div style={S.muted}>{designResult.customerVisibleDesign.design_summary}</div>
            </div>

            <div style={S.metricGrid}>
              <div style={S.metric}>
                <div style={S.metricLabel}>월 예산 범위</div>
                <div style={{ ...S.metricValue, fontSize: "14px" }}>
                  {designResult.customerVisibleDesign.monthly_budget_range}
                </div>
              </div>
            </div>

            <div>
              <h4 style={S.sectionTitle}>먼저 준비할 보장</h4>
              <div style={{ fontSize: "14px", color: "#cbd5e1" }}>
                {(designResult.customerVisibleDesign.priority_coverages ?? []).join(", ") || "—"}
              </div>
            </div>

            <div>
              <h4 style={S.sectionTitle}>유지할 기존 보장</h4>
              <div style={{ fontSize: "14px", color: "#cbd5e1" }}>
                {(designResult.customerVisibleDesign.keep_existing_coverages ?? []).join(", ") || "—"}
              </div>
            </div>

            {designResult.customerVisibleDesign.additional_review_coverages?.length ? (
              <div>
                <h4 style={S.sectionTitle}>추가 검토할 보장</h4>
                <div style={{ fontSize: "14px", color: "#cbd5e1" }}>
                  {designResult.customerVisibleDesign.additional_review_coverages.join(", ")}
                </div>
              </div>
            ) : null}

            {designResult.customerVisibleDesign.pre_enrollment_cautions?.length ? (
              <div>
                <h4 style={S.sectionTitle}>가입 전 주의사항</h4>
                <ul style={S.list}>
                  {designResult.customerVisibleDesign.pre_enrollment_cautions.map((item) => (
                    <li key={item} style={S.listItem}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {designResult.requiredDocuments?.length ? (
              <div>
                <h4 style={S.sectionTitle}>필요 서류</h4>
                <ul style={S.list}>
                  {designResult.requiredDocuments.map((doc) => (
                    <li key={doc} style={S.listItem}>{doc}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h4 style={S.sectionTitle}>다음 행동</h4>
              <ul style={S.list}>
                {(designResult.customerVisibleDesign.next_actions ?? []).map((action) => (
                  <li key={action} style={S.listItem}>{action}</li>
                ))}
              </ul>
            </div>

            {designResult.claudeExplanation ? (
              <div>
                <h4 style={S.sectionTitle}>설계안 Claude 설명</h4>
                <div style={S.explanation}>{designResult.claudeExplanation}</div>
              </div>
            ) : (
              <div style={S.muted}>
                설계안 Claude 설명을 생성하지 못했습니다.
                {designResult.claudeMeta?.reason ? ` (${designResult.claudeMeta.reason})` : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={S.muted}>보험설계안이 없습니다.</div>
        )}
      </div>


      <div style={S.card}>
        <h3 style={S.sectionTitle}>보험 리밸런싱</h3>
        {loading ? (
          <div style={S.muted}>설계안과 기존 보험을 비교해 리밸런싱 결과를 생성하는 중…</div>
        ) : rebalancingResult?.customerVisibleRebalancing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <h4 style={S.sectionTitle}>유지할 보험</h4>
              <div style={{ fontSize: "14px", color: "#cbd5e1" }}>
                {(rebalancingResult.customerVisibleRebalancing.keep_insurances ?? []).join(", ") || "—"}
              </div>
            </div>

            <div>
              <h4 style={S.sectionTitle}>보강할 보장</h4>
              <div style={{ fontSize: "14px", color: "#cbd5e1" }}>
                {(rebalancingResult.customerVisibleRebalancing.strengthen_coverages ?? []).join(", ") || "—"}
              </div>
            </div>

            {rebalancingResult.customerVisibleRebalancing.cautions_before_reduction?.length ? (
              <div>
                <h4 style={S.sectionTitle}>줄이기 전 주의사항</h4>
                <ul style={S.list}>
                  {rebalancingResult.customerVisibleRebalancing.cautions_before_reduction.map((item) => (
                    <li key={item} style={S.listItem}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h4 style={S.sectionTitle}>다음 행동</h4>
              <ul style={S.list}>
                {(rebalancingResult.customerVisibleRebalancing.next_actions ?? []).map((action) => (
                  <li key={action} style={S.listItem}>{action}</li>
                ))}
              </ul>
            </div>

            {rebalancingResult.rebalancingResult?.estimated_budget_impact?.label ? (
              <div style={S.muted}>
                예산 영향: {rebalancingResult.rebalancingResult.estimated_budget_impact.label}
              </div>
            ) : null}

            {rebalancingResult.claudeExplanation ? (
              <div>
                <h4 style={S.sectionTitle}>리밸런싱 Claude 설명</h4>
                <div style={S.explanation}>{rebalancingResult.claudeExplanation}</div>
              </div>
            ) : (
              <div style={S.muted}>
                리밸런싱 Claude 설명을 생성하지 못했습니다.
                {rebalancingResult.claudeMeta?.reason ? ` (${rebalancingResult.claudeMeta.reason})` : ""}
              </div>
            )}
          </div>
        ) : (
          <div style={S.muted}>리밸런싱 결과가 없습니다.</div>
        )}
      </div>

      <div style={{ marginTop: "8px" }}>
        <button type="button" style={S.btn} onClick={loadAnalysis} disabled={loading}>
          {loading ? "분석 중…" : "보장·인수·추천·설계·리밸런싱 분석 다시 실행"}
        </button>
      </div>
    </section>
  );
}
