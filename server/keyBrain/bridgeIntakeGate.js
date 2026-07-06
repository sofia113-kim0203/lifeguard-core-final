/**
 * P5-B — KEY Bridge trigger / dedupe gates (pure — unit-testable).
 */

export const KEY_BRIDGE_GAP_MIN_HOURS = 72;
export const KEY_BRIDGE_ANCHOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function computeGapHours(lastActivityAt, now = new Date()) {
  const lastMs = lastActivityAt ? new Date(lastActivityAt).getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, (nowMs - lastMs) / (60 * 60 * 1000));
}

export function kstCalendarDayKey(isoOrDate, now = new Date()) {
  const value = isoOrDate ?? now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function threadHasKeyBridgeRow(rows = []) {
  return (rows ?? []).some((row) => {
    const meta = row?.metadata_json ?? row?.metadata ?? {};
    return meta.key_presence === true && meta.key_presence_source === "key_bridge";
  });
}

export function resolveBridgeAnchorJobId(rows = [], fallbackJobId = null) {
  for (let i = (rows ?? []).length - 1; i >= 0; i -= 1) {
    const meta = rows[i]?.metadata_json ?? rows[i]?.metadata ?? {};
    if (meta.key_presence_source === "key_initiative" && meta.anchor_job_id) {
      return String(meta.anchor_job_id);
    }
  }
  return fallbackJobId ? String(fallbackJobId) : null;
}

export function hasSameDayBridgeForAnchor(rows = [], anchorJobId, now = new Date()) {
  const today = kstCalendarDayKey(now);
  if (!today || !anchorJobId) return false;
  return (rows ?? []).some((row) => {
    const meta = row?.metadata_json ?? row?.metadata ?? {};
    if (meta.key_presence_source !== "key_bridge") return false;
    if (String(meta.anchor_job_id ?? "") !== String(anchorJobId)) return false;
    const day = kstCalendarDayKey(row.created_at ?? row.createdAt);
    return day === today;
  });
}

export function evaluateBridgeEmitGate({
  gapHours,
  hasThreadMessages = false,
  hasAnchor = false,
  hasBridgeInSession = false,
  sameDayAnchorBridge = false,
  uploadEntryActive = true,
} = {}) {
  const reasons = [];
  if (!uploadEntryActive) reasons.push("upload_entry_inactive");
  if (!hasThreadMessages) reasons.push("no_thread");
  if (gapHours < KEY_BRIDGE_GAP_MIN_HOURS) reasons.push("gap_under_72h");
  if (!hasAnchor) reasons.push("no_anchor");
  if (hasBridgeInSession) reasons.push("bridge_in_session");
  if (sameDayAnchorBridge) reasons.push("same_day_anchor_bridge");
  return {
    emit: reasons.length === 0,
    reasons,
  };
}
