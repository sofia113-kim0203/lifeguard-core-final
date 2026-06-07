import { useCallback, useEffect, useState } from "react";
import CustomerIntakePanel from "./CustomerIntakePanel.jsx";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";

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
      setError(err.message || "고객 데이터를 불러오지 못했습니다.");
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
          로그인한 고객의 실제 Supabase 데이터입니다.
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
        <DataField label="이메일" value={data.email} />
        <DataField label="customer_id" value={data.customerId} />
        <DataField label="이름" value={data.displayName} />
        <DataField label="프로필 상태" value={data.profileStatus} />
        <DataField label="사용자 역할" value={data.userRole} />
        <DataField
          label="건강 프로필"
          value={
            data.profileHealthExists
              ? `있음 (${data.profileHealthSource ?? "source 없음"})`
              : "없음"
          }
        />
        <DataField
          label="필수 동의"
          value={`${data.requiredConsentCount} / 3`}
        />
      </div>

      <button type="button" style={{ ...S.btn, alignSelf: "flex-start" }} onClick={loadData}>
        새로고침
      </button>

      <CustomerIntakePanel user={user} onSaved={loadData} />
    </div>
  );
}
