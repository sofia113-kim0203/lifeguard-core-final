import FeatureShellPanel from "./FeatureShellPanel.jsx";

export default function AiRecommendationPanel({ user }) {
  return (
    <FeatureShellPanel
      user={user}
      title="AI 보험 추천"
      description="고객 프로필·보험 요약·건강 고지를 바탕으로 보장 공백과 추천 상품을 제안하는 화면입니다. 현재는 추천 엔진 연결 전 준비 단계입니다."
      statusItems={[
        {
          label: "고객 프로필 연동",
          status: "데이터 연결 예정",
          detail: "고객 분석 입력 데이터와 연결됩니다.",
        },
        {
          label: "보장 공백 분석",
          status: "준비중",
          detail: "유지 계약·보장 요약 기반 분석 엔진이 준비 중입니다.",
        },
        {
          label: "AI 추천 응답",
          status: "다음 단계",
          detail: "AI 기반 추천 응답은 이후 단계에서 연결됩니다.",
        },
      ]}
    />
  );
}
