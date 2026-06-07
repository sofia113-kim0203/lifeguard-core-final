import FeatureShellPanel from "./FeatureShellPanel.jsx";

export default function DocumentsPanel({ user }) {
  return (
    <FeatureShellPanel
      user={user}
      title="문서 관리"
      description="고객별 보험 증권, 진단서, 청구 서류를 업로드·조회·검색하는 화면입니다. 현재는 고객 스코프가 연결된 준비 단계입니다."
      statusItems={[
        {
          label: "문서 업로드",
          status: "준비중",
          detail: "고객별 문서 저장소 연동이 준비 중입니다.",
        },
        {
          label: "문서 목록/검색",
          status: "데이터 연결 예정",
          detail: "customer_documents 테이블과 RLS 기반 조회가 연결됩니다.",
        },
        {
          label: "문서 분석/RAG",
          status: "다음 단계",
          detail: "청크 생성·검색은 이후 단계에서 활성화됩니다.",
        },
      ]}
    />
  );
}
