import { useEffect, useState } from "react";
import AuthPanel from "./components/AuthPanel.jsx";
import CustomerDashboardPanel from "./components/CustomerDashboardPanel.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { supabase } from "./lib/supabase.js";
import AdminRealDataReadinessPanel from "./components/AdminRealDataReadinessPanel.jsx";
import AdminCarrierProductIngestionPanel from "./components/AdminCarrierProductIngestionPanel.jsx";
import AdminManualKnowledgeIngestionPanel from "./components/AdminManualKnowledgeIngestionPanel.jsx";
import AdminManualKnowledgeSearchReviewPanel from "./components/AdminManualKnowledgeSearchReviewPanel.jsx";
import AdminPolicyRagPanel from "./components/AdminPolicyRagPanel.jsx";
import AdminPolicyChunkProcessingPanel from "./components/AdminPolicyChunkProcessingPanel.jsx";
import AdminPolicyEmbeddingPreparationPanel from "./components/AdminPolicyEmbeddingPreparationPanel.jsx";
import AdminPolicyVectorSearchPanel from "./components/AdminPolicyVectorSearchPanel.jsx";
import AdminPolicyGroundingContextPanel from "./components/AdminPolicyGroundingContextPanel.jsx";
import AdminClaudeGroundingIntegrationPanel from "./components/AdminClaudeGroundingIntegrationPanel.jsx";
import AdminPolicyEmbeddingExecutionPanel from "./components/AdminPolicyEmbeddingExecutionPanel.jsx";
import AdminClaudeExecutionPanel from "./components/AdminClaudeExecutionPanel.jsx";
import AdminPolicyPdfIngestionPanel from "./components/AdminPolicyPdfIngestionPanel.jsx";
import AdminPolicyTextExtractionPanel from "./components/AdminPolicyTextExtractionPanel.jsx";
import AdminPolicyChunkGenerationPanel from "./components/AdminPolicyChunkGenerationPanel.jsx";
import AdminPolicyEmbeddingPipelinePanel from "./components/AdminPolicyEmbeddingPipelinePanel.jsx";
import AdminGroundedRetrievalValidationPanel from "./components/AdminGroundedRetrievalValidationPanel.jsx";
import AdminProductionDataFlowValidationPanel from "./components/AdminProductionDataFlowValidationPanel.jsx";
import AdminCustomerMemoryIntegrationPanel from "./components/AdminCustomerMemoryIntegrationPanel.jsx";
import AdminCustomerConversationMemoryPanel from "./components/AdminCustomerConversationMemoryPanel.jsx";
import AdminCustomerGroundedConversationPanel from "./components/AdminCustomerGroundedConversationPanel.jsx";
import AdminCustomerAiConversationExecutionPanel from "./components/AdminCustomerAiConversationExecutionPanel.jsx";
import AdminRealPolicyKnowledgeIngestionPanel from "./components/AdminRealPolicyKnowledgeIngestionPanel.jsx";
import AdminRealPolicyPdfUploadStoragePanel from "./components/AdminRealPolicyPdfUploadStoragePanel.jsx";
import AdminRealPolicyPdfExtractionPipelinePanel from "./components/AdminRealPolicyPdfExtractionPipelinePanel.jsx";
import AdminRealPolicyTextExtractionExecutionPanel from "./components/AdminRealPolicyTextExtractionExecutionPanel.jsx";
import AdminRealPolicyChunkGenerationPanel from "./components/AdminRealPolicyChunkGenerationPanel.jsx";
import AdminRealPolicyEmbeddingPreparationPanel from "./components/AdminRealPolicyEmbeddingPreparationPanel.jsx";
import AdminRealPolicyEmbeddingExecutionPanel from "./components/AdminRealPolicyEmbeddingExecutionPanel.jsx";
import AdminRealPolicyVectorSearchIntegrationPanel from "./components/AdminRealPolicyVectorSearchIntegrationPanel.jsx";
import AdminRealPolicyCustomerAiConversationPanel from "./components/AdminRealPolicyCustomerAiConversationPanel.jsx";

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
];

const CUSTOMER_DASHBOARD_MENU = "customer";
const AUTH_MENU = "auth";

const MENU_ITEMS = [
  { id: "home", label: "홈", icon: "⌂" },
  { id: AUTH_MENU, label: "로그인/회원가입", icon: "👤" },
  { id: "customer", label: "고객 분석", icon: "◎" },
  { id: "claim", label: "보험금 청구 확인", icon: "✓" },
  { id: "ai", label: "AI 보험 추천", icon: "✦" },
  { id: "documents", label: "문서 관리", icon: "▤" },
  { id: "agent", label: "설계사 데스크", icon: "◈" },
  { id: "admin", label: "관리자", icon: "⚙" },
];

const STATUS_CARDS = [
  { label: "DB 연결 완료", value: "온라인", tone: "#22c55e" },
  { label: "테이블 33개", value: "스키마", tone: "#38bdf8" },
  { label: "함수 182개", value: "RLS · RPC", tone: "#a78bfa" },
  { label: "벡터 준비 완료", value: "pgvector", tone: "#f59e0b" },
  { label: "Supabase 연결 완료", value: "설정됨", tone: "#34d399" },
];

const INSIGHT_ITEMS = [
  {
    title: "고객 기억 데이터",
    desc: "정규화된 사실과 프로필 연동 메모리 버전.",
  },
  {
    title: "보험 가입 데이터",
    desc: "유지 계약, 보험료, 보장 요약 정보.",
  },
  {
    title: "청구 신호",
    desc: "청구 가능성 라벨과 문서 근거 참조.",
  },
  {
    title: "약관/RAG 지식",
    desc: "고객별 문서 청크와 사례 지식 검색.",
  },
];

export default function App() {
  const [activeMenu, setActiveMenu] = useState("home");
  const [activeAdminPanel, setActiveAdminPanel] = useState("real_data_readiness");
  const { session, user, loading: authLoading } = useAuthSession();

  useEffect(() => {
    if (session && activeMenu === AUTH_MENU) {
      setActiveMenu(CUSTOMER_DASHBOARD_MENU);
    }
  }, [session, activeMenu]);

  const handleMenuSelect = (menuId) => {
    if (menuId === AUTH_MENU && session) {
      setActiveMenu(CUSTOMER_DASHBOARD_MENU);
      return;
    }
    setActiveMenu(menuId);
  };

  const handleLoginSuccess = () => {
    setActiveMenu(CUSTOMER_DASHBOARD_MENU);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveMenu(AUTH_MENU);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
        color: "#e2e8f0",
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
        display: "flex",
      }}
    >
      <aside
        style={{
          width: "248px",
          flexShrink: 0,
          borderRight: "1px solid rgba(148, 163, 184, 0.12)",
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          padding: "24px 16px",
        }}
      >
        <div style={{ padding: "0 12px 28px" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "0.14em",
              color: "#64748b",
              fontWeight: 700,
            }}
          >
            라이프가드
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px", color: "#f8fafc" }}>
            코어
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
          {MENU_ITEMS.map((item) => {
            const active = activeMenu === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleMenuSelect(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  padding: "12px 14px",
                  border: "none",
                  borderRadius: "12px",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "14px",
                  fontWeight: active ? 600 : 500,
                  color: active ? "#f8fafc" : "#94a3b8",
                  background: active
                    ? "linear-gradient(90deg, rgba(37, 99, 235, 0.35), rgba(59, 130, 246, 0.12))"
                    : "transparent",
                  boxShadow: active ? "inset 3px 0 0 #3b82f6" : "none",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                <span
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "8px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: active ? "rgba(59, 130, 246, 0.25)" : "rgba(30, 41, 59, 0.8)",
                    fontSize: "14px",
                  }}
                >
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div
          style={{
            marginTop: "auto",
            padding: "14px 12px",
            borderRadius: "12px",
            background: "rgba(30, 41, 59, 0.6)",
            border: "1px solid rgba(148, 163, 184, 0.1)",
            fontSize: "12px",
            color: "#64748b",
            lineHeight: 1.5,
          }}
        >
          1단계 구축 완료
          <br />
          <span style={{ color: "#94a3b8" }}>localhost:5173</span>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: "72px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 32px",
            borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
            background: "rgba(15, 23, 42, 0.5)",
          }}
        >
          <div>
            <div style={{ fontSize: "13px", color: "#64748b" }}>보험 지능 업무 공간</div>
            <div style={{ fontSize: "18px", fontWeight: 600, color: "#f1f5f9", marginTop: "2px" }}>
              {MENU_ITEMS.find((m) => m.id === activeMenu)?.label ?? "홈"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {session ? (
              <>
                <div style={{ fontSize: "13px", color: "#94a3b8" }}>{user?.email}</div>
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "999px",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                    background: "rgba(30, 41, 59, 0.8)",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily:
                      '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <div
                style={{
                  padding: "8px 14px",
                  borderRadius: "999px",
                  background: "rgba(34, 197, 94, 0.12)",
                  border: "1px solid rgba(34, 197, 94, 0.35)",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#4ade80",
                }}
              >
                ● 시스템 준비 완료
              </div>
            )}
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "14px",
                color: "#fff",
              }}
            >
              LG
            </div>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            display:
              activeMenu === "admin" || activeMenu === CUSTOMER_DASHBOARD_MENU
                ? "block"
                : "grid",
            gridTemplateColumns:
              activeMenu === "admin" || activeMenu === CUSTOMER_DASHBOARD_MENU
                ? undefined
                : "1fr 300px",
            gap: "24px",
            padding: "28px 32px",
            overflow: "auto",
          }}
        >
          {activeMenu === AUTH_MENU ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
              {authLoading || session ? null : <AuthPanel onLoginSuccess={handleLoginSuccess} />}
            </div>
          ) : activeMenu === CUSTOMER_DASHBOARD_MENU ? (
            <CustomerDashboardPanel user={user} />
          ) : activeMenu === "admin" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
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
                        background: active
                          ? "rgba(37, 99, 235, 0.25)"
                          : "rgba(15, 23, 42, 0.5)",
                        color: active ? "#f8fafc" : "#94a3b8",
                        fontSize: "13px",
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        fontFamily:
                          '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
                      }}
                    >
                      {panel.label}
                    </button>
                  );
                })}
              </div>
              {activeAdminPanel === "carrier_product_ingestion" ? (
                <AdminCarrierProductIngestionPanel />
              ) : activeAdminPanel === "manual_knowledge_ingestion" ? (
                <AdminManualKnowledgeIngestionPanel />
              ) : activeAdminPanel === "manual_knowledge_search_review" ? (
                <AdminManualKnowledgeSearchReviewPanel />
              ) : activeAdminPanel === "policy_rag" ? (
                <AdminPolicyRagPanel />
              ) : activeAdminPanel === "policy_chunk_processing" ? (
                <AdminPolicyChunkProcessingPanel />
              ) : activeAdminPanel === "policy_embedding_preparation" ? (
                <AdminPolicyEmbeddingPreparationPanel />
              ) : activeAdminPanel === "policy_vector_search" ? (
                <AdminPolicyVectorSearchPanel />
              ) : activeAdminPanel === "policy_grounding_context" ? (
                <AdminPolicyGroundingContextPanel />
              ) : activeAdminPanel === "claude_grounding_integration" ? (
                <AdminClaudeGroundingIntegrationPanel />
              ) : activeAdminPanel === "policy_embedding_execution" ? (
                <AdminPolicyEmbeddingExecutionPanel />
              ) : activeAdminPanel === "claude_execution" ? (
                <AdminClaudeExecutionPanel />
              ) : activeAdminPanel === "policy_pdf_ingestion" ? (
                <AdminPolicyPdfIngestionPanel />
              ) : activeAdminPanel === "policy_text_extraction" ? (
                <AdminPolicyTextExtractionPanel />
              ) : activeAdminPanel === "policy_chunk_generation" ? (
                <AdminPolicyChunkGenerationPanel />
              ) : activeAdminPanel === "policy_embedding_pipeline" ? (
                <AdminPolicyEmbeddingPipelinePanel />
              ) : activeAdminPanel === "grounded_retrieval_validation" ? (
                <AdminGroundedRetrievalValidationPanel />
              ) : activeAdminPanel === "production_data_flow_validation" ? (
                <AdminProductionDataFlowValidationPanel />
              ) : activeAdminPanel === "customer_memory_integration" ? (
                <AdminCustomerMemoryIntegrationPanel />
              ) : activeAdminPanel === "customer_conversation_memory" ? (
                <AdminCustomerConversationMemoryPanel />
              ) : activeAdminPanel === "customer_grounded_conversation" ? (
                <AdminCustomerGroundedConversationPanel />
              ) : activeAdminPanel === "customer_ai_conversation_execution" ? (
                <AdminCustomerAiConversationExecutionPanel />
              ) : activeAdminPanel === "real_policy_knowledge_ingestion" ? (
                <AdminRealPolicyKnowledgeIngestionPanel />
              ) : activeAdminPanel === "real_policy_pdf_upload_storage" ? (
                <AdminRealPolicyPdfUploadStoragePanel />
              ) : activeAdminPanel === "real_policy_pdf_extraction_pipeline" ? (
                <AdminRealPolicyPdfExtractionPipelinePanel />
              ) : activeAdminPanel === "real_policy_text_extraction_execution" ? (
                <AdminRealPolicyTextExtractionExecutionPanel />
              ) : activeAdminPanel === "real_policy_chunk_generation" ? (
                <AdminRealPolicyChunkGenerationPanel />
              ) : activeAdminPanel === "real_policy_embedding_preparation" ? (
                <AdminRealPolicyEmbeddingPreparationPanel />
              ) : activeAdminPanel === "real_policy_embedding_execution" ? (
                <AdminRealPolicyEmbeddingExecutionPanel />
              ) : activeAdminPanel === "real_policy_vector_search_integration" ? (
                <AdminRealPolicyVectorSearchIntegrationPanel />
              ) : activeAdminPanel === "real_policy_customer_ai_conversation" ? (
                <AdminRealPolicyCustomerAiConversationPanel />
              ) : (
                <AdminRealDataReadinessPanel />
              )}
            </div>
          ) : (
          <>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
            <section
              style={{
                background: "linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(15, 23, 42, 0.9) 60%)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                borderRadius: "20px",
                padding: "32px 36px",
                boxShadow: "0 20px 50px rgba(0, 0, 0, 0.25)",
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: "36px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#f8fafc",
                }}
              >
                라이프가드 코어
              </h1>
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "17px",
                  color: "#94a3b8",
                  maxWidth: "520px",
                }}
              >
                AI 보험 지능 플랫폼
              </p>
            </section>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "14px",
              }}
            >
              {STATUS_CARDS.map((card) => (
                <div
                  key={card.label}
                  style={{
                    background: "rgba(30, 41, 59, 0.65)",
                    border: "1px solid rgba(148, 163, 184, 0.12)",
                    borderRadius: "16px",
                    padding: "18px 20px",
                    borderTop: `3px solid ${card.tone}`,
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "18px",
                      fontWeight: 700,
                      color: "#f1f5f9",
                    }}
                  >
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            <section
              style={{
                flex: 1,
                background: "rgba(17, 24, 39, 0.9)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
                borderRadius: "20px",
                padding: "28px 32px",
                minHeight: "280px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                  }}
                >
                  ✦
                </div>
                <div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>
                    AI 상담 어시스턴트
                  </div>
                  <div style={{ fontSize: "13px", color: "#64748b" }}>
                    기억·문서·규칙 기반 근거 상담
                  </div>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  background: "rgba(15, 23, 42, 0.8)",
                  borderRadius: "14px",
                  border: "1px dashed rgba(148, 163, 184, 0.2)",
                  padding: "24px",
                  color: "#64748b",
                  fontSize: "15px",
                  lineHeight: 1.7,
                }}
              >
                보장 공백, 청구 가능성, 고지 검토, 보험료·보장 리밸런싱 등을 질문하세요. 응답은
                고객 단위 RAG, 룰 팩, 동의 기반 데이터만 사용하며 타 고객 정보는 노출되지
                않습니다.
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "24px" }}>
                <ActionButton primary>고객 분석 시작</ActionButton>
                <ActionButton>청구 가능성 확인</ActionButton>
                <ActionButton>AI 추천 열기</ActionButton>
              </div>
            </section>
          </div>

          <aside
            style={{
              background: "rgba(17, 24, 39, 0.85)",
              border: "1px solid rgba(148, 163, 184, 0.12)",
              borderRadius: "20px",
              padding: "22px 20px",
              height: "fit-content",
              position: "sticky",
              top: 0,
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "#64748b",
                marginBottom: "16px",
              }}
            >
              데이터 인사이트
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {INSIGHT_ITEMS.map((item, i) => (
                <div
                  key={item.title}
                  style={{
                    padding: "16px",
                    borderRadius: "14px",
                    background: "rgba(30, 41, 59, 0.5)",
                    border: "1px solid rgba(148, 163, 184, 0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"][i],
                      }}
                    />
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#e2e8f0" }}>
                      {item.title}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </aside>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ children, primary = false }) {
  return (
    <button
      type="button"
      style={{
        padding: "12px 20px",
        borderRadius: "12px",
        border: primary ? "none" : "1px solid rgba(148, 163, 184, 0.25)",
        background: primary
          ? "linear-gradient(135deg, #2563eb, #4f46e5)"
          : "rgba(30, 41, 59, 0.8)",
        color: "#f8fafc",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: primary ? "0 8px 24px rgba(37, 99, 235, 0.35)" : "none",
      }}
    >
      {children}
    </button>
  );
}
