/**
 * Admin KEY assignment confirm card — human gate before POST.
 * Never prints assignment/customer/agent UUIDs in labels.
 */

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    marginTop: "10px",
    background: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: "12px",
    padding: "14px 16px",
    fontFamily: FONT,
  },
  row: { fontSize: "13px", color: "#e2e8f0", marginBottom: "6px" },
  muted: { color: "#94a3b8" },
  btn: {
    padding: "10px 14px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  btnMuted: {
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    background: "rgba(15, 23, 42, 0.55)",
    color: "#e2e8f0",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};

export default function AdminAssignmentConfirmCard({
  card,
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!card || card.kind !== "admin_assignment_confirm") return null;

  return (
    <div style={S.card} data-testid="admin-assignment-confirm-card">
      <div style={S.row}>
        <span style={S.muted}>고객 · </span>
        {card.customer_label || "—"}
      </div>
      <div style={S.row}>
        <span style={S.muted}>설계사 · </span>
        {card.agent_label || "—"}
      </div>
      <div style={{ ...S.row, marginBottom: "12px" }}>
        <span style={S.muted}>현재 상태 · </span>
        {card.status_label || "—"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          type="button"
          style={{
            ...S.btn,
            opacity: busy ? 0.45 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
          disabled={busy}
          onClick={() => onConfirm?.(card)}
        >
          {card.primary_label || "확인"}
        </button>
        <button
          type="button"
          style={{
            ...S.btnMuted,
            opacity: busy ? 0.45 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
          disabled={busy}
          onClick={() => onCancel?.(card)}
        >
          {card.secondary_label || "취소"}
        </button>
      </div>
    </div>
  );
}
