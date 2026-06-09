/**
 * Phase 26 Step 2A/2B — Fast conversational response from real analysis + source data state.
 * No placeholders — only memory facts, DB source context, and cache status drive the message.
 */

const STAGE_LABELS = {
  coverage_gap: "보장 공백",
  underwriting_risk: "인수 위험",
  recommendation: "보험 추천",
  insurance_design: "보험설계안",
};

function findFact(facts, keyPart) {
  return facts.find((fact) => String(fact.fact_key ?? "").includes(keyPart));
}

function summarizeMemoryContext(memorySnapshot, sourceContext = null, sourceSummary = null) {
  const facts = memorySnapshot?.facts ?? [];
  const profile = memorySnapshot?.profile ?? sourceContext?.profile ?? {};
  const summary = sourceSummary ?? {};
  const name =
    findFact(facts, "profile.name")?.fact_value?.trim() ||
    profile.display_name ||
    summary.profile?.name ||
    null;
  const medication =
    findFact(facts, "health.medication")?.fact_value?.trim() ||
    summary.health?.medication ||
    null;
  const indemnity =
    facts.some((fact) => /실손|indemnity/i.test(`${fact.fact_key} ${fact.fact_value}`)) ||
    (summary.insurance ?? []).some((policy) => /실손/i.test(`${policy.product} ${policy.type}`));
  const policyCount =
    findFact(facts, "insurance.policy.count")?.fact_value ??
    (sourceContext?.policies?.length || summary.insurance?.length || 0);

  return {
    customerLabel: name ? `${name}님` : "고객님",
    medication,
    hasIndemnity: indemnity,
    policyCount: policyCount ? Number(policyCount) : null,
    factCount: memorySnapshot?.fact_count ?? facts.length,
    memoryVersion: memorySnapshot?.memory_version ?? 0,
    hasSourceProfile: Boolean(sourceContext?.has_profile || profile.display_name),
    hasSourceHealth: Boolean(sourceContext?.has_health || summary.health?.medication),
    hasSourcePolicies: Boolean(sourceContext?.has_policies || (summary.insurance ?? []).length > 0),
    hasSourceDocuments: Boolean(sourceContext?.has_documents || (summary.documents ?? []).length > 0),
  };
}

function pendingStageLabels(cachePayload) {
  const refreshTypes = cachePayload?.background_refresh_types ?? [];
  return refreshTypes.map((type) => STAGE_LABELS[type] ?? type);
}

export function buildFastConversationalResponse({
  question,
  memorySnapshot,
  cachePayload,
  sourceContext = null,
  sourceSummary = null,
} = {}) {
  const trimmedQuestion = String(question ?? "").trim();
  const memory = summarizeMemoryContext(memorySnapshot, sourceContext, sourceSummary);
  const pending = pendingStageLabels(cachePayload);
  const allFresh = cachePayload?.cache_status === "fresh";
  const hasAnyCustomerData =
    memory.factCount > 0 ||
    memory.hasSourceProfile ||
    memory.hasSourceHealth ||
    memory.hasSourcePolicies;
  const lines = [];

  lines.push(`${memory.customerLabel}, 질문해 주신 내용을 확인했습니다.`);

  if (trimmedQuestion) {
    lines.push(
      `"${trimmedQuestion.length > 80 ? `${trimmedQuestion.slice(0, 80)}…` : trimmedQuestion}"에 대해 상담을 이어가겠습니다.`,
    );
  }

  if (memory.factCount > 0) {
    lines.push(
      `Customer Memory ${memory.factCount}건(버전 ${memory.memoryVersion})을 기준으로 분석을 진행합니다.`,
    );
  } else if (hasAnyCustomerData) {
    const parts = [];
    if (memory.hasSourceProfile) parts.push("프로필");
    if (memory.hasSourceHealth) parts.push("건강");
    if (memory.hasSourcePolicies) parts.push("보험");
    lines.push(
      `고객 분석 화면에 등록된 ${parts.join("·")} 정보를 Memory에 반영한 뒤 분석을 진행합니다.`,
    );
  } else {
    lines.push("고객 분석 입력(프로필·건강·보험)을 먼저 저장해 주시면 더 정확한 상담이 가능합니다.");
  }

  if (memory.medication) {
    lines.push(`기록된 복용 정보(${memory.medication})를 인수 심사 분석에 반영합니다.`);
  }

  if (memory.hasIndemnity) {
    lines.push("현재 기록 기준 실손 보장은 유지 가능한 상태로 확인됩니다.");
  } else if (memory.policyCount != null && memory.policyCount > 0) {
    lines.push(`등록된 활성 보험 ${memory.policyCount}건을 기준으로 보장 공백을 점검합니다.`);
  }

  if (memory.hasSourceDocuments) {
    lines.push("문서 관리에 업로드된 자료가 있으면 약관·서류 분석에 함께 반영합니다.");
  }

  if (allFresh) {
    lines.push("최근 분석 결과가 유효합니다. 질문과 연결된 정밀 분석 결과를 바로 반영하겠습니다.");
  } else if (pending.length > 0) {
    lines.push(`백그라운드에서 ${pending.join(" → ")} 순서로 정밀 분석을 실행합니다.`);
    lines.push("고객님의 정보와 약관을 함께 분석하고 있습니다.");
    lines.push("가입 가능성과 보장 공백을 확인하는 중입니다.");
  }

  if (memory.medication || /약|병력|건강|질환/.test(trimmedQuestion)) {
    lines.push("분석되는 동안 추가 병력이나 복용약이 있는지 알려주시면 정확도가 높아집니다.");
  }

  lines.push("분석이 완료되면 보장 공백·인수 위험·추천·설계안 결과가 화면에 자동으로 연결됩니다.");

  return lines.join("\n\n");
}

export function buildStageProgressLabel(stageKey, status = "completed") {
  const label = STAGE_LABELS[stageKey] ?? stageKey;
  if (status === "processing") return `${label} 분석 중…`;
  if (status === "completed") return `${label} 분석 완료`;
  if (status === "failed") return `${label} 분석 실패`;
  return `${label} 대기`;
}

export { STAGE_LABELS };
