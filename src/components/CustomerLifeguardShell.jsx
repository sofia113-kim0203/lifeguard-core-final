/**
 * P4-UI MASTER — Customer shell: LIFEGUARD chat only (warm light experience).
 */
import { useEffect } from "react";
import { CustomerSessionProvider } from "../context/CustomerSessionProvider.jsx";
import {
  getRedirectPathForRole,
  isBackofficePath,
  LIFEGUARD_PATH,
  normalizeAppPath,
} from "../lib/appRouting.js";
import { fetchAppRouteGate } from "../lib/appRouteGateClient.js";
import AuthPanel from "./AuthPanel.jsx";
import LifeguardHomeChat from "./LifeguardHomeChat.jsx";
import { LG } from "../lib/lifeguardCustomerTheme.js";

export default function CustomerLifeguardShell({
  user,
  userRole = "customer",
  session,
  authLoading = false,
  authMode = "login",
  onOpenAuth,
  onLoginSuccess,
}) {
  useEffect(() => {
    if (!user) return;
    const path = normalizeAppPath(window.location.pathname);
    if (isBackofficePath(path)) {
      window.history.replaceState({}, "", LIFEGUARD_PATH);
    }
    fetchAppRouteGate(path)
      .then((gate) => {
        if (gate?.redirect && normalizeAppPath(gate.redirect) !== path) {
          window.history.replaceState({}, "", gate.redirect);
        }
      })
      .catch(() => {
        if (isBackofficePath(path)) {
          window.history.replaceState({}, "", getRedirectPathForRole(path, userRole));
        }
      });
  }, [user, userRole]);

  if (!user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: LG.bg,
        }}
      >
        {authLoading ? (
          <div style={{ color: LG.textMuted, fontFamily: LG.sans, fontSize: "15px" }}>잠시만요…</div>
        ) : (
          <AuthPanel key={authMode} initialMode={authMode} onLoginSuccess={onLoginSuccess} />
        )}
      </div>
    );
  }

  return (
    <CustomerSessionProvider user={user} authSession={session} authLoading={authLoading}>
      <LifeguardHomeChat layer1Only />
    </CustomerSessionProvider>
  );
}
