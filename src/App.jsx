import { useEffect, useState } from "react";
import AdminMenuPanel from "./components/AdminMenuPanel.jsx";
import AgentDeskPanel from "./components/AgentDeskPanel.jsx";
import AiRecommendationPanel from "./components/AiRecommendationPanel.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import ResetPasswordPanel from "./components/ResetPasswordPanel.jsx";
import ClaimCheckPanel from "./components/ClaimCheckPanel.jsx";
import CorporatePanel from "./components/CorporatePanel.jsx";
import CustomerAiChatRoomWrapper from "./components/CustomerAiChatRoomWrapper.jsx";
import CustomerDashboardPanel from "./components/CustomerDashboardPanel.jsx";
import CustomerHomePanel from "./components/CustomerHomePanel.jsx";
import DocumentsPanel from "./components/DocumentsPanel.jsx";
import RoleAccessPanel from "./components/RoleAccessPanel.jsx";
import { CustomerSessionProvider } from "./context/CustomerSessionProvider.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useCustomerContext } from "./hooks/useCustomerContext.js";
import {
  APP_ROLES,
  canAccessPath,
  getRedirectPathForRole,
  isBackofficePath,
  isBackofficeRole,
  LIFEGUARD_PATH,
  normalizeAppPath,
  resolveMenuIdFromPath,
  resolvePathFromMenuId,
} from "./lib/appRouting.js";
import { supabase } from "./lib/supabase.js";
import CustomerLifeguardShell from "./components/CustomerLifeguardShell.jsx";
import KeyRoomVisualSeat, {
  isLocalKeyRoomVisualSeat,
} from "./components/KeyRoomVisualSeat.jsx";
import { LG } from "./lib/lifeguardCustomerTheme.js";

const CUSTOMER_DASHBOARD_MENU = "customer";
const AI_CHAT_MENU = "chat";
const AUTH_MENU = "auth";

const MENU_ITEMS = [
  { id: "home", label: "홈", mark: "H" },
  { id: CUSTOMER_DASHBOARD_MENU, label: "고객 분석", mark: "C" },
  { id: AI_CHAT_MENU, label: "AI 상담실", mark: "S" },
  { id: "ai", label: "내 보험 점검", mark: "R" },
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
  AI_CHAT_MENU,
  "claim",
  "ai",
  "documents",
  "corporate",
  "agent",
  "admin",
]);

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

function AiRecommendationMenuPanel({ user, onNavigate }) {
  return (
    <AiRecommendationPanel user={user} useSessionJob onNavigateToChat={() => onNavigate?.(AI_CHAT_MENU)} />
  );
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
      return <CustomerDashboardPanel user={user} onNavigate={onNavigate} />;
    case AI_CHAT_MENU:
      return <CustomerAiChatRoomWrapper user={user} onNavigate={onNavigate} />;
    case "claim":
      return <ClaimCheckPanel user={user} />;
    case "ai":
      return <AiRecommendationMenuPanel user={user} onNavigate={onNavigate} />;
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

function isResetPasswordPath(pathname) {
  return normalizeAppPath(pathname) === "/reset-password";
}

function pageTitle(activeMenu) {
  if (activeMenu === AUTH_MENU) return "로그인 / 회원가입";
  return MENU_ITEMS.find((m) => m.id === activeMenu)?.label ?? "홈";
}

export default function App() {
  const [activeMenu, setActiveMenu] = useState(() => resolveMenuIdFromPath(window.location.pathname) ?? "home");
  const [authMode, setAuthMode] = useState("login");
  const [appPath, setAppPath] = useState(() =>
    typeof window !== "undefined" ? normalizeAppPath(window.location.pathname) : "/",
  );
  const { session, user, loading: authLoading } = useAuthSession();
  const { context, loading: roleLoading } = useCustomerContext(user);
  const userRole = context?.userRole ?? (user ? APP_ROLES.CUSTOMER : null);

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
    navigateTo(LIFEGUARD_PATH);
    setActiveMenu(AUTH_MENU);
  };

  const handleLoginSuccess = () => {
    const requestedPath = normalizeAppPath(
      typeof window !== "undefined" ? window.location.pathname : LIFEGUARD_PATH,
    );
    // Role may still be loading right after auth — keep the requested path, then let the
    // existing access effect apply getRedirectPathForRole once userRole is known.
    if (userRole && !roleLoading) {
      const nextPath = canAccessPath(requestedPath, userRole)
        ? normalizeAppPath(requestedPath)
        : getRedirectPathForRole(requestedPath, userRole);
      setActiveMenu(resolveMenuIdFromPath(nextPath) ?? "home");
      navigateTo(nextPath);
      return;
    }
    setActiveMenu(resolveMenuIdFromPath(requestedPath) ?? "home");
    navigateTo(requestedPath);
  };

  const handleOpenAuth = (mode = "login") => {
    setAuthMode(mode);
    setActiveMenu(AUTH_MENU);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveMenu("home");
    navigateTo(LIFEGUARD_PATH);
  };

  useEffect(() => {
    if (session && activeMenu === AUTH_MENU) {
      setActiveMenu("home");
    }
  }, [session, activeMenu]);

  useEffect(() => {
    if (!user || roleLoading) return;
    if (userRole === APP_ROLES.CUSTOMER) {
      if (isBackofficePath(appPath)) {
        navigateTo(LIFEGUARD_PATH);
      }
      return;
    }
    const menuFromPath = resolveMenuIdFromPath(appPath);
    if (menuFromPath && menuFromPath !== activeMenu) {
      setActiveMenu(menuFromPath);
    }
    if (!canAccessPath(appPath, userRole)) {
      navigateTo(getRedirectPathForRole(appPath, userRole));
    }
  }, [user, userRole, appPath, roleLoading, activeMenu]);

  const handleMenuSelect = (menuId) => {
    setActiveMenu(menuId);
    if (user && isBackofficeRole(userRole)) {
      navigateTo(resolvePathFromMenuId(menuId));
    }
  };

  const handleNavigate = (menuId) => {
    handleMenuSelect(menuId);
  };

  if (isLocalKeyRoomVisualSeat()) {
    return <KeyRoomVisualSeat />;
  }

  if (isResetPasswordPath(appPath)) {
    return <ResetPasswordPanel onGoToLogin={handleGoToLogin} />;
  }

  if (authLoading || (user && roleLoading)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: LG.bg,
          color: LG.textMuted,
          fontFamily: LG.sans,
        }}
      >
        잠시만요…
      </div>
    );
  }

  if (!user || userRole === APP_ROLES.CUSTOMER) {
    return (
      <CustomerLifeguardShell
        user={user}
        userRole={userRole ?? APP_ROLES.CUSTOMER}
        session={session}
        authLoading={authLoading}
        authMode={authMode}
        onOpenAuth={handleOpenAuth}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

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
            <CustomerSessionProvider user={user} authSession={session} authLoading={authLoading}>
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
