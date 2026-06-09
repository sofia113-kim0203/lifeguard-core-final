import { useCallback } from "react";
import AiRecommendationPanel from "./AiRecommendationPanel.jsx";
import CustomerAiChatPanel from "./CustomerAiChatPanel.jsx";
import CustomerIntakePanel from "./CustomerIntakePanel.jsx";
import IntakeCompletenessBar from "./IntakeCompletenessBar.jsx";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { formatCompletenessLabel } from "../lib/intakeCompleteness.js";
import {
  formatHealthSource,
  formatProfileStatus,
  formatUserRole,
  toCustomerErrorMessage,
  UI_LABELS,
} from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  label: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 600,
    marginBottom: "6px",
  },
  value: {
    fontSize: "15px",
    color: "#f1f5f9",
    fontWeight: 500,
    wordBreak: "break-all",
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
  sessionBanner: {
    padding: "14px 18px",
    borderRadius: "12px",
    background: "rgba(59, 130, 246, 0.12)",
    border: "1px solid rgba(96, 165, 250, 0.25)",
    color: "#dbeafe",
    fontSize: "14px",
    lineHeight: 1.6,
  },
};

function DataField({ label, value }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={S.value}>{value ?? "—"}</div>
    </div>
  );
}

export default function CustomerDashboardPanel({ user }) {
  const session = useOptionalCustomerSession();

  const loadData = useCallback(async () => {
    await session?.refreshSession?.({ event: "dashboard_refresh" });
  }, [session]);

  const handleAnalysisJobUpdate = useCallback(
    (job) => {
      if (job) session?.setActiveAnalysisJob?.(job);
    },
    [session],
  );

  if (!user) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        로그인이 필요합니다.
      </div>
    );
  }

  const data = session?.dashboardData ?? null;
  const unifiedState = session?.unifiedState ?? null;
  const activeAnalysisJob = session?.activeAnalysisJob ?? null;
  const insurancePolicyCount = session?.insurancePolicyCount ?? 0;
  const memoryVersion = session?.memoryVersion ?? 0;
  const stateHash = session?.stateHash ?? null;
  const loading = session?.loading ?? false;
  const error = session?.error ?? "";

  if (!session) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        고객 세션을 준비하는 중입니다. 로그인 후 다시 시도해 주세요.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        고객 상담실 데이터를 불러오는 중…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            ...S.card,
            color: "#fecaca",
            background: "rgba(127, 29, 29, 0.35)",
            border: "1px solid rgba(248, 113, 113, 0.25)",
          }}
        >
          {toCustomerErrorMessage(error, "고객 데이터를 불러오지 못했습니다.")}
        </div>
        <button type="button" style={S.btn} onClick={loadData}>
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          AI 상담실
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          프로필·보험·문서·상담·분석 결과가 하나의 화면에서 연결됩니다.
        </p>
      </div>

      <div style={S.sessionBanner}>
        <strong>통합 고객 상태</strong>
        <div style={{ marginTop: "6px" }}>
          가입 보험 <strong>{insurancePolicyCount}건</strong>
          {" · "}
          메모리 버전 <strong>v{memoryVersion}</strong>
          {unifiedState?.document_count != null ? (
            <>
              {" · "}
              문서 <strong>{unifiedState.document_count}건</strong>
            </>
          ) : null}
          {stateHash ? (
            <>
              {" · "}
              상태 해시 <code style={{ fontSize: "12px" }}>{stateHash}</code>
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          ...S.card,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "20px",
        }}
      >
        <DataField label={UI_LABELS.email} value={data?.email} />
        <DataField label={UI_LABELS.customerId} value={data?.customerId} />
        <DataField label="이름" value={data?.displayName} />
        <DataField label="가입 보험 건수" value={`${insurancePolicyCount}건`} />
        <DataField label={UI_LABELS.profileStatus} value={formatProfileStatus(data?.profileStatus)} />
        <DataField label={UI_LABELS.userRole} value={formatUserRole(data?.userRole)} />
        <DataField
          label={UI_LABELS.healthProfile}
          value={
            data?.profileHealthExists
              ? `있음 (${formatHealthSource(data.profileHealthSource)})`
              : "없음"
          }
        />
        <DataField
          label={UI_LABELS.requiredConsents}
          value={`${data?.requiredConsentCount ?? 0} / 3`}
        />
        <DataField
          label={UI_LABELS.intakeCompleteness}
          value={`${data?.intakeCompletenessScore ?? 0}% (${formatCompletenessLabel(data?.intakeCompletenessScore ?? 0)})`}
        />
      </div>

      <IntakeCompletenessBar completeness={data?.intakeCompleteness} compact />

      <button type="button" style={{ ...S.btn, alignSelf: "flex-start" }} onClick={loadData}>
        세션 새로고침
      </button>

      <CustomerIntakePanel user={user} onSaved={loadData} />

      <CustomerAiChatPanel user={user} onAnalysisJobUpdate={handleAnalysisJobUpdate} />

      <AiRecommendationPanel user={user} analysisJob={activeAnalysisJob} />
    </div>
  );
}
