import { useEffect, useState } from "react";
import AdminMenuPanel from "./components/AdminMenuPanel.jsx";
import AgentDeskPanel from "./components/AgentDeskPanel.jsx";
import AiRecommendationPanel from "./components/AiRecommendationPanel.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import ResetPasswordPanel from "./components/ResetPasswordPanel.jsx";
import ClaimCheckPanel from "./components/ClaimCheckPanel.jsx";
import CustomerDashboardPanel from "./components/CustomerDashboardPanel.jsx";
import DocumentsPanel from "./components/DocumentsPanel.jsx";
import RoleAccessPanel from "./components/RoleAccessPanel.jsx";
import { CustomerSessionProvider } from "./context/CustomerSessionProvider.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { supabase } from "./lib/supabase.js";

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

const FULL_WIDTH_MENUS = new Set([
  AUTH_MENU,
  CUSTOMER_DASHBOARD_MENU,
  "claim",
  "ai",
  "documents",
  "agent",
  "admin",
]);

const STATUS_CARDS = [
  { label: "DB 연결 완료", value: "온라인", tone: "#22c55e" },
  { label: "테이블 33개", value: "스키마", tone: "#38bdf8" },
  { label: "보안 정책 182개", value: "접근 제어", tone: "#a78bfa" },
  { label: "벡터 검색 준비", value: "완료", tone: "#f59e0b" },
  { label: "원격 DB 연결", value: "설정됨", tone: "#34d399" },
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
    title: "약관·지식 검색",
    desc: "고객별 문서와 사례 지식 검색.",
  },
];

function AiRecommendationMenuPanel({ user }) {
  return <AiRecommendationPanel user={user} useSessionJob />;
}

function renderMainContent(activeMenu, { user, authLoading, onLoginSuccess, authMode }) {
  switch (activeMenu) {
    case AUTH_MENU:
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
          {authLoading || user ? null : (
            <AuthPanel key={authMode} onLoginSuccess={onLoginSuccess} initialMode={authMode} />
          )}
        </div>
      );
    case CUSTOMER_DASHBOARD_MENU:
      return <CustomerDashboardPanel user={user} />;
    case "claim":
      return <ClaimCheckPanel user={user} />;
    case "ai":
      return <AiRecommendationMenuPanel user={user} />;
    case "documents":
      return <DocumentsPanel user={user} />;
    case "agent":
      return <AgentDeskPanel user={user} />;
    case "admin":
      return (
        <RoleAccessPanel
          user={user}
          title="관리자"
          description="운영·데이터·약관 지식·AI 파이프라인 관리 화면입니다."
          requiredRoles={["admin"]}
          allowedContent={<AdminMenuPanel user={user} />}
        />
      );
    default:
      return <HomePanel />;
  }
}

function normalizeAppPath(pathname) {
  const trimmed = (pathname || "/").replace(/\/+$/, "") || "/";
  return trimmed;
}

function isResetPasswordPath(pathname) {
  return normalizeAppPath(pathname) === "/reset-password";
}

export default function App() {
  const [activeMenu, setActiveMenu] = useState("home");
  const [authMode, setAuthMode] = useState("login");
  const [appPath, setAppPath] = useState(() =>
    typeof window !== "undefined" ? normalizeAppPath(window.location.pathname) : "/",
  );
  const { session, user, loading: authLoading } = useAuthSession();

  useEffect(() => {
    const syncPath = () => setAppPath(normalizeAppPath(window.location.pathname));
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, "", path);
    setAppPath(normalizeAppPath(path));
  };

  const handleGoToLogin = (mode = "login") => {
    if (window.location.hash) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    setAuthMode(mode);
    navigateTo("/");
    setActiveMenu(AUTH_MENU);
  };

  if (isResetPasswordPath(appPath)) {
    return <ResetPasswordPanel onGoToLogin={handleGoToLogin} />;
  }

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

  const isFullWidth = FULL_WIDTH_MENUS.has(activeMenu);

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
          <span style={{ color: "#94a3b8" }}>고객 서비스 연결됨</span>
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
            display: isFullWidth ? "block" : "grid",
            gridTemplateColumns: isFullWidth ? undefined : "1fr 300px",
            gap: "24px",
            padding: "28px 32px",
            overflow: "auto",
          }}
        >
          {user ? (
            <CustomerSessionProvider user={user}>
              {renderMainContent(activeMenu, {
                user,
                authLoading,
                onLoginSuccess: handleLoginSuccess,
                authMode,
              })}
            </CustomerSessionProvider>
          ) : (
            renderMainContent(activeMenu, {
              user,
              authLoading,
              onLoginSuccess: handleLoginSuccess,
              authMode,
            })
          )}
        </div>
      </div>
    </div>
  );
}

function HomePanel() {
  return (
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
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{card.label}</div>
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
              <div style={{ fontSize: "13px", color: "#64748b" }}>기억·문서·규칙 기반 근거 상담</div>
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
            고객별 문서·규칙·동의 기반 데이터만 사용하며 다른 고객 정보는 노출되지 않습니다.
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
