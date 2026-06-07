import FeatureShellPanel from "./FeatureShellPanel.jsx";
import RoleAccessPanel from "./RoleAccessPanel.jsx";

function AgentDeskShell({ user }) {
  return (
    <FeatureShellPanel
      user={user}
      title="설계사 데스크"
      description="설계사·관리자가 담당 고객 상담, 청구 검토, 보장 분석을 수행하는 업무 화면입니다. 현재는 역할 기반 접근이 연결된 준비 단계입니다."
      statusItems={[
        {
          label: "담당 고객 목록",
          status: "데이터 연결 예정",
          detail: "agent_assignments 기반 고객 배정 목록이 연결됩니다.",
        },
        {
          label: "고객 상담 메모",
          status: "준비중",
          detail: "고객 대화·상담 이력 조회 기능이 준비 중입니다.",
        },
        {
          label: "청구/보장 검토 도구",
          status: "다음 단계",
          detail: "운영 검토 워크플로는 이후 단계에서 제공됩니다.",
        },
      ]}
    />
  );
}

export default function AgentDeskPanel({ user }) {
  return (
    <RoleAccessPanel
      user={user}
      title="설계사 데스크"
      description="설계사·관리자 전용 업무 공간입니다."
      requiredRoles={["agent", "admin"]}
      allowedContent={<AgentDeskShell user={user} />}
    />
  );
}
