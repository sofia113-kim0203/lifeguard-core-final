/**
 * Tom 2-A — Question-scoped evidence audit (known / unknown / low).
 * No policy counts, premium totals, document/memory inventory.
 */
import { LOOKUP_CATEGORIES, matchPolicyToCategory } from "./intentGateLayer.js";

export const EVIDENCE_STATUS = {
  KNOWN: "known",
  UNKNOWN: "unknown",
  LOW: "low",
};

const GAP_TOPIC_PRIORITY = ["cancer", "brain", "heart", "medical_expense", "driver"];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function detectGapTopicFromQuestion(question = "") {
  const text = normalizeQuestion(question).toLowerCase();
  for (const category of GAP_TOPIC_PRIORITY) {
    const config = LOOKUP_CATEGORIES[category];
    if (!config) continue;
    if (config.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { category, label: config.label };
    }
  }
  return { category: null, label: "해당 보장" };
}

function buildField(id, label, status, { value = null, note = null } = {}) {
  return { id, label, status, value, note };
}

export function buildGapEvidenceAudit(factBundle = {}, question = "") {
  const topic = detectGapTopicFromQuestion(question);
  const policies = factBundle?.policies ?? [];
  const category = topic.category ?? "gap";
  const match = topic.category ? matchPolicyToCategory(policies, category) : { found: false, confidence: "low" };

  const fields = [];

  if (!match.found) {
    fields.push(
      buildField(`${category}_contract`, `${topic.label} 관련 계약`, EVIDENCE_STATUS.UNKNOWN, {
        note: "등록된 계약 목록에서 해당 카테고리가 확인되지 않았습니다.",
      }),
    );
  } else if (match.confidence === "high") {
    fields.push(
      buildField(`${category}_contract`, `${topic.label} 관련 계약`, EVIDENCE_STATUS.KNOWN, {
        note: "계약 존재는 확인되나 보장금액은 별도 확인이 필요합니다.",
      }),
    );
  } else {
    fields.push(
      buildField(`${category}_contract`, `${topic.label} 관련 계약`, EVIDENCE_STATUS.LOW, {
        note: "유사 계약은 있을 수 있으나 담보 구조는 아직 불명확합니다.",
      }),
    );
  }

  fields.push(
    buildField(
      `${category}_diagnosis_benefit`,
      `${topic.label} 진단비 금액`,
      EVIDENCE_STATUS.UNKNOWN,
      { note: `현재 자료에서 ${topic.label} 진단비 금액이 확인되지 않았습니다.` },
    ),
  );
  const similarLabel =
    category === "cancer" ? `${topic.label} 유사암 담보` : `${topic.label} 관련 특약·담보`;
  fields.push(buildField(`${category}_similar_benefit`, similarLabel, EVIDENCE_STATUS.UNKNOWN));
  fields.push(
    buildField(`${category}_surgery_benefit`, `${topic.label} 수술비 담보`, EVIDENCE_STATUS.UNKNOWN),
  );

  const judgmentFields = fields.filter((field) =>
    /diagnosis_benefit|similar_benefit|surgery_benefit/.test(field.id),
  );
  const judgmentReady = judgmentFields.some((field) => field.status === EVIDENCE_STATUS.KNOWN);

  const missingLabels = judgmentFields
    .filter((field) => field.status !== EVIDENCE_STATUS.KNOWN)
    .map((field) => field.label);

  return {
    topic: category,
    topicLabel: topic.label,
    question: normalizeQuestion(question),
    fields,
    judgment_ready: judgmentReady,
    missing_labels: missingLabels,
    missing_summary:
      missingLabels.length > 0 ? missingLabels.join(", ") : `${topic.label} 보장금액·담보 구조`,
  };
}

export function formatTomRegulatedEvidenceBlock(audit) {
  const lines = [
    "[Tom evidence audit — use ONLY these fields; each has status known|unknown|low]",
    `question_topic: ${audit.topicLabel}`,
    `judgment_ready: ${audit.judgment_ready}`,
  ];
  for (const field of audit.fields) {
    lines.push(
      `- ${field.label} (${field.id}): status=${field.status}${field.note ? `; note=${field.note}` : ""}`,
    );
  }
  lines.push("[forbidden in reply] policy_count, premium_total, document_count, memory_count, menu redirect");
  return lines.join("\n");
}

/** @deprecated use buildGapEvidenceAudit */
export const buildCancerGapEvidenceAudit = buildGapEvidenceAudit;
