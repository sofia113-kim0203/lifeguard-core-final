import FeatureShellPanel from "./FeatureShellPanel.jsx";

export default function ClaimCheckPanel({ user }) {
  return (
    <FeatureShellPanel
      user={user}
      title="보험금 청구 확인"
      description="고객별 청구 가능성 점검, 필요 서류, 청구 진행 상태를 확인하는 화면입니다. 현재는 고객 컨텍스트가 연결된 준비 단계입니다."
      statusItems={[
        {
          label: "청구 가능성 분석",
          status: "준비중",
          detail: "고객 보험 계약·의료 이력·문서 근거를 연결할 예정입니다.",
        },
        {
          label: "청구 서류 체크리스트",
          status: "데이터 연결 예정",
          detail: "문서 관리와 연동해 필요 서류 목록을 표시합니다.",
        },
        {
          label: "청구 진행 추적",
          status: "다음 단계",
          detail: "청구 상태 업데이트와 알림 연동이 이후 단계에서 제공됩니다.",
        },
      ]}
    />
  );
}
