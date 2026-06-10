import { useCallback, useEffect, useRef } from "react";
import CustomerIntakePanel from "./CustomerIntakePanel.jsx";
import IntakeCompletenessBar from "./IntakeCompletenessBar.jsx";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import { formatCompletenessLabel } from "../lib/intakeCompleteness.js";
import { formatGenderLabel } from "../lib/signupValidation.js";
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
  btnPrimary: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "#fff",
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
  actionRow: { display: "flex", flexWrap: "wrap", gap: "10px" },
};

function DataField({ label, value }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={S.value}>{value ?? "—"}</div>
    </div>
  );
}

function analysisStatusLabel(job) {
  if (!job) return "분석 대기";
  if (job.status === "completed") return "분석 완료";
  if (job.status === "processing" || job.status === "queued") return "분석 진행 중";
  if (job.status === "failed") return "분석 실패";
  return "분석 준비";
}

function designReadyLabel(job) {
  if (!job?.result_json?.insurance_design) return "설계안 준비 중";
  return "설계안 준비됨";
}

function AnalysisJobSummaryCard({ job }) {
  const status = analysisStatusLabel(job);
  const designLabel = designReadyLabel(job);
  const inFlight = job?.status === "processing" || job?.status === "queued";

  return (
    <div style={S.card}>
      <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f1f5f9" }}>
        분석 상태 요약
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", color: "#cbd5e1" }}>
        <div>
          상태: <strong style={{ color: "#e2e8f0" }}>{status}</strong>
        </div>
        <div>
          설계안: <strong style={{ color: "#e2e8f0" }}>{designLabel}</strong>
        </div>
        {job?.question ? (
          <div style={{ fontSize: "13px", color: "#94a3b8" }}>
            최근 질문: {job.question.length > 80 ? `${job.question.slice(0, 80)}…` : job.question}
          </div>
        ) : null}
        {inFlight ? (
          <div style={{ fontSize: "13px", color: "#93c5fd", marginTop: "4px" }}>
            실시간 진행은 AI 상담실에서 확인해 주세요.
          </div>
        ) : null}
        {job?.status === "failed" && job?.error_message ? (
          <div style={{ fontSize: "13px", color: "#fca5a5" }}>{job.error_message}</div>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomerDashboardPanel({ user, onNavigate }) {
  const session = useOptionalCustomerSession();
  const refreshedOnMount = useRef(false);

  const loadData = useCallback(async () => {
    await session?.refreshSession?.({ event: "dashboard_refresh", reloadJob: true });
  }, [session]);

  useEffect(() => {
    if (refreshedOnMount.current || !session?.refreshSession) return;
    refreshedOnMount.current = true;
    void session.refreshSession({ event: "customer_dashboard_enter", reloadJob: true });
  }, [session]);

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
        고객 분석 데이터를 불러오는 중…
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
          고객 분석
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          고객 정보와 입력 완료도를 확인하고, AI 분석·상담은 각 전용 메뉴에서 진행합니다.
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
        <DataField label="휴대폰" value={data?.phone} />
        <DataField label="생년월일" value={data?.birthDate} />
        <DataField label="성별" value={formatGenderLabel(data?.gender)} />
        <DataField label="직업" value={data?.jobCategory} />
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

      <AnalysisJobSummaryCard job={activeAnalysisJob} />

      <div style={S.actionRow}>
        <button type="button" style={S.btnPrimary} onClick={() => onNavigate?.("chat")}>
          AI 상담실에서 질문하기
        </button>
        <button type="button" style={S.btn} onClick={() => onNavigate?.("ai")}>
          AI 보험 추천에서 결과 보기
        </button>
        <button type="button" style={S.btn} onClick={loadData}>
          세션 새로고침
        </button>
      </div>

      <CustomerIntakePanel user={user} onSaved={loadData} />
    </div>
  );
}
