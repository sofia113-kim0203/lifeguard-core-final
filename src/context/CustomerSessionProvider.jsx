import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isCustomerUnauthorizedError } from "../lib/customerApiAuth.js";
import { fetchLatestAnalysisJob } from "../lib/customerConversationalAnalysis.js";
import { loadCustomerDashboardData } from "../lib/customerDashboard.js";
import {
  applyUnifiedDashboardFields,
  isUnifiedProfileMissingError,
  loadCustomerUnifiedState,
} from "../lib/customerUnifiedState.js";
import { deriveMemoryStatusFromUnified } from "../lib/memoryStatus.js";
import { postCustomerSystemMessage } from "../lib/customerConversations.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const CustomerSessionContext = createContext(null);
const SESSION_LOAD_TIMEOUT_MS = 15_000;

async function loadCustomerSessionRecords(user, event) {
  let unified = null;
  try {
    unified = await loadCustomerUnifiedState({ lastEvent: event });
  } catch (err) {
    if (!isUnifiedProfileMissingError(err)) {
      throw err;
    }
    await loadCustomerDashboardData(user);
    unified = await loadCustomerUnifiedState({ lastEvent: event });
  }

  const dashboard = applyUnifiedDashboardFields(
    await loadCustomerDashboardData(user, { unifiedState: unified }),
    unified,
  );
  return { dashboard, unified };
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function hasCachedSessionData({ dashboardData, unifiedState, activeAnalysisJob }) {
  return Boolean(dashboardData || unifiedState || activeAnalysisJob);
}

export function CustomerSessionProvider({ user, authSession = null, authLoading = false, children }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [unifiedState, setUnifiedState] = useState(null);
  const [activeAnalysisJob, setActiveAnalysisJob] = useState(null);
  const [memoryStatus, setMemoryStatus] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");
  const [lastEvent, setLastEvent] = useState(null);
  const sessionCacheRef = useRef({ dashboardData: null, unifiedState: null, activeAnalysisJob: null });

  sessionCacheRef.current = { dashboardData, unifiedState, activeAnalysisJob };

  const refreshSession = useCallback(
    async ({ event = null, reloadJob = true } = {}) => {
      if (!user) {
        setDashboardData(null);
        setUnifiedState(null);
        setActiveAnalysisJob(null);
        setMemoryStatus(null);
        setLoading(false);
        setError("");
        setLastEvent(null);
        return null;
      }

      if (authLoading) {
        return null;
      }

      if (!authSession?.access_token) {
        setLoading(false);
        setError("로그인이 필요합니다.");
        return null;
      }

      const blockUiWithLoading = !hasCachedSessionData(sessionCacheRef.current);
      if (blockUiWithLoading) {
        setLoading(true);
      }
      setError("");
      try {
        const { dashboard, unified } = await withTimeout(
          loadCustomerSessionRecords(user, event),
          SESSION_LOAD_TIMEOUT_MS,
          "고객 세션 요청 시간이 초과되었습니다. 다시 시도해 주세요.",
        );
        setDashboardData(dashboard);
        setUnifiedState(unified);
        setMemoryStatus(deriveMemoryStatusFromUnified(unified));
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
        if (isCustomerUnauthorizedError(err)) {
          setError("로그인이 필요합니다. 다시 로그인해 주세요.");
        } else {
          setError(toCustomerErrorMessage(err, "고객 세션을 불러오지 못했습니다."));
        }
        return null;
      } finally {
        if (blockUiWithLoading) {
          setLoading(false);
        }
      }
    },
    [user, authSession, authLoading],
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
      memoryStatus,
      setMemoryStatus,
      loading,
      error,
      lastEvent,
      refreshSession,
      notifySystemMessage,
      insurancePolicyCount: unifiedState?.policy_count ?? null,
      memoryVersion: unifiedState?.memory_version ?? null,
      stateHash: unifiedState?.state_hash ?? null,
    }),
    [
      user,
      dashboardData,
      unifiedState,
      activeAnalysisJob,
      memoryStatus,
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
