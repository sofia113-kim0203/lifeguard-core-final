export function normalizeClaudeExplanationEntry(entry) {
  if (!entry) {
    return { explanation: null, meta: null };
  }
  if (typeof entry === "string") {
    return {
      explanation: entry,
      meta: { skipped: false, source: "legacy_string" },
    };
  }
  return {
    explanation: entry.explanation ?? null,
    meta: entry.meta ?? null,
  };
}

export function hasClaudeExplanation(entry) {
  const normalized = normalizeClaudeExplanationEntry(entry);
  return Boolean(String(normalized.explanation ?? "").trim());
}
