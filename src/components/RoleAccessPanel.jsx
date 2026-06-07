import { useCustomerContext } from "../hooks/useCustomerContext.js";
import { formatRequiredRoles, formatUserRole, UI_LABELS } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  badge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: "rgba(245, 158, 11, 0.15)",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    color: "#fbbf24",
  },
};

export default function RoleAccessPanel({
  user,
  title,
  description,
  requiredRoles,
  allowedContent,
}) {
  const { context, loading } = useCustomerContext(user);
  const currentRole = context?.userRole ?? (user ? "customer" : null);
  const hasAccess =
    user && currentRole && requiredRoles.includes(currentRole) && !loading;

  if (!user) {
    return (
      <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>{title}</h1>
          <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
            {description}
          </p>
        </div>
        <div style={S.card}>
          <span style={S.badge}>준비중</span>
          <p style={{ margin: "16px 0 0", fontSize: "15px", color: "#e2e8f0", lineHeight: 1.6 }}>
            이 화면은 로그인 후 역할에 따라 열립니다.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        접근 권한을 확인하는 중…
      </div>
    );
  }

  if (hasAccess) {
    return allowedContent;
  }

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>{title}</h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          {description}
        </p>
      </div>

      <div style={S.card}>
        <span style={S.badge}>준비중</span>
        <p style={{ margin: "16px 0 0", fontSize: "15px", color: "#e2e8f0", lineHeight: 1.6 }}>
          접근 권한 준비 화면입니다. 현재 계정 역할로는 이 메뉴의 운영 기능을 사용할 수 없습니다.
        </p>
        <div
          style={{
            marginTop: "20px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{UI_LABELS.email}</div>
            <div style={{ marginTop: "6px", fontSize: "15px", color: "#f1f5f9" }}>
              {context?.email ?? user.email}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{UI_LABELS.customerId}</div>
            <div style={{ marginTop: "6px", fontSize: "15px", color: "#f1f5f9" }}>
              {context?.customerId ?? UI_LABELS.emptyValue}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{UI_LABELS.currentRole}</div>
            <div style={{ marginTop: "6px", fontSize: "15px", color: "#f1f5f9" }}>
              {formatUserRole(currentRole)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{UI_LABELS.requiredRole}</div>
            <div style={{ marginTop: "6px", fontSize: "15px", color: "#f1f5f9" }}>
              {formatRequiredRoles(requiredRoles)}
            </div>
          </div>
        </div>
        <p style={{ margin: "20px 0 0", fontSize: "13px", color: "#94a3b8", lineHeight: 1.55 }}>
          상태: <strong style={{ color: "#fbbf24" }}>준비중</strong> · 데이터 연결 예정 · 다음 단계에서
          역할 기반 접근이 활성화됩니다.
        </p>
      </div>
    </div>
  );
}
