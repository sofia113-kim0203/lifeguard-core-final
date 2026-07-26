/**
 * Admin panel registry for Full-Shell V3.1 — same modules as AdminMenuPanel.
 * No API/DB contract changes.
 */
import AdminRealDataReadinessPanel from "../components/AdminRealDataReadinessPanel.jsx";
import AdminCarrierProductIngestionPanel from "../components/AdminCarrierProductIngestionPanel.jsx";
import AdminManualKnowledgeIngestionPanel from "../components/AdminManualKnowledgeIngestionPanel.jsx";
import AdminManualKnowledgeSearchReviewPanel from "../components/AdminManualKnowledgeSearchReviewPanel.jsx";
import AdminPolicyRagPanel from "../components/AdminPolicyRagPanel.jsx";
import AdminPolicyChunkProcessingPanel from "../components/AdminPolicyChunkProcessingPanel.jsx";
import AdminPolicyEmbeddingPreparationPanel from "../components/AdminPolicyEmbeddingPreparationPanel.jsx";
import AdminPolicyVectorSearchPanel from "../components/AdminPolicyVectorSearchPanel.jsx";
import AdminPolicyGroundingContextPanel from "../components/AdminPolicyGroundingContextPanel.jsx";
import AdminClaudeGroundingIntegrationPanel from "../components/AdminClaudeGroundingIntegrationPanel.jsx";
import AdminPolicyEmbeddingExecutionPanel from "../components/AdminPolicyEmbeddingExecutionPanel.jsx";
import AdminClaudeExecutionPanel from "../components/AdminClaudeExecutionPanel.jsx";
import AdminPolicyPdfIngestionPanel from "../components/AdminPolicyPdfIngestionPanel.jsx";
import AdminPolicyTextExtractionPanel from "../components/AdminPolicyTextExtractionPanel.jsx";
import AdminPolicyChunkGenerationPanel from "../components/AdminPolicyChunkGenerationPanel.jsx";
import AdminPolicyEmbeddingPipelinePanel from "../components/AdminPolicyEmbeddingPipelinePanel.jsx";
import AdminGroundedRetrievalValidationPanel from "../components/AdminGroundedRetrievalValidationPanel.jsx";
import AdminProductionDataFlowValidationPanel from "../components/AdminProductionDataFlowValidationPanel.jsx";
import AdminCustomerMemoryIntegrationPanel from "../components/AdminCustomerMemoryIntegrationPanel.jsx";
import AdminCustomerConversationMemoryPanel from "../components/AdminCustomerConversationMemoryPanel.jsx";
import AdminCustomerGroundedConversationPanel from "../components/AdminCustomerGroundedConversationPanel.jsx";
import AdminCustomerAiConversationExecutionPanel from "../components/AdminCustomerAiConversationExecutionPanel.jsx";
import AdminRealPolicyKnowledgeIngestionPanel from "../components/AdminRealPolicyKnowledgeIngestionPanel.jsx";
import AdminRealPolicyPdfUploadStoragePanel from "../components/AdminRealPolicyPdfUploadStoragePanel.jsx";
import AdminRealPolicyPdfExtractionPipelinePanel from "../components/AdminRealPolicyPdfExtractionPipelinePanel.jsx";
import AdminRealPolicyTextExtractionExecutionPanel from "../components/AdminRealPolicyTextExtractionExecutionPanel.jsx";
import AdminRealPolicyChunkGenerationPanel from "../components/AdminRealPolicyChunkGenerationPanel.jsx";
import AdminRealPolicyEmbeddingPreparationPanel from "../components/AdminRealPolicyEmbeddingPreparationPanel.jsx";
import AdminRealPolicyEmbeddingExecutionPanel from "../components/AdminRealPolicyEmbeddingExecutionPanel.jsx";
import AdminRealPolicyVectorSearchIntegrationPanel from "../components/AdminRealPolicyVectorSearchIntegrationPanel.jsx";
import AdminRealPolicyCustomerAiConversationPanel from "../components/AdminRealPolicyCustomerAiConversationPanel.jsx";
import AdminAgentAssignmentPanel from "../components/AdminAgentAssignmentPanel.jsx";

/**
 * Left-rail primary menu — labels match admin ops; panel ids stay existing modules.
 * 설계사 / 배정 / 동의·연결 share agent_assignment (existing customer·agent lists + binding).
 */
export const ADMIN_V31_PRIMARY_MENU = [
  { menuKey: "customers", panelId: "customer_memory_integration", label: "고객" },
  { menuKey: "agents", panelId: "agent_assignment", label: "설계사" },
  { menuKey: "assignment", panelId: "agent_assignment", label: "배정 관리" },
  { menuKey: "consent", panelId: "agent_assignment", label: "동의·연결 상태" },
];

/**
 * Ops tools grouped for left-rail collapse only — same panel ids as AdminMenuPanel.
 * Labels are section headers, not new features.
 */
export const ADMIN_V31_OPS_GROUPS = [
  {
    id: "customer_ops",
    label: "고객 운영",
    panelIds: [
      "customer_conversation_memory",
      "customer_grounded_conversation",
      "customer_ai_conversation_execution",
    ],
  },
  {
    id: "data_ops",
    label: "운영 데이터",
    panelIds: [
      "real_data_readiness",
      "carrier_product_ingestion",
      "manual_knowledge_ingestion",
      "manual_knowledge_search_review",
      "production_data_flow_validation",
    ],
  },
  {
    id: "policy_ops",
    label: "약관·지식",
    panelIds: [
      "policy_rag",
      "policy_chunk_processing",
      "policy_embedding_preparation",
      "policy_vector_search",
      "policy_grounding_context",
      "claude_grounding_integration",
      "policy_embedding_execution",
      "claude_execution",
      "policy_pdf_ingestion",
      "policy_text_extraction",
      "policy_chunk_generation",
      "policy_embedding_pipeline",
      "grounded_retrieval_validation",
      "real_policy_knowledge_ingestion",
      "real_policy_pdf_upload_storage",
      "real_policy_pdf_extraction_pipeline",
      "real_policy_text_extraction_execution",
      "real_policy_chunk_generation",
      "real_policy_embedding_preparation",
      "real_policy_embedding_execution",
      "real_policy_vector_search_integration",
      "real_policy_customer_ai_conversation",
    ],
  },
];

/** Full panel registry — same ids as legacy AdminMenuPanel. */
export const ADMIN_V31_PANELS = [
  { id: "agent_assignment", label: "배정 관리", group: "primary" },
  { id: "customer_memory_integration", label: "고객", group: "primary" },
  { id: "customer_conversation_memory", label: "고객 대화 메모리 관리", group: "ops" },
  { id: "customer_grounded_conversation", label: "고객 Grounded 대화 관리", group: "ops" },
  { id: "customer_ai_conversation_execution", label: "고객 AI 대화 실행 관리", group: "ops" },
  { id: "real_data_readiness", label: "실데이터 준비상태 점검", group: "ops" },
  { id: "carrier_product_ingestion", label: "보험사/상품 데이터 적재 준비", group: "ops" },
  { id: "manual_knowledge_ingestion", label: "수작업 지식 등록", group: "ops" },
  { id: "manual_knowledge_search_review", label: "수작업 지식 검색/검토", group: "ops" },
  { id: "policy_rag", label: "약관 RAG 소스 관리", group: "ops" },
  { id: "policy_chunk_processing", label: "약관 Chunk 처리 관리", group: "ops" },
  { id: "policy_embedding_preparation", label: "약관 Embedding 준비 관리", group: "ops" },
  { id: "policy_vector_search", label: "약관 Vector Search 테스트", group: "ops" },
  { id: "policy_grounding_context", label: "Grounding Context 테스트", group: "ops" },
  { id: "claude_grounding_integration", label: "Claude Grounding 준비 테스트", group: "ops" },
  { id: "policy_embedding_execution", label: "실제 Embedding 실행 준비", group: "ops" },
  { id: "claude_execution", label: "Claude 실행 준비", group: "ops" },
  { id: "policy_pdf_ingestion", label: "실제 약관 PDF 적재", group: "ops" },
  { id: "policy_text_extraction", label: "약관 텍스트 추출 관리", group: "ops" },
  { id: "policy_chunk_generation", label: "약관 Chunk 생성 관리", group: "ops" },
  { id: "policy_embedding_pipeline", label: "Embedding Pipeline 관리", group: "ops" },
  { id: "grounded_retrieval_validation", label: "Grounded Retrieval 검증", group: "ops" },
  { id: "production_data_flow_validation", label: "운영 데이터 흐름 검증", group: "ops" },
  { id: "real_policy_knowledge_ingestion", label: "실제 약관 자료 관리", group: "ops" },
  { id: "real_policy_pdf_upload_storage", label: "실제 약관 PDF 관리", group: "ops" },
  { id: "real_policy_pdf_extraction_pipeline", label: "실제 약관 추출 파이프라인", group: "ops" },
  { id: "real_policy_text_extraction_execution", label: "실제 약관 텍스트 추출 관리", group: "ops" },
  { id: "real_policy_chunk_generation", label: "실제 약관 Chunk 생성 관리", group: "ops" },
  { id: "real_policy_embedding_preparation", label: "실제 약관 Embedding 준비", group: "ops" },
  { id: "real_policy_embedding_execution", label: "실제 약관 Embedding 실행", group: "ops" },
  { id: "real_policy_vector_search_integration", label: "실제 약관 Vector Search 연동", group: "ops" },
  { id: "real_policy_customer_ai_conversation", label: "실제 약관 고객 AI 답변 준비", group: "ops" },
];

export function adminV31PanelById(panelId) {
  return ADMIN_V31_PANELS.find((p) => p.id === panelId) ?? null;
}

export const ADMIN_V31_DEFAULT_PANEL = "agent_assignment";

export function adminV31PanelLabel(panelId) {
  return ADMIN_V31_PANELS.find((p) => p.id === panelId)?.label ?? "관리자";
}

export function renderAdminV31Panel(activeAdminPanel, panelProps = {}) {
  switch (activeAdminPanel) {
    case "agent_assignment":
      return <AdminAgentAssignmentPanel {...panelProps} />;
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
    case "real_data_readiness":
    default:
      return <AdminRealDataReadinessPanel />;
  }
}
