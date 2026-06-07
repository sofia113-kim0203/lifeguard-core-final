import { useCustomerContext } from "../hooks/useCustomerContext.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const STATUS_TONES = {
  준비중: { bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.35)", color: "#fbbf24" },
  "데이터 연결 예정": {
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.35)",
    color: "#60a5fa",
  },
  "다음 단계": {
    bg: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.35)",
    color: "#4ade80",
  },
};

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
  statusRow: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  statusItem: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    border: "1px solid rgba(248, 113, 113, 0.25)",
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

function StatusBadge({ status }) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES["준비중"];
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "6px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 700,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.color,
      }}
    >
      {status}
    </span>
  );
}

export default function FeatureShellPanel({
  user,
  title,
  description,
  statusItems = [],
  showCustomerContext = true,
  children,
}) {
  const { context, loading, error } = useCustomerContext(showCustomerContext ? user : null);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>{title}</h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          {description}
        </p>
      </div>

      {showCustomerContext ? (
        <div
          style={{
            ...S.card,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "20px",
          }}
        >
          {!user ? (
            <DataField label="로그인 상태" value="로그인이 필요합니다." />
          ) : loading ? (
            <DataField label="고객 정보" value="불러오는 중…" />
          ) : error ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={S.error}>{error}</div>
            </div>
          ) : (
            <>
              <DataField label="이메일" value={context?.email} />
              <DataField label="customer_id" value={context?.customerId} />
              <DataField label="역할" value={context?.userRole} />
            </>
          )}
        </div>
      ) : null}

      <div style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f1f5f9" }}>
          현재 상태
        </h2>
        <div style={S.statusRow}>
          {statusItems.map((item) => (
            <div key={item.label} style={S.statusItem}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#e2e8f0" }}>{item.label}</div>
                {item.detail ? (
                  <div style={{ marginTop: "6px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
                    {item.detail}
                  </div>
                ) : null}
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      </div>

      {children}
    </div>
  );
}
