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

/** Insurer-progress statuses counted as "진행 중" on the customer left rail. */
export const UI_CLAIM_IN_PROGRESS_STATUSES = Object.freeze([
  "preparing",
  "ready_for_customer_submission",
  "submitted_by_customer",
  "under_review",
]);

/** Candidate only — not insurer-filed; never shown as "접수" / "진행 중". */
export const UI_CLAIM_CANDIDATE_STATUSES = Object.freeze(["identified"]);

const CLAIM_STAGE = Object.freeze({
  identified: "확인 필요",
  preparing: "준비",
  ready_for_customer_submission: "준비",
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

  // 청구 — prefer real progress / terminal; identified alone → 확인 필요 (never 접수)
  const claimRow =
    claims.find((c) =>
      [
        "under_review",
        "submitted_by_customer",
        "ready_for_customer_submission",
        "preparing",
        "paid",
        "denied",
      ].includes(String(c?.status ?? "")),
    ) ||
    claims.find((c) => UI_CLAIM_CANDIDATE_STATUSES.includes(String(c?.status ?? ""))) ||
    null;
  const claimStage =
    claimStageLabel(claimRow?.status) ||
    (done.corporateClaimStatus ? claimStageLabel(done.corporateClaimStatus) : null);
  if (claimStage) {
    chips.push({
      id: "claim",
      label: `청구 · ${claimStage}`,
      tone: claimStage === "확인 필요" ? "amber" : "navy",
    });
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
      {
        key: "prep",
        label: "준비",
        on: [
          "preparing",
          "ready_for_customer_submission",
          "submitted_by_customer",
          "under_review",
          "paid",
          "denied",
        ].includes(stage),
      },
      {
        key: "submitted",
        label: "접수",
        on: ["submitted_by_customer", "under_review", "paid", "denied"].includes(stage),
      },
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

/** Final customer UI shell — display model from verified KEY facts only. No demo invent. */
const FINAL_CLAIM_STEPS = Object.freeze([
  { key: "prep", label: "준비" },
  { key: "docs", label: "서류검토" },
  { key: "filed", label: "접수" },
  { key: "review", label: "심사중" },
  { key: "paid", label: "지급완료" },
]);

const DIAGNOSIS_IDS = Object.freeze([
  "cancer_diagnosis",
  "cerebrovascular_diagnosis",
  "ischemic_heart_diagnosis",
]);

const DIAGNOSIS_LABELS = Object.freeze({
  cancer_diagnosis: "암",
  cerebrovascular_diagnosis: "뇌혈관",
  ischemic_heart_diagnosis: "허혈성 심장질환",
});

function clockTypeLabel(type) {
  const t = String(type ?? "").trim();
  if (t === "premium_due") return "월 보험료 납입";
  if (t === "policy_renewal") return "갱신 검토";
  if (t === "policy_maturity") return "만기";
  if (t === "lapse_scheduled") return "실효 예정";
  if (t === "reinstate_by") return "부활 기한";
  if (t === "claim_followup") return "청구 후속";
  return trim(t, 24) || "보험 일정";
}

function daysUntil(dueAt) {
  const due = String(dueAt ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const ms = new Date(`${due}T12:00:00`).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function claimStepIndex(status) {
  const s = String(status ?? "").trim();
  if (s === "paid") return 4;
  if (s === "denied") return 3;
  if (s === "under_review") return 3;
  if (s === "submitted_by_customer") return 2;
  if (s === "ready_for_customer_submission" || s === "preparing") return 0;
  // identified is candidate-only — never mapped onto the in-progress stepper as 접수.
  return -1;
}

export function isUiClaimInProgressStatus(status) {
  return UI_CLAIM_IN_PROGRESS_STATUSES.includes(String(status ?? "").trim());
}

export function isUiClaimCandidateStatus(status) {
  return UI_CLAIM_CANDIDATE_STATUSES.includes(String(status ?? "").trim());
}

function formatCompactWon(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 10000) {
    const man = n / 10000;
    const text = Number.isInteger(man) ? String(man) : man.toFixed(1).replace(/\.0$/, "");
    return `${text}만 원`;
  }
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/**
 * Build left/right/action shell for final customer UI.
 * SSOT shell sections always present; empty slots stay honest ("확인 전" / empty).
 * Never invent counts, dates, goals, payouts, or demo chat.
 */
export function buildCustomerUiFinalShellModel({
  insuranceStatus = null,
  monthlyPremiumSum = null,
  coverageBaseline = null,
  handSnapshot = null,
  viewMode = "personal",
  entityId = null,
} = {}) {
  const scope = { mode: String(viewMode || "personal"), entityId };
  const snap = handSnapshot && typeof handSnapshot === "object" ? handSnapshot : {};
  const claims = scopeRows(snap.claims, scope);
  const clocks = scopeRows(snap.clocks, scope).filter((c) => {
    const st = String(c?.status ?? "active");
    return (st === "active" || st === "expired") && String(c?.due_at ?? "").trim();
  });
  const evidence = scopeRows(snap.evidence, scope);
  const ledger = scopeRows(snap.ledger, scope);
  const paymentTruth = scopeRows(snap.paymentTruth, scope);

  const activeClaims = claims.filter((c) => isUiClaimInProgressStatus(c?.status));
  const candidateClaims = claims.filter((c) => isUiClaimCandidateStatus(c?.status));
  const primaryClaim = activeClaims[0] || null;
  let claimProgress;
  if (primaryClaim) {
    const idx = claimStepIndex(primaryClaim.status);
    const steps = FINAL_CLAIM_STEPS.map((step, i) => ({
      ...step,
      state: idx < 0 ? "future" : i < idx ? "done" : i === idx ? "current" : "future",
    }));
    claimProgress = {
      empty: false,
      mode: "in_progress",
      activeCount: activeClaims.length,
      candidateCount: candidateClaims.length,
      kindLabel: trim(primaryClaim.claim_type || primaryClaim.product_hint || "청구", 24) || "청구",
      receivedAt: trim(primaryClaim.received_at || primaryClaim.created_at || "", 32) || null,
      currentIndex: idx,
      steps,
    };
  } else if (candidateClaims.length > 0) {
    // Candidate only — not insurer-filed progress; no "N건 진행 중" / no 접수 stepper.
    claimProgress = {
      empty: false,
      mode: "candidate",
      activeCount: 0,
      candidateCount: candidateClaims.length,
      kindLabel: "확인 필요",
      receivedAt: null,
      currentIndex: -1,
      steps: [],
    };
  } else {
    claimProgress = {
      empty: true,
      mode: "empty",
      activeCount: 0,
      candidateCount: 0,
      kindLabel: null,
      receivedAt: null,
      currentIndex: -1,
      steps: [],
    };
  }

  const confirmed = Number(insuranceStatus?.confirmedCount);
  const needs = Number(insuranceStatus?.needsCount);
  const total = Number(insuranceStatus?.totalCount);
  const baselineItems = Array.isArray(coverageBaseline?.items) ? coverageBaseline.items : [];
  const shortItems = baselineItems.filter(
    (it) =>
      DIAGNOSIS_IDS.includes(it.id) &&
      it.status === "미달" &&
      it.currentAmount != null &&
      Number.isFinite(Number(it.currentAmount)),
  );

  // Left "가입 핵심" only — schedules stay on the right (no L/R duplicate).
  const coreMetrics = [];
  if (Number.isFinite(total) && total > 0) {
    const bits = [];
    if (Number.isFinite(confirmed)) bits.push(`유효 ${confirmed}건`);
    if (Number.isFinite(needs) && needs > 0) bits.push(`확인 필요 ${needs}건`);
    coreMetrics.push({
      id: "policies",
      title: `가입 건수 ${total}건`,
      sub: bits.join(" · ") || null,
      tone: "default",
      pending: false,
    });
  } else {
    coreMetrics.push({
      id: "policies",
      title: "가입 건수",
      sub: "확인 전",
      tone: "muted",
      pending: true,
    });
  }

  if (monthlyPremiumSum != null && Number(monthlyPremiumSum) > 0) {
    const month = formatCompactWon(monthlyPremiumSum);
    const year = formatCompactWon(Number(monthlyPremiumSum) * 12);
    if (month) {
      coreMetrics.push({
        id: "premium",
        title: `월 보험료 ${month}`,
        sub: year ? `연 ${year}` : null,
        tone: "default",
        pending: false,
      });
    } else {
      coreMetrics.push({
        id: "premium",
        title: "월 보험료",
        sub: "확인 전",
        tone: "muted",
        pending: true,
      });
    }
  } else {
    coreMetrics.push({
      id: "premium",
      title: "월 보험료",
      sub: "확인 전",
      tone: "muted",
      pending: true,
    });
  }

  const coverageGap =
    shortItems.length > 0
      ? {
          pending: false,
          title: `보장 공백 ${shortItems.length}곳`,
          sub: trim(`${shortItems[0].shortLabel || shortItems[0].label} 부족`, 28) || "확인된 부족",
        }
      : {
          pending: true,
          title: "확인 전",
          sub: "확인된 공백이 생기면 여기에 모읍니다",
        };

  // Always surface the 3 diagnosis rows from industry baseline path.
  // Missing verified amounts → honest "확인 전" (never invent numbers).
  const diagnosis = [];
  for (const id of DIAGNOSIS_IDS) {
    const item = baselineItems.find((it) => it.id === id);
    const label = DIAGNOSIS_LABELS[id] || item?.shortLabel || item?.label || id;
    const baselineAmt =
      item?.industry_representative != null
        ? Number(item.industry_representative)
        : item?.industry_range_low != null
          ? Number(item.industry_range_low)
          : null;
    const baselineOk = baselineAmt != null && Number.isFinite(baselineAmt) && baselineAmt > 0;
    const curRaw = item?.currentAmount;
    const curOk = curRaw != null && Number.isFinite(Number(curRaw));
    if (!item || !item.isAmountMode || !curOk) {
      diagnosis.push({
        id,
        label,
        pending: true,
        currentDisplay: "확인 전",
        baselineDisplay: baselineOk ? formatCompactWon(baselineAmt) : null,
        ratio: 0,
        tone: "muted",
      });
      continue;
    }
    const cur = Number(curRaw);
    if (!baselineOk) {
      diagnosis.push({
        id,
        label,
        pending: true,
        currentDisplay: item.currentDisplay || formatCompactWon(cur) || "확인 전",
        baselineDisplay: null,
        ratio: 0,
        tone: "muted",
      });
      continue;
    }
    const ratio = Math.max(0, Math.min(100, Math.round((cur / baselineAmt) * 100)));
    diagnosis.push({
      id,
      label,
      pending: false,
      currentDisplay: item.currentDisplay || formatCompactWon(cur),
      baselineDisplay: formatCompactWon(baselineAmt),
      ratio,
      tone: item.status === "미달" ? "warn" : item.status === "충족" ? "ok" : "muted",
    });
  }

  const reviewingCount = claims.filter((c) => String(c?.status) === "under_review").length;
  const paidTruth = paymentTruth.filter((r) => r.outcome === "paid");
  let yearPaidDisplay = "집계 전";
  let yearPaidKnown = false;
  let yearSum = 0;
  for (const row of paidTruth) {
    const amt = Number(row?.paid_amount ?? row?.amount ?? row?.payout_amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    yearSum += amt;
    yearPaidKnown = true;
  }
  if (yearPaidKnown) yearPaidDisplay = formatCompactWon(yearSum) || "집계 전";

  const schedules = clocks
    .slice()
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
    .slice(0, 2)
    .map((c) => {
      const d = daysUntil(c.due_at);
      return {
        id: c.clock_id || `${c.clock_type}_${c.due_at}`,
        dLabel: d == null ? null : d >= 0 ? `D-${d}` : `D+${Math.abs(d)}`,
        title: trim(c.label, 36) || clockTypeLabel(c.clock_type),
        dueAt: c.due_at,
      };
    })
    .filter((s) => s.dLabel && s.dueAt);

  const activities = [];
  for (const c of activeClaims.slice(0, 2)) {
    activities.push({
      id: `claim_${c.claim_case_key || c.id}`,
      title: "청구 상태 갱신",
      when: trim(c.updated_at || c.received_at || "", 20) || null,
    });
  }
  for (const e of evidence.slice(0, 2)) {
    if (activities.length >= 3) break;
    activities.push({
      id: `ev_${e.id || e.evidence_id || activities.length}`,
      title: "서류 보관",
      when: trim(e.stored_at || e.created_at || "", 20) || null,
    });
  }
  for (const p of paidTruth.slice(0, 2)) {
    if (activities.length >= 3) break;
    activities.push({
      id: `pay_${p.id || activities.length}`,
      title: p.outcome === "paid" ? "지급 결과 확인" : "부지급 결과 확인",
      when: trim(p.updated_at || p.created_at || "", 20) || null,
    });
  }

  const goals = ledger
    .filter((e) => e.type === "goal" && String(e.status || "active") === "active")
    .slice(0, 2)
    .map((g, i) => ({
      id: g.id || `goal_${i}`,
      text: trim(g.content, 80),
    }))
    .filter((g) => g.text);

  const actionPills = [];
  const missingDocs = activeClaims.some((c) => {
    const missing = c.missing_documents || c.needed_documents;
    return Array.isArray(missing) && missing.length > 0;
  });
  if (missingDocs) actionPills.push({ id: "docs", label: "서류 보완하기" });
  if (shortItems.length > 0) {
    actionPills.push({
      id: "gap",
      label: `${shortItems[0].shortLabel || "보장"} 보완 검토하기`,
    });
  }
  if (paidTruth.length > 0 || claims.some((c) => c.status === "paid" || c.status === "denied")) {
    actionPills.push({ id: "result", label: "최근 청구 결과 보기" });
  }

  // Center action card — always present; never invent a fake claim story.
  let nowAction = {
    pending: true,
    title: "다음 행동 · 확인 전",
    body: "KEY가 자료와 대화를 확인하면 다음 행동을 여기에 제시합니다.",
    ctaLabel: "준비가 되면 알려주기",
    ctaHint: "사진으로 보내 주셔도 괜찮아요",
    submitText: "준비가 되면 알려주기",
  };
  if (missingDocs) {
    nowAction = {
      pending: false,
      title: "남은 서류를 준비해 주세요",
      body: "청구에 필요한 서류가 확인되면, 준비되는 대로 알려 주세요. 제가 이어서 도와드리겠습니다.",
      ctaLabel: "서류 준비됐으면 알려주기",
      ctaHint: "사진으로 보내 주셔도 괜찮아요",
      submitText: "서류 보완하기",
    };
  } else if (shortItems.length > 0) {
    const gapLabel = shortItems[0].shortLabel || "보장";
    nowAction = {
      pending: false,
      title: `${gapLabel} 보완을 같이 볼까요`,
      body: "확인된 보장 공백을 바탕으로, 다음에 무엇을 보면 좋은지 이 자리에서 이어가겠습니다.",
      ctaLabel: "보완 검토 시작하기",
      ctaHint: null,
      submitText: `${gapLabel} 보완 검토하기`,
    };
  }

  const paymentResults = [];
  for (const p of paymentTruth.slice(0, 3)) {
    const outcome = String(p?.outcome || p?.status || "").toLowerCase();
    const paid = outcome === "paid" || outcome === "지급";
    const denied = outcome === "denied" || outcome === "거절" || outcome === "부지급";
    if (!paid && !denied) continue;
    paymentResults.push({
      id: p.id || `pay_${paymentResults.length}`,
      title: paid ? "지급 결과" : "거절 결과",
      reason:
        trim(p.reason || p.denial_reason || p.note || "", 80) ||
        (paid ? "지급이 확인되었습니다." : "거절 사유를 확인 중입니다."),
    });
  }

  const familyMemory = {
    hint: "기억한 가족 · 아직 기록 없음",
    count: 0,
  };
  const notesMemory = { text: "" };

  return {
    claimProgress,
    coreMetrics,
    coverageGap,
    diagnosis,
    familyMemory,
    notesMemory,
    nowAction,
    moneyFlow: {
      reviewingCount,
      yearPaidDisplay,
      yearPaidKnown,
    },
    schedules,
    activities: activities.slice(0, 3),
    goals,
    paymentResults,
    actionPills,
  };
}
