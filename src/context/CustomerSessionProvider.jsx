import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchLatestAnalysisJob } from "../lib/customerConversationalAnalysis.js";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";
import { loadCustomerUnifiedState } from "../lib/customerUnifiedState.js";
import { postCustomerSystemMessage } from "../lib/customerConversations.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const CustomerSessionContext = createContext(null);

export function CustomerSessionProvider({ user, children }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [unifiedState, setUnifiedState] = useState(null);
  const [activeAnalysisJob, setActiveAnalysisJob] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");
  const [lastEvent, setLastEvent] = useState(null);

  const refreshSession = useCallback(
    async ({ event = null, reloadJob = true } = {}) => {
      if (!user) {
        setDashboardData(null);
        setUnifiedState(null);
        setActiveAnalysisJob(null);
        setLoading(false);
        setError("");
        setLastEvent(null);
        return null;
      }

      setLoading(true);
      setError("");
      try {
        const [dashboard, unified] = await Promise.all([
          loadCustomerDashboardData(user),
          loadCustomerUnifiedState({ lastEvent: event }),
        ]);
        setDashboardData(dashboard);
        setUnifiedState(unified);
        if (event) setLastEvent(event);

        if (reloadJob) {
          try {
            const latestJob = await fetchLatestAnalysisJob();
            if (latestJob) setActiveAnalysisJob(latestJob);
          } catch {
            // no active job is acceptable
          }
        }

        return { dashboard, unified };
      } catch (err) {
        setError(toCustomerErrorMessage(err, "고객 세션을 불러오지 못했습니다."));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  const notifySystemMessage = useCallback(
    async (message, { metadata = {}, refresh = true } = {}) => {
      if (!user) return null;
      const row = await postCustomerSystemMessage(user, message, metadata, {
        customerId: dashboardData?.customerId ?? null,
      });
      if (refresh) {
        await refreshSession({ event: "system_message", reloadJob: false });
      }
      return row;
    },
    [user, dashboardData?.customerId, refreshSession],
  );

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      user,
      dashboardData,
      unifiedState,
      activeAnalysisJob,
      setActiveAnalysisJob,
      loading,
      error,
      lastEvent,
      refreshSession,
      notifySystemMessage,
      insurancePolicyCount:
        unifiedState?.policy_count ?? dashboardData?.insurancePolicyCount ?? 0,
      memoryVersion: unifiedState?.memory_version ?? dashboardData?.memoryVersion ?? 0,
      stateHash: unifiedState?.state_hash ?? null,
    }),
    [
      user,
      dashboardData,
      unifiedState,
      activeAnalysisJob,
      loading,
      error,
      lastEvent,
      refreshSession,
      notifySystemMessage,
    ],
  );

  return (
    <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>
  );
}

export function useCustomerSession() {
  const context = useContext(CustomerSessionContext);
  if (!context) {
    throw new Error("useCustomerSession must be used within CustomerSessionProvider");
  }
  return context;
}

export function useOptionalCustomerSession() {
  return useContext(CustomerSessionContext);
}
