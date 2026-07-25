import { useState } from "react";
import AdminRealDataReadinessPanel from "./AdminRealDataReadinessPanel.jsx";
import AdminCarrierProductIngestionPanel from "./AdminCarrierProductIngestionPanel.jsx";
import AdminManualKnowledgeIngestionPanel from "./AdminManualKnowledgeIngestionPanel.jsx";
import AdminManualKnowledgeSearchReviewPanel from "./AdminManualKnowledgeSearchReviewPanel.jsx";
import AdminPolicyRagPanel from "./AdminPolicyRagPanel.jsx";
import AdminPolicyChunkProcessingPanel from "./AdminPolicyChunkProcessingPanel.jsx";
import AdminPolicyEmbeddingPreparationPanel from "./AdminPolicyEmbeddingPreparationPanel.jsx";
import AdminPolicyVectorSearchPanel from "./AdminPolicyVectorSearchPanel.jsx";
import AdminPolicyGroundingContextPanel from "./AdminPolicyGroundingContextPanel.jsx";
import AdminClaudeGroundingIntegrationPanel from "./AdminClaudeGroundingIntegrationPanel.jsx";
import AdminPolicyEmbeddingExecutionPanel from "./AdminPolicyEmbeddingExecutionPanel.jsx";
import AdminClaudeExecutionPanel from "./AdminClaudeExecutionPanel.jsx";
import AdminPolicyPdfIngestionPanel from "./AdminPolicyPdfIngestionPanel.jsx";
import AdminPolicyTextExtractionPanel from "./AdminPolicyTextExtractionPanel.jsx";
import AdminPolicyChunkGenerationPanel from "./AdminPolicyChunkGenerationPanel.jsx";
import AdminPolicyEmbeddingPipelinePanel from "./AdminPolicyEmbeddingPipelinePanel.jsx";
import AdminGroundedRetrievalValidationPanel from "./AdminGroundedRetrievalValidationPanel.jsx";
import AdminProductionDataFlowValidationPanel from "./AdminProductionDataFlowValidationPanel.jsx";
import AdminCustomerMemoryIntegrationPanel from "./AdminCustomerMemoryIntegrationPanel.jsx";
import AdminCustomerConversationMemoryPanel from "./AdminCustomerConversationMemoryPanel.jsx";
import AdminCustomerGroundedConversationPanel from "./AdminCustomerGroundedConversationPanel.jsx";
import AdminCustomerAiConversationExecutionPanel from "./AdminCustomerAiConversationExecutionPanel.jsx";
import AdminRealPolicyKnowledgeIngestionPanel from "./AdminRealPolicyKnowledgeIngestionPanel.jsx";
import AdminRealPolicyPdfUploadStoragePanel from "./AdminRealPolicyPdfUploadStoragePanel.jsx";
import AdminRealPolicyPdfExtractionPipelinePanel from "./AdminRealPolicyPdfExtractionPipelinePanel.jsx";
import AdminRealPolicyTextExtractionExecutionPanel from "./AdminRealPolicyTextExtractionExecutionPanel.jsx";
import AdminRealPolicyChunkGenerationPanel from "./AdminRealPolicyChunkGenerationPanel.jsx";
import AdminRealPolicyEmbeddingPreparationPanel from "./AdminRealPolicyEmbeddingPreparationPanel.jsx";
import AdminRealPolicyEmbeddingExecutionPanel from "./AdminRealPolicyEmbeddingExecutionPanel.jsx";
import AdminRealPolicyVectorSearchIntegrationPanel from "./AdminRealPolicyVectorSearchIntegrationPanel.jsx";
import AdminRealPolicyCustomerAiConversationPanel from "./AdminRealPolicyCustomerAiConversationPanel.jsx";
import AdminAgentAssignmentPanel from "./AdminAgentAssignmentPanel.jsx";
import AdminKeyAssignmentChatPanel from "./AdminKeyAssignmentChatPanel.jsx";
import FeatureShellPanel from "./FeatureShellPanel.jsx";

const ADMIN_PANELS = [
  { id: "real_data_readiness", label: "실데이터 준비상태 점검" },
  { id: "carrier_product_ingestion", label: "보험사/상품 데이터 적재 준비" },
  { id: "manual_knowledge_ingestion", label: "수작업 지식 등록" },
  { id: "manual_knowledge_search_review", label: "수작업 지식 검색/검토" },
  { id: "policy_rag", label: "약관 RAG 소스 관리" },
  { id: "policy_chunk_processing", label: "약관 Chunk 처리 관리" },
  { id: "policy_embedding_preparation", label: "약관 Embedding 준비 관리" },
  { id: "policy_vector_search", label: "약관 Vector Search 테스트" },
  { id: "policy_grounding_context", label: "Grounding Context 테스트" },
  { id: "claude_grounding_integration", label: "Claude Grounding 준비 테스트" },
  { id: "policy_embedding_execution", label: "실제 Embedding 실행 준비" },
  { id: "claude_execution", label: "Claude 실행 준비" },
  { id: "policy_pdf_ingestion", label: "실제 약관 PDF 적재" },
  { id: "policy_text_extraction", label: "약관 텍스트 추출 관리" },
  { id: "policy_chunk_generation", label: "약관 Chunk 생성 관리" },
  { id: "policy_embedding_pipeline", label: "Embedding Pipeline 관리" },
  { id: "grounded_retrieval_validation", label: "Grounded Retrieval 검증" },
  { id: "production_data_flow_validation", label: "운영 데이터 흐름 검증" },
  { id: "customer_memory_integration", label: "고객 메모리 관리" },
  { id: "customer_conversation_memory", label: "고객 대화 메모리 관리" },
  { id: "customer_grounded_conversation", label: "고객 Grounded 대화 관리" },
  { id: "customer_ai_conversation_execution", label: "고객 AI 대화 실행 관리" },
  { id: "real_policy_knowledge_ingestion", label: "실제 약관 자료 관리" },
  { id: "real_policy_pdf_upload_storage", label: "실제 약관 PDF 관리" },
  { id: "real_policy_pdf_extraction_pipeline", label: "실제 약관 추출 파이프라인" },
  { id: "real_policy_text_extraction_execution", label: "실제 약관 텍스트 추출 관리" },
  { id: "real_policy_chunk_generation", label: "실제 약관 Chunk 생성 관리" },
  { id: "real_policy_embedding_preparation", label: "실제 약관 Embedding 준비" },
  { id: "real_policy_embedding_execution", label: "실제 약관 Embedding 실행" },
  { id: "real_policy_vector_search_integration", label: "실제 약관 Vector Search 연동" },
  { id: "real_policy_customer_ai_conversation", label: "실제 약관 고객 AI 답변 준비" },
  { id: "agent_assignment", label: "설계사 배정 관리" },
  { id: "key_assignment_chat", label: "KEY 배정 상담" },
];

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

function renderAdminPanel(activeAdminPanel) {
  switch (activeAdminPanel) {
    case "agent_assignment":
      return <AdminAgentAssignmentPanel />;
    case "key_assignment_chat":
      return <AdminKeyAssignmentChatPanel />;
    case "carrier_product_ingestion":
      return <AdminCarrierProductIngestionPanel />;
    case "manual_knowledge_ingestion":
      return <AdminManualKnowledgeIngestionPanel />;
    case "manual_knowledge_search_review":
      return <AdminManualKnowledgeSearchReviewPanel />;
    case "policy_rag":
      return <AdminPolicyRagPanel />;
    case "policy_chunk_processing":
      return <AdminPolicyChunkProcessingPanel />;
    case "policy_embedding_preparation":
      return <AdminPolicyEmbeddingPreparationPanel />;
    case "policy_vector_search":
      return <AdminPolicyVectorSearchPanel />;
    case "policy_grounding_context":
      return <AdminPolicyGroundingContextPanel />;
    case "claude_grounding_integration":
      return <AdminClaudeGroundingIntegrationPanel />;
    case "policy_embedding_execution":
      return <AdminPolicyEmbeddingExecutionPanel />;
    case "claude_execution":
      return <AdminClaudeExecutionPanel />;
    case "policy_pdf_ingestion":
      return <AdminPolicyPdfIngestionPanel />;
    case "policy_text_extraction":
      return <AdminPolicyTextExtractionPanel />;
    case "policy_chunk_generation":
      return <AdminPolicyChunkGenerationPanel />;
    case "policy_embedding_pipeline":
      return <AdminPolicyEmbeddingPipelinePanel />;
    case "grounded_retrieval_validation":
      return <AdminGroundedRetrievalValidationPanel />;
    case "production_data_flow_validation":
      return <AdminProductionDataFlowValidationPanel />;
    case "customer_memory_integration":
      return <AdminCustomerMemoryIntegrationPanel />;
    case "customer_conversation_memory":
      return <AdminCustomerConversationMemoryPanel />;
    case "customer_grounded_conversation":
      return <AdminCustomerGroundedConversationPanel />;
    case "customer_ai_conversation_execution":
      return <AdminCustomerAiConversationExecutionPanel />;
    case "real_policy_knowledge_ingestion":
      return <AdminRealPolicyKnowledgeIngestionPanel />;
    case "real_policy_pdf_upload_storage":
      return <AdminRealPolicyPdfUploadStoragePanel />;
    case "real_policy_pdf_extraction_pipeline":
      return <AdminRealPolicyPdfExtractionPipelinePanel />;
    case "real_policy_text_extraction_execution":
      return <AdminRealPolicyTextExtractionExecutionPanel />;
    case "real_policy_chunk_generation":
      return <AdminRealPolicyChunkGenerationPanel />;
    case "real_policy_embedding_preparation":
      return <AdminRealPolicyEmbeddingPreparationPanel />;
    case "real_policy_embedding_execution":
      return <AdminRealPolicyEmbeddingExecutionPanel />;
    case "real_policy_vector_search_integration":
      return <AdminRealPolicyVectorSearchIntegrationPanel />;
    case "real_policy_customer_ai_conversation":
      return <AdminRealPolicyCustomerAiConversationPanel />;
    default:
      return <AdminRealDataReadinessPanel />;
  }
}

export default function AdminMenuPanel({ user }) {
  const [activeAdminPanel, setActiveAdminPanel] = useState("real_data_readiness");

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <FeatureShellPanel
        user={user}
        title="관리자"
        description="운영·데이터·약관 지식·AI 파이프라인 관리 화면입니다. 관리자 역할이 확인된 경우 하위 관리 도구에 접근할 수 있습니다."
        showCustomerContext={false}
        statusItems={[
          {
            label: "운영 데이터 점검",
            status: "데이터 연결 예정",
            detail: "실데이터 준비상태 및 파이프라인 점검 도구가 연결됩니다.",
          },
          {
            label: "약관·지식 검색 관리",
            status: "준비중",
            detail: "약관 적재·청크·임베딩 관리 화면이 준비 중입니다.",
          },
          {
            label: "고객 AI 운영",
            status: "다음 단계",
            detail: "고객 대화·메모리 운영 도구가 이후 단계에서 확장됩니다.",
          },
        ]}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {ADMIN_PANELS.map((panel) => {
          const active = activeAdminPanel === panel.id;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => setActiveAdminPanel(panel.id)}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: active
                  ? "1px solid rgba(59, 130, 246, 0.45)"
                  : "1px solid rgba(148, 163, 184, 0.2)",
                background: active ? "rgba(37, 99, 235, 0.25)" : "rgba(15, 23, 42, 0.5)",
                color: active ? "#f8fafc" : "#94a3b8",
                fontSize: "13px",
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {panel.label}
            </button>
          );
        })}
      </div>

      {renderAdminPanel(activeAdminPanel)}
    </div>
  );
}
