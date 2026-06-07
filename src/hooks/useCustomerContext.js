import { useCallback, useEffect, useState } from "react";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";

export function useCustomerContext(user) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!user) {
      setContext(null);
      setLoading(false);
      setError("");
      return null;
    }

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
      return next;
    } catch (err) {
      setContext(null);
      setError(err.message || "고객 정보를 불러오지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { context, loading, error, reload };
}
