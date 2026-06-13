function messageDedupeKey(row) {
  if (!row || typeof row !== "object") return null;
  if (row.id) return `id:${String(row.id)}`;
  const createdAt = row.createdAt ?? row.created_at ?? "";
  const role = row.role ?? "";
  const message = String(row.message ?? "").trim().slice(0, 120);
  if (!createdAt && !role && !message) return null;
  return `fallback:${createdAt}|${role}|${message}`;
}

/** Deduplicate by message id; id-less rows use created_at/role/message fallback. */
export function dedupeMessagesById(rows) {
  const byKey = new Map();
  const unkeyed = [];

  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const key = messageDedupeKey(row);
    if (!key) {
      unkeyed.push(row);
      continue;
    }
    byKey.set(key, row);
  }

  const sortTime = (row) => {
    const value = row?.createdAt ?? row?.created_at ?? null;
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return [...byKey.values(), ...unkeyed].sort((a, b) => sortTime(a) - sortTime(b));
}

/**
 * Phase 30-B — Hide phase26-2a-fast when phase26-2a-result exists for the same job.
 * DB rows unchanged; display-only filter.
 */
export function filterMessagesForDisplay(rows) {
  const deduped = dedupeMessagesById(Array.isArray(rows) ? rows : []);
  const resultJobIds = new Set(
    deduped
      .filter(
        (row) =>
          row?.metadata?.phase === "phase26-2a-result" &&
          row?.metadata?.analysis_job_id,
      )
      .map((row) => String(row.metadata.analysis_job_id)),
  );

  return deduped.filter((row) => {
    if (row?.metadata?.phase !== "phase26-2a-fast") return true;
    const jobId = row?.metadata?.analysis_job_id;
    if (!jobId) return true;
    return !resultJobIds.has(String(jobId));
  });
}
