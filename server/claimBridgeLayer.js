/**
 * Phase 30-A — Claim Intelligence Bridge (orchestration only).
 * Composes existing policy view + policy RAG; no new engine or DB.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveUnifiedPolicyView } from "./customerConversationalTone.js";
import { resolveOpenAiApiKey } from "./documentRagContext.js";
import { LOOKUP_CATEGORIES, matchPolicyToCategory } from "./intentGateLayer.js";
import {
  buildPolicyTermsQaPrompt,
  handlePolicyTermsQaRequest,
  INSUFFICIENT_CONTEXT_MESSAGE,
  resolveClaudeModel,
} from "./policyTermsQaCore.js";

export const CLAIM_TOPIC_KEYWORDS = {
  fracture: {
    label: "골절",
    keywords: ["골절", "부러", "골절상", "골절증"],
    lookupCategory: null,
    policyKeywords: ["골절", "상해", "입원", "실손", "의료비"],
    documents: ["진단서", "X-ray 또는 MRI 영상자료", "의료비 영수증"],
  },
  surgery: {
    label: "수술",
    keywords: ["수술", "시술"],
    lookupCategory: null,
    policyKeywords: ["수술", "입원", "실손", "의료비", "수술비"],
    documents: ["수술 확인서 또는 진단서", "입퇴원 확인서", "의료비 영수증"],
  },
  hospitalization: {
    label: "입원",
    keywords: ["입원", "입원일당"],
    lookupCategory: null,
    policyKeywords: ["입원", "실손", "의료비", "입원일당"],
    documents: ["입퇴원 확인서", "진단서", "의료비 영수증"],
  },
  cancer: {
    label: "암",
    keywords: ["암", "암진단", "암보험", "cancer"],
    lookupCategory: "cancer",
    policyKeywords: ["암", "진단비", "암진단"],
    documents: ["암 진단서", "조직검사 결과", "의료비 영수증"],
  },
  medical_expense: {
    label: "실손",
    keywords: ["실손", "실손의료", "의료비보험", "의료비"],
    lookupCategory: "medical_expense",
    policyKeywords: ["실손", "의료비", "실손의료"],
    documents: ["진료비 영수증", "진단서", "처방전"],
  },
};

const FORBIDDEN_CLAIM_PHRASES = [
  /무조건\s*받을\s*수\s*있/,
  /청구\s*가능합니다/,
  /지급됩니다/,
  /지급\s*됩니다/,
  /불가능합니다/,
  /청구\s*불가/,
  /지급\s*불가/,
];

const REQUIRED_GUARDRAIL_MARKERS = [
  { pattern: /현재\s*자료\s*기준/, label: "현재 자료 기준" },
  { pattern: /약관/, label: "약관" },
  { pattern: /서류/, label: "서류" },
  { pattern: /보험사\s*심사/, label: "보험사 심사" },
];

const CLAIM_GUARDRAIL_FOOTER =
  "현재 자료 기준으로는 약관과 서류 확인이 필요하며, 최종 지급 여부는 보험사 심사에 따라 달라질 수 있습니다.";

function normalizeQuestion(question = "") {
  return String(question).replace(/\s+/g, " ").trim();
}

function buildCustomerLabel(workingContext = {}) {
  const snapshot = workingContext.snapshot ?? {};
  const facts = snapshot.facts ?? [];
  const sourceSummary = workingContext.sourceSummary ?? {};
  const name =
    facts.find((fact) => fact.fact_key === "profile.name")?.fact_value?.trim() ||
    snapshot.profile?.display_name ||
    sourceSummary.profile?.name ||
    null;
  return name ? `${name}님` : "고객님";
}

function joinLabels(labels) {
  const list = (labels ?? []).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

export function detectClaimTopic(question = "") {
  const text = normalizeQuestion(question).toLowerCase();
  for (const [topicKey, config] of Object.entries(CLAIM_TOPIC_KEYWORDS)) {
    if (config.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { topicKey, ...config };
    }
  }
  return { topicKey: null, label: "보험금", keywords: [], lookupCategory: null, policyKeywords: [], documents: ["진단서", "의료비 영수증"] };
}

function policySearchText(policy) {
  return [
    policy?.insurer,
    policy?.insurer_name,
    policy?.product,
    policy?.product_name,
    policy?.policy_type,
    policy?.coverage_summary,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

export function findRelevantPolicies(policies = [], claimTopic = {}) {
  if (claimTopic.lookupCategory && LOOKUP_CATEGORIES[claimTopic.lookupCategory]) {
    const categoryMatch = matchPolicyToCategory(policies, claimTopic.lookupCategory);
    if (categoryMatch.found) {
      return {
        found: true,
        confidence: categoryMatch.confidence,
        matched_policies: categoryMatch.matched_policies,
        match_basis: "category",
      };
    }
  }

  const policyKeywords = claimTopic.policyKeywords ?? claimTopic.keywords ?? [];
  if (!policyKeywords.length) {
    return { found: false, confidence: "low", matched_policies: [], match_basis: "none" };
  }

  const matched = [];
  for (const policy of policies ?? []) {
    const text = policySearchText(policy);
    const hits = policyKeywords.filter((keyword) => text.includes(String(keyword).toLowerCase()));
    if (!hits.length) continue;
    matched.push({
      insurer: policy?.insurer_name ?? policy?.insurer ?? "",
      product: policy?.product_name ?? policy?.product ?? "",
      confidence: "medium",
      matched_keywords: hits,
    });
  }

  if (!matched.length) {
    return { found: false, confidence: "low", matched_policies: [], match_basis: "keyword" };
  }

  return {
    found: true,
    confidence: matched.length === 1 ? "medium" : "low",
    matched_policies: matched,
    match_basis: "keyword",
  };
}

export function buildClaimFastResponse(question, workingContext = {}, intentGate = {}) {
  const customerLabel = buildCustomerLabel(workingContext);
  const claimTopic = detectClaimTopic(question);
  const topicLabel = claimTopic.label ?? "보험금";
  const { policyCount, policyDescriptions } = resolveUnifiedPolicyView(workingContext);

  const lines = [
    `${customerLabel}, ${topicLabel} 관련 청구 가능 여부는 약관과 서류 확인이 필요합니다. 현재 보유 계약과 약관 기준으로 먼저 확인해 보겠습니다.`,
  ];

  if (policyDescriptions.length) {
    lines.push(`등록된 보유 계약은 ${policyDescriptions.join(", ")} 등 ${policyCount || policyDescriptions.length}건입니다.`);
  } else if (policyCount > 0) {
    lines.push(`등록된 가입 보험이 ${policyCount}건 확인됩니다.`);
  }

  return lines.join("\n\n");
}

function summarizePolicyContext(preview = "") {
  const cleaned = String(preview ?? "")
    .replace(/\[P\d+\][^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "[No policy knowledge context retrieved]") return null;
  return cleaned.slice(0, 220);
}

function buildPolicyHoldingSentence(customerLabel, claimTopic, policyMatch, policies) {
  const topicLabel = claimTopic.label ?? "해당";

  if (!policies.length) {
    return `${customerLabel}, 현재 등록된 가입 보험 정보가 없어 ${topicLabel} 관련 계약을 바로 확인하기 어렵습니다.`;
  }

  if (!policyMatch.found) {
    return `${customerLabel}, 현재 등록된 보험 목록에서는 ${topicLabel} 관련 담보가 명확히 확인되지 않습니다. 보장내역서 기준으로 한 번 더 확인이 필요합니다.`;
  }

  const productLines = policyMatch.matched_policies
    .map((item) => `${item.insurer} ${item.product}`.trim())
    .filter(Boolean);

  if (productLines.length) {
    return `${customerLabel}, 현재 자료 기준으로 ${topicLabel} 관련으로 보이는 계약은 ${joinLabels(productLines)}입니다.`;
  }

  return `${customerLabel}, 현재 자료 기준으로 ${topicLabel} 관련 보험 계약이 있을 수 있으나, 담보 범위는 약관 확인이 필요합니다.`;
}

function buildDirectClaimOpening(question, claimTopic) {
  const topicLabel = claimTopic.label ?? "보험금";
  const text = normalizeQuestion(question);

  if (/약관/.test(text) && /지급/.test(text)) {
    return `약관상 지급 여부는 가입하신 보험 약관 조항을 기준으로 확인해야 합니다.`;
  }
  if (/청구\s*가능/.test(text)) {
    return `${topicLabel} 관련 청구 가능 여부는 현재 보유 계약의 약관과 제출 서류를 함께 봐야 합니다.`;
  }
  if (claimTopic.topicKey) {
    return `${topicLabel} 상황에서 보험금 지급 여부는 현재 자료 기준으로 약관 조건과 진단·치료 서류를 함께 확인해야 합니다.`;
  }
  return `보험금 지급 여부는 현재 자료 기준으로 약관과 서류를 함께 확인해야 합니다.`;
}

function buildDocumentsSentence(claimTopic) {
  const docs = claimTopic.documents ?? ["진단서", "의료비 영수증"];
  return `청구 검토 시에는 보통 ${joinLabels(docs)} 등이 필요하며, 상품별로 추가 서류가 요구될 수 있습니다.`;
}

export function sanitizeClaimAnswer(text) {
  let answer = String(text ?? "").trim();
  for (const pattern of FORBIDDEN_CLAIM_PHRASES) {
    if (pattern.test(answer)) {
      answer = answer.replace(pattern, "지급 여부는 약관과 서류 확인 후 보험사 심사가 필요합니다");
    }
  }
  return answer.slice(0, 800);
}

export function assertClaimGuardrails(answer) {
  const text = String(answer ?? "");
  const missing = REQUIRED_GUARDRAIL_MARKERS.filter((marker) => !marker.pattern.test(text)).map(
    (marker) => marker.label,
  );
  const forbidden = FORBIDDEN_CLAIM_PHRASES.filter((pattern) => pattern.test(text)).map(
    (pattern) => String(pattern),
  );
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

async function callAnthropicClaimShort({ apiKey, modelName, system, user, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "CLAUDE_API_ERROR" };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  return text ? { ok: true, answer: text } : { ok: false, reason: "CLAUDE_EMPTY_RESPONSE" };
}

export async function buildClaimBridgeAnswer({
  question,
  workingContext = {},
  supabase = null,
  authHeader = null,
  testCustomerId = null,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const customerLabel = buildCustomerLabel(workingContext);
  const claimTopic = detectClaimTopic(question);
  const { policies, policyCount } = resolveUnifiedPolicyView(workingContext);
  const policyMatch = findRelevantPolicies(policies, claimTopic);

  const parts = [buildDirectClaimOpening(question, claimTopic), buildPolicyHoldingSentence(customerLabel, claimTopic, policyMatch, policies)];

  let ragMode = "none";
  let ragRowCount = 0;

  if (supabase) {
    const ragResult = await handlePolicyTermsQaRequest({
      question,
      mode: "rag_only",
      adminSupabase: supabase,
      authHeader,
      testCustomerId,
      env,
      fetchImpl,
    }).catch(() => null);

    if (ragResult?.ok) {
      ragMode = "rag_only";
      ragRowCount = ragResult.rag_row_count ?? 0;

      if (ragResult.insufficient_context || !ragResult.context_used) {
        parts.push(INSUFFICIENT_CONTEXT_MESSAGE);
      } else {
        const anthropicApiKey = resolveAnthropicApiKey(env);
        const openAiApiKey = resolveOpenAiApiKey(env);

        if (anthropicApiKey && openAiApiKey && ragResult.document_context_preview) {
          const { system, user } = buildPolicyTermsQaPrompt(
            question,
            ragResult.document_context_preview,
          );
          const claimSystem = [
            system,
            "Answer in 3-6 polite Korean sentences.",
            "Start by directly addressing the customer's claim/payment question.",
            "Do NOT state claim approval, denial, or exact payment amounts as certain.",
            "Must include: 현재 자료 기준, 약관, 서류, 보험사 심사.",
            "Forbidden: 무조건 받을 수 있습니다, 청구 가능합니다, 지급됩니다, 불가능합니다.",
          ].join("\n");

          const claudeResult = await callAnthropicClaimShort({
            apiKey: anthropicApiKey,
            modelName: resolveClaudeModel(env),
            system: claimSystem,
            user,
            fetchImpl,
          });

          if (claudeResult.ok) {
            ragMode = "rag_claude";
            parts.length = 0;
            parts.push(claudeResult.answer);
          } else {
            const snippet = summarizePolicyContext(ragResult.document_context_preview);
            if (snippet) {
              parts.push(`현재 자료 기준 약관에서 관련 조항이 확인됩니다. ${snippet}`);
            }
          }
        } else {
          const snippet = summarizePolicyContext(ragResult.document_context_preview);
          if (snippet) {
            parts.push(`현재 자료 기준 약관에서 관련 조항이 확인됩니다. ${snippet}`);
          }
        }
      }
    }
  }

  if (parts.length <= 2 || ragMode === "none") {
    parts.push(buildDocumentsSentence(claimTopic));
  }

  parts.push(CLAIM_GUARDRAIL_FOOTER);

  let answer = sanitizeClaimAnswer(parts.join("\n\n"));

  const guardrails = assertClaimGuardrails(answer);
  if (!guardrails.ok) {
    if (!/현재\s*자료\s*기준/.test(answer)) {
      answer = `현재 자료 기준으로 안내드리면, ${answer}`;
    }
    if (!/보험사\s*심사/.test(answer)) {
      answer = `${answer}\n\n${CLAIM_GUARDRAIL_FOOTER}`;
    }
    answer = sanitizeClaimAnswer(answer);
  }

  return {
    text: answer.slice(0, 800),
    claim_topic: claimTopic.topicKey,
    claim_topic_label: claimTopic.label,
    policy_match: policyMatch,
    policy_count: policyCount,
    rag_mode: ragMode,
    rag_row_count: ragRowCount,
    guardrails: assertClaimGuardrails(answer),
  };
}

export function buildClaimBridgeResultText(question, workingContext = {}, bridgeResult = null) {
  if (bridgeResult?.text) return bridgeResult.text;
  const customerLabel = buildCustomerLabel(workingContext);
  const claimTopic = detectClaimTopic(question);
  return sanitizeClaimAnswer(
    [
      buildDirectClaimOpening(question, claimTopic),
      `${customerLabel}, 현재 자료 기준으로 약관과 서류 확인이 필요합니다.`,
      buildDocumentsSentence(claimTopic),
      CLAIM_GUARDRAIL_FOOTER,
    ].join("\n\n"),
  );
}
