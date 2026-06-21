/**
 * Phase 28 / P3 — Customer home: Tom center, cards secondary.
 */
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { deriveMemoryStatusFromUnified, memoryStatusLabel, memoryStatusTone } from "../lib/memoryStatus.js";
import PolicyExplorerSection from "./PolicyExplorerSection.jsx";
import AdvisorBrainEntry from "./AdvisorBrainEntry.jsx";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

function analysisReadyLabel(job) {
  if (!job) return "분석 대기";
  if (job.status === "completed") return "분석 완료";
  if (job.status === "processing" || job.status === "queued") return "분석 진행 중";
  if (job.status === "failed") return "분석 재시도 필요";
  return "분석 준비";
}

function designReadyLabel(job) {
  if (!job?.result_json?.insurance_design) return "설계안 준비 중";
  return "설계안 준비됨";
}

function StatusPill({ label, tone = "default" }) {
  const tones = {
    default: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)", color: "#93c5fd" },
    ready: { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.35)", color: "#4ade80" },
    pending: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.35)", color: "#fbbf24" },
    failed: { bg: "rgba(248, 113, 113, 0.12)", border: "rgba(248, 113, 113, 0.35)", color: "#fca5a5" },
  };
  const t = tones[tone] ?? tones.default;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "5px 10px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
      }}
    >
      {label}
    </span>
  );
}

function HomeCard({ title, subtitle, value, footer, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "rgba(30, 41, 59, 0.55)",
        border: "1px solid rgba(148, 163, 184, 0.12)",
        borderRadius: "16px",
        padding: "18px 20px",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s ease, border-color 0.15s ease",
        fontFamily: FONT,
        minHeight: "140px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "#64748b",
            textTransform: "uppercase",
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            marginTop: "8px",
            fontSize: "17px",
            fontWeight: 700,
            color: "#e2e8f0",
            lineHeight: 1.25,
          }}
        >
          {title}
        </div>
        {value ? (
          <div
            style={{
              marginTop: "10px",
              fontSize: "22px",
              fontWeight: 800,
              color: "#cbd5e1",
              letterSpacing: "-0.02em",
            }}
          >
            {value}
          </div>
        ) : null}
      </div>
      {footer ? (
        <div style={{ marginTop: "14px", fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>
          {footer}
        </div>
      ) : null}
    </button>
  );
}

export default function CustomerHomePanel({ user, onNavigate, onOpenAuth }) {
  const session = useOptionalCustomerSession();
  const dashboard = session?.dashboardData ?? null;
  const unified = session?.unifiedState ?? null;
  const job = session?.activeAnalysisJob ?? null;
  const loading = Boolean(user) && (session?.loading ?? false);

  const policyCount = unified?.policy_count ?? dashboard?.insurancePolicyCount ?? 0;
  const documentCount = unified?.document_count ?? 0;
  const displayName = dashboard?.displayName ?? user?.user_metadata?.display_name ?? "고객";
  const basicProfileReady = Boolean(
    dashboard?.phone && dashboard?.birthDate && dashboard?.gender && dashboard?.displayName,
  );
  const analysisLabel = analysisReadyLabel(job);
  const designLabel = designReadyLabel(job);
  const analysisTone = job?.status === "completed" ? "ready" : "pending";
  const designTone = designLabel === "설계안 준비됨" ? "ready" : "pending";
  const memoryStatus =
    session?.memoryStatus ?? deriveMemoryStatusFromUnified(unified) ?? (loading ? null : "ready");
  const memoryLabel = memoryStatusLabel(memoryStatus);
  const memoryTone = memoryStatusTone(memoryStatus);

  if (!user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", fontFamily: FONT }}>
        <section
          style={{
            background: "linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(15, 23, 42, 0.9) 60%)",
            border: "1px solid rgba(59, 130, 246, 0.25)",
            borderRadius: "20px",
            padding: "36px 40px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "32px", fontWeight: 700, color: "#f8fafc" }}>
            나의 보험 상태를 한눈에
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: "16px", color: "#94a3b8", maxWidth: "560px", lineHeight: 1.65 }}>
            LIFEGUARD는 가입 보험, 문서, AI 분석 결과를 바탕으로 고객 맞춤 설계안을 제공하는 보험
            AI 서비스입니다.
          </p>
          <button
            type="button"
            onClick={() => onOpenAuth?.("login")}
            style={{
              marginTop: "24px",
              padding: "14px 24px",
              borderRadius: "12px",
              border: "none",
              background: "linear-gradient(135deg, #2563eb, #4f46e5)",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            로그인하고 내 보험 현황 보기
          </button>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", fontFamily: FONT }}>
      <section>
        <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#94a3b8" }}>
          {displayName}님, 안녕하세요
        </h1>
      </section>

      <AdvisorBrainEntry disabled={loading} />

      <section
        style={{
          opacity: 0.88,
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" }}>
          보조 정보
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <StatusPill
            label={`기본 프로필 ${loading ? "…" : basicProfileReady ? "완료" : "입력 필요"}`}
            tone={basicProfileReady ? "ready" : "default"}
          />
          <StatusPill label={`가입 보험 ${loading ? "…" : `${policyCount}건`}`} tone={policyCount > 0 ? "ready" : "default"} />
          <StatusPill label={`문서 ${loading ? "…" : `${documentCount}건`}`} tone={documentCount > 0 ? "ready" : "default"} />
          <StatusPill label={`Memory ${loading ? "…" : memoryLabel}`} tone={memoryTone} />
          <StatusPill label={`분석 ${loading ? "…" : analysisLabel}`} tone={analysisTone} />
          <StatusPill label={`설계 ${loading ? "…" : designLabel}`} tone={designTone} />
        </div>

        <PolicyExplorerSection
          dashboardPolicies={dashboard?.insurancePolicies}
          unifiedPolicies={unified?.policies}
          variant="summary"
          loading={loading}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "14px",
          }}
        >
          <HomeCard
            subtitle="프로필"
            title={displayName}
            value={dashboard?.profileStatus === "active" ? "활성" : "준비 중"}
            footer="기본 프로필과 동의 상태"
            onClick={() => onNavigate?.("customer")}
          />
          <HomeCard
            subtitle="내보험"
            title="가입 보험"
            value={loading ? "…" : `${policyCount}건`}
            footer="보유 계약과 보장 요약"
            onClick={() => onNavigate?.("customer")}
          />
          <HomeCard
            subtitle="내문서"
            title="업로드 문서"
            value={loading ? "…" : `${documentCount}건`}
            footer="증권·약관·의료서류"
            onClick={() => onNavigate?.("documents")}
          />
          <HomeCard
            subtitle="설계안"
            title="AI 맞춤 보험 설계"
            value={loading ? "…" : designLabel}
            footer="추천·분석 기반 설계안"
            onClick={() => onNavigate?.("ai")}
          />
        </div>
      </section>
    </div>
  );
}
