const MEMORY_STATUS_LABELS = {
  ready: "Memory 준비됨",
  degraded: "Memory 부분 동기화",
  failed: "Memory 갱신 실패",
};

const MEMORY_STATUS_TONES = {
  ready: "ready",
  degraded: "pending",
  failed: "default",
};

export function memoryStatusLabel(status) {
  if (!status) return "Memory 확인 중";
  return MEMORY_STATUS_LABELS[status] ?? "Memory 확인 중";
}

export function memoryStatusTone(status) {
  return MEMORY_STATUS_TONES[status] ?? "default";
}

export function deriveMemoryStatusFromUnified(unified) {
  if (!unified) return null;
  if (unified.memory_status) return unified.memory_status;
  const factCount = unified.memory_fact_count ?? 0;
  const hasSource =
    Boolean(unified.flags?.has_profile) ||
    Boolean(unified.flags?.has_health) ||
    Boolean(unified.flags?.has_policies) ||
    (unified.document_count ?? 0) > 0;
  if (!hasSource) return "ready";
  if (factCount === 0) return "degraded";
  return "ready";
}
