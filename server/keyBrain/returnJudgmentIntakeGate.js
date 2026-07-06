/**
 * P5-C — RETURN_JUDGMENT trigger / dedupe gates (pure — unit-testable).
 */
import {
  KEY_BRIDGE_GAP_MIN_HOURS,
  computeGapHours,
  kstCalendarDayKey,
  resolveBridgeAnchorJobId,
  threadHasKeyBridgeRow,
} from "./bridgeIntakeGate.js";

export { KEY_BRIDGE_GAP_MIN_HOURS as RETURN_JUDGMENT_GAP_MIN_HOURS, computeGapHours };

export function threadHasReturnJudgmentRow(rows = []) {
  return (rows ?? []).some((row) => {
    const meta = row?.metadata_json ?? row?.metadata ?? {};
    return meta.key_presence === true && meta.key_presence_source === "return_judgment";
  });
}

export function hasSameDayReturnJudgmentForAnchor(rows = [], anchorJobId, now = new Date()) {
  const today = kstCalendarDayKey(now);
  if (!today || !anchorJobId) return false;
  return (rows ?? []).some((row) => {
    const meta = row?.metadata_json ?? row?.metadata ?? {};
    if (meta.key_presence_source !== "return_judgment") return false;
    if (String(meta.anchor_job_id ?? "") !== String(anchorJobId)) return false;
    const day = kstCalendarDayKey(row.created_at ?? row.createdAt);
    return day === today;
  });
}

export function evaluateReturnJudgmentEmitGate({
  gapHours,
  hasThreadMessages = false,
  hasBridgeInSession = false,
  hasAnchor = false,
  hasReturnJudgmentInSession = false,
  sameDayAnchorReturnJudgment = false,
  uploadEntryActive = true,
  panelResultsPresent = false,
} = {}) {
  const reasons = [];
  if (!uploadEntryActive) reasons.push("upload_entry_inactive");
  if (!hasThreadMessages) reasons.push("no_thread");
  if (gapHours < KEY_BRIDGE_GAP_MIN_HOURS) reasons.push("gap_under_72h");
  if (!hasBridgeInSession) reasons.push("bridge_required_first");
  if (!hasAnchor) reasons.push("no_anchor");
  if (!panelResultsPresent) reasons.push("no_panel_context");
  if (hasReturnJudgmentInSession) reasons.push("return_judgment_in_session");
  if (sameDayAnchorReturnJudgment) reasons.push("same_day_anchor_return_judgment");
  return {
    emit: reasons.length === 0,
    reasons,
  };
}

export { resolveBridgeAnchorJobId, threadHasKeyBridgeRow };
