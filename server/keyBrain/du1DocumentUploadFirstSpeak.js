/**
 * DU-1 Slice 2 — four-input KEY judgment (not template decoration).
 * Document / Policies / Memory / Conversation are separate sources with epistemic tiers.
 */
import { LOOKUP_CATEGORIES, matchPolicyToCategory } from "../intentGateLayer.js";

export const DU1_SCHEMA_VERSION = "du-1-document-upload-first-speak-v2";

export const DU1_EPISTEMIC_TIER = {
  CERTAIN: "certain",
  INFERENCE: "inference",
  UNKNOWN: "unknown",
};

export const DU1_INPUT_SOURCE = {
  DOCUMENT: "document",
  POLICIES: "policies",
  MEMORY: "memory",
  CONVERSATION: "conversation",
  EVIDENCE: "evidence",
  JUDGMENT: "judgment",
};

const OCR_FORBIDDEN_SPEECH_RE = [
  /보험사명|상품명|필드|식별\s*필드|신뢰도|field_count|OCR|Evidence|Factory|Memory\s*Loop|Memory\s*write|Memory\s*Builder|trace/i,
  /(?:삼성|현대|메리츠|KB|DB|한화|흥국|롯데|NH|AIG|AXA)[^\n]{0,20}(?:화재|손해|생명|손보)/,
  /policy_count|profile_policy|coverage_sheet_l1|passing_row_count/i,
  /확인\s*가능한\s*내용은/i,
];

const SPECULATION_RE = /것\s*같습니다|흐름과\s*맞춰\s*보면|그다음\s*단계로\s*보입니다|평소[^\n]{0,20}챙기셨는데/;
const MEMORY_AS_REGISTERED_RE = /기억[^\n]{0,24}등록|등록[^\n]{0,24}기억/;

function joinKoLabels(labels = []) {
  const list = labels.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}·${list[1]}`;
  return `${list.slice(0, -1).join("·")}·${list[list.length - 1]}`;
}

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDocumentProbeText(document = {}) {
  const meta = document.metadata_json ?? {};
  return normalizeText(
    [
      document.customer_hint_type,
      document.doc_class,
      meta.category_key,
      document.original_filename,
    ]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();
}

function detectLifeAxesFromText(text = "") {
  const probe = normalizeText(text).toLowerCase();
  if (!probe) return [];

  const labels = [];
  for (const cfg of Object.values(LOOKUP_CATEGORIES)) {
    const hit = cfg.keywords.some((keyword) => probe.includes(String(keyword).toLowerCase()));
    if (hit) labels.push(cfg.label);
  }
  return labels;
}

function summarizeExistingPolicyAxes(policies = []) {
  const labels = [];
  for (const catKey of Object.keys(LOOKUP_CATEGORIES)) {
    const match = matchPolicyToCategory(policies, catKey);
    if (match.found) labels.push(LOOKUP_CATEGORIES[catKey].label);
  }
  return labels;
}

function resolveMemoryFacts(contextSnapshot = null) {
  const bundle = contextSnapshot?.bundle ?? {};
  const facts = bundle.memoryFacts ?? bundle.memory_facts ?? [];
  return Array.isArray(facts) ? facts : [];
}

function resolveRecentConversation(contextSnapshot = null) {
  const bundle = contextSnapshot?.bundle ?? {};
  return bundle.recentConversation ?? bundle.recent_conversation ?? { hasHistory: false };
}

function resolvePolicies(contextSnapshot = null) {
  const bundle = contextSnapshot?.bundle ?? {};
  return Array.isArray(bundle.policies) ? bundle.policies : [];
}

function classifyUploadDocument(document = {}) {
  const probe = buildDocumentProbeText(document);
  const lifeAxes = detectLifeAxesFromText(probe);

  let kind = "other";
  if (/coverage_analysis|coverage_sheet|가입현황|보장분석|보장\s*분석/.test(probe)) {
    kind = "coverage_sheet";
  } else if (/insurance_policy|policy_certificate|증권|가입증권/.test(probe)) {
    kind = "insurance_policy";
  } else if (/claim|청구/.test(probe)) {
    kind = "claim";
  } else if (/medical|의료|진단서|소견서/.test(probe)) {
    kind = "medical";
  } else if (/insurance|policy|certificate|보험/.test(probe)) {
    kind = "insurance_policy";
  }

  const identifiable =
    kind === "coverage_sheet" ||
    (kind === "insurance_policy" && lifeAxes.length > 0) ||
    (kind !== "other" && kind !== "insurance_policy");

  return { kind, lifeAxes, identifiable, probe };
}

function resolveConversationStatus(loadedContext = null) {
  if (!loadedContext) return "empty";
  const conversations = loadedContext.conversations;
  if (typeof conversations === "object" && conversations != null) {
    return conversations.status ?? "empty";
  }
  return conversations ?? "empty";
}

/** loadedContext gates what KEY may speak about — not decorative. */
export function resolveDu1InputGates(loadedContext = null, bundle = {}) {
  const policies = bundle.policies ?? [];
  const memoryFacts = bundle.memoryFacts ?? [];
  const conversation = bundle.conversation ?? {};

  const policiesPresent = loadedContext?.policies === "present" && policies.length > 0;
  const memoryPresent = loadedContext?.memory === "present" && memoryFacts.length > 0;
  const conversationPresent =
    resolveConversationStatus(loadedContext) === "present" && hasSubstantiveConversation(conversation);

  return {
    documentPresent: Boolean(bundle.document?.id ?? bundle.document?.original_filename),
    policiesPresent,
    memoryPresent,
    conversationPresent,
    loadedContextApplied: loadedContext != null,
  };
}

export function hasSubstantiveConversation(conversation = {}) {
  const excerpt = normalizeText(
    conversation.latestUserMessageExcerpt ?? conversation.latestUserMessages?.[0] ?? "",
  );
  return excerpt.length >= 6;
}

/**
 * @param {object} params
 */
export function buildEa1CustomerSummaryFromMultiExtraction(multiExtraction = {}) {
  const policies = multiExtraction?.policies ?? [];
  const axisSet = new Set();
  let fieldPopulated = false;

  for (const policy of policies) {
    const fields = policy?.fields ?? {};
    const probeText = Object.values(fields)
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (probeText.length > 0) fieldPopulated = true;
    for (const axis of detectLifeAxesFromText(probeText)) {
      axisSet.add(axis);
    }
  }

  const life_axes = [...axisSet];
  const identifiable =
    life_axes.length > 0 ||
    (fieldPopulated && policies.some((row) => Number(row?.field_count ?? 0) >= 2));

  return {
    life_axes,
    identifiable,
    field_populated: fieldPopulated,
    policy_block_count: policies.length,
  };
}

export function buildDu1InputBundle({
  document = {},
  contextSnapshot = null,
  loadedContext = null,
  keyFirstJudgment = null,
} = {}) {
  const policies = resolvePolicies(contextSnapshot);
  const memoryFacts = resolveMemoryFacts(contextSnapshot);
  const conversation = resolveRecentConversation(contextSnapshot);
  const meta = document?.metadata_json ?? {};
  const ea1CustomerSummary = meta.key_ea1_customer_summary ?? null;
  const evidenceComplete =
    meta.policy_extraction_status === "completed" &&
    ea1CustomerSummary != null &&
    typeof ea1CustomerSummary === "object";
  const partial = {
    schema_version: DU1_SCHEMA_VERSION,
    context_snapshot_loaded: contextSnapshot != null,
    document,
    policies,
    memoryFacts,
    conversation,
    loadedContext,
    judgment: keyFirstJudgment,
    flags: contextSnapshot?.flags ?? {},
    documentClass: classifyUploadDocument(document),
    ea1CustomerSummary,
    evidenceComplete,
  };
  return {
    ...partial,
    inputGates: resolveDu1InputGates(loadedContext, partial),
  };
}

export function assertDu1FourInputsPresent(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  if (bundle.context_snapshot_loaded !== true) return false;
  if (!bundle.document || typeof bundle.document !== "object") return false;
  if (!Array.isArray(bundle.policies)) return false;
  if (!Array.isArray(bundle.memoryFacts)) return false;
  if (!bundle.conversation || typeof bundle.conversation !== "object") return false;
  if (!bundle.loadedContext || typeof bundle.loadedContext !== "object") return false;
  return true;
}

export function validateDu1CustomerSpeech(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { ok: false, reason: "empty_speech" };
  }
  for (const pattern of OCR_FORBIDDEN_SPEECH_RE) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: "ocr_forbidden_speech", pattern: String(pattern) };
    }
  }
  if (/Gap|추천|청구\s*가능|담보\s*부족/.test(normalized)) {
    return { ok: false, reason: "forbidden_product_leap" };
  }
  if (SPECULATION_RE.test(normalized)) {
    return { ok: false, reason: "speculation_forbidden" };
  }
  if (MEMORY_AS_REGISTERED_RE.test(normalized)) {
    return { ok: false, reason: "memory_as_registered_forbidden" };
  }
  return { ok: true, reason: "key_only_speech" };
}

export function validateDu1EpistemicSegments(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, reason: "missing_segments" };
  }
  for (const segment of segments) {
    if (!segment?.tier || !Object.values(DU1_EPISTEMIC_TIER).includes(segment.tier)) {
      return { ok: false, reason: "segment_missing_tier", segment };
    }
    if (!segment?.source || !Object.values(DU1_INPUT_SOURCE).includes(segment.source)) {
      return { ok: false, reason: "segment_missing_source", segment };
    }
    if (!normalizeText(segment.text)) {
      return { ok: false, reason: "segment_empty_text", segment };
    }
  }
  return { ok: true, reason: "epistemic_segments_valid" };
}

function describeDocumentAxisInference(documentLifeAxes = [], kind = "insurance_policy") {
  if (documentLifeAxes.includes("운전자")) {
    return "파일명·분류 기준으로 운전 중 사고 대비 쪽 계약으로 보입니다.";
  }
  if (documentLifeAxes.includes("실손")) {
    return "파일명·분류 기준으로 병원비·실손 쪽 계약으로 보입니다.";
  }
  if (documentLifeAxes.includes("암")) {
    return "파일명·분류 기준으로 암·진단비 쪽 계약으로 보입니다.";
  }
  if (kind === "insurance_policy") {
    return "파일명·분류 기준으로 보험 계약 자료로 보입니다.";
  }
  if (kind === "claim") {
    return "파일명·분류 기준으로 청구·지급 관련 자료로 보입니다.";
  }
  if (kind === "medical") {
    return "파일명·분류 기준으로 의료·진단 관련 자료로 보입니다.";
  }
  if (kind === "coverage_sheet") {
    return "파일명·분류 기준으로 가입현황표로 보입니다.";
  }
  return null;
}

function buildDocumentSegments(documentClass = {}) {
  const { kind, lifeAxes, identifiable } = documentClass;
  const segments = [];

  segments.push({
    source: DU1_INPUT_SOURCE.DOCUMENT,
    tier: DU1_EPISTEMIC_TIER.CERTAIN,
    text:
      kind === "coverage_sheet"
        ? "가입현황표를 받았습니다."
        : "올려 주신 자료를 받았습니다.",
  });

  const inference = describeDocumentAxisInference(lifeAxes, kind);
  if (inference) {
    segments.push({
      source: DU1_INPUT_SOURCE.DOCUMENT,
      tier: DU1_EPISTEMIC_TIER.INFERENCE,
      text: inference,
      basis: "filename_and_category_hint",
    });
  } else if (kind === "insurance_policy" && !identifiable) {
    segments.push({
      source: DU1_INPUT_SOURCE.DOCUMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "파일명·분류만으로는 어떤 계약인지 단정하기 어렵습니다.",
    });
  }

  return segments;
}

function describeRegisteredPolicyAxes(axes = []) {
  if (axes.length === 0) {
    return "프로필에 등록된 보험이 있습니다.";
  }
  if (axes.length === 1) {
    return `프로필에 ${axes[0]} 축 보험이 등록돼 있습니다.`;
  }
  return `프로필에 ${joinKoLabels(axes)} 축 보험이 등록돼 있습니다.`;
}

function buildPolicySegments(policies = [], documentLifeAxes = []) {
  const axes = summarizeExistingPolicyAxes(policies);
  const segments = [];

  segments.push({
    source: DU1_INPUT_SOURCE.POLICIES,
    tier: DU1_EPISTEMIC_TIER.CERTAIN,
    text: describeRegisteredPolicyAxes(axes),
  });

  if (documentLifeAxes.length > 0 && axes.length > 0) {
    const overlap = documentLifeAxes.filter((axis) => axes.includes(axis));
    const docAxis = documentLifeAxes[0];
    if (overlap.length === 0) {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `등록된 ${joinKoLabels(axes)} 축과, 이번 파일명·분류 기준 ${docAxis} 축은 겹치지 않습니다.`,
        basis: "registered_policies_vs_document_metadata",
      });
    } else {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `등록된 ${joinKoLabels(axes)} 축과 이번 자료의 ${joinKoLabels(overlap)} 축이 맞닿아 있습니다.`,
        basis: "registered_policies_vs_document_metadata",
      });
    }
  }

  return segments;
}

function buildMemorySegments(memoryFacts = []) {
  const segments = [];
  for (const fact of memoryFacts) {
    const value = normalizeText(fact?.fact_value ?? fact?.value ?? "");
    if (value.length < 6) continue;
    if (/memory_fact|fact_key|trace|qa\s*synthetic|staging\s*only|synthetic\s*memory/i.test(value)) {
      continue;
    }
    if (!/[가-힣]/.test(value) && /^[a-z0-9\s._\-()]+$/i.test(value)) {
      continue;
    }

    const axes = detectLifeAxesFromText(value);
    if (axes.length > 0) {
      segments.push({
        source: DU1_INPUT_SOURCE.MEMORY,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `이전에 기억해 둔 내용 기준으로 ${joinKoLabels(axes)} 쪽에 관심을 두신 적이 있습니다.`,
        basis: "memory_fact_keyword",
      });
      break;
    }

    segments.push({
      source: DU1_INPUT_SOURCE.MEMORY,
      tier: DU1_EPISTEMIC_TIER.CERTAIN,
      text: `이전에 기억해 둔 내용에 「${value.slice(0, 48)}」가 있습니다.`,
      basis: "memory_fact_excerpt",
    });
    break;
  }
  return segments;
}

function buildConversationSegments(conversation = {}) {
  const excerpt = normalizeText(
    conversation.latestUserMessageExcerpt ?? conversation.latestUserMessages?.[0] ?? "",
  ).slice(0, 56);
  if (excerpt.length < 6) return [];

  return [
    {
      source: DU1_INPUT_SOURCE.CONVERSATION,
      tier: DU1_EPISTEMIC_TIER.CERTAIN,
      text: `직전에 「${excerpt}」라고 말씀하셨습니다.`,
      basis: "recent_user_message_excerpt",
    },
  ];
}

function buildUnknownSegments({ kind, policiesPresent, documentClass }) {
  const segments = [];

  if (kind === "coverage_sheet") {
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "표 형식만으로는 특약·보장 상세와 '부족한 보장' 판단은 아직 어렵습니다.",
    });
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "특약 자료가 오면 그때부터 같이 보겠습니다.",
    });
    return segments;
  }

  segments.push({
    source: DU1_INPUT_SOURCE.JUDGMENT,
    tier: DU1_EPISTEMIC_TIER.UNKNOWN,
    text: "이 파일 내용만으로는 특약·보장 범위까지는 아직 말씀드리기 어렵습니다.",
  });

  if (policiesPresent) {
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "특약이나 가입현황이 함께 오면, 등록된 보험과 한 세트로 정리하겠습니다.",
    });
  } else if (!documentClass.identifiable) {
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "선명한 증권이나 가입증명서가 함께 오면, 그때 다시 맞춰 설명하겠습니다.",
    });
  } else {
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "추가 자료가 오면 그때 다시 맞춰 설명하겠습니다.",
    });
  }

  return segments;
}

function buildConsentHoldSegments() {
  return [
    {
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.CERTAIN,
      text: "문서는 안전하게 받아 두었습니다.",
    },
    {
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "내용 분석은 동의 후 KEY가 진행하겠습니다.",
    },
  ];
}

function buildIntakeEvidenceSegments(summary = {}, linkedPolicyIds = []) {
  const segments = [];
  const axes = summary.life_axes ?? [];

  if (axes.length > 0) {
    segments.push({
      source: DU1_INPUT_SOURCE.EVIDENCE,
      tier: DU1_EPISTEMIC_TIER.CERTAIN,
      text:
        linkedPolicyIds.length > 0
          ? `확인해 둔 내용 기준으로 ${joinKoLabels(axes)} 축 계약이며, 프로필과 연결돼 있습니다.`
          : `확인해 둔 내용 기준으로 ${joinKoLabels(axes)} 축 계약으로 잡혀 있습니다.`,
      basis: "ea1_intake_evidence",
    });
    return segments;
  }

  if (summary.identifiable === false) {
    segments.push({
      source: DU1_INPUT_SOURCE.EVIDENCE,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "내용 확인은 했지만, 어떤 계약인지는 아직 단정하지 않겠습니다.",
    });
  }

  return segments;
}

function buildFollowUpEvidenceSegments(summary = {}, linkedPolicyIds = []) {
  const segments = [];
  const axes = summary.life_axes ?? [];

  segments.push({
    source: DU1_INPUT_SOURCE.EVIDENCE,
    tier: DU1_EPISTEMIC_TIER.CERTAIN,
    text: "방금 올려 주신 자료 확인을 마쳤습니다.",
  });

  if (axes.length > 0 && summary.identifiable !== false) {
    segments.push({
      source: DU1_INPUT_SOURCE.EVIDENCE,
      tier: DU1_EPISTEMIC_TIER.INFERENCE,
      text:
        linkedPolicyIds.length > 0
          ? `확인된 내용 기준으로 ${joinKoLabels(axes)} 축 계약으로 보이며, 프로필과 연결해 두었습니다.`
          : `확인된 내용 기준으로 ${joinKoLabels(axes)} 축 계약으로 보입니다.`,
      basis: "ea1_customer_safe_axes",
    });
    return segments;
  }

  if (summary.identifiable === false || (axes.length === 0 && !summary.field_populated)) {
    segments.push({
      source: DU1_INPUT_SOURCE.EVIDENCE,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "확인된 식별 정보가 부족해, 어떤 계약인지는 아직 단정하지 않겠습니다.",
    });
  }

  return segments;
}

function summarizePolicySituationLabel(policies = []) {
  const axes = summarizeExistingPolicyAxes(policies);
  if (axes.length === 1) return `${axes[0]} 축 보험`;
  if (axes.length > 1) return `${joinKoLabels(axes)} 축 보험`;
  const productName = normalizeText(policies[0]?.product_name ?? "");
  if (productName.length >= 2) {
    return `「${productName.slice(0, 28)}」`;
  }
  return "등록돼 있는 보험";
}

function buildFollowUpForwardStepSegment() {
  return {
    source: DU1_INPUT_SOURCE.JUDGMENT,
    tier: DU1_EPISTEMIC_TIER.UNKNOWN,
    text: "특약·가입현황 자료가 오면, 그때부터 비교 기준이 생깁니다.",
    basis: "forward_step_after_confirmation",
  };
}

/**
 * Post-confirmation follow-up when body extract is thin — delta only, no first-speak repeat.
 */
function buildFollowUpProvisionalDeltaSegments({
  documentClass = {},
  policies = [],
  memoryFacts = [],
  conversation = {},
  gates = {},
} = {}) {
  const segments = [];
  const documentLifeAxes = documentClass.lifeAxes ?? [];
  const policyLabel = summarizePolicySituationLabel(policies);

  segments.push({
    source: DU1_INPUT_SOURCE.EVIDENCE,
    tier: DU1_EPISTEMIC_TIER.CERTAIN,
    text: "내용 확인을 마쳤습니다.",
  });

  segments.push({
    source: DU1_INPUT_SOURCE.EVIDENCE,
    tier: DU1_EPISTEMIC_TIER.INFERENCE,
    text: "파일 안쪽까지 확인했지만, 계약을 가르는 식별 정보는 아직 잡히지 않았습니다.",
    basis: "confirmation_without_identifiers",
  });

  if (gates.policiesPresent && policies.length > 0) {
    const policyAxes = summarizeExistingPolicyAxes(policies);
    if (documentLifeAxes.length > 0 && policyAxes.length > 0) {
      const overlap = documentLifeAxes.filter((axis) => policyAxes.includes(axis));
      if (overlap.length > 0) {
        segments.push({
          source: DU1_INPUT_SOURCE.POLICIES,
          tier: DU1_EPISTEMIC_TIER.INFERENCE,
          text: `새로 확인한 것은, 이번 자료가 ${joinKoLabels(overlap)} 축으로 보인다는 점입니다. 등록돼 있는 ${policyLabel}과 같은 축으로 묶어 볼 수 있습니다.`,
          basis: "post_confirmation_axis_overlap",
        });
      } else {
        segments.push({
          source: DU1_INPUT_SOURCE.POLICIES,
          tier: DU1_EPISTEMIC_TIER.INFERENCE,
          text: `새로 확인한 것은, 이번 자료(${joinKoLabels(documentLifeAxes)})와 등록돼 있는 ${policyLabel} 축이 서로 다르다는 점입니다. 추가 계약인지 같은 계약인지는 아직 구분 중입니다.`,
          basis: "post_confirmation_axis_split",
        });
      }
    } else {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `등록돼 있는 ${policyLabel}과 이번 자료를 나란히 두고, 같은 계약인지부터 가르겠습니다.`,
        basis: "post_confirmation_policy_comparison",
      });
    }
  }

  segments.push(...buildMemorySegments(memoryFacts));
  segments.push(...buildConversationSegments(conversation));
  segments.push(buildFollowUpForwardStepSegment());

  return segments;
}

function buildFollowUpPolicySegments(
  policies = [],
  linkedPolicyIds = [],
  extractionAxes = [],
  documentLifeAxes = [],
) {
  const linkedSet = new Set(linkedPolicyIds.map(String));
  const otherPolicies = policies.filter((row) => !linkedSet.has(String(row?.id ?? "")));
  const mergedAxes = [...new Set([...extractionAxes, ...documentLifeAxes])];
  const segments = [];

  if (otherPolicies.length === 0 && policies.length > 0 && linkedPolicyIds.length > 0) {
    segments.push({
      source: DU1_INPUT_SOURCE.POLICIES,
      tier: DU1_EPISTEMIC_TIER.CERTAIN,
      text: "이번 자료가 프로필에 반영되어, 등록된 보험과 함께 볼 수 있습니다.",
    });
    return segments;
  }

  if (otherPolicies.length > 0) {
    const otherAxes = summarizeExistingPolicyAxes(otherPolicies);
    const overlap = mergedAxes.filter((axis) => otherAxes.includes(axis));
    if (overlap.length > 0) {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `등록돼 있던 ${joinKoLabels(otherAxes)} 축과 이번에 확인한 ${joinKoLabels(overlap)} 축이 맞닿아 있습니다.`,
        basis: "registered_policies_vs_extracted_axes",
      });
    } else if (otherAxes.length === 0 && mergedAxes.length === 0) {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: "등록돼 있던 보험과 이번 자료를 함께 정리할 수 있습니다.",
        basis: "registered_policies_vs_document",
      });
    } else {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: `등록돼 있던 ${joinKoLabels(otherAxes)} 축과 이번 자료의 ${joinKoLabels(mergedAxes) || "해당"} 축을 함께 정리할 수 있습니다.`,
        basis: "registered_policies_vs_extracted_axes",
      });
    }
  } else if (policies.length > 0 && linkedPolicyIds.length === 0) {
    segments.push({
      source: DU1_INPUT_SOURCE.POLICIES,
      tier: DU1_EPISTEMIC_TIER.INFERENCE,
      text: "프로필에 등록된 보험과 이번 자료도 함께 정리할 수 있습니다.",
      basis: "registered_policies_present",
    });
  }

  return segments;
}

function segmentsToCustomerText(segments = []) {
  const paragraphs = [];
  let buffer = [];

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    buffer.push(segment.text);
    const next = segments[i + 1];
    const breakParagraph =
      !next ||
      next.source !== segment.source ||
      (segment.tier === DU1_EPISTEMIC_TIER.UNKNOWN && next.tier !== DU1_EPISTEMIC_TIER.UNKNOWN);
    if (breakParagraph) {
      paragraphs.push(buffer.join(" "));
      buffer = [];
    }
  }

  return paragraphs.filter(Boolean).join("\n\n");
}

/**
 * @param {ReturnType<typeof buildDu1InputBundle>} bundle
 */
function isAnalysisConsentHold(bundle = {}) {
  const posture =
    bundle.judgment?.posture ?? bundle.judgment?.orient_speech_planned?.posture ?? null;
  if (posture === "hold_consent") return true;
  if (posture === "provisional_metadata") return false;
  const scope = bundle.judgment?.judgment_scope?.unknowable ?? [];
  return scope.includes("document_body") && !scope.includes("document_body_before_key_read");
}

export function composeDu1WithEpistemicTrace(bundle) {
  if (isAnalysisConsentHold(bundle)) {
    const segments = buildConsentHoldSegments();
    return { segments, text: segmentsToCustomerText(segments), inputGates: bundle.inputGates ?? {} };
  }

  const gates = bundle.inputGates ?? resolveDu1InputGates(bundle.loadedContext, bundle);
  const { kind, lifeAxes } = bundle.documentClass;
  const segments = [];

  segments.push(...buildDocumentSegments(bundle.documentClass));

  if (gates.policiesPresent) {
    segments.push(...buildPolicySegments(bundle.policies, lifeAxes));
  }

  if (bundle.evidenceComplete && bundle.ea1CustomerSummary) {
    const linkedIds = Array.isArray(bundle.document?.metadata_json?.profile_policy_ids)
      ? bundle.document.metadata_json.profile_policy_ids
      : [];
    segments.push(...buildIntakeEvidenceSegments(bundle.ea1CustomerSummary, linkedIds));
  }

  if (gates.memoryPresent) {
    segments.push(...buildMemorySegments(bundle.memoryFacts));
  }

  if (gates.conversationPresent) {
    segments.push(...buildConversationSegments(bundle.conversation));
  }

  segments.push(
    ...buildUnknownSegments({
      kind,
      policiesPresent: gates.policiesPresent,
      documentClass: bundle.documentClass,
    }),
  );

  const text = segmentsToCustomerText(segments);
  return { segments, text, inputGates: gates };
}

/**
 * @param {ReturnType<typeof buildDu1InputBundle>} bundle
 */
export function composeDu1FirstExplanation(bundle) {
  return composeDu1WithEpistemicTrace(bundle).text;
}

/**
 * Phase A — post-extract follow-up (EA-1 customer-safe, no OCR echo).
 */
export function composePhaseAFollowUpWithEpistemicTrace({
  document = {},
  contextSnapshot = null,
  loadedContext = null,
  multiExtraction = null,
  linkedPolicyIds = [],
  ea1CustomerSummary = null,
} = {}) {
  const bundle = buildDu1InputBundle({ document, contextSnapshot, loadedContext });
  const summary =
    ea1CustomerSummary ??
    (multiExtraction ? buildEa1CustomerSummaryFromMultiExtraction(multiExtraction) : null);
  const extractionAxes = summary?.life_axes ?? [];
  const mergedLifeAxes = [...new Set([...(bundle.documentClass.lifeAxes ?? []), ...extractionAxes])];
  const documentClass = {
    ...bundle.documentClass,
    lifeAxes: mergedLifeAxes,
    identifiable: summary?.identifiable ?? bundle.documentClass.identifiable,
  };
  const gates = resolveDu1InputGates(loadedContext, bundle);
  const segments = [];

  if (summary) {
    segments.push(...buildFollowUpEvidenceSegments(summary, linkedPolicyIds));
  } else {
    segments.push(
      ...buildFollowUpProvisionalDeltaSegments({
        documentClass,
        policies: bundle.policies,
        memoryFacts: bundle.memoryFacts,
        conversation: bundle.conversation,
        gates,
      }),
    );
    return { segments, text: segmentsToCustomerText(segments), inputGates: gates };
  }

  if (gates.policiesPresent) {
    segments.push(
      ...buildFollowUpPolicySegments(
        bundle.policies,
        linkedPolicyIds,
        extractionAxes,
        documentClass.lifeAxes,
      ),
    );
  }

  if (gates.memoryPresent) {
    segments.push(...buildMemorySegments(bundle.memoryFacts));
  }

  if (gates.conversationPresent) {
    segments.push(...buildConversationSegments(bundle.conversation));
  }

  const hasIdentifiedAxes =
    (summary.life_axes ?? []).length > 0 && summary.identifiable !== false;
  if (hasIdentifiedAxes) {
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.UNKNOWN,
      text: "특약·보장 상세는 가입현황과 맞춰 보면 이어서 말씀드리겠습니다.",
      basis: "forward_step_after_identified_axes",
    });
  } else {
    segments.push(buildFollowUpForwardStepSegment());
  }

  return { segments, text: segmentsToCustomerText(segments), inputGates: gates };
}

export function buildPhaseAFollowUpCustomerSpeak({
  document = {},
  contextSnapshot = null,
  loadedContext = null,
  multiExtraction = null,
  linkedPolicyIds = [],
  ea1CustomerSummary = null,
} = {}) {
  const bundle = buildDu1InputBundle({ document, contextSnapshot, loadedContext });
  if (!assertDu1FourInputsPresent(bundle)) {
    return null;
  }

  const { text, segments, inputGates } = composePhaseAFollowUpWithEpistemicTrace({
    document,
    contextSnapshot,
    loadedContext,
    multiExtraction,
    linkedPolicyIds,
    ea1CustomerSummary,
  });
  const speechValidation = validateDu1CustomerSpeech(text);
  const segmentValidation = validateDu1EpistemicSegments(segments);
  if (!speechValidation.ok || !segmentValidation.ok) {
    return null;
  }

  return {
    schema_version: "phase-a-upload-follow-up-v1",
    text,
    segments,
    inputGates,
  };
}

/**
 * @param {object|null} keyFirstJudgment
 * @param {object} [options]
 */
export function buildDu1CustomerFirstSentence(
  keyFirstJudgment,
  { document = {}, contextSnapshot = null, loadedContext = null } = {},
) {
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot,
    loadedContext,
    keyFirstJudgment,
  });

  if (!assertDu1FourInputsPresent(bundle)) {
    return null;
  }

  const { text, segments } = composeDu1WithEpistemicTrace(bundle);
  const speechValidation = validateDu1CustomerSpeech(text);
  const segmentValidation = validateDu1EpistemicSegments(segments);
  if (!speechValidation.ok || !segmentValidation.ok) {
    return null;
  }
  return text;
}
