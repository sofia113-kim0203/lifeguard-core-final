import { useCallback, useEffect, useState } from "react";
import CustomerAiChatPanel from "./CustomerAiChatPanel.jsx";
import CustomerIntakePanel from "./CustomerIntakePanel.jsx";
import IntakeCompletenessBar from "./IntakeCompletenessBar.jsx";
import { formatCompletenessLabel } from "../lib/intakeCompleteness.js";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await loadCustomerDashboardData(user);
      setData(result);
    } catch (err) {
      setData(null);
      setError(toCustomerErrorMessage(err, "고객 데이터를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        고객 데이터를 불러오는 중…
      </div>
    );
  }

  if (error) {
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
          {error}
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
          로그인한 고객의 실제 프로필·건강·동의 데이터입니다.
        </p>
      </div>

      <div
        style={{
          ...S.card,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "20px",
        }}
      >
        <DataField label={UI_LABELS.email} value={data.email} />
        <DataField label={UI_LABELS.customerId} value={data.customerId} />
        <DataField label="이름" value={data.displayName} />
        <DataField label={UI_LABELS.profileStatus} value={formatProfileStatus(data.profileStatus)} />
        <DataField label={UI_LABELS.userRole} value={formatUserRole(data.userRole)} />
        <DataField
          label={UI_LABELS.healthProfile}
          value={
            data.profileHealthExists
              ? `있음 (${formatHealthSource(data.profileHealthSource)})`
              : "없음"
          }
        />
        <DataField
          label={UI_LABELS.requiredConsents}
          value={`${data.requiredConsentCount} / 3`}
        />
        <DataField
          label={UI_LABELS.intakeCompleteness}
          value={`${data.intakeCompletenessScore ?? 0}% (${formatCompletenessLabel(data.intakeCompletenessScore ?? 0)})`}
        />
      </div>

      <IntakeCompletenessBar completeness={data.intakeCompleteness} compact />

      <button type="button" style={{ ...S.btn, alignSelf: "flex-start" }} onClick={loadData}>
        새로고침
      </button>

      <CustomerIntakePanel user={user} onSaved={loadData} />

      <CustomerAiChatPanel user={user} />
    </div>
  );
}
