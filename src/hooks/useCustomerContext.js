import { useCallback, useEffect, useState } from "react";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

export function useCustomerContext(user) {
  const userId = user?.id ?? null;
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [resolvedUserId, setResolvedUserId] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!user) {
      setContext(null);
      setResolvedUserId(null);
      setLoading(false);
      setError("");
      return null;
    }

    const id = user.id;
    setLoading(true);
    setError("");
    try {
      const data = await loadCustomerDashboardData(user);
      const next = {
        email: data.email,
        customerId: data.customerId,
        displayName: data.displayName,
        userRole: data.userRole ?? "customer",
      };
      setContext(next);
      setResolvedUserId(id);
      return next;
    } catch (err) {
      setContext(null);
      // Resolved for this user (failed) — do not spin forever as "unsettled".
      setResolvedUserId(id);
      setError(toCustomerErrorMessage(err, "고객 정보를 불러오지 못했습니다."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Close the null→user gap: useState(Boolean(user)) does not re-init, so loading can
  // stay false for one frame while context is still null. Treat that as role-unsettled.
  const awaitingRole = Boolean(userId) && (loading || resolvedUserId !== userId);
  const liveContext = resolvedUserId === userId ? context : null;

  return { context: liveContext, loading: awaitingRole, error, reload };
}
