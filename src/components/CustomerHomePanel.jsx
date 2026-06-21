/**
 * P3 v4 — Customer home: LIFEGUARD Agent chat (cards hidden).
 */
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";
import LifeguardHomeChat from "./LifeguardHomeChat.jsx";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

export default function CustomerHomePanel({ user, onNavigate, onOpenAuth }) {
  const session = useOptionalCustomerSession();
  const dashboard = session?.dashboardData ?? null;
  const loading = Boolean(user) && (session?.loading ?? false);
  const displayName = dashboard?.displayName ?? user?.user_metadata?.display_name ?? "고객";

  if (!user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", fontFamily: FONT }}>
        <section
          style={{
            background: "linear-gradient(135deg, rgba(13, 148, 136, 0.15) 0%, rgba(15, 23, 42, 0.9) 60%)",
            border: "1px solid rgba(13, 148, 136, 0.25)",
            borderRadius: "20px",
            padding: "36px 40px",
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-serif, "Playfair Display", Georgia, serif)',
              fontSize: "28px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "#f8fafc",
            }}
          >
            LIFEGUARD
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "14px", color: "#94a3b8" }}>
            당신의 보험을 이해하는 AI
          </p>
          <p style={{ margin: "16px 0 0", fontSize: "16px", color: "#94a3b8", maxWidth: "560px", lineHeight: 1.65 }}>
            가입 보험, 문서, AI 분석을 바탕으로 고객 맞춤 설계안을 제공하는 보험 AI 서비스입니다.
          </p>
          <button
            type="button"
            onClick={() => onOpenAuth?.("login")}
            style={{
              marginTop: "24px",
              padding: "14px 24px",
              borderRadius: "12px",
              border: "none",
              background: "#0d9488",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            로그인하고 시작하기
          </button>
        </section>
      </div>
    );
  }

  return <LifeguardHomeChat displayName={displayName} disabled={loading} onNavigate={onNavigate} />;
}
