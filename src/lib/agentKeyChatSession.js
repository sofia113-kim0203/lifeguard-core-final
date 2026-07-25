/**
 * Advisor KEY chat continuity — sessionStorage only (tab session).
 * Keyed by authenticated agent user id + scope id. Never customer DB.
 */

export const AGENT_HOME_SCOPE_GENERAL = "__general__";

const KEY_PREFIX = "lg_agent_key_chat_v1";

/**
 * @param {string} agentUserId
 * @param {string} scopeId
 */
export function agentKeyChatSessionStorageKey(agentUserId, scopeId) {
  const agent = String(agentUserId ?? "").trim();
  const scope = String(scopeId ?? "").trim() || AGENT_HOME_SCOPE_GENERAL;
  return `${KEY_PREFIX}:${agent}:${scope}`;
}

/**
 * @param {unknown} messages
 */
export function sanitizeAgentKeyChatMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const row of list) {
    const role = row?.role === "assistant" ? "assistant" : "user";
    const content = String(row?.content ?? "").trim();
    if (!content && row?.thinking !== true) continue;
    const item = {
      role,
      content: String(row?.content ?? ""),
      thinking: row?.thinking === true,
    };
    if (row?.mode != null) item.mode = row.mode;
    if (row?.customer_context_used === true) item.customer_context_used = true;
    if (row?.wait_secondary) item.wait_secondary = String(row.wait_secondary);
    out.push(item);
  }
  return out;
}

/**
 * @param {string} agentUserId
 * @param {string} scopeId
 * @param {{ storage?: Storage | null }} [opts]
 */
export function readAgentKeyChatSession(agentUserId, scopeId, opts = {}) {
  const storage =
    opts.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!storage) return null;
  const agent = String(agentUserId ?? "").trim();
  if (!agent) return null;
  try {
    const raw = storage.getItem(agentKeyChatSessionStorageKey(agent, scopeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      scopeId: String(parsed.scopeId ?? scopeId),
      messages: sanitizeAgentKeyChatMessages(parsed.messages),
      updatedAt: Number(parsed.updatedAt) || null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} agentUserId
 * @param {string} scopeId
 * @param {unknown} messages
 * @param {{ storage?: Storage | null }} [opts]
 */
export function writeAgentKeyChatSession(agentUserId, scopeId, messages, opts = {}) {
  const storage =
    opts.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!storage) return false;
  const agent = String(agentUserId ?? "").trim();
  if (!agent) return false;
  const scope = String(scopeId ?? "").trim() || AGENT_HOME_SCOPE_GENERAL;
  try {
    storage.setItem(
      agentKeyChatSessionStorageKey(agent, scope),
      JSON.stringify({
        scopeId: scope,
        messages: sanitizeAgentKeyChatMessages(messages),
        updatedAt: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} agentUserId
 * @param {string} scopeId
 * @param {{ storage?: Storage | null }} [opts]
 */
export function clearAgentKeyChatSession(agentUserId, scopeId, opts = {}) {
  const storage =
    opts.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!storage) return;
  const agent = String(agentUserId ?? "").trim();
  if (!agent) return;
  try {
    storage.removeItem(agentKeyChatSessionStorageKey(agent, scopeId));
  } catch {
    /* ignore */
  }
}

/**
 * Remove all advisor KEY chat scopes for one agent (logout).
 * @param {string} agentUserId
 * @param {{ storage?: Storage | null }} [opts]
 */
export function clearAllAgentKeyChatSessions(agentUserId, opts = {}) {
  const storage =
    opts.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!storage) return 0;
  const agent = String(agentUserId ?? "").trim();
  if (!agent) return 0;
  const prefix = `${KEY_PREFIX}:${agent}:`;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    /* ignore */
  }
  return removed;
}
