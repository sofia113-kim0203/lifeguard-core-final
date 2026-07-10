/**
 * S7-a + S7-b — Borrowed Senses shadow speak (Claude 1-call structured JSON · trace only).
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { gateBorrowedSensesOutput, S7_BORROWED_SENSES_SCHEMA, S7_BORROWED_SENSES_SCHEMA_B, S7B_EXPERTISE_TAXONOMY } from "./keyBorrowedSensesGate.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 35000;
const TIMEOUT_RETRY_MS = 45000;
const DEFAULT_TEMPERATURE = 0.3;
const MAX_PARSE_RETRIES = 1;

const BORROWED_SENSES_TOOL = {
  name: "emit_borrowed_senses",
  description: "Emit S7-a + S7-b borrowed senses shadow JSON. Expression + leadership trace only — never replace S6 final_answer.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      understanding_hypotheses: {
        type: "array",
        items: { type: "string" },
      },
      customer_intent: { type: "string" },
      emotional_signal: { type: ["string", "null"] },
      hesitation_signal: { type: ["string", "null"] },
      context_carryover: { type: ["string", "null"] },
      visual_observation: { type: ["string", "null"] },
      answer_purpose: { type: "string" },
      must_not_assume: {
        type: "array",
        items: { type: "string" },
      },
      used_facts: {
        type: "array",
        items: { type: "string" },
      },
      recommendation_basis: { type: ["string", "null"] },
      voice_raw_candidate: { type: "string" },
      key_purpose: { type: ["string", "null"] },
      leadership_move: { type: ["string", "null"] },
      insurance_expertise_angle: {
        type: "array",
        items: { type: "string" },
      },
      insurance_expertise_rationale: { type: ["string", "null"] },
      proposal_direction: { type: ["string", "null"] },
      next_decision_point: {
        type: "array",
        minItems: 2,
        items: { type: "string" },
      },
      final_answer_source: { type: "string", enum: ["s6"] },
    },
    required: [
      "understanding_hypotheses",
      "customer_intent",
      "emotional_signal",
      "hesitation_signal",
      "context_carryover",
      "visual_observation",
      "answer_purpose",
      "must_not_assume",
      "used_facts",
      "recommendation_basis",
      "voice_raw_candidate",
      "key_purpose",
      "leadership_move",
      "insurance_expertise_angle",
      "insurance_expertise_rationale",
      "proposal_direction",
      "next_decision_point",
      "final_answer_source",
    ],
  },
};

function summarizeVisualBlocks(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return blocks.map((block) => ({
    type: block?.type ?? null,
    title: block?.title ?? null,
    subtitle: block?.subtitle ?? null,
    row_count: Array.isArray(block?.rows) ? block.rows.length : 0,
    rows: Array.isArray(block?.rows) ? block.rows.slice(0, 6) : [],
  }));
}

function buildSystemPrompt() {
  return [
    "You are KEY Borrowed Senses (S7-a + S7-b shadow layer) for LIFEGUARD.",
    "Claude provides: hearing, social reading, visual reading, expression CANDIDATES, and leadership TRACE only.",
    "KEY owns facts, judgment, responsibility, and the frozen S6 final_answer.",
    "Understanding is HYPOTHESIS — never state hypotheses as confirmed facts.",
    "understanding_hypotheses MUST be soft: use '가능성', '마음이 있을 수 있음', '걱정이 있어 보임'. FORBIDDEN in understanding_hypotheses: 확실히, 분명, 틀림없, 반드시, and any wording that states customer psychology as fact. Do NOT invent unstated 가입 고려 / 보험료 부담 as certainty — only soft possibility if the question weakly suggests it.",
    "Do NOT replace or rewrite the S6 final_answer.",
    "Principle: NOT '추천 금지' — YES '근거 없는 확정 추천 금지'.",
    "When customer purpose (stated or hypothesized) AND confirmed facts exist, KEY MUST assert purpose-fit clearly — do not timidly defer with review-order only.",
    "ALLOWED purpose-fit voice (shadow): '현재 목적 기준으로는 이쪽이 더 맞아 보입니다'; '보험료 절감 목적이라면 새 상품보다 기존 중복 확인이 먼저입니다'; '보장 보완 목적이라면 이 상품군은 후보가 될 수 있습니다'; '암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다'; '아직 확정은 아니지만, 지금 확인된 사실로는 이 방향이 목적에 더 가깝습니다'.",
    "FORBIDDEN: enroll/cancel commands ('무조건 가입하세요', '해지해도 됩니다'); 확인 전 충분/부족 확정; inventing numbers/coverages/totals; product push with no customer purpose.",
    "Safety (gate/facts/system) blocks hard stops — KEY itself must not avoid purpose-fit judgment when purpose+facts exist.",
    "Use ONLY facts from allowed_fact_tokens / allowed_numbers / used_facts inputs.",
    "For context_carryover: only reference conversation_history or previous_answer_summary — never invent '지난번' memory. Carry ONLY topics/numbers explicitly present in history. Prefer '직전 대화에서 확인된 …'. FORBIDDEN in context_carryover: inventing prior 암/사망/진단비/수술비 as if already discussed; '나머지 N건' or other calculated/estimated counts not written in history.",
    "For visual_observation: describe ONLY what is in visual_blocks_summary rows/titles — never invent numbers, contracts, or judgments not shown.",
    "When visual_blocks_summary is present, cite only cell values and row labels from that summary.",
    "For premium scope: when policy_count > 1, never imply monthly_premium is total for all contracts.",
    "voice_raw_candidate is an alternate expression sketch — NOT the customer-facing answer. Prefer clearer purpose-fit than a timid S6 paraphrase.",
    "voice_raw_candidate structure on consult paths: (1) customer purpose (2) purpose-fit assertion (맞아 보입니다/후보/먼저) (3) why it fits + what is still unconfirmed (4) next choice.",
    "Speak TO the customer in 2nd-person/구어체. FORBIDDEN openings: third-person report tone like '고객 목적이 아직 확인되지 않은 상태입니다', '정보가 부족합니다', '추천은 어렵습니다'. Prefer warm direct speech: '좋아요', '추천해드릴게요', '먼저 목적을 잡으면'.",
    "recommendation_basis MUST separate: why this direction looks fit for the purpose vs why it is not yet a definitive enroll/cancel/verdict.",
    "S7-b leadership fields (key_purpose, leadership_move, insurance_expertise_angle, proposal_direction, next_decision_point) are trace-only — never customer-facing.",
    "KEY acts as 보험 주치의: lead the customer to the next safe decision point — soft but not passive.",
    "leadership_move must be an active framing step — never end with only '편하실 때 말씀해 주세요'.",
    "proposal_direction may be (a) review direction OR (b) purpose-fit direction within confirmed facts — NOT enroll/cancel command and NOT purposeless product push.",
    "On consult/premium-burden questions: proposal_direction MUST be a non-empty string (never null/empty). Prefer purpose-fit when purpose is clear; otherwise a concrete review path (필수 보장 vs 중복 보장 분리 등).",
    "Greeting-only (안녕하세요) may leave proposal_direction null. Browse-like (둘러보/구경/그냥 왔어/가볍게/처음이야) must NOT end wait-only ('궁금하면 말씀해 주세요'). Lower pressure, recommend 2–3 easy start points (보험료 부담 / 큰 보장 빈틈 / 중복 보장), KEY leans one start, open next_decision 2–3 choices. Consultation-start recommendation OK; enroll/cancel/product push forbidden. Browse: in ALL shadow fields (understanding_hypotheses, recommendation_basis, voice, leadership) do NOT invent arbitrary % / amounts / counts outside allowed_fact_tokens — confirmed tokens like policy_count 22 OK; inventing '30%' or unverified 월 금액 BAD. Prefer lean phrasing '처음이면 보험료 부담과 큰 보장 빈틈부터 보는 걸 추천' — avoid fake-stat phrasing '대부분은 …', '보통 30%', '월 N원 줄일 수 있습니다'.",
    "Keep-policy (이 보험 유지/유지해야/해지해도/없애도): NEVER verdict 유지하세요 or 해지해도 됩니다. Separate that '이 보험' may be unspecified — ask which contract first; do NOT assume 대표 실손 as the target. Present 4 keep-judgment criteria (보장 역할 / 보험료 부담 / 중복 / 대체 가능성), explicitly name 유지 후보 / 조정 후보 / 보완 후보 (at least two), then KEY next action. next_decision_point MUST be 2–3 non-empty choices — NEVER leave empty. Consultation-path recommendation OK; enroll/cancel/product push forbidden.",
    "Consult paths must not leave proposal_direction empty.",
    "insurance_expertise_angle: pick 1–3 tags ONLY from insurance_expertise_taxonomy in the payload.",
    "next_decision_point: provide 2–3 concrete choices the customer can decide next (consult path). NEVER leave this array empty on consult questions including 보험료 줄이고/절감 and keep-policy.",
    "For 암보험/암 보장 questions: split coverage into 진단비·수술비·치료비; NEVER claim 부족/충분 before verification; MAY say 대표 계약 암 담보부터 보는 게 맞아 보입니다; next_decision_point MUST offer 2–3 choices among those items or whole-vs-partial review.",
    "For 보험료/premium burden/줄이고/절감: NEVER write '22건, 월 X원' as if all 22 contracts share one monthly amount; always separate representative contract (4만5천 원) from unconfirmed total sum; MAY say 절감 목적이면 새 상품을 보기 전에 기존 중복·납입 확인이 먼저 맞아 보입니다 (anti-push, NOT enroll). next_decision_point MUST list 2–3 choices e.g. 납입 구조 / 중복 보장 / 조정 후보 — NEVER leave empty.",
    "used_facts: cite policy_count and monthly_premium_representative separately — never combine 22건 with a single premium as total.",
    "FORBIDDEN in all shadow fields including voice_raw_candidate: 보장축, 우선순위 축, 암 보장축, 필수축, 축별, 축으로, 축을, 축부터, 축 설정.",
    "Use 보장 구성, 보장 종류, 보장 영역 instead of '축'.",
    "Never claim 부족합니다/충분합니다/꼭 필요합니다 as definitive verdict before verification.",
    "You MUST call emit_borrowed_senses exactly once with valid JSON fields.",
    "final_answer_source must always be \"s6\".",
  ].join(" ");
}

function buildQuestionLeadershipHint(question = "") {
  const q = String(question ?? "").trim();
  if (/보험료.*(?:부담|줄이)|줄이고\s*싶|절감|부담/.test(q)) {
    return "Premium cut/burden path: proposal_direction MUST be non-empty purpose-fit or review direction (NOT enroll/cancel push). Prefer: 절감 목적이면 새 상품을 보기 전에 지금 있는 계약의 중복 보장·납입 부담부터 확인하는 게 먼저 맞아 보입니다 (anti-push phrasing OK — do NOT recommend 새 상품 가입). voice_raw_candidate: purpose → fit → why/unconfirmed → next choice. next_decision_point MUST be 2-3 non-empty choices e.g. (1) 납입 보험료 구조 확인 (2) 중복 보장 확인 (3) 줄여도 되는 조정 후보 확인 — NEVER leave next_decision_point empty. Never leave proposal_direction empty.";
  }
  if (/암\s*보험|암보험/.test(q)) {
    return "Cancer coverage path (incl. 부족해?): split 진단비·수술비·치료비; NEVER claim 부족/충분 before verification; MAY assert purpose-fit: 암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다. understanding_hypotheses MUST stay soft — GOOD: '암 보장이 부족할까 봐 걱정하는 마음이 있을 수 있음', '진단비·수술비·치료비 항목을 확인하고 싶어 하는 상황일 수 있음', '부족/충분을 단정하기보다 항목별 확인을 원할 수 있음'. BAD: '암 보장을 확실히 챙기고 싶은 상황', '분명히 부족하다고 느끼는 상황', '새 암보험 가입을 고려 중이라고 단정', '보험료 부담이 있다고 단정'. next_decision_point 2-3 choices. voice_raw must not be review-order only.";
  }
  if (/꼭\s*필요|필요한\s*거|필요성/.test(q)) {
    return "Necessity path (S7Q12): NEVER claim 꼭 필요합니다 as verdict. next_decision_point MUST have 2-3 choices — e.g. (1) 먼저 '이거'가 어떤 계약/보장인지 특정하기 (2) 기존 계약과 중복되는 보장인지 확인하기 (3) 고객 목적 기준으로 유지/조정/보완 후보인지 나눠보기. Never leave next_decision_point empty. Purpose-fit OK: 필요성 판단이면 대상 특정·중복 확인이 먼저 맞아 보입니다.";
  }
  // FULLVOICE_Q9 / S7Q6 recommend — before need-path so "보험 추천해줘" does not share Q2 tone.
  if (
    /추천/.test(q) &&
    !/뭐가\s*필요|필요해|꼭\s*필요|필요한\s*거|필요성/.test(q)
  ) {
    return "Recommend path (FULLVOICE_Q9 / S7Q6 보험 추천해줘): Recommendation IS core — first AFFIRM recommendation is possible, then lead purpose/direction. GOOD opening (2nd-person/구어체): '좋아요. 보험 추천은 가능해요. 다만 바로 상품부터 고르기보다, 먼저 목적을 잡으면 훨씬 정확해져요.' OR '추천해드릴게요. 먼저 방향을 잡으면 좋아요. 보험료를 줄이고 싶은지, 빠진 보장을 채우고 싶은지, 지금 보험이 괜찮은지부터 나눠볼 수 있어요.' OR '바로 상품 이름부터 고르기보다, 목적에 맞는 방향부터 잡는 게 추천의 시작이에요.' BAD opening FORBIDDEN: '고객 목적이 아직 확인되지 않은 상태입니다', '정보가 부족합니다', '추천은 어렵습니다', '추천은 하지 않겠습니다', '상담사와 확인하세요', '이 상품 가입하세요'. Do NOT refuse judgment or sound like recommendation-ban. If purpose unclear: warm direct speech → fact-based direction lean (절감→중복 확인 먼저 / 보완→보장 구성 / 막연→현황 정리) → ask which fits. next_decision_point MUST have 2-3 choices — e.g. (1) 보험료 절감 목적이면 기존 중복 보장부터 확인하기 (2) 보장 보완 목적이면 부족한 보장 구성부터 확인하기 (3) 목적이 아직 막연하면 전체 계약 현황부터 정리하기. Never leave next_decision_point empty. Forbidden: purposeless product push or enroll/cancel command.";
  }
  if (/뭐가\s*필요|필요해/.test(q)) {
    return "Direction/need path (S7Q7 / FULLVOICE_Q2): do NOT refuse all judgment. If purpose unclear, speak TO the customer (not third-person report). State a fact-based purpose-fit lean (절감→중복 확인 먼저 / 보완→상품군 후보) then ask which purpose fits. next_decision_point MUST have 2-3 choices — e.g. (1) 보험료 절감 목적이면 기존 중복 보장부터 확인하기 (2) 보장 보완 목적이면 부족한 보장 구성부터 확인하기 (3) 목적이 아직 막연하면 전체 계약 현황부터 정리하기. Never leave next_decision_point empty. Forbidden: purposeless product push or enroll command; FORBIDDEN openings like '고객 목적이 아직 확인되지 않은 상태입니다'. Do NOT use S7Q12 '이거' 특정 choices here.";
  }
  if (/표가|표\s*가|표\s*무슨|표의\s*뜻|표\s*의미/.test(q)) {
    return "Table meaning path: next_decision_point MUST have 2-3 choices even if visual_blocks_summary is null (e.g. representative row / total vs unconfirmed / one contract detail). Never leave empty.";
  }
  if (/지난번|저번|이어서|앞서/.test(q)) {
    return "Continue path (S7Q10): context_carryover MUST use ONLY topics/numbers explicitly in conversation_history / previous_answer_summary. Prefer '직전 대화에서 확인된 …'. GOOD: '직전 대화에서 확인된 22건 계약과 삼성생명 실손, 월 4만5천 원 기준으로 이어볼 수 있음'; next choices among 보장종류/납입/궁금한 영역. BAD: '지난번에 암 보장까지 봤습니다', '지난번에 사망 보장이 부족하다고 봤습니다', '나머지 21건을 보면 됩니다', '이미 암/수술/사망까지 확인했습니다'. Do NOT invent prior 암/사망/진단비/수술비 memory. Do NOT put calculated '나머지 N건' in context_carryover. next_decision_point 2-3 choices. Purpose-fit OK within confirmed facts only.";
  }
  if (/둘러보|구경|그냥\s*왔|가볍게|뭐\s*있는지\s*보|처음이(?:야|에요|예요)/.test(q)) {
    return "Browse-like path (S7Q9 / FULLVOICE browse): NOT wait-only. Do NOT end with only '궁금한 게 생기면 말씀해 주세요' / '필요하면 말씀해 주세요' / '확인해보세요'. (1) Lower pressure: 처음엔 가입이나 해지 얘기부터 하지 않아도 됨 (avoid phrasing '바로 가입' — gate false-positive). (2) Recommend 2–3 easy consultation start points — MUST cover at least two of: 보험료 부담, 큰 보장 빈틈(암·실손·수술비), 중복 보장. (3) KEY leans one start — prefer exact: 처음이면 보험료 부담과 큰 보장 빈틈부터 가볍게 보는 걸 추천드려요 (do NOT say '대부분은 …부터', '보통 30%', unverified 월 금액 절감). (4) next_decision_point 2-3 choices e.g. 보험료 부담 / 큰 보장 빈틈 / 중복 보장. (5) Continue: 제가 먼저 보험료 부담부터 가볍게 볼까요? Numbers: confirmed allowed_fact_tokens OK (e.g. policy_count 22); FORBIDDEN in hypotheses/recommendation_basis/voice: inventing arbitrary % (e.g. 30%), unverified 월 금액, or counts not in allowed set. Do NOT weaken start-point leadership. BAD: 특정 상품 가입하세요, 해지해도 됩니다, invent numbers/%, '대부분은' fake-stat framing, 쪽-only vague phrasing, one-sentence end.";
  }
  if (
    /이\s*보험\s*유지|이거\s*유지|유지해야|계속\s*가져|해지해도|없애도|빼도\s*돼/.test(q)
  ) {
    return "Keep-policy path (FULLVOICE_Q8 / 유지해야 해?): NEVER 유지하세요 / 해지해도 됩니다 / 가입하세요. (1) Direct: 유지할지 말지는 바로 해지·유지로 정하기보다 그 보험의 역할부터 봐야 함. (2) Separate unspecified target: '이 보험'이 어떤 계약인지 먼저 특정 — do NOT assume 대표 실손/삼성생명 as the spoken target when customer did not name it. (3) Present keep-judgment 4 criteria — MUST cover at least three of: 보장 역할, 보험료 부담, 중복 여부, 대체 가능성. (4) Explicitly name at least two of 유지 후보 / 조정 후보 / 보완 후보 (prefer all three). (5) KEY next action: 제가 먼저 그 보험의 보장 역할과 보험료 부담부터 확인해볼까요? next_decision_point MUST be 2-3 non-empty choices e.g. 어떤 계약인지 특정 / 역할·보험료부터 / 유지·조정·보완 후보 판단 — NEVER leave next_decision_point empty. BAD: 중복 확인만으로 끝, 대상 불명확한데 실손부터 보면 됩니다 단정, invent numbers, wait-only 말씀해 주세요.";
  }
  return null;
}

function buildUserPayload({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
} = {}) {
  return {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    s7a_schema_version: S7_BORROWED_SENSES_SCHEMA,
    insurance_expertise_taxonomy: S7B_EXPERTISE_TAXONOMY,
    forbidden_axis_terms: [
      "보장축",
      "우선순위 축",
      "암 보장축",
      "필수축",
      "축별",
      "축으로",
      "축을",
      "축부터",
      "축 설정",
    ],
    customer_question: question,
    conversation_history: (history ?? []).slice(-4).map((h) => ({
      role: h.role,
      text: h.text ?? h.content ?? "",
    })),
    previous_answer_summary: String(previousAnswerSummary ?? "").trim() || null,
    s6_final_answer_frozen: String(s6FinalAnswer ?? "").trim(),
    question_focus: directive?.question_focus ?? null,
    answer_mode: directive?.answer_mode ?? null,
    decision_situation_key: decision?.situation_key ?? null,
    allowed_fact_tokens: directive?.allowed_fact_tokens ?? {},
    allowed_numbers: directive?.allowed_numbers ?? [],
    facts_to_speak: (directive?.facts_to_speak ?? []).map((f) => f.fact_id),
    premium_scope_policy: directive?.premium_scope_policy ?? null,
    visual_blocks_summary: summarizeVisualBlocks(visualBlocks),
    s7b_question_leadership_hint: buildQuestionLeadershipHint(question),
  };
}

function stripCodeFence(raw = "") {
  return String(raw ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function repairJsonText(raw = "") {
  let text = stripCodeFence(raw);
  text = text.replace(/,\s*([}\]])/g, "$1");
  return text;
}

function parseJsonFromText(raw = "") {
  const candidates = [String(raw ?? "").trim(), repairJsonText(raw)];
  for (const text of candidates) {
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      try {
        return JSON.parse(repairJsonText(match[0]));
      } catch {
        // continue
      }
    }
  }
  return null;
}

function extractParsedFromResponse(data = {}) {
  for (const block of data.content ?? []) {
    if (block?.type === "tool_use" && block?.name === "emit_borrowed_senses" && block?.input) {
      return block.input;
    }
  }
  const raw = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return parseJsonFromText(raw);
}

function extractSlashChoicesFromText(text = "") {
  const raw = String(text ?? "");
  const paren = raw.match(/\(([^)]+)\)/);
  const candidate = paren ? paren[1] : raw;
  if (!candidate.includes("/")) return [];
  const parts = candidate
    .split(/\s*\/\s*/)
    .map((s) => s.replace(/^[\s—–\-·•]+|[\s—–\-·•]+$/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
  return parts.length >= 2 ? parts.slice(0, 3) : [];
}

/** Extract (1)/(2)/(3) or ①/②/③ style choices from voice/leadership text. */
function extractNumberedChoicesFromText(text = "") {
  const raw = String(text ?? "");
  const circled = [...raw.matchAll(/[①②③④⑤]\s*([^①②③④⑤\n]{4,80})/g)].map((m) =>
    m[1].replace(/[—–\-·•].*$/, "").trim(),
  );
  if (circled.length >= 2) return circled.slice(0, 3);
  const numbered = [...raw.matchAll(/(?:^|[^\d])\(?([1-3])\)?[.)]\s*([^\n(]{4,80})/g)].map((m) =>
    m[2].replace(/\s*→.*$/, "").replace(/[—–\-·•].*$/, "").trim(),
  );
  if (numbered.length >= 2) return numbered.slice(0, 3);
  return [];
}

function goldenNextDecisionFallback(question = "") {
  const q = String(question ?? "").trim();
  if (/표가|표\s*가|표\s*무슨|표의\s*뜻|표\s*의미/.test(q)) {
    return [
      "대표 계약 행부터 보기",
      "전체 합계와 미확인 항목 구분하기",
      "특정 보험사/계약 하나를 골라 자세히 보기",
    ];
  }
  if (/보험료.*(?:부담|줄이)|줄이고\s*싶|절감|부담/.test(q)) {
    return [
      "납입 보험료 구조부터 확인할지",
      "중복 보장부터 확인할지",
      "줄여도 되는 조정 후보부터 볼지",
    ];
  }
  if (
    /이\s*보험\s*유지|이거\s*유지|유지해야|계속\s*가져|해지해도|없애도|빼도\s*돼/.test(q)
  ) {
    return [
      "어떤 계약인지 먼저 특정할지",
      "보장 역할과 보험료 부담부터 확인할지",
      "유지·조정·보완 후보로 나눠 볼지",
    ];
  }
  if (/둘러보|구경|그냥\s*왔|가볍게|뭐\s*있는지\s*보|처음이(?:야|에요|예요)/.test(q)) {
    return [
      "보험료 부담부터 가볍게 볼지",
      "큰 보장 빈틈(암·실손·수술비)부터 볼지",
      "중복 보장부터 볼지",
    ];
  }
  if (/암\s*보험|암보험/.test(q)) {
    return [
      "암 보장 전체를 한번에 볼지",
      "진단비·수술비·치료비 중 하나부터 볼지",
    ];
  }
  if (/꼭\s*필요|필요한\s*거|필요성/.test(q)) {
    return [
      "먼저 '이거'가 어떤 계약/보장인지 특정하기",
      "기존 계약과 중복되는 보장인지 확인하기",
      "고객 목적 기준으로 유지/조정/보완 후보인지 나눠보기",
    ];
  }
  if (/추천|뭐가\s*필요|필요해/.test(q)) {
    return [
      "보험료 절감 목적이면 기존 중복 보장부터 확인하기",
      "보장 보완 목적이면 부족한 보장 구성부터 확인하기",
      "목적이 아직 막연하면 전체 계약 현황부터 정리하기",
    ];
  }
  return [];
}

export function repairNextDecisionPoints(parsed = {}, question = "") {
  const existing = Array.isArray(parsed.next_decision_point)
    ? parsed.next_decision_point.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (existing.length >= 2) return existing;

  const fromMove = extractSlashChoicesFromText(parsed.leadership_move);
  if (fromMove.length >= 2) return fromMove;

  const fromProposal = extractSlashChoicesFromText(parsed.proposal_direction);
  if (fromProposal.length >= 2) return fromProposal;

  const fromVoice = extractNumberedChoicesFromText(parsed.voice_raw_candidate);
  if (fromVoice.length >= 2) return fromVoice;

  const fromMoveNumbered = extractNumberedChoicesFromText(parsed.leadership_move);
  if (fromMoveNumbered.length >= 2) return fromMoveNumbered;

  return goldenNextDecisionFallback(question);
}

/** Greeting/browse may leave proposal_direction null; consult-like questions must not. */
function isConsultLikeQuestion(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (/^(?:안녕|반갑|하이|hello)/i.test(q)) return false;
  if (/그냥\s*둘러/.test(q)) return false;
  return true;
}

/**
 * Stabilize non-deterministic Claude null proposal_direction on consult paths.
 * Uses next_decision_point as review-direction framing only — never enroll/cancel/product push.
 * Shadow-only; does not touch S6 final_answer.
 */
export function repairProposalDirection(parsed = {}, question = "", nextDecision = []) {
  const existing = String(parsed.proposal_direction ?? "").trim();
  if (existing) return existing;
  if (!isConsultLikeQuestion(question)) return null;
  const choices = (Array.isArray(nextDecision) ? nextDecision : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 3);
  if (choices.length < 2) return null;
  if (/보험료.*부담|부담/.test(String(question ?? ""))) {
    return `확인된 사실 범위에서 ${choices.join(" · ")} 순으로 검토하는 방향 — 특정 상품 가입·해지 권유 아님`;
  }
  return `확인된 사실 범위에서 다음 검토 선택지를 기준으로 진행하는 방향: ${choices.join(" / ")} — 상품 가입·해지 권유 아님`;
}

function normalizeBorrowedOutput(parsed = {}, s6FinalAnswer = "", question = "") {
  const hypotheses = Array.isArray(parsed.understanding_hypotheses)
    ? parsed.understanding_hypotheses.map((h) => String(h).trim()).filter(Boolean)
    : parsed.understanding_hypothesis
      ? [String(parsed.understanding_hypothesis).trim()]
      : [];

  const next_decision_point = repairNextDecisionPoints(parsed, question);
  const proposal_direction = repairProposalDirection(parsed, question, next_decision_point);

  return {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    s7a_schema_version: S7_BORROWED_SENSES_SCHEMA,
    understanding_hypotheses: hypotheses,
    customer_intent: normalizeTextField(parsed.customer_intent),
    emotional_signal: normalizeNullable(parsed.emotional_signal),
    hesitation_signal: normalizeNullable(parsed.hesitation_signal),
    context_carryover: normalizeNullable(parsed.context_carryover),
    visual_observation: normalizeNullable(parsed.visual_observation),
    answer_purpose: normalizeTextField(parsed.answer_purpose),
    must_not_assume: Array.isArray(parsed.must_not_assume)
      ? parsed.must_not_assume.map((s) => String(s).trim()).filter(Boolean)
      : [],
    used_facts: Array.isArray(parsed.used_facts)
      ? parsed.used_facts.map((s) => String(s).trim()).filter(Boolean)
      : [],
    recommendation_basis: normalizeNullable(parsed.recommendation_basis),
    voice_raw_candidate: normalizeNullable(parsed.voice_raw_candidate),
    key_purpose: normalizeNullable(parsed.key_purpose),
    leadership_move: normalizeNullable(parsed.leadership_move),
    insurance_expertise_angle: Array.isArray(parsed.insurance_expertise_angle)
      ? parsed.insurance_expertise_angle.map((s) => String(s).trim()).filter(Boolean)
      : [],
    insurance_expertise_rationale: normalizeNullable(parsed.insurance_expertise_rationale),
    proposal_direction,
    next_decision_point,
    final_answer_source: "s6",
    s6_final_answer_snapshot: String(s6FinalAnswer ?? "").trim(),
  };
}

function normalizeTextField(value) {
  return String(value ?? "").trim() || null;
}

function normalizeNullable(value) {
  const t = String(value ?? "").trim();
  return t || null;
}

async function callClaudeBorrowedSenses({
  model,
  apiKey,
  userPayload,
  fetchImpl,
  signal,
  temperature,
  repairRaw = null,
  repairReason = "json",
}) {
  const repairMessage =
    repairReason === "leadership"
      ? "Your previous output omitted next_decision_point (need 2-3 choices). Call emit_borrowed_senses again with all required fields including next_decision_point."
      : "Your previous output was not valid structured JSON. Call emit_borrowed_senses again with all required fields. JSON only via tool call.";
  const messages = repairRaw
    ? [
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
        {
          role: "assistant",
          content: [{ type: "text", text: repairRaw }],
        },
        {
          role: "user",
          content: repairMessage,
        },
      ]
    : [{ role: "user", content: JSON.stringify(userPayload, null, 2) }];

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: Math.min(0.45, Math.max(0.15, Number(temperature) || DEFAULT_TEMPERATURE)),
      system: buildSystemPrompt(),
      tools: [BORROWED_SENSES_TOOL],
      tool_choice: { type: "tool", name: "emit_borrowed_senses" },
      messages,
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `CLAUDE_API_${res.status}`, data: null, raw: null };
  }

  const data = await res.json();
  const parsed = extractParsedFromResponse(data);
  const raw = JSON.stringify(data.content ?? []);
  if (!parsed) {
    return { ok: false, error: "CLAUDE_JSON_PARSE_FAIL", data, raw };
  }
  return { ok: true, parsed, data, raw };
}

/**
 * Shadow-only borrowed senses probe — never mutates S6 final_answer.
 */
export async function runBorrowedSensesShadowProbe({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = Number(env.KEY_BORROWED_SENSES_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
} = {}) {
  const apiKey = resolveAnthropicApiKey(env);
  const base = {
    schema_version: S7_BORROWED_SENSES_SCHEMA_B,
    shadow_only: true,
    customer_text_changed: false,
    final_answer_source: "s6",
    s6_final_answer: String(s6FinalAnswer ?? "").trim(),
    provider: null,
    error: null,
    borrowed: null,
    gate: null,
    raw: null,
    attempts: 0,
  };

  if (!apiKey) {
    return {
      ...base,
      error: "ANTHROPIC_NOT_CONFIGURED",
    };
  }

  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  const userPayload = buildUserPayload({
    question,
    directive,
    decision,
    history,
    previousAnswerSummary,
    s6FinalAnswer,
    visualBlocks,
  });

  let lastRaw = null;
  let lastError = "CLAUDE_JSON_PARSE_FAIL";
  let parseRetryUsed = false;
  let leadershipRetryCount = 0;
  let timeoutRetryUsed = false;
  let activeTimeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  let attempts = 0;
  const maxAttempts = 5;

  try {
    while (attempts < maxAttempts) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
      const attemptTemp =
        attempts === 1 ? temperature : Math.min(0.22, Number(temperature) || DEFAULT_TEMPERATURE);

      let repairRaw = null;
      let repairReason = "json";
      if (parseRetryUsed && lastRaw) {
        repairRaw = lastRaw;
        repairReason = "json";
      } else if (leadershipRetryCount > 0 && lastRaw) {
        repairRaw = lastRaw;
        repairReason = "leadership";
      }

      let result;
      try {
        result = await callClaudeBorrowedSenses({
          model,
          apiKey,
          userPayload,
          fetchImpl,
          signal: controller.signal,
          temperature: attemptTemp,
          repairRaw,
          repairReason,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          ok: false,
          error: /abort|timeout/i.test(msg) ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
          raw: null,
        };
      } finally {
        clearTimeout(timer);
      }

      if (!result.ok && result.error?.startsWith("CLAUDE_API_")) {
        return { ...base, error: result.error, provider: "anthropic", attempts };
      }

      lastRaw = result.raw;
      if (result.ok && result.parsed) {
        const borrowed = normalizeBorrowedOutput(result.parsed, s6FinalAnswer, question);
        const gate = gateBorrowedSensesOutput({
          borrowed,
          directive,
          history,
          question,
          visualBlocks,
        });

        if ((gate.missing_next_decision || gate.missing_proposal_direction) && leadershipRetryCount < 3) {
          leadershipRetryCount += 1;
          lastRaw = JSON.stringify(result.parsed, null, 2);
          userPayload.s7b_retry_hint = gate.missing_proposal_direction
            ? "RETRY REQUIRED: proposal_direction is null/empty but this is a consult path. Set ONE non-empty review OR purpose-fit DIRECTION within confirmed facts (NOT enroll/cancel command, NOT purposeless product push). Examples: '줄이기 전에 필수 보장과 겹치는 보장을 먼저 나눈다' OR '절감 목적이면 중복 확인이 먼저 맞아 보입니다'. Keep next_decision_point with 2-3 choices. Never leave proposal_direction null."
            : "RETRY: next_decision_point must contain 2-3 non-empty customer choices. For 암보험/암 보장: 진단비·수술비·치료비 choices. For 보험료 부담: 납입 큰 계약 / 겹치는 보장 / 필수 보장 choices. For 꼭 필요/필요성 (S7Q12): '이거' 계약·보장 특정하기 / 기존 계약과 중복 여부 확인하기 / 유지·조정·보완 후보로 나눠보기. For 뭐가 필요/추천 (S7Q7 direction/need): 절감이면 중복 보장부터 / 보완이면 부족한 보장 구성부터 / 막연하면 전체 계약 현황부터. Never leave next_decision_point empty.";
          continue;
        }

        return {
          ...base,
          provider: "anthropic",
          model,
          raw: result.raw,
          borrowed,
          gate,
          error: null,
          attempts,
        };
      }

      lastError = result.error ?? "CLAUDE_JSON_PARSE_FAIL";

      if (lastError === "CLAUDE_TIMEOUT" && !timeoutRetryUsed) {
        timeoutRetryUsed = true;
        activeTimeoutMs = TIMEOUT_RETRY_MS;
        continue;
      }

      if (lastError === "CLAUDE_JSON_PARSE_FAIL" && !parseRetryUsed) {
        parseRetryUsed = true;
        continue;
      }

      break;
    }

    return {
      ...base,
      error: lastError,
      raw: lastRaw,
      provider: "anthropic",
      model,
      attempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      error: /abort|timeout/i.test(msg) ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
      provider: "anthropic",
      attempts,
    };
  }
}

export {
  S7_BORROWED_SENSES_SCHEMA,
  S7_BORROWED_SENSES_SCHEMA_B,
  summarizeVisualBlocks,
  buildUserPayload,
  buildQuestionLeadershipHint,
};
