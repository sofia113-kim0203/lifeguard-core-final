/**
 * P6-1 — conversation history merge (DB + request session), no insurance-only topic taxonomy.
 */

export function normalizeRequestHistoryForSnapshot(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .map((turn) => ({
      role: turn?.role === "assistant" ? "assistant" : "user",
      content: String(turn?.content ?? turn?.message ?? "").trim(),
    }))
    .filter((turn) => turn.content);
}

export function buildRecentConversationSummary(rows = []) {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const userMessages = sorted.filter((row) => row.role === "user").slice(0, 8);
  const latestUserMessages = userMessages.map((row) => String(row.message ?? "").trim()).filter(Boolean);
  const latestUserMessageExcerpt = latestUserMessages[0] ?? null;

  return {
    hasHistory: latestUserMessages.length > 0,
    latestUserMessages,
    latestUserMessageExcerpt,
    messageCount: sorted.length,
  };
}

/** Merge in-session request history (most recent) with persisted conversation rows. */
export function buildMergedRecentConversationSummary(dbRows = [], requestHistory = []) {
  const dbSummary = buildRecentConversationSummary(dbRows);
  const requestTurns = normalizeRequestHistoryForSnapshot(requestHistory);
  const requestUserMessages = requestTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .filter(Boolean);

  if (requestUserMessages.length === 0) {
    return dbSummary;
  }

  const seen = new Set();
  const mergedUserMessages = [];
  for (const message of [...requestUserMessages.slice(-8).reverse(), ...(dbSummary.latestUserMessages ?? [])]) {
    if (seen.has(message)) continue;
    seen.add(message);
    mergedUserMessages.push(message);
    if (mergedUserMessages.length >= 8) break;
  }

  return {
    hasHistory: mergedUserMessages.length > 0,
    latestUserMessages: mergedUserMessages,
    latestUserMessageExcerpt: mergedUserMessages[0] ?? null,
    messageCount: (dbSummary.messageCount ?? 0) + requestUserMessages.length,
    includesRequestHistory: true,
    sources: [
      ...(dbRows.length > 0 ? ["db"] : []),
      ...(requestUserMessages.length > 0 ? ["request_history"] : []),
    ],
  };
}
