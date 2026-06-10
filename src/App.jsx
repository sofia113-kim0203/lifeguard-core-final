import { useEffect, useState } from "react";
import AdminMenuPanel from "./components/AdminMenuPanel.jsx";
import AgentDeskPanel from "./components/AgentDeskPanel.jsx";
import AiRecommendationPanel from "./components/AiRecommendationPanel.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import ResetPasswordPanel from "./components/ResetPasswordPanel.jsx";
import ClaimCheckPanel from "./components/ClaimCheckPanel.jsx";
import CorporatePanel from "./components/CorporatePanel.jsx";
import CustomerDashboardPanel from "./components/CustomerDashboardPanel.jsx";
import CustomerHomePanel from "./components/CustomerHomePanel.jsx";
import DocumentsPanel from "./components/DocumentsPanel.jsx";
import RoleAccessPanel from "./components/RoleAccessPanel.jsx";
import { CustomerSessionProvider } from "./context/CustomerSessionProvider.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { supabase } from "./lib/supabase.js";

const CUSTOMER_DASHBOARD_MENU = "customer";
const AUTH_MENU = "auth";

const MENU_ITEMS = [
  { id: "home", label: "홈", mark: "H" },
  { id: CUSTOMER_DASHBOARD_MENU, label: "고객 분석", mark: "C" },
  { id: "ai", label: "AI 보험 추천", mark: "R" },
  { id: "claim", label: "보험금 청구 확인", mark: "P" },
  { id: "documents", label: "문서 관리", mark: "D" },
  { id: "corporate", label: "법인장", mark: "B" },
  { id: "agent", label: "설계사 데스크", mark: "A" },
  { id: "admin", label: "관리자", mark: "M" },
];

const FULL_WIDTH_MENUS = new Set([
  "home",
  AUTH_MENU,
  CUSTOMER_DASHBOARD_MENU,
  "claim",
  "ai",
  "documents",
  "corporate",
  "agent",
  "admin",
]);

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

function AiRecommendationMenuPanel({ user }) {
  return <AiRecommendationPanel user={user} useSessionJob />;
}

function renderMainContent(
  activeMenu,
  { user, authLoading, onLoginSuccess, onNavigate, onOpenAuth, authMode },
) {
  switch (activeMenu) {
    case AUTH_MENU:
      return (
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "clamp(12px, 3vw, 28px) clamp(12px, 4vw, 32px) clamp(32px, 6vw, 48px)",
            boxSizing: "border-box",
          }}
        >
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
    case "corporate":
      return <CorporatePanel />;
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
      return (
        <CustomerHomePanel user={user} onNavigate={onNavigate} onOpenAuth={onOpenAuth} />
      );
  }
}

function normalizeAppPath(pathname) {
  const trimmed = (pathname || "/").replace(/\/+$/, "") || "/";
  return trimmed;
}

function isResetPasswordPath(pathname) {
  return normalizeAppPath(pathname) === "/reset-password";
}

function pageTitle(activeMenu) {
  if (activeMenu === AUTH_MENU) return "로그인 / 회원가입";
  return MENU_ITEMS.find((m) => m.id === activeMenu)?.label ?? "홈";
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
      setActiveMenu("home");
    }
  }, [session, activeMenu]);

  const handleMenuSelect = (menuId) => {
    setActiveMenu(menuId);
  };

  const handleNavigate = (menuId) => {
    setActiveMenu(menuId);
  };

  const handleLoginSuccess = () => {
    setActiveMenu("home");
  };

  const handleOpenAuth = (mode = "login") => {
    setAuthMode(mode);
    setActiveMenu(AUTH_MENU);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveMenu("home");
  };

  const isFullWidth = FULL_WIDTH_MENUS.has(activeMenu);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
        color: "#e2e8f0",
        fontFamily: FONT,
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
        <div style={{ padding: "0 12px 24px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.14em", color: "#64748b", fontWeight: 700 }}>
            LIFEGUARD
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px", color: "#f8fafc" }}>
            보험 AI
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
                  fontFamily: FONT,
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
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                  }}
                >
                  {item.mark}
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
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {session ? (
            <>
              <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5, wordBreak: "break-all" }}>
                {user?.email}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "rgba(15, 23, 42, 0.55)",
                  color: "#e2e8f0",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleOpenAuth("login")}
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #2563eb, #4f46e5)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                로그인
              </button>
              <button
                type="button"
                onClick={() => handleOpenAuth("signup")}
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "transparent",
                  color: "#cbd5e1",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                회원가입
              </button>
            </>
          )}
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
            <div style={{ fontSize: "13px", color: "#64748b" }}>고객 보험 AI 서비스</div>
            <div style={{ fontSize: "18px", fontWeight: 600, color: "#f1f5f9", marginTop: "2px" }}>
              {pageTitle(activeMenu)}
            </div>
          </div>
          {session ? (
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>{user?.email}</div>
          ) : null}
        </header>

        <div
          style={{
            flex: 1,
            display: "block",
            padding: isFullWidth ? "28px 32px" : "28px 32px",
            overflow: "auto",
          }}
        >
          {user ? (
            <CustomerSessionProvider user={user}>
              {renderMainContent(activeMenu, {
                user,
                authLoading,
                onLoginSuccess: handleLoginSuccess,
                onNavigate: handleNavigate,
                onOpenAuth: handleOpenAuth,
                authMode,
              })}
            </CustomerSessionProvider>
          ) : (
            renderMainContent(activeMenu, {
              user,
              authLoading,
              onLoginSuccess: handleLoginSuccess,
              onNavigate: handleNavigate,
              onOpenAuth: handleOpenAuth,
              authMode,
            })
          )}
        </div>
      </div>
    </div>
  );
}
