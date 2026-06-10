import { useCallback } from "react";
import CustomerAiChatPanel from "./CustomerAiChatPanel.jsx";
import { useOptionalCustomerSession } from "../hooks/useCustomerSession.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: "20px", fontFamily: FONT },
  title: { margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" },
  desc: { margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 },
  linkRow: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" },
  linkBtn: {
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
  muted: { fontSize: "15px", color: "#94a3b8" },
};

export default function CustomerAiChatRoomWrapper({ user, onNavigate }) {
  const session = useOptionalCustomerSession();
  const loading = session?.loading ?? false;

  const handleAnalysisJobUpdate = useCallback(
    (job) => {
      if (job) session?.setActiveAnalysisJob?.(job);
    },
    [session],
  );

  if (!user) {
    return <div style={S.muted}>로그인이 필요합니다.</div>;
  }

  if (!session) {
    return <div style={S.muted}>고객 세션을 준비하는 중입니다. 잠시 후 다시 시도해 주세요.</div>;
  }

  if (loading && !session.dashboardData) {
    return <div style={S.muted}>AI 상담실 데이터를 불러오는 중…</div>;
  }

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.title}>AI 상담실</h1>
        <p style={S.desc}>
          보험 상담 질문을 입력하면 즉시 응답을 받고, 보장 공백·인수 위험·추천·설계안 정밀 분석이
          백그라운드에서 실행됩니다. 분석이 완료되면 AI 보험 추천 메뉴에서 상세 결과를 확인할 수
          있습니다.
        </p>
      </div>

      <div style={S.linkRow}>
        <button type="button" style={S.linkBtn} onClick={() => onNavigate?.("ai")}>
          AI 보험 추천에서 결과 보기
        </button>
      </div>

      <CustomerAiChatPanel user={user} onAnalysisJobUpdate={handleAnalysisJobUpdate} />
    </div>
  );
}
