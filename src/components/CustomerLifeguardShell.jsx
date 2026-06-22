/**
 * P4-A — Customer layer-1 shell: full-viewport LIFEGUARD chat only (no backoffice menus).
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
import CustomerHomePanel from "./CustomerHomePanel.jsx";
import LifeguardHomeChat from "./LifeguardHomeChat.jsx";

export default function CustomerLifeguardShell({
  user,
  userRole = "customer",
  session,
  authLoading = false,
  onOpenAuth,
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
    return <CustomerHomePanel user={null} onOpenAuth={onOpenAuth} />;
  }

  return (
    <CustomerSessionProvider user={user} authSession={session} authLoading={authLoading}>
      <LifeguardHomeChat layer1Only />
    </CustomerSessionProvider>
  );
}
