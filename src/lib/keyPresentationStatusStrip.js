/**
 * Presentation status strip — display-only chips from KEY Hand SSOT / done payload.
 * No judgment · no probability · no Claude · empty rows stay hidden.
 */

export const KEY_HAND_FACT_PATHS = Object.freeze({
  claims: "key_active_claim_cases",
  clocks: "key_insurance_clock_items",
  evidence: "key_claim_evidence_items",
  ledger: "key_life_ledger_items",
  paymentTruth: "key_payment_truth_items",
});

const CLAIM_STAGE = Object.freeze({
  identified: "접수",
  preparing: "접수",
  submitted_by_customer: "접수",
  under_review: "심사",
  paid: "지급",
  denied: "부지급",
});

function trim(v, max = 80) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function scopeRows(rows, { mode = "personal", entityId = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const eid = String(entityId ?? "").trim() || null;
  if (mode === "corporate") {
    if (!eid) return [];
    return list.filter((r) => String(r?.entity_id ?? "").trim() === eid);
  }
  if (mode === "both") {
    return list.filter((r) => {
      const rowEid = String(r?.entity_id ?? "").trim();
      return !rowEid || (eid && rowEid === eid);
    });
  }
  return list.filter((r) => !String(r?.entity_id ?? "").trim());
}

function claimStageLabel(status) {
  const key = String(status ?? "").trim();
  return CLAIM_STAGE[key] || null;
}

/**
 * Build presentation chips from Hand snapshot + optional done-derived overlay.
 * @returns {{ chips: Array<{id:string,label:string,tone?:string}>, claimProgress: object|null }}
 */
export function buildKeyPresentationStatusStrip({
  handSnapshot = null,
  doneStatus = null,
  viewMode = "personal",
  entityId = null,
} = {}) {
  const scope = { mode: String(viewMode || "personal"), entityId };
  const snap = handSnapshot && typeof handSnapshot === "object" ? handSnapshot : {};
  const done = doneStatus && typeof doneStatus === "object" ? doneStatus : {};

  const claims = scopeRows(snap.claims ?? done.claims, scope);
  const clocks = scopeRows(snap.clocks ?? done.clocks, scope);
  const evidence = scopeRows(snap.evidence ?? done.evidence, scope);
  const ledger = scopeRows(snap.ledger ?? done.ledger, scope);
  const paymentTruth = scopeRows(snap.paymentTruth ?? done.paymentTruth, scope);

  const chips = [];

  // 청구
  const claimRow =
    claims.find((c) => ["under_review", "submitted_by_customer", "preparing", "paid", "denied"].includes(c.status)) ||
    claims[0] ||
    null;
  const claimStage =
    claimStageLabel(claimRow?.status) ||
    (done.corporateClaimStatus ? claimStageLabel(done.corporateClaimStatus) : null);
  if (claimStage) {
    chips.push({ id: "claim", label: `청구 · ${claimStage}`, tone: "navy" });
  }

  // 기한 — active clocks only
  const activeClocks = clocks.filter((c) => {
    const st = String(c?.status ?? "active");
    return st === "active" || st === "expired" || st === "unknown_date";
  });
  if (activeClocks.length > 0) {
    const due = activeClocks.find((c) => c.due_at)?.due_at;
    const type = activeClocks[0]?.clock_type;
    const typeLabel =
      type === "premium_due"
        ? "납입"
        : type === "lapse_scheduled"
          ? "실효"
          : type === "reinstate_by"
            ? "부활"
            : "기한";
    chips.push({
      id: "clock",
      label: due ? `기한 · ${typeLabel} ${due}` : `기한 · ${activeClocks.length}건`,
      tone: "amber",
    });
  }

  // 증거
  const evidenceCount =
    evidence.length ||
    (Number(done.evidenceItemCount) > 0 ? Number(done.evidenceItemCount) : 0);
  if (evidenceCount > 0) {
    chips.push({ id: "evidence", label: `증거 · ${evidenceCount}건`, tone: "muted" });
  }

  // 목표 — ledger goals or session goal from done
  const goals = ledger.filter((e) => e.type === "goal" && String(e.status || "active") === "active");
  const goalText =
    trim(goals[0]?.content, 36) ||
    trim(done.sessionGoalText, 36) ||
    trim(done.openGoalText, 36);
  if (goalText) {
    chips.push({ id: "goal", label: `목표 · ${goalText}`, tone: "green" });
  }

  // 지급결과 — payment truth preferred, else claim paid/denied
  const truthRow =
    paymentTruth.find((r) => r.outcome === "paid" || r.outcome === "denied") ||
    paymentTruth[0] ||
    null;
  if (truthRow?.outcome === "paid") {
    chips.push({ id: "payment", label: "지급결과 · 지급", tone: "green" });
  } else if (truthRow?.outcome === "denied") {
    chips.push({ id: "payment", label: "지급결과 · 부지급", tone: "rose" });
  } else if (claimRow?.status === "paid") {
    chips.push({ id: "payment", label: "지급결과 · 지급", tone: "green" });
  } else if (claimRow?.status === "denied") {
    chips.push({ id: "payment", label: "지급결과 · 부지급", tone: "rose" });
  }

  // Claim / payment progress strip (same data, richer when present)
  let claimProgress = null;
  const progressClaim = claimRow || (truthRow ? { status: truthRow.outcome === "paid" ? "paid" : truthRow.outcome === "denied" ? "denied" : null } : null);
  if (progressClaim && claimStageLabel(progressClaim.status)) {
    const stage = String(progressClaim.status);
    const stages = [
      { key: "submitted", label: "접수", on: ["preparing", "submitted_by_customer", "under_review", "paid", "denied", "identified"].includes(stage) },
      { key: "review", label: "심사", on: ["under_review", "paid", "denied"].includes(stage) },
      { key: "paid", label: "지급", on: stage === "paid" },
      { key: "denied", label: "부지급", on: stage === "denied" },
    ];
    const reasonCustomer =
      trim(truthRow?.reason_customer_stated, 60) ||
      (stage === "denied" ? trim(progressClaim.denial_reason, 60) : "");
    const reasonVerbatim = trim(truthRow?.reason_verbatim, 60);
    const verification = trim(truthRow?.verification_status, 40);
    claimProgress = {
      stages: stages.filter((s) => {
        // Hide inactive terminal opposite (don't show both paid+denied as equal)
        if (s.key === "paid" && stage === "denied") return true; // show unpaid state as off
        if (s.key === "denied" && stage === "paid") return true;
        return true;
      }),
      activeStage: claimStageLabel(stage),
      reason_customer_stated: reasonCustomer || null,
      reason_verbatim: reasonVerbatim || null,
      verification_status: verification || null,
      reason_source_label:
        reasonVerbatim && verification === "insurer_verified"
          ? "보험사 확인"
          : reasonCustomer
            ? "고객 진술"
            : null,
    };
  }

  return { chips, claimProgress };
}

/** Pull display fields from mapped / raw home-brain done payload (no invent). */
export function extractKeyStatusFromDonePayload(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const voice =
    payload.salesDirectorTrace?.key_compose_trace?.key_voice_trace ??
    payload.sales_director_trace?.key_compose_trace?.key_voice_trace ??
    payload.keyStatusVoice ??
    null;
  const sessionGoal =
    payload.sessionGoal ??
    payload.session_goal ??
    null;
  const consultation =
    payload.keyConsultationRecord ??
    payload.key_consultation_record ??
    null;
  const openGoal =
    Array.isArray(consultation?.open_goals) && consultation.open_goals[0]
      ? consultation.open_goals[0].goal ?? consultation.open_goals[0]
      : null;

  const claims = Array.isArray(payload.keyStatus?.claims)
    ? payload.keyStatus.claims
    : Array.isArray(voice?.active_claim_cases)
      ? voice.active_claim_cases
      : null;
  const clocks = Array.isArray(payload.keyStatus?.clocks)
    ? payload.keyStatus.clocks
    : Array.isArray(voice?.insurance_clock_items)
      ? voice.insurance_clock_items
      : null;
  const evidence = Array.isArray(payload.keyStatus?.evidence)
    ? payload.keyStatus.evidence
    : null;
  const ledger = Array.isArray(payload.keyStatus?.ledger)
    ? payload.keyStatus.ledger
    : null;
  const paymentTruth = Array.isArray(payload.keyStatus?.paymentTruth)
    ? payload.keyStatus.paymentTruth
    : null;

  const corporateClaimStatus = voice?.corporate_claim_hand?.status ?? null;
  const evidenceItemCount =
    Number(voice?.claim_evidence_brief?.item_count ?? voice?.claim_evidence_hydrated ?? 0) || 0;

  const hasAny =
    claims?.length ||
    clocks?.length ||
    evidence?.length ||
    ledger?.length ||
    paymentTruth?.length ||
    sessionGoal?.goal ||
    openGoal ||
    corporateClaimStatus ||
    evidenceItemCount > 0;

  if (!hasAny) return null;

  return {
    claims: claims || [],
    clocks: clocks || [],
    evidence: evidence || [],
    ledger: ledger || [],
    paymentTruth: paymentTruth || [],
    sessionGoalText: trim(sessionGoal?.goal, 36) || null,
    openGoalText: trim(openGoal, 36) || null,
    corporateClaimStatus,
    evidenceItemCount,
  };
}

export function buildHandSnapshotFromDetailsJson(detailsJson = null) {
  if (!detailsJson || typeof detailsJson !== "object") {
    return { claims: [], clocks: [], evidence: [], ledger: [], paymentTruth: [] };
  }
  return {
    claims: Array.isArray(detailsJson[KEY_HAND_FACT_PATHS.claims])
      ? detailsJson[KEY_HAND_FACT_PATHS.claims]
      : [],
    clocks: Array.isArray(detailsJson[KEY_HAND_FACT_PATHS.clocks])
      ? detailsJson[KEY_HAND_FACT_PATHS.clocks]
      : [],
    evidence: Array.isArray(detailsJson[KEY_HAND_FACT_PATHS.evidence])
      ? detailsJson[KEY_HAND_FACT_PATHS.evidence]
      : [],
    ledger: Array.isArray(detailsJson[KEY_HAND_FACT_PATHS.ledger])
      ? detailsJson[KEY_HAND_FACT_PATHS.ledger]
      : [],
    paymentTruth: Array.isArray(detailsJson[KEY_HAND_FACT_PATHS.paymentTruth])
      ? detailsJson[KEY_HAND_FACT_PATHS.paymentTruth]
      : [],
  };
}

/** Customer document status — separate original storage from factory analysis. */
export function formatCustomerDocumentStorageStatus(document = null) {
  if (!document) return null;
  if (document.deleted_at) return "삭제됨";
  const path = String(document.storage_path ?? "").trim();
  const ingest = String(document.ingest_status ?? "").trim();
  if (!path) return "업로드 실패";
  if (ingest === "failed" && !path) return "업로드 실패";
  // Bytes may be unknown client-side; storage_path present ⇒ original kept.
  if (path) return "원본 보관 완료";
  return null;
}

export function formatCustomerDocumentFactoryStatus(document = null) {
  if (!document) return null;
  const extractionStatus = document?.metadata_json?.policy_extraction_status;
  if (extractionStatus === "completed") return "자동 정리 완료";
  if (extractionStatus === "extraction_failed") return "자동 정리 보류";
  if (extractionStatus === "pending_manual_review") return "자동 정리 검토 중";
  if (document?.ingest_status === "ready") return "자동 정리 진행 중";
  return null; // hide when not applicable — do not say PDF read failed
}

export function resolvePdfWaitStatusText({ hasDocumentAttach = false } = {}) {
  if (hasDocumentAttach) {
    return {
      primary: "원본 문서를 읽고 있어요.",
      secondary: "파일이 크면 조금 더 걸릴 수 있어요.",
    };
  }
  return {
    primary: "KEY가 확인하고 있어요.",
    secondary: null,
  };
}
