/**
 * S7-a + S7-b — Borrowed Senses shadow speak (Claude 1-call structured JSON · trace only).
 * Claude-Full talent-open: answerMode=claude_full uses emit_claude_full (customer_answer) + free prompt.
 * Shadow S7 emit_borrowed_senses path is retained (no physical delete).
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { gateBorrowedSensesOutput, S7_BORROWED_SENSES_SCHEMA, S7_BORROWED_SENSES_SCHEMA_B, S7B_EXPERTISE_TAXONOMY } from "./keyBorrowedSensesGate.js";
import {
  deriveKeyVoiceQuestionFocus,
  collectVerifiedSpeakAllowlistFromReality,
} from "./keyVoiceDirective.js";
import { formatPremiumFromRaw } from "./speakFactRenderer.js";
import { buildClaudeFullContextPack } from "./keyClaudeFullContextPack.js";
import {
  CLAUDE_FULL_EMIT_TOOL,
  buildClaudeFullSystemPrompt,
  normalizeClaudeFullOutput,
  extractClaudeFullParsedFromResponse,
  permissionCheckProposedToolActions,
  normalizeDocumentEvidence,
} from "./keyClaudeFullEmit.js";
import {
  buildClaudeFullUserContentWithPdf,
  estimateAnthropicMessagesRequestBytes,
  isClaudeFullRequestTooLarge,
} from "./keyClaudeFullDocumentDirect.js";
import { relMs } from "./keyLatencyMarks.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 35000;
const TIMEOUT_RETRY_MS = 45000;
const PUBLIC_RESEARCH_TIMEOUT_MS = 60000;
const DEFAULT_TEMPERATURE = 0.3;
const MAX_PARSE_RETRIES = 1;

/** Anthropic official built-in web search (Messages API · server tool). */
export const ANTHROPIC_WEB_SEARCH_TOOL = Object.freeze({
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
});

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

function buildSystemPrompt({
  mode = "emit",
  answerMode = "shadow_sketch",
  documentDirect = false,
} = {}) {
  // Claude-Full: safety-only free prompt (no S7 structure/tone/choice mandates).
  if (answerMode === "claude_full") {
    return buildClaudeFullSystemPrompt({
      mode:
        mode === "focused_correction"
          ? "focused_correction"
          : mode === "emit_with_tools" || mode === "emit_with_research"
            ? "emit_with_tools"
            : "emit",
      documentDirect: documentDirect === true,
    });
  }
  if (mode === "research") {
    return [
      "You are KEY public research helper (read-only).",
      "When the request needs fresh public facts, you MUST call the built-in web_search tool before finishing.",
      "For explicit local recommend / find requests (area + 맛집·식당·카페·병원·시설, or 찾아줘/검색해줘/추천해줘), search FIRST using the stated area and request — do NOT wait for cuisine/mood preference.",
      "Do NOT write a final customer-facing answer.",
      "Do NOT invent restaurant names, ratings, hours, parking, prices, or addresses.",
      "Do NOT discuss insurance, contracts, coverage, or claims.",
      "Search, compare public sources, then stop when you have enough grounded public results (or honestly empty).",
    ].join(" ");
  }
  const lines = [
    "You are KEY Borrowed Senses (S7-a + S7-b shadow layer) for LIFEGUARD.",
    "Claude provides: hearing, social reading, visual reading, expression CANDIDATES, and leadership TRACE only.",
    "KEY owns facts, judgment, responsibility, and the frozen S6 final_answer.",
    "Understanding is HYPOTHESIS — never state hypotheses as confirmed facts.",
    "understanding_hypotheses MUST be soft: use '가능성', '마음이 있을 수 있음', '걱정이 있어 보임'. FORBIDDEN in understanding_hypotheses: 확실히, 분명, 틀림없, 반드시, and any wording that states customer psychology as fact. Do NOT invent unstated 가입 고려 / 보험료 부담 as certainty — only soft possibility if the question weakly suggests it.",
    "S6 final_answer may be empty when this call runs before Speak — that is OK. Do NOT invent an S6 answer. voice_raw_candidate remains a CANDIDATE only.",
    "Do NOT replace or rewrite a frozen S6 final_answer when one is provided.",
    "Principle: NOT '추천 금지' — YES '근거 없는 확정 추천 금지'.",
    "When customer purpose (stated or hypothesized) AND confirmed facts exist, KEY MUST assert purpose-fit clearly — do not timidly defer with review-order only.",
    "ALLOWED purpose-fit voice (shadow): '현재 목적 기준으로는 이쪽이 더 맞아 보입니다'; '보험료 절감 목적이라면 새 상품보다 기존 중복 확인이 먼저입니다'; '보장 보완 목적이라면 이 상품군은 후보가 될 수 있습니다'; '암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다'; '아직 확정은 아니지만, 지금 확인된 사실로는 이 방향이 목적에 더 가깝습니다'.",
    "FORBIDDEN: enroll/cancel commands ('무조건 가입하세요', '해지해도 됩니다'); 확인 전 충분/부족 확정; inventing numbers/coverages/totals; product push with no customer purpose.",
    "Safety (gate/facts/system) blocks hard stops — KEY itself must not avoid purpose-fit judgment when purpose+facts exist.",
    "Use ONLY facts from allowed_fact_tokens / allowed_numbers / used_facts inputs.",
    "For context_carryover: only reference conversation_history, recent_conversation_originals, older_conversation_summary, retained_past_originals, or previous_answer_summary — never invent '지난번' memory. Carry ONLY topics/numbers explicitly present in history. Prefer '직전 대화에서 확인된 …'. FORBIDDEN in context_carryover: inventing prior 암/사망/진단비/수술비 as if already discussed; '나머지 N건' or other calculated/estimated counts not written in history.",
    "CURRENT TASK CONTINUITY: When conversation_history / open_customer_thread shows an unfinished customer request, treat the current message as refining that request until a clear new topic appears. Keep the open purpose fixed in voice_raw_candidate. If the open request is a place/restaurant recommendation, follow-ups about companions, surgery recovery, mobility, seating, or food limits are selection constraints — NOT a new trip/travel topic. FORBIDDEN: '여행 가시는군요' when the open ask was restaurant recommendation. When the customer clearly raises insurance-payout worry, switch to that topic.",
    "Never end a normal place/daily/claim conversation with a generic wait stub like '지금은 여기까지 확인했어요. 잠시 후 다시 말씀해 주시면…'. If evidence has ≥1 grounded place, name it; if evidence is empty, ask ONE clarifying condition tied to the open request.",
    "For visual_observation: describe ONLY what is in visual_blocks_summary rows/titles — never invent numbers, contracts, or judgments not shown.",
    "When visual_blocks_summary is present, cite only cell values and row labels from that summary.",
    "For premium scope: when policy_count > 1, never imply monthly_premium is total for all contracts.",
    "voice_raw_candidate is an alternate expression sketch — NOT the customer-facing answer. Prefer clearer purpose-fit than a timid S6 paraphrase.",
    "voice_raw_candidate structure on consult paths: (1) customer purpose (2) purpose-fit assertion (맞아 보입니다/후보/먼저) (3) why it fits + what is still unconfirmed (4) next choice.",
    "Speak TO the customer in 2nd-person/구어체. FORBIDDEN openings: third-person report tone like '고객 목적이 아직 확인되지 않은 상태입니다', '정보가 부족합니다', '추천은 어렵습니다'. Prefer warm direct speech: '좋아요', '추천해드릴게요', '먼저 목적을 잡으면'.",
    "recommendation_basis MUST separate: why this direction looks fit for the purpose vs why it is not yet a definitive enroll/cancel/verdict.",
    "S7-b leadership fields (key_purpose, leadership_move, insurance_expertise_angle, proposal_direction, next_decision_point) are KEY-internal — never dump them as a separate customer appendix; weave next action into voice_raw_candidate naturally.",
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
    'final_answer_source must always be "s6".',
  ].filter(Boolean);
  if (mode === "emit_with_research") {
    lines.push(
      "PUBLIC RESEARCH EVIDENCE is provided in the user payload (key_public_research_evidence).",
      "voice_raw_candidate MUST name only places grounded in that evidence (title/cited_text/url/claim_or_summary/snippet — full evidence, not only a candidate chart).",
      "For 맛집/장소/시설 추천·찾기: when status is success and grounded candidates exist, present confirmed candidates FIRST (prefer up to 3 when available; if 2 then recommend 2; if 1 then recommend that 1 honestly). Soft comparatives like '자주 언급되는 편' are OK. A clarifying question alone is NOT a complete answer when candidates exist — ask conditions only AFTER naming candidates.",
      "When public_research.search_before_clarify is true OR open_customer_thread.place_thread_open is true with success evidence: NEVER open with only preference questions (한식/일식/분위기). Name grounded candidates first.",
      "If open_customer_thread.place_thread_open is true, keep restaurant/place selection as the current purpose even when the latest user message only adds companion/surgery/mobility constraints — ask about walking distance, parking/elevator, seating comfort, spicy/tough food limits, or quiet setting to narrow prior candidates. Do not invent a new travel itinerary.",
      "If status_detail is research_search_not_used or research_insufficient or research_unavailable or grounded candidates are 0: do NOT invent restaurant names; say what could not be confirmed; ask ONE clarifying condition (cuisine/neighborhood) tied to the open request; never mention insurance; never use a generic wait stub.",
      "FORBIDDEN: invent restaurant names absent from all evidence text; end with only '어떤 분위기/음식 종류를 원하세요?' when grounded candidates exist; assert exact rating/hours/parking/price/distance/address/exit/floor/building digits not present in evidence; insurance invite; '네이버/카카오에서 직접 검색하세요' dump; '지금은 여기까지 확인했어요' wait stub.",
    );
  }
  if (mode === "focused_correction") {
    lines.push(
      "FOCUSED CORRECTION (once): Rewrite voice_raw_candidate to fix ONLY the listed CLOSED_HARD violations and failed claims.",
      "Keep the same conversation pack, verified_customer_chart, public evidence, allowed_numbers, and allowed_entities.",
      "Do not invent facts. Do not re-search. Do not shrink the chart. Do not emit internal reasoning text.",
    );
  }
  return lines.join(" ");
}

/** Strip Anthropic thinking / redacted_thinking blocks — never persist reasoning prose. */
function stripReasoningFromProviderData(data = null) {
  if (!data || typeof data !== "object") return { data, stripped: false };
  const content = Array.isArray(data.content) ? data.content : null;
  if (!content) return { data, stripped: false };
  const filtered = content.filter(
    (b) => b?.type !== "thinking" && b?.type !== "redacted_thinking",
  );
  if (filtered.length === content.length) return { data, stripped: false };
  return {
    data: { ...data, content: filtered },
    stripped: true,
  };
}

function extractUsageMetrics(data = null) {
  const usage = data?.usage && typeof data.usage === "object" ? data.usage : null;
  return {
    input_tokens: Number.isFinite(Number(usage?.input_tokens)) ? Number(usage.input_tokens) : null,
    output_tokens: Number.isFinite(Number(usage?.output_tokens))
      ? Number(usage.output_tokens)
      : null,
  };
}

/** Place / venue recommendation that requires real public web_search (not soft context like 부모님 모시 alone). */
export function isPlacePublicResearchRequest(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return /맛집|식당|레스토랑|카페|여행지|관광지|병원|검진\s*센터|약국|장소\s*추천|코스\s*추천|갈\s*만한\s*곳|어디\s*(?:가|좋|먹)|데이트\s*코스|시설\s*추천|서비스\s*추천/.test(
    q,
  );
}

/**
 * True when the current ask needs fresh public facts (not insurance portfolio facts).
 * General KEY→Claude web_search ability — not a restaurant-only feature or new classifier.
 */
export function needsFreshPublicFacts({ question = "", history = [] } = {}) {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (isActivePlaceCustomerThread({ question: q, history })) return true;

  const asksLookup =
    /(?:찾아(?:봐|줘|주세요|볼까)|검색해(?:줘|주세요|봐)|추천해(?:줘|주세요|봐)|알려(?:줘|주세요)|어디(?:가|가\s*좋)|뭐\s*먹)/.test(
      q,
    );
  const publicSubject =
    /맛집|식당|카페|레스토랑|병원|검진|약국|시설|센터|관광지|여행지|갈\s*만한\s*곳|영업\s*시간|운영\s*(?:시간|여부)|휴무|접수\s*방법|신청\s*방법|공개\s*자료|제도|분당|서울|근처|지역|동네/.test(
      q,
    );
  if (asksLookup && publicSubject) return true;

  if (/영업\s*시간|운영\s*(?:시간|여부)|지금\s*열|몇\s*시까지|오늘\s*휴무/.test(q)) return true;
  if (/최신|접수\s*방법|신청\s*방법|공개\s*자료/.test(q) && /확인|알려|찾|검색|어떻게/.test(q)) {
    return true;
  }
  // Do NOT force on bare 여행/관광/외출 nouns — need lookup intent + public subject
  // (or place thread / isPlacePublicResearchRequest above). Soft travel feelings stay off.
  return false;
}

/** Clear new insurance/claim topic — do not keep a prior unfinished place ask. */
export function isClearNewTopicInsuranceAsk(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    /보험금|청구|담보|진단서|영수증|보험료|암\s*보장|암\s*보험|가입|해지|보장\s*충분/.test(q) &&
    !/맛집|식당|카페|레스토랑|병원|약국/.test(q)
  );
}

function historyTurnText(h = null) {
  return String(h?.text ?? h?.content ?? h?.message ?? "").trim();
}

/** True when recent user history already opened an unfinished place/venue request. */
export function historyHasOpenPlaceRequest(history = []) {
  for (const h of Array.isArray(history) ? history : []) {
    if (String(h?.role ?? "") !== "user") continue;
    if (isPlacePublicResearchRequest(historyTurnText(h))) return true;
  }
  return false;
}

/**
 * Active place customer thread: current place ask, or unfinished place ask in history
 * unless the customer clearly switched to insurance/claim.
 * Not a food/travel classifier — continuity of the open request only.
 */
export function isActivePlaceCustomerThread({ question = "", history = [] } = {}) {
  if (isPlacePublicResearchRequest(question)) return true;
  if (isClearNewTopicInsuranceAsk(question)) return false;
  return historyHasOpenPlaceRequest(history);
}

/** Compact open-thread context for Claude (history facts only — no new Memory store). */
export function buildOpenCustomerThreadContext({ question = "", history = [] } = {}) {
  // Full session history — no artificial slice(-6).
  const turns = Array.isArray(history) ? history : [];
  const prior_user_asks = turns
    .filter((h) => String(h?.role ?? "") === "user")
    .map((h) => historyTurnText(h))
    .filter(Boolean);
  const prior_assistant_answers = turns
    .filter((h) => String(h?.role ?? "") === "assistant")
    .map((h) => historyTurnText(h))
    .filter(Boolean);
  const place_thread_open = isActivePlaceCustomerThread({ question, history: turns });
  return {
    prior_user_asks,
    prior_assistant_answers,
    place_thread_open,
    continuity_rule:
      "Until the customer clearly starts a new topic, treat the current message as refining the unfinished request in conversation_history / prior_user_asks. Keep serving that open request. Do not reframe an unfinished place/restaurant ask as a brand-new trip/travel topic. When the customer clearly raises insurance-payout worry or another new topic, switch to that topic.",
  };
}

/** True when current turn may need Anthropic built-in web_search. */
export function shouldEnablePublicWebSearch({ question = "", decision = null, history = [] } = {}) {
  const priority = String(decision?.response_priority ?? "").trim();
  const situation = String(decision?.situation_key ?? "").trim();
  // T3 claim path: public search stays off.
  if (priority === "claim_prep" || situation === "claim_need_check") return false;
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (isClearNewTopicInsuranceAsk(q)) return false;
  // Explicit public-fact need (place/facility/hours/lookup) or unfinished place thread.
  if (needsFreshPublicFacts({ question: q, history })) return true;
  if (
    priority === "premium_adequacy_check" ||
    priority === "cancer_axis_check" ||
    situation === "premium_burden" ||
    situation === "coverage_assessment_cancer_axis" ||
    priority === "fact_lookup" ||
    priority === "direction_choice"
  ) {
    return false;
  }
  return false;
}

/** Distinct grounded place-like titles from research results (for sufficiency). */
export function countGroundedPlaceCandidates(evidence = null) {
  const titles = (evidence?.results ?? [])
    .map((r) => String(r?.title ?? "").trim())
    .filter((t) => t.length >= 2);
  return new Set(titles.map((t) => t.toLowerCase().replace(/\s+/g, ""))).size;
}

/**
 * Place-request contract on Phase-1 evidence.
 * Success when search ran and ≥1 grounded candidate exists.
 * Prefer up to 3 candidates as a quality goal (prompt/refine), not a success Gate.
 */
export function applyPlaceResearchContract(evidence = null, question = "", history = []) {
  const base =
    evidence && typeof evidence === "object"
      ? { ...evidence }
      : emptyResearchEvidence({ status: "empty" });
  if (!isActivePlaceCustomerThread({ question, history })) {
    base.customer_facing_summary = buildCustomerFacingResearchSummary(base);
    return base;
  }
  const searchCount = Number(base.search_count ?? 0);
  const resultCount = countGroundedPlaceCandidates(base);
  if (searchCount <= 0) {
    base.status = "search_not_used";
    base.status_detail = "research_search_not_used";
    base.research_unavailable = true;
    base.used = false;
    base.customer_facing_summary = buildCustomerFacingResearchSummary(base);
    return base;
  }
  if (resultCount < 1) {
    base.status = "insufficient";
    base.status_detail = "research_insufficient";
    base.research_unavailable = true;
    base.customer_facing_summary = buildCustomerFacingResearchSummary(base);
    return base;
  }
  base.status = "success";
  base.status_detail = null;
  base.research_unavailable = false;
  base.customer_facing_summary = buildCustomerFacingResearchSummary(base);
  return base;
}

function domainFromUrl(url = "") {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function emptyResearchEvidence(overrides = {}) {
  return {
    schema_version: "key-public-research-evidence-v1",
    status: "skipped",
    status_detail: null,
    used: false,
    search_count: 0,
    provider_requests: 0,
    retrieved_at: new Date().toISOString(),
    stop_reason: null,
    searches: [],
    results: [],
    citations: [],
    errors: [],
    customer_facing_summary: {
      status: "skipped",
      result_count: 0,
      domains: [],
      title_previews: [],
    },
    ...overrides,
  };
}

function buildCustomerFacingResearchSummary(evidence = {}) {
  const results = Array.isArray(evidence.results) ? evidence.results : [];
  return {
    status: evidence.status ?? "skipped",
    status_detail: evidence.status_detail ?? null,
    result_count: results.length,
    domains: [...new Set(results.map((r) => r.domain).filter(Boolean))].slice(0, 8),
    title_previews: results.map((r) => r.title).filter(Boolean).slice(0, 8),
    search_count: evidence.search_count ?? 0,
    // Never include encrypted_* here
  };
}

/**
 * Preserve citation / snippet text on results so Gate grounding can see the same
 * public evidence Claude used — not only a narrow title/candidate chart.
 */
export function enrichResearchEvidenceForGrounding(evidence = null) {
  if (!evidence || typeof evidence !== "object") return evidence;
  const citations = Array.isArray(evidence.citations) ? evidence.citations : [];
  const citation_text_blob = citations
    .map((c) => [c?.title, c?.cited_text, c?.claim_or_summary].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  const results = (Array.isArray(evidence.results) ? evidence.results : []).map((r) => {
    const related = citations.filter(
      (c) =>
        (c?.url && r?.url && String(c.url) === String(r.url)) ||
        (c?.title && r?.title && String(c.title) === String(r.title)),
    );
    const texts = related.map((c) => c?.cited_text || c?.claim_or_summary).filter(Boolean);
    const claim = [r?.claim_or_summary, r?.cited_text, ...texts].filter(Boolean).join("\n");
    return {
      ...r,
      claim_or_summary: claim || r?.claim_or_summary || null,
      cited_text: texts.join("\n") || r?.cited_text || null,
    };
  });
  return {
    ...evidence,
    results,
    citation_text_blob: citation_text_blob || evidence.citation_text_blob || null,
    customer_facing_summary: buildCustomerFacingResearchSummary({ ...evidence, results }),
  };
}

/** Extract source-bearing public research evidence — full encrypted fields preserved internally. */
export function extractPublicResearchEvidence(data = {}, { retrievedAt = new Date().toISOString() } = {}) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const searches = [];
  const results = [];
  const citations = [];
  const errors = [];
  const queryByToolId = new Map();
  let searchCount = 0;

  for (const block of content) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      searchCount += 1;
      const q = String(block?.input?.query ?? "").trim();
      if (block.id) queryByToolId.set(block.id, q);
      searches.push({
        id: block.id ?? null,
        query: q || null,
      });
    }
  }

  for (const block of content) {
    if (block?.type !== "web_search_tool_result") continue;
    const toolUseId = block.tool_use_id ?? null;
    const query = queryByToolId.get(toolUseId) ?? null;
    const rawContent = block.content;

    if (rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)) {
      if (rawContent.type === "web_search_tool_result_error") {
        errors.push({
          tool_use_id: toolUseId,
          error_code: String(rawContent.error_code ?? "unavailable"),
          query,
        });
        continue;
      }
    }

    const items = Array.isArray(rawContent) ? rawContent : [];
    if (items.length === 0 && Array.isArray(rawContent)) {
      // empty result array — tracked via status later
      continue;
    }
    for (const item of items) {
      if (item?.type === "web_search_tool_result_error") {
        errors.push({
          tool_use_id: toolUseId,
          error_code: String(item.error_code ?? "unavailable"),
          query,
        });
        continue;
      }
      if (item?.type && item.type !== "web_search_result") continue;
      const url = String(item?.url ?? "").trim();
      const title = String(item?.title ?? "").trim();
      if (!url && !title) continue;
      results.push({
        tool_use_id: toolUseId,
        query,
        title: title || null,
        url: url || null,
        source: domainFromUrl(url),
        domain: domainFromUrl(url),
        page_age: item?.page_age != null ? String(item.page_age) : null,
        encrypted_content:
          item?.encrypted_content != null ? String(item.encrypted_content) : null,
        retrieved_at: retrievedAt,
        customer_specific_fact: false,
      });
    }
  }

  for (const block of content) {
    if (block?.type !== "text" || !Array.isArray(block.citations)) continue;
    for (const cite of block.citations) {
      if (cite?.type && cite.type !== "web_search_result_location") continue;
      const url = String(cite?.url ?? "").trim();
      if (!url) continue;
      citations.push({
        url,
        title: String(cite?.title ?? "").trim() || null,
        cited_text: String(cite?.cited_text ?? "").trim() || null,
        encrypted_index:
          cite?.encrypted_index != null ? String(cite.encrypted_index) : null,
        source: domainFromUrl(url),
        domain: domainFromUrl(url),
        retrieved_at: retrievedAt,
        customer_specific_fact: false,
      });
    }
  }

  const usageSearches = Number(data?.usage?.server_tool_use?.web_search_requests ?? 0);
  const hasEmptyArrayResult = content.some(
    (b) =>
      b?.type === "web_search_tool_result" &&
      Array.isArray(b.content) &&
      b.content.length === 0,
  );

  let status = "success";
  let statusDetail = null;
  if (errors.length && !results.length) {
    status = "error";
    statusDetail = errors[0]?.error_code ?? "unavailable";
  } else if (!results.length && (searchCount > 0 || usageSearches > 0 || hasEmptyArrayResult)) {
    status = "empty";
    statusDetail = "research_empty";
  } else if (!results.length && searchCount === 0 && usageSearches === 0) {
    status = "empty";
    statusDetail = "research_empty";
  }

  const evidence = {
    schema_version: "key-public-research-evidence-v1",
    status,
    status_detail: statusDetail,
    used: searchCount > 0 || usageSearches > 0 || results.length > 0 || errors.length > 0,
    search_count: Math.max(searchCount, usageSearches),
    provider_requests: 0,
    retrieved_at: retrievedAt,
    stop_reason: data?.stop_reason ?? null,
    searches,
    results,
    citations,
    errors,
  };
  evidence.customer_facing_summary = buildCustomerFacingResearchSummary(evidence);
  return evidence;
}

/** Detect unresolved server_tool_use (no matching result) — mixed/incomplete contract. */
export function findUnresolvedServerToolUses(data = {}) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const resultIds = new Set(
    content
      .filter((b) => b?.type === "web_search_tool_result" && b.tool_use_id)
      .map((b) => b.tool_use_id),
  );
  return content
    .filter((b) => b?.type === "server_tool_use" && b?.name === "web_search" && b.id)
    .filter((b) => !resultIds.has(b.id))
    .map((b) => b.id);
}

function classifyProviderHttpError(status, bodyText = "") {
  const t = String(bodyText ?? "");
  if (status === 400 && /web search|not.*enabled|disabled/i.test(t)) {
    return "web_search_disabled_400";
  }
  if (status === 429 || /rate.?limit|too_many_requests/i.test(t)) return "rate_limit";
  if (status === 408 || /timeout/i.test(t)) return "timeout";
  return `provider_error_${status}`;
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
  // Insurance Education (면책/갱신형/감액/특약 뜻) — concept OK; inventing ungrounded numbers as fact FORBIDDEN.
  if (
    /갱신형|비갱신형|면책\s*기간|감액\s*기간|특약\s*뜻|담보\s*뜻|보험\s*용어/.test(q) ||
    /(?:갱신형|비갱신형|면책|감액|특약|담보|실손).{0,12}(?:무슨\s*뜻|뭐야|무엇|설명)/.test(q) ||
    /(?:무슨\s*뜻|뭐야|무엇).{0,12}(?:갱신형|비갱신형|면책|감액|특약|담보)/.test(q)
  ) {
    return "Insurance Education path (면책기간/갱신형/감액/특약·담보 뜻): Explain the concept clearly in KEY voice — do NOT refuse education or go wait-only. GOOD: '면책기간은 가입 후 일정 기간 동안 보장이 시작되지 않거나 제한될 수 있는 기간을 뜻해요. 며칠인지는 상품·담보마다 달라요.' OR '갱신형은 일정 주기마다 보험료가 다시 정해질 수 있는 구조예요.' ALLOWED numbers: ONLY values present in allowed_fact_tokens / allowed_numbers / confirmed document facts (e.g. policy_count 22, 확인된 월 4만5천 원). FORBIDDEN as invented fact: ungrounded day counts (e.g. 90일), %, 금액, 한도, '보통 N일', '대개 N%' when not in allowed inputs — say 상품·담보마다 다름 instead of inventing a number. Do NOT expand into personal contract verdict (고객님께 적합/부족/충분, 가입하세요, 해지해도 됩니다). next_decision_point MUST have 2-3 choices — e.g. (1) 개념만 더 보기 (2) 본인 계약 서류 기준으로 확인하기 (3) 비슷한 용어(갱신형↔비갱신형 등)와 비교하기. Never leave next_decision_point empty.";
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

/** Policy field keys Claude may read from the verified chart (factory-owned only). */
const CHART_POLICY_FIELD_KEYS = [
  "insurer_name",
  "product_name",
  "monthly_premium",
  "premium_amount",
  "coverages",
  "coverage_list",
  "coverage_names",
  // Slice 6: do not forward policy_number (direct identifier) into Claude chart.
  "policy_status",
  // Slice 7: insured_name aliases into parties.insured (with coverage_summary.insured).
  "insured_name",
  "start_date",
  "end_date",
  "payment_cycle",
  "product_type",
  "company_name",
];

/** Preserve factory literals as-is (e.g. "9999세") — never normalize to 종신/invalid. */
function preserveFactoryLiteral(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return value;
}

function pickFirstPresent(...values) {
  for (const v of values) {
    if (v == null || v === "") continue;
    return preserveFactoryLiteral(v);
  }
  return null;
}

/**
 * Slice 7 — contract parties from factory/extract only.
 * Unifies insured / insured_name / coverage_summary.insured (no invent, no cross-contract mix).
 */
function buildContractPartyField(value, provenance) {
  const v = preserveFactoryLiteral(value);
  if (v == null) {
    return {
      value: null,
      evidence_state: "unknown",
      provenance: provenance ?? null,
    };
  }
  return {
    value: v,
    evidence_state: "verified",
    provenance: provenance ?? null,
  };
}

function extractContractPartiesFromPolicy(p = null, summary = null, contractProvenance = null) {
  const s = summary && typeof summary === "object" ? summary : {};
  // policyholder: top-level or coverage_summary only — never invent.
  const policyholderRaw = pickFirstPresent(p?.policyholder, s.policyholder);
  // insured: unify insured_name ↔ insured (same person field, different legacy names).
  const insuredRaw = pickFirstPresent(
    p?.insured,
    s.insured,
    p?.insured_name,
    s.insured_name,
  );
  const partyProvenance = {
    document_id: contractProvenance?.document_id ?? null,
    extractor_version: contractProvenance?.extractor_version ?? null,
    extracted_at: contractProvenance?.extracted_at ?? null,
    source_span: pickFirstPresent(
      s.policyholder_source_line,
      s.insured_source_line,
      s.source_line,
    ),
  };
  return {
    policyholder: buildContractPartyField(policyholderRaw, partyProvenance),
    insured: buildContractPartyField(insuredRaw, partyProvenance),
  };
}

/**
 * Collect factory-owned coverage labels already present on the policy.
 * Maps coverage_summary.detected_coverages / coverage_categories — never invents.
 */
function extractVerifiedCoveragesFromPolicy(p = null) {
  if (!p || typeof p !== "object") return null;
  const out = [];
  const seen = new Set();
  const pushOne = (v) => {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const pushMany = (raw) => {
    if (raw == null || raw === "") return;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item == null) continue;
        if (typeof item === "string" || typeof item === "number") pushOne(item);
        else if (typeof item === "object") {
          pushOne(item.name ?? item.coverage_name ?? item.label ?? item.category ?? "");
        }
      }
      return;
    }
    if (typeof raw === "string") {
      for (const part of raw.split(/[,|/·]/).map((x) => x.trim()).filter(Boolean)) pushOne(part);
    }
  };
  pushMany(p.coverages);
  pushMany(p.coverage_list);
  pushMany(p.coverage_names);
  pushMany(p.coverage_categories);
  const summary = p.coverage_summary;
  if (summary && typeof summary === "object") {
    pushMany(summary.detected_coverages);
    pushMany(summary.coverage_categories);
    pushMany(summary.categories);
    pushMany(summary.riders);
  }
  return out.length ? out : null;
}

function buildCoverageProvenance(summary = null, detail = null) {
  const document_id = pickFirstPresent(
    detail?.source_document_id,
    summary?.source_document_id,
    summary?.document_id,
  );
  const extractor_version = pickFirstPresent(
    detail?.extractor_version,
    summary?.extractor_version,
  );
  const extracted_at = pickFirstPresent(detail?.extracted_at, summary?.extracted_at);
  const page = pickFirstPresent(detail?.page, detail?.page_number, summary?.page);
  const row_or_source_span = pickFirstPresent(
    detail?.source_line,
    detail?.row_or_source_span,
    detail?.notes,
    summary?.source_line,
  );
  if (
    document_id == null &&
    extractor_version == null &&
    extracted_at == null &&
    page == null &&
    row_or_source_span == null
  ) {
    return null;
  }
  return {
    document_id,
    page,
    row_or_source_span,
    extractor_version,
    extracted_at,
  };
}

/**
 * Structured coverages from factory/extract — amounts only when already present.
 * Never invent names, amounts, or units. Never coerce 9999세 → 종신.
 */
function extractVerifiedCoverageDetailsFromPolicy(p = null) {
  if (!p || typeof p !== "object") return [];
  const summary =
    p.coverage_summary && typeof p.coverage_summary === "object" ? p.coverage_summary : {};
  const out = [];
  const seen = new Set();

  const pushCoverage = (row) => {
    if (!row || typeof row !== "object") return;
    const nameRaw = pickFirstPresent(
      row.coverage_name,
      row.rider_name,
      row.name,
      row.label,
      row.category,
    );
    const amount =
      row.coverage_amount != null && row.coverage_amount !== ""
        ? preserveFactoryLiteral(row.coverage_amount)
        : row.amount != null && row.amount !== ""
          ? preserveFactoryLiteral(row.amount)
          : null;
    const amountRaw = pickFirstPresent(
      row.coverage_amount_raw,
      row.amount_raw,
      amount != null ? amount : null,
    );
    const hasName = nameRaw != null && String(nameRaw).trim() !== "";
    const hasAmount = amount != null || (amountRaw != null && String(amountRaw).trim() !== "");
    if (!hasName && !hasAmount) return;

    const coverage_name = hasName ? preserveFactoryLiteral(nameRaw) : "unknown";
    const key = `${String(coverage_name)}::${amount ?? ""}::${amountRaw ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);

    let evidence_state = "verified";
    if (!hasName && hasAmount) evidence_state = "partial";
    else if (hasName && !hasAmount) evidence_state = "partial";
    else if (row.evidence_state) evidence_state = String(row.evidence_state);

    out.push({
      coverage_name,
      coverage_amount: amount,
      coverage_amount_raw: amountRaw,
      coverage_unit: pickFirstPresent(row.coverage_unit, row.unit),
      coverage_period: pickFirstPresent(
        row.coverage_period,
        row.insurance_period,
        summary.insurance_period,
      ),
      renewal_type: pickFirstPresent(row.renewal_type, summary.renewal_type, p.renewal_type),
      evidence_state,
      provenance: buildCoverageProvenance(summary, row),
    });
  };

  if (Array.isArray(summary.rider_details)) {
    for (const detail of summary.rider_details) pushCoverage(detail);
  }
  if (Array.isArray(summary.riders)) {
    for (const rider of summary.riders) {
      if (rider && typeof rider === "object") pushCoverage(rider);
    }
  }
  // Top-level summary coverage_name + amount (single)
  if (summary.coverage_name != null || summary.coverage_amount != null) {
    pushCoverage({
      coverage_name: summary.coverage_name,
      coverage_amount: summary.coverage_amount,
      coverage_amount_raw: summary.coverage_amount_raw,
      coverage_unit: summary.coverage_unit,
      source_line: summary.source_line,
    });
  }

  // Label-only factory coverages (no amount) — keep as partial name rows if not already added
  const labels = extractVerifiedCoveragesFromPolicy(p) ?? [];
  for (const label of labels) {
    const already = out.some(
      (c) => String(c.coverage_name ?? "").trim() === String(label).trim(),
    );
    if (already) continue;
    pushCoverage({ coverage_name: label, coverage_amount: null });
  }

  return out;
}

function buildContractProvenance(p = null, summary = null) {
  return {
    document_id: pickFirstPresent(
      summary?.source_document_id,
      p?.source_document_id,
      p?.document_id,
    ),
    extractor_version: pickFirstPresent(summary?.extractor_version, p?.extractor_version),
    extracted_at: pickFirstPresent(summary?.extracted_at, p?.extracted_at),
    effective_from: pickFirstPresent(
      summary?.effective_from,
      p?.effective_from,
      p?.start_date,
    ),
    source: pickFirstPresent(p?.source, "factory"),
  };
}

/**
 * Verified customer chart for Claude input — full contract list, no 1-policy stub.
 * Claude may read/analyze; KEY alone owns chart write/adopt/judgment.
 * Unverified values are marked unknown — never promoted to chart facts.
 * Slice 6: pass factory rider amounts / periods / provenance when already present.
 * Slice 7: pass verified policyholder / insured per contract (no beneficiary yet).
 */
export function buildVerifiedCustomerChart(reality = null) {
  const policies = Array.isArray(reality?.policies) ? reality.policies : [];
  const declaredCount = Number(reality?.policy_count ?? policies.length ?? 0) || 0;
  const contracts = policies.map((p, index) => {
    const summary =
      p?.coverage_summary && typeof p.coverage_summary === "object" ? p.coverage_summary : {};
    const verified = {};
    const unknown = [];
    for (const key of CHART_POLICY_FIELD_KEYS) {
      if (key === "coverages" || key === "coverage_list" || key === "coverage_names") continue;
      const raw = p?.[key];
      if (raw == null || raw === "") {
        continue;
      }
      verified[key] = preserveFactoryLiteral(raw);
    }
    // Periods from factory/extract — never invent; preserve literals (incl. 9999세).
    const payment_period = pickFirstPresent(
      p?.payment_period,
      summary.payment_period,
      verified.payment_cycle,
    );
    const insurance_period = pickFirstPresent(p?.insurance_period, summary.insurance_period);
    const renewal_type = pickFirstPresent(p?.renewal_type, summary.renewal_type);
    const end_date = pickFirstPresent(verified.end_date, p?.end_date, summary.end_date);
    const start_date = pickFirstPresent(
      verified.start_date,
      p?.start_date,
      summary.effective_from,
      p?.effective_from,
    );
    if (payment_period != null) verified.payment_period = payment_period;
    if (insurance_period != null) verified.insurance_period = insurance_period;
    if (renewal_type != null) verified.renewal_type = renewal_type;
    if (end_date != null) verified.end_date = end_date;
    if (start_date != null) verified.start_date = start_date;

    const coverageLabels = extractVerifiedCoveragesFromPolicy(p);
    if (coverageLabels) verified.coverages = coverageLabels;
    const coverages = extractVerifiedCoverageDetailsFromPolicy(p);

    const provenance = buildContractProvenance(p, summary);
    const parties = extractContractPartiesFromPolicy(p, summary, provenance);
    // Canonical party fields on contract + verified_fields (insured_name alias unified).
    if (parties.policyholder.value != null) {
      verified.policyholder = parties.policyholder.value;
    } else {
      unknown.push("policyholder");
    }
    if (parties.insured.value != null) {
      verified.insured = parties.insured.value;
      verified.insured_name = parties.insured.value;
    } else {
      unknown.push("insured");
    }

    if (verified.insurer_name == null && verified.company_name == null) unknown.push("insurer_name");
    if (verified.product_name == null) unknown.push("product_name");
    if (verified.monthly_premium == null && verified.premium_amount == null) {
      unknown.push("monthly_premium");
    }
    if (coverages.length === 0 && verified.coverages == null) {
      unknown.push("coverages");
    }
    const status =
      Object.keys(verified).length === 0 && coverages.length === 0
        ? "unknown"
        : unknown.length === 0
          ? "verified"
          : "partial";

    const insurer = pickFirstPresent(verified.insurer_name, verified.company_name);
    const monthly_premium = pickFirstPresent(verified.monthly_premium, verified.premium_amount);

    return {
      index,
      contract_id: pickFirstPresent(p?.id, p?.policy_id, p?.contract_id),
      insurer,
      product_name: pickFirstPresent(verified.product_name),
      start_date,
      end_date,
      payment_period,
      insurance_period,
      renewal_type,
      monthly_premium,
      policyholder: parties.policyholder.value,
      insured: parties.insured.value,
      parties,
      evidence_state: status,
      provenance,
      coverages,
      status,
      verified_fields: verified,
      unknown_fields: unknown,
      source: "factory",
    };
  });

  const aggregatesRaw =
    reality?.factory_aggregates ??
    reality?.aggregates ??
    reality?.calculation_aggregates ??
    null;
  const factory_aggregates =
    aggregatesRaw && typeof aggregatesRaw === "object"
      ? { status: "verified", values: aggregatesRaw }
      : { status: "unknown", values: null };

  return {
    schema: "verified_customer_chart_v1",
    policy_count: {
      value: declaredCount,
      status: declaredCount > 0 ? "verified" : "unknown",
      source: "factory",
    },
    contracts,
    factory_aggregates,
    chart_completeness: {
      listed_contracts: contracts.length,
      declared_policy_count: declaredCount,
      all_contracts_listed: contracts.length === declaredCount && declaredCount > 0,
    },
    ownership:
      "KEY owns chart record and final judgment. Claude may read and analyze only — never store, mutate, or adopt facts.",
  };
}

function buildSessionGoalPayload(decision = null, directive = null) {
  return {
    situation_key: decision?.situation_key ?? directive?.decision_situation_key ?? null,
    response_priority: decision?.response_priority ?? directive?.response_priority ?? null,
    key_next_move:
      decision?.key_next_move ??
      decision?.direction?.move ??
      directive?.key_next_move ??
      null,
    key_situation_judgment:
      decision?.key_situation_judgment ?? directive?.key_situation_judgment ?? null,
    confirm_question: decision?.confirm_question ?? directive?.confirm_question ?? null,
    inferred_goal: decision?.situation_key ?? null,
  };
}

function buildDecisionPayload(decision = null) {
  if (!decision || typeof decision !== "object") return null;
  return {
    situation_key: decision.situation_key ?? null,
    response_priority: decision.response_priority ?? null,
    key_judgment: decision.key_judgment ?? null,
    key_situation_judgment: decision.key_situation_judgment ?? null,
    key_next_move: decision.key_next_move ?? decision.direction?.move ?? null,
    direction: decision.direction ?? null,
    invite: decision.invite ?? null,
    direct_answer_hint: decision.direct_answer_hint ?? null,
    customer_situation_hypothesis: decision.customer_situation_hypothesis ?? null,
    fact_selection: decision.fact_selection ?? null,
    decision_complete: decision.decision_complete === true,
  };
}

function mapConversationHistory(history = []) {
  return (Array.isArray(history) ? history : []).map((h) => ({
    role: h?.role ?? null,
    text: h?.text ?? h?.content ?? "",
  }));
}

/**
 * Early fact boundary from Reality only — never invents decision/directive/s6.
 * Reuses the same verified policy fact ids KEY Decision already trusts.
 * Also attaches full verified_customer_chart (not a 1-policy stub).
 */
export function buildEarlyBorrowedFactBoundary({ reality = null, question = "" } = {}) {
  const policies = Array.isArray(reality?.policies) ? reality.policies : [];
  const p = policies[0] ?? null;
  const count = Number(reality?.policy_count ?? policies.length ?? 0) || 0;
  const spoken = [];
  const verified_customer_chart = buildVerifiedCustomerChart(reality);

  if (count > 0) {
    spoken.push({ fact_id: "policy_count", value: String(count), source: "factory" });
    if (p?.insurer_name) {
      spoken.push({ fact_id: "insurer", value: String(p.insurer_name), source: "factory" });
    }
    if (p?.product_name) {
      spoken.push({ fact_id: "product", value: String(p.product_name), source: "factory" });
    }
    const premiumRaw = p?.monthly_premium ?? p?.premium_amount ?? null;
    if (premiumRaw != null) {
      spoken.push({ fact_id: "monthly_premium", value: String(premiumRaw), source: "factory" });
    }
  }

  // Allowed speak tokens stay Decision-shaped; full chart is separate for Claude reading.
  const allowed_fact_tokens = {
    policy_count: null,
    insurer: null,
    product: null,
    monthly_premium_raw: null,
    monthly_premium_display: null,
  };
  const allowed_numbers = new Set();
  const allowed_entities = new Set();

  for (const f of spoken) {
    if (f.fact_id === "policy_count") {
      allowed_fact_tokens.policy_count = f.value;
      allowed_numbers.add(String(f.value));
    }
    if (f.fact_id === "insurer") {
      allowed_fact_tokens.insurer = f.value;
      allowed_entities.add(String(f.value));
    }
    if (f.fact_id === "product") {
      allowed_fact_tokens.product = f.value;
      allowed_entities.add(String(f.value));
    }
    if (f.fact_id === "monthly_premium") {
      allowed_fact_tokens.monthly_premium_raw = f.value;
      const display = formatPremiumFromRaw(f.value);
      allowed_fact_tokens.monthly_premium_display = display;
      for (const n of String(f.value).match(/\d+/g) ?? []) allowed_numbers.add(n);
      for (const n of String(display ?? "").match(/\d+/g) ?? []) allowed_numbers.add(n);
    }
  }

  const realityAllowlist = collectVerifiedSpeakAllowlistFromReality(reality);
  for (const n of realityAllowlist.allowed_numbers) allowed_numbers.add(String(n));
  for (const e of realityAllowlist.allowed_entities) allowed_entities.add(String(e));
  verified_customer_chart.insurer_counts = realityAllowlist.insurer_counts;
  verified_customer_chart.product_counts = realityAllowlist.product_counts;

  // Surface verified insurer/product names from the full chart into allowed_entities.
  for (const c of verified_customer_chart.contracts ?? []) {
    const v = c.verified_fields ?? {};
    if (v.insurer_name) allowed_entities.add(String(v.insurer_name));
    if (v.company_name) allowed_entities.add(String(v.company_name));
    if (v.product_name) allowed_entities.add(String(v.product_name));
    const prem = v.monthly_premium ?? v.premium_amount;
    if (prem != null) {
      for (const n of String(prem).match(/\d+/g) ?? []) allowed_numbers.add(n);
    }
  }

  const focus = deriveKeyVoiceQuestionFocus(question, null);
  const multi = count > 1 && allowed_fact_tokens.monthly_premium_display;
  const premium_scope_policy = multi
    ? {
        separation_required: true,
        policy_count: count,
        representative_premium: allowed_fact_tokens.monthly_premium_display,
        forbid_blur_phrases: ["N건, 월 X", "기준으로 전체 보험료"],
      }
    : null;

  return {
    question_focus: focus,
    allowed_fact_tokens,
    allowed_numbers: [...allowed_numbers],
    allowed_entities: [...allowed_entities],
    facts_to_speak: spoken.map((f) => f.fact_id),
    facts_spoken: spoken,
    premium_scope_policy,
    verified_customer_chart,
    // Explicit: no fake decision / directive / s6
    decision: null,
    directive: null,
    s6_final_answer: "",
  };
}

function buildUserPayload({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
  factBoundary = null,
  reflection = null,
  reality = null,
  publicResearchEvidence = null,
  relatedPastJudgments = null,
  relatedPastOriginals = null,
  documentEvidence = null,
  answerMode = "shadow_sketch",
  focusedCorrection = null,
  contextPack = null,
} = {}) {
  const early = factBoundary && typeof factBoundary === "object" ? factBoundary : null;
  const allowed_fact_tokens =
    directive?.allowed_fact_tokens ?? early?.allowed_fact_tokens ?? {};
  const allowed_numbers = directive?.allowed_numbers ?? early?.allowed_numbers ?? [];
  const allowed_entities =
    directive?.allowed_entities ?? early?.allowed_entities ?? [];
  const facts_to_speak = directive?.facts_to_speak
    ? (directive.facts_to_speak ?? []).map((f) => (typeof f === "string" ? f : f.fact_id))
    : early?.facts_to_speak ?? [];
  const verified_customer_chart =
    early?.verified_customer_chart ??
    directive?.verified_customer_chart ??
    buildVerifiedCustomerChart(reality);
  const pack =
    contextPack && typeof contextPack === "object"
      ? contextPack
      : buildClaudeFullContextPack({
          history,
          previousAnswerSummary,
          question,
          documentEvidence,
          relatedPastOriginals:
            relatedPastOriginals ??
            (answerMode === "claude_full" ? relatedPastJudgments : null),
        }).pack;
  const claudeFull = answerMode === "claude_full";
  // Claude-Full: avoid duplicate full-history attach when recent + older summary + retained cover the thread.
  const conversation_history = claudeFull
    ? null
    : Array.isArray(pack.conversation_history_full)
      ? pack.conversation_history_full
      : mapConversationHistory(history);
  const decisionPayload = claudeFull ? null : buildDecisionPayload(decision);
  const session_goal = claudeFull ? null : buildSessionGoalPayload(decision, directive);
  const document_evidence =
    Array.isArray(pack.document_evidence) && pack.document_evidence.length
      ? pack.document_evidence
      : normalizeDocumentEvidence(Array.isArray(documentEvidence) ? documentEvidence : []);
  const related_past_originals = Array.isArray(pack.related_past_originals)
    ? pack.related_past_originals
    : [];

  return {
    schema_version: claudeFull ? "claude_full_emit_v2" : S7_BORROWED_SENSES_SCHEMA_B,
    s7a_schema_version: claudeFull ? null : S7_BORROWED_SENSES_SCHEMA,
    insurance_expertise_taxonomy: claudeFull ? null : S7B_EXPERTISE_TAXONOMY,
    // Material pack — tools & forbidden list (D2). Not Decision/Goal drafts.
    available_tools: claudeFull
      ? ["web_search", "emit_claude_full", "document_lookup", "memory_candidate"]
      : null,
    forbidden_behaviors: claudeFull
      ? [
          "invent_facts",
          "contradict_verified_chart",
          "ungrounded_enroll_cancel_recommend",
          "out_of_permission_execution",
          "clear_danger",
          "pretend_decision_already_sealed",
        ]
      : null,
    forbidden_axis_terms: claudeFull
      ? null
      : [
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
    current_user_message: question,
    customer_question: question,
    conversation_history,
    conversation_history_count: conversation_history?.length ?? 0,
    recent_conversation_originals: pack.recent_conversation_originals ?? mapConversationHistory(history),
    recent_conversation_count:
      pack.recent_conversation_count ?? (Array.isArray(history) ? history.length : 0),
    older_conversation_summary: pack.older_conversation_summary ?? null,
    retained_past_originals: pack.retained_past_originals ?? [],
    retained_past_original_count: pack.retained_past_original_count ?? 0,
    related_past_originals,
    related_past_original_count: related_past_originals.length,
    document_evidence,
    document_evidence_count: document_evidence.length,
    open_customer_thread: buildOpenCustomerThreadContext({ question, history }),
    previous_answer_summary:
      pack.previous_answer_summary ??
      (String(previousAnswerSummary ?? "").trim() || null),
    s6_final_answer_frozen: claudeFull ? "" : String(s6FinalAnswer ?? "").trim(),
    question_focus: claudeFull
      ? null
      : directive?.question_focus ?? early?.question_focus ?? null,
    answer_mode: claudeFull ? "claude_full" : directive?.answer_mode ?? null,
    decision_situation_key: claudeFull ? null : decision?.situation_key ?? null,
    // D2: Decision / Session Goal are Claude OUTPUT only — never input drafts.
    decision: decisionPayload,
    session_goal,
    related_past_judgments: claudeFull
      ? null
      : Array.isArray(relatedPastJudgments)
        ? relatedPastJudgments
        : Array.isArray(decision?.related_past_judgments)
          ? decision.related_past_judgments
          : null,
    verified_customer_chart,
    public_research_evidence: publicResearchEvidence ?? null,
    allowed_fact_tokens,
    allowed_numbers,
    allowed_entities,
    facts_to_speak,
    premium_scope_policy: directive?.premium_scope_policy ?? early?.premium_scope_policy ?? null,
    reflection_situation_reading: claudeFull
      ? null
      : Array.isArray(reflection?.situation_reading)
        ? reflection.situation_reading.map((s) => String(s).trim()).filter(Boolean)
        : null,
    reflection_reading_confidence: claudeFull ? null : reflection?.reading_confidence ?? null,
    visual_blocks_summary: claudeFull ? null : summarizeVisualBlocks(visualBlocks),
    s7b_question_leadership_hint: claudeFull ? null : buildQuestionLeadershipHint(question),
    call_phase: decision || directive ? "post_decision" : "pre_decision",
    focused_correction:
      focusedCorrection && typeof focusedCorrection === "object"
        ? {
            attempt: 1,
            violations: focusedCorrection.violations ?? [],
            failed_claims_preview: String(
              focusedCorrection.failed_claims_preview ?? "",
            ).slice(0, 400),
            previous_customer_answer: String(
              focusedCorrection.previous_customer_answer ??
                focusedCorrection.previous_voice_raw_candidate ??
                "",
            ).slice(0, 2000),
            previous_voice_raw_candidate: String(
              focusedCorrection.previous_voice_raw_candidate ??
                focusedCorrection.previous_customer_answer ??
                "",
            ).slice(0, 2000),
          }
        : null,
    provider_input_policy: {
      history_slice: null,
      chart_stub_one_policy: false,
      research_history_slice: null,
      note: claudeFull
        ? "Claude-Full: customer question + recent originals + older summary + retained past + related past + verified chart + evidence + documents. Full history is not duplicate-attached."
        : "Full conversation_history and verified_customer_chart are sent. Downstream Anthropic output max_tokens remain (research/emit/speak) — input is not artificially truncated here.",
      claude_full_no_key_answer_draft: claudeFull,
      claude_full_no_key_preinterpretation: claudeFull,
      claude_full_talent_open: claudeFull,
    },
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
  const claudeFull = extractClaudeFullParsedFromResponse(data);
  if (claudeFull) return claudeFull;
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

async function readAnthropicSseMessage({
  res,
  startedAt = null,
}) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const dataRaw = await res.json();
    const complete_ms = startedAt != null ? relMs(startedAt) : null;
    return {
      dataRaw,
      ttft_ms: complete_ms,
      ttft_basis: "non_stream_json_fallback",
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let ttft_ms = null;
  let message = null;
  let usage = null;
  let contentBlocks = [];

  const markTtft = () => {
    if (ttft_ms == null && startedAt != null) ttft_ms = relMs(startedAt);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const type = String(evt?.type ?? "");
      if (type === "message_start" && evt.message) {
        message = evt.message;
        if (Array.isArray(message.content)) contentBlocks = [...message.content];
      } else if (type === "content_block_start") {
        markTtft();
        const idx = Number(evt.index);
        if (Number.isFinite(idx)) {
          const block = evt.content_block && typeof evt.content_block === "object"
            ? { ...evt.content_block }
            : { type: "text", text: "" };
          if (block.type === "tool_use") block.input_json = block.input_json ?? "";
          contentBlocks[idx] = block;
        }
      } else if (type === "content_block_delta") {
        markTtft();
        const idx = Number(evt.index);
        const delta = evt.delta ?? {};
        if (!Number.isFinite(idx)) continue;
        if (!contentBlocks[idx]) contentBlocks[idx] = { type: "text", text: "" };
        if (delta.type === "text_delta") {
          contentBlocks[idx].text = `${contentBlocks[idx].text ?? ""}${delta.text ?? ""}`;
        } else if (delta.type === "input_json_delta") {
          contentBlocks[idx].input_json =
            `${contentBlocks[idx].input_json ?? ""}${delta.partial_json ?? ""}`;
          contentBlocks[idx].type = contentBlocks[idx].type || "tool_use";
        }
      } else if (type === "message_delta") {
        if (evt.usage) usage = { ...(usage ?? {}), ...evt.usage };
      } else if (type === "message_stop") {
        // final assembly below
      }
    }
  }

  // Finalize tool_use blocks: parse accumulated input_json into input object
  const content = contentBlocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    if (block.type === "tool_use" || block.input_json != null) {
      let input = block.input;
      if (block.input_json) {
        try {
          input = JSON.parse(block.input_json);
        } catch {
          input = block.input ?? {};
        }
      }
      return {
        type: "tool_use",
        id: block.id ?? null,
        name: block.name ?? null,
        input: input ?? {},
      };
    }
    return block;
  });

  const dataRaw = {
    ...(message && typeof message === "object" ? message : {}),
    content,
    usage: usage ?? message?.usage ?? null,
  };
  return {
    dataRaw,
    ttft_ms,
    ttft_basis: ttft_ms != null ? "stream_first_content_block" : "stream_no_content",
  };
}

async function postAnthropicMessages({
  fetchImpl,
  signal,
  apiKey,
  model,
  maxTokens,
  temperature,
  system,
  tools,
  toolChoice,
  messages,
  startedAt = null,
}) {
  const bodyStr = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    tools,
    tool_choice: toolChoice,
    messages,
    stream: true,
  });
  const input_bytes = Buffer.byteLength(bodyStr, "utf8");
  const provider_request_start_ms =
    startedAt != null ? relMs(startedAt) : null;
  const wallStart = Date.now();
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: bodyStr,
  });
  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      bodyText = "";
    }
    const provider_request_complete_ms =
      startedAt != null ? relMs(startedAt) : null;
    return {
      ok: false,
      error: classifyProviderHttpError(res.status, bodyText),
      http_status: res.status,
      data: null,
      raw: null,
      provider_timing: {
        provider_request_start_ms,
        provider_request_complete_ms,
        provider_duration_ms: Math.max(0, Date.now() - wallStart),
        ttft_ms: null,
        ttft_basis: null,
        input_bytes,
        input_tokens: null,
        output_tokens: null,
      },
    };
  }
  const { dataRaw, ttft_ms, ttft_basis } = await readAnthropicSseMessage({
    res,
    startedAt,
  });
  const { data, stripped } = stripReasoningFromProviderData(dataRaw);
  const usage = extractUsageMetrics(data);
  const provider_request_complete_ms =
    startedAt != null ? relMs(startedAt) : null;
  return {
    ok: true,
    data,
    raw: JSON.stringify(data.content ?? []),
    reasoning_stripped: stripped === true,
    provider_timing: {
      provider_request_start_ms,
      provider_request_complete_ms,
      provider_duration_ms: Math.max(0, Date.now() - wallStart),
      ttft_ms: typeof ttft_ms === "number" ? ttft_ms : null,
      ttft_basis: ttft_basis ?? null,
      input_bytes,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
  };
}

/**
 * PHASE 1 — web_search only. Never includes emit_borrowed_senses.
 * Max 3 provider requests. pause_turn: assistant content unchanged, no user Continue.
 * Place requests: require real web_search use; optionally refine toward 3 as preference.
 */
async function runPublicResearchPhase({
  model,
  apiKey,
  question,
  history,
  fetchImpl,
  signal,
  temperature,
  startedAt = null,
}) {
  const retrievedAt = new Date().toISOString();
  const placeRequest = isActivePlaceCustomerThread({ question, history });
  const forcePublicSearch = needsFreshPublicFacts({ question, history });
  let messages = [
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "public_research_only",
          question: String(question ?? "").trim(),
          conversation_history: mapConversationHistory(history),
          open_customer_thread: buildOpenCustomerThreadContext({ question, history }),
          suggested_first_query: String(question ?? "").trim(),
          search_before_clarify: forcePublicSearch,
          instruction: forcePublicSearch
            ? placeRequest
              ? "This is an explicit public place/venue/facility request (or unfinished place thread). You MUST call web_search at least once NOW using the stated area and request. Do NOT ask cuisine/mood preference before searching. Prefer up to 3 distinct grounded place candidates when available (quality goal, not a hard stop at fewer). Do not write a customer answer. Do not invent places. Do not reframe as a new travel itinerary. Do not mention insurance."
              : "This request needs fresh public facts. You MUST call web_search at least once NOW for current public information. Do not write a customer answer. Do not invent facts. Do not mention insurance."
            : "Use web_search for fresh public facts if needed. Do not write a customer answer. Do not mention insurance.",
        },
        null,
        2,
      ),
    },
  ];
  const tools = [ANTHROPIC_WEB_SEARCH_TOOL];
  const system = buildSystemPrompt({ mode: "research" });
  const temp = Math.min(0.45, Math.max(0.15, Number(temperature) || DEFAULT_TEMPERATURE));
  let providerRequests = 0;
  let lastData = null;
  let merged = emptyResearchEvidence({ retrieved_at: retrievedAt, status: "empty" });
  let forcedSearchNudgeUsed = false;
  let refineNudgeUsed = false;

  for (let turn = 0; turn < 3; turn += 1) {
    providerRequests += 1;
    // First turn on explicit public-fact requests: require a tool call (web_search is the only tool).
    const toolChoice =
      forcePublicSearch && turn === 0 && !forcedSearchNudgeUsed
        ? { type: "any" }
        : { type: "auto" };
    const once = await postAnthropicMessages({
      fetchImpl,
      signal,
      apiKey,
      model,
      maxTokens: 4096,
      temperature: temp,
      system,
      tools,
      toolChoice,
      messages,
      startedAt,
    });
    if (!once.ok) {
      return {
        ok: false,
        error: once.error,
        public_research_evidence: emptyResearchEvidence({
          status: "error",
          status_detail: once.error,
          provider_requests: providerRequests,
          retrieved_at: retrievedAt,
        }),
        provider_requests: providerRequests,
      };
    }
    lastData = once.data;
    const stop = String(once.data?.stop_reason ?? "");
    if (stop === "refusal") {
      return {
        ok: false,
        error: "research_refusal",
        public_research_evidence: emptyResearchEvidence({
          status: "incomplete",
          status_detail: "research_refusal",
          provider_requests: providerRequests,
          stop_reason: stop,
          retrieved_at: retrievedAt,
        }),
        provider_requests: providerRequests,
      };
    }
    if (stop === "max_tokens") {
      return {
        ok: false,
        error: "research_incomplete_max_tokens",
        public_research_evidence: emptyResearchEvidence({
          status: "incomplete",
          status_detail: "research_incomplete_max_tokens",
          provider_requests: providerRequests,
          stop_reason: stop,
          retrieved_at: retrievedAt,
        }),
        provider_requests: providerRequests,
      };
    }

    // Client tool_use must not appear in research-only phase; treat unresolved server tools as failure.
    const clientToolUses = (once.data?.content ?? []).filter((b) => b?.type === "tool_use");
    if (clientToolUses.length > 0) {
      return {
        ok: false,
        error: "research_unexpected_client_tool",
        public_research_evidence: emptyResearchEvidence({
          status: "incomplete",
          status_detail: "research_unexpected_client_tool",
          provider_requests: providerRequests,
          stop_reason: stop,
          retrieved_at: retrievedAt,
        }),
        provider_requests: providerRequests,
      };
    }

    const unresolved = findUnresolvedServerToolUses(once.data);
    if (stop === "tool_use" || unresolved.length > 0) {
      // Research-only phase has no client tools — unresolved server tool / tool_use is contract failure.
      return {
        ok: false,
        error: "research_unresolved_server_tool",
        public_research_evidence: emptyResearchEvidence({
          status: "incomplete",
          status_detail: "research_unresolved_server_tool",
          provider_requests: providerRequests,
          stop_reason: stop,
          retrieved_at: retrievedAt,
        }),
        provider_requests: providerRequests,
      };
    }

    const piece = extractPublicResearchEvidence(once.data, { retrievedAt });
    merged = {
      ...piece,
      provider_requests: providerRequests,
      searches: [...(merged.searches ?? []), ...(piece.searches ?? [])].filter(
        (s, i, arr) => arr.findIndex((x) => x.id === s.id && x.query === s.query) === i,
      ),
      results: [...(merged.results ?? []), ...(piece.results ?? [])].filter(
        (r, i, arr) =>
          arr.findIndex((x) => x.url === r.url && x.title === r.title && x.tool_use_id === r.tool_use_id) ===
          i,
      ),
      citations: [...(merged.citations ?? []), ...(piece.citations ?? [])].filter(
        (c, i, arr) =>
          arr.findIndex((x) => x.url === c.url && x.cited_text === c.cited_text) === i,
      ),
      errors: [...(merged.errors ?? []), ...(piece.errors ?? [])],
      search_count: Math.max(merged.search_count ?? 0, piece.search_count ?? 0),
      used: Boolean(merged.used || piece.used),
    };
    merged.customer_facing_summary = buildCustomerFacingResearchSummary(merged);

    if (stop === "pause_turn") {
      // Contract: re-send assistant content unchanged — no user Continue text.
      messages = [...messages, { role: "assistant", content: once.data?.content ?? [] }];
      continue;
    }

    // Explicit public-fact request: force one search nudge if Claude ended without web_search.
    if (
      forcePublicSearch &&
      (merged.search_count ?? 0) <= 0 &&
      !forcedSearchNudgeUsed &&
      turn < 2
    ) {
      forcedSearchNudgeUsed = true;
      messages = [
        ...messages,
        { role: "assistant", content: once.data?.content ?? [] },
        {
          role: "user",
          content:
            "Contract: you did not use web_search. Call web_search now for this public-fact request (use the stated area/request; do not wait for preference questions). Do not invent places. Do not write a customer answer.",
        },
      ];
      continue;
    }

    // Place request: optionally refine toward 3 as a quality preference (not a Gate).
    const grounded = countGroundedPlaceCandidates(merged);
    if (
      placeRequest &&
      (merged.search_count ?? 0) > 0 &&
      grounded > 0 &&
      grounded < 3 &&
      (merged.search_count ?? 0) < ANTHROPIC_WEB_SEARCH_TOOL.max_uses &&
      !refineNudgeUsed &&
      turn < 2
    ) {
      refineNudgeUsed = true;
      messages = [
        ...messages,
        { role: "assistant", content: once.data?.content ?? [] },
        {
          role: "user",
          content:
            "Prefer up to 3 distinct grounded place candidates when available. Narrow or complement the web_search query (area + cuisine) if useful. Fewer than 3 is acceptable. Do not invent places. Do not write a customer answer.",
        },
      ];
      continue;
    }

    // end_turn (or other completion): finalize status
    if (merged.errors.length && !merged.results.length) {
      merged.status = "error";
      merged.status_detail = merged.errors[0]?.error_code ?? "unavailable";
    } else if (!merged.results.length) {
      merged.status = "empty";
      merged.status_detail = "research_empty";
    } else {
      merged.status = "success";
      merged.status_detail = null;
    }
    merged = applyPlaceResearchContract(merged, question, history);
    merged = enrichResearchEvidenceForGrounding(merged);
    merged.provider_requests = providerRequests;
    merged.customer_facing_summary = buildCustomerFacingResearchSummary(merged);
    return {
      ok: true,
      public_research_evidence: merged,
      provider_requests: providerRequests,
      lastData,
    };
  }

  merged = applyPlaceResearchContract(
    {
      ...merged,
      provider_requests: providerRequests,
      status: merged.status ?? "incomplete",
      status_detail: merged.status_detail ?? "research_loop_exhausted",
    },
    question,
    history,
  );
  merged = enrichResearchEvidenceForGrounding(merged);
  return {
    ok: true,
    public_research_evidence: merged,
    provider_requests: providerRequests,
    lastData,
  };
}

/**
 * Claude-Full talent-open call: offer policy-allowed web_search + emit_claude_full.
 * Claude chooses whether to search. No forced research-by-question-type.
 * Focused correction: emit only.
 */
async function callClaudeFullEmitPass({
  model,
  apiKey,
  userPayload,
  fetchImpl,
  signal,
  temperature,
  repairRaw = null,
  repairReason = "json",
  offerWebSearch = true,
  startedAt = null,
  focusedCorrection = null,
  directPdfAttachment = null,
}) {
  const documentDirect = Boolean(directPdfAttachment?.pdfBase64);
  const repairMessage =
    repairReason === "focused_correction"
      ? "FOCUSED CORRECTION: Call emit_claude_full again. Fix ONLY the listed CLOSED_HARD violations in customer_answer. Do not invent facts. Do not emit internal reasoning."
      : "Your previous output was not valid structured JSON. Call emit_claude_full again with at least customer_answer. JSON only via tool call.";
  const temp = Math.min(0.45, Math.max(0.15, Number(temperature) || DEFAULT_TEMPERATURE));
  const system = buildSystemPrompt({
    mode: focusedCorrection
      ? "focused_correction"
      : offerWebSearch
        ? "emit_with_tools"
        : "emit",
    answerMode: "claude_full",
    documentDirect,
  });
  const tools = focusedCorrection || !offerWebSearch
    ? [CLAUDE_FULL_EMIT_TOOL]
    : [ANTHROPIC_WEB_SEARCH_TOOL, CLAUDE_FULL_EMIT_TOOL];
  const userContent = buildClaudeFullUserContentWithPdf({
    userPayload,
    pdfBase64: documentDirect ? directPdfAttachment.pdfBase64 : null,
    mediaType: directPdfAttachment?.mediaType,
  });
  let messages = repairRaw
    ? [
        { role: "user", content: userContent },
        { role: "assistant", content: [{ type: "text", text: repairRaw }] },
        { role: "user", content: repairMessage },
      ]
    : [{ role: "user", content: userContent }];

  const requestTrace = [];
  let lastProviderTiming = null;
  let researchEvidence = emptyResearchEvidence({ status: "skipped" });
  let lastData = null;
  let lastRaw = null;
  let reasoningStripped = false;

  // Before any Anthropic call: measure full request (PDF base64 + payload + tools/schema).
  if (documentDirect) {
    const firstToolChoice = focusedCorrection || repairRaw
      ? { type: "tool", name: "emit_claude_full" }
      : { type: "auto" };
    const estimated_request_bytes = estimateAnthropicMessagesRequestBytes({
      model,
      maxTokens: 4096,
      temperature: temp,
      system,
      tools,
      toolChoice: firstToolChoice,
      messages,
    });
    if (isClaudeFullRequestTooLarge(estimated_request_bytes)) {
      return {
        ok: false,
        error: "REQUEST_PAYLOAD_TOO_LARGE",
        estimated_request_bytes,
        public_research_evidence: researchEvidence,
        provider_request_trace: [
          {
            phase: "claude_full_emit_blocked",
            blocked: true,
            reason: "request_payload_too_large",
            estimated_request_bytes,
            // Never log body / base64 — size only
          },
        ],
        provider_timing: {
          provider_request_start_ms: null,
          provider_request_complete_ms: null,
          provider_duration_ms: null,
          ttft_ms: null,
          input_bytes: estimated_request_bytes,
          input_tokens: null,
          output_tokens: null,
        },
        provider_call_count: 0,
      };
    }
  }

  for (let turn = 0; turn < 4; turn += 1) {
    const toolChoice = focusedCorrection
      ? { type: "tool", name: "emit_claude_full" }
      : turn === 0 && repairRaw
        ? { type: "tool", name: "emit_claude_full" }
        : { type: "auto" };
    const once = await postAnthropicMessages({
      fetchImpl,
      signal,
      apiKey,
      model,
      maxTokens: 4096,
      temperature: temp,
      system,
      tools,
      toolChoice,
      messages,
      startedAt,
    });
    requestTrace.push({
      phase: focusedCorrection
        ? "focused_correction"
        : turn === 0
          ? "claude_full_emit"
          : `claude_full_turn_${turn + 1}`,
      tools: tools.map((t) => t.name),
      ...(once.provider_timing ?? {}),
    });
    if (once.provider_timing) lastProviderTiming = once.provider_timing;
    if (once.reasoning_stripped === true) reasoningStripped = true;
    if (!once.ok) {
      return {
        ...once,
        public_research_evidence: researchEvidence,
        provider_request_trace: requestTrace,
        provider_timing: lastProviderTiming,
      };
    }
    lastData = once.data;
    lastRaw = once.raw;

    const parsed = extractClaudeFullParsedFromResponse(once.data);
    if (parsed) {
      let piece = extractPublicResearchEvidence(once.data, {
        retrievedAt: new Date().toISOString(),
      });
      if (piece?.used || (piece?.results?.length ?? 0) > 0 || piece?.status === "search_not_used") {
        piece = applyPlaceResearchContract(
          piece,
          userPayload?.customer_question ?? userPayload?.question ?? "",
          userPayload?.recent_conversation_originals ??
            userPayload?.conversation_history ??
            [],
        );
        piece = enrichResearchEvidenceForGrounding(piece);
        researchEvidence = {
          ...piece,
          status: piece.status ?? "success",
        };
        researchEvidence.customer_facing_summary =
          buildCustomerFacingResearchSummary(researchEvidence);
      }
      return {
        ok: true,
        parsed,
        data: once.data,
        raw: once.raw,
        public_research_evidence: researchEvidence,
        provider_request_trace: requestTrace,
        provider_timing: lastProviderTiming,
        reasoning_stripped: reasoningStripped,
      };
    }

    const piece = extractPublicResearchEvidence(once.data, {
      retrievedAt: new Date().toISOString(),
    });
    if (piece?.used || (piece?.results?.length ?? 0) > 0 || (piece?.search_count ?? 0) > 0 || piece?.status === "search_not_used" || piece?.status === "empty") {
      let mergedPiece = {
        ...researchEvidence,
        ...piece,
        searches: [...(researchEvidence.searches ?? []), ...(piece.searches ?? [])],
        results: [...(researchEvidence.results ?? []), ...(piece.results ?? [])],
        citations: [...(researchEvidence.citations ?? []), ...(piece.citations ?? [])],
        used: Boolean(researchEvidence.used || piece.used),
        search_count: Math.max(researchEvidence.search_count ?? 0, piece.search_count ?? 0),
        status: piece.status ?? researchEvidence.status ?? "success",
        status_detail: piece.status_detail ?? researchEvidence.status_detail ?? null,
      };
      mergedPiece = applyPlaceResearchContract(
        mergedPiece,
        userPayload?.customer_question ?? userPayload?.question ?? "",
        userPayload?.recent_conversation_originals ??
          userPayload?.conversation_history ??
          [],
      );
      mergedPiece = enrichResearchEvidenceForGrounding(mergedPiece);
      researchEvidence = mergedPiece;
      researchEvidence.customer_facing_summary =
        buildCustomerFacingResearchSummary(researchEvidence);
      messages = [
        ...messages,
        { role: "assistant", content: once.data?.content ?? [] },
        {
          role: "user",
          content: JSON.stringify(
            {
              note: "Search results are available. Call emit_claude_full now with customer_answer grounded in verified chart + these public results. Do not invent facts.",
              public_research_evidence: {
                status: researchEvidence.status,
                status_detail: researchEvidence.status_detail,
                results: (researchEvidence.results ?? []).slice(0, 8).map((r) => ({
                  title: r.title,
                  url: r.url,
                  claim_or_summary: r.claim_or_summary ?? null,
                  cited_text: r.cited_text ?? null,
                })),
              },
            },
            null,
            2,
          ),
        },
      ];
      continue;
    }

    const stop = String(once.data?.stop_reason ?? "");
    if (stop === "pause_turn") {
      messages = [...messages, { role: "assistant", content: once.data?.content ?? [] }];
      continue;
    }

    // No emit and no useful search — nudge once toward emit.
    if (turn < 3) {
      messages = [
        ...messages,
        { role: "assistant", content: once.data?.content ?? [] },
        {
          role: "user",
          content:
            "Call emit_claude_full now with at least customer_answer. Optional fields only if useful.",
        },
      ];
      continue;
    }
    break;
  }

  return {
    ok: false,
    error: "CLAUDE_JSON_PARSE_FAIL",
    data: lastData,
    raw: lastRaw,
    public_research_evidence: researchEvidence,
    provider_request_trace: requestTrace,
    provider_timing: lastProviderTiming,
    reasoning_stripped: reasoningStripped,
  };
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
  publicResearchEnabled = false,
  // When set, skip Phase 1 (used only for emit repair after research already done)
  precomputedResearchEvidence = null,
  answerMode = "shadow_sketch",
  startedAt = null,
  focusedCorrection = null,
  directPdfAttachment = null,
}) {
  if (answerMode === "claude_full") {
    return callClaudeFullEmitPass({
      model,
      apiKey,
      userPayload,
      fetchImpl,
      signal,
      temperature,
      repairRaw,
      repairReason,
      // With original PDF attached, prefer emit over forced research phase.
      offerWebSearch: !focusedCorrection && !directPdfAttachment?.pdfBase64,
      startedAt,
      focusedCorrection,
      directPdfAttachment,
    });
  }
  const repairMessage =
    repairReason === "leadership"
      ? "Your previous output omitted next_decision_point (need 2-3 choices). Call emit_borrowed_senses again with all required fields including next_decision_point."
      : repairReason === "focused_correction"
        ? "FOCUSED CORRECTION: Call emit_borrowed_senses again. Fix ONLY the listed CLOSED_HARD violations in voice_raw_candidate. Do not invent facts. Do not emit internal reasoning."
        : "Your previous output was not valid structured JSON. Call emit_borrowed_senses again with all required fields. JSON only via tool call.";
  const temp = Math.min(0.45, Math.max(0.15, Number(temperature) || DEFAULT_TEMPERATURE));
  const emitMode = focusedCorrection
    ? "focused_correction"
    : publicResearchEnabled
      ? "emit_with_research"
      : "emit";
  const system = buildSystemPrompt({ mode: emitMode, answerMode });

  // --- No research: single emit-only request ---
  if (!publicResearchEnabled) {
    const messages = repairRaw
      ? [
          { role: "user", content: JSON.stringify(userPayload, null, 2) },
          { role: "assistant", content: [{ type: "text", text: repairRaw }] },
          { role: "user", content: repairMessage },
        ]
      : [{ role: "user", content: JSON.stringify(userPayload, null, 2) }];
    const once = await postAnthropicMessages({
      fetchImpl,
      signal,
      apiKey,
      model,
      maxTokens: 2048,
      temperature: temp,
      system,
      tools: [BORROWED_SENSES_TOOL],
      toolChoice: { type: "tool", name: "emit_borrowed_senses" },
      messages,
      startedAt,
    });
    if (!once.ok) {
      return {
        ...once,
        public_research_evidence: emptyResearchEvidence(),
        provider_request_trace: [
          {
            phase: "emit",
            tools: ["emit_borrowed_senses"],
            ...(once.provider_timing ?? {}),
          },
        ],
      };
    }
    const parsed = extractParsedFromResponse(once.data);
    if (!parsed) {
      return {
        ok: false,
        error: "CLAUDE_JSON_PARSE_FAIL",
        data: once.data,
        raw: once.raw,
        public_research_evidence: emptyResearchEvidence(),
        provider_request_trace: [
          {
            phase: "emit",
            tools: ["emit_borrowed_senses"],
            ...(once.provider_timing ?? {}),
          },
        ],
        provider_timing: once.provider_timing ?? null,
      };
    }
    return {
      ok: true,
      parsed,
      data: once.data,
      raw: once.raw,
      public_research_evidence: emptyResearchEvidence({ status: "skipped" }),
      provider_request_trace: [
        {
          phase: focusedCorrection ? "focused_correction" : "emit",
          tools: ["emit_borrowed_senses"],
          ...(once.provider_timing ?? {}),
        },
      ],
      provider_timing: once.provider_timing ?? null,
      reasoning_stripped: once.reasoning_stripped === true,
    };
  }

  // --- PHASE 1: web_search only ---
  let researchEvidence = precomputedResearchEvidence;
  let researchProviderRequests = 0;
  const requestTrace = [];
  if (!researchEvidence) {
    const research = await runPublicResearchPhase({
      model,
      apiKey,
      question: userPayload?.customer_question ?? userPayload?.question ?? "",
      history: userPayload?.conversation_history ?? [],
      fetchImpl,
      signal,
      temperature: temp,
      startedAt,
    });
    researchProviderRequests = research.provider_requests ?? 0;
    for (let i = 0; i < researchProviderRequests; i += 1) {
      requestTrace.push({ phase: "research", tools: ["web_search"] });
    }
    if (!research.ok) {
      // Incomplete research: do not emit / do not invent places
      return {
        ok: false,
        error: research.error,
        data: null,
        raw: null,
        public_research_evidence: research.public_research_evidence,
        provider_request_trace: requestTrace,
        research_failed: true,
      };
    }
    researchEvidence = research.public_research_evidence;
    // empty/error/search_not_used/insufficient: proceed to Phase 2 with unavailable chart (no invented places)
    if (
      researchEvidence.status === "empty" ||
      researchEvidence.status === "error" ||
      researchEvidence.status === "search_not_used" ||
      researchEvidence.status === "insufficient" ||
      researchEvidence.research_unavailable === true
    ) {
      researchEvidence = {
        ...researchEvidence,
        research_unavailable: true,
      };
      researchEvidence.customer_facing_summary = buildCustomerFacingResearchSummary(researchEvidence);
    }
  }

  // --- PHASE 2: emit only (never mixed with web_search) ---
  const researchOk = researchEvidence.status === "success" && researchEvidence.research_unavailable !== true;
  const placeRequest = isActivePlaceCustomerThread({
    question: userPayload?.customer_question ?? userPayload?.question ?? "",
    history: userPayload?.conversation_history ?? [],
  });
  const emitPayload = {
    ...userPayload,
    public_research_evidence: {
      status: researchEvidence.status,
      status_detail: researchEvidence.status_detail,
      research_unavailable: researchEvidence.research_unavailable === true,
      results: (researchEvidence.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        page_age: r.page_age,
        query: r.query,
        claim_or_summary: r.claim_or_summary ?? null,
        cited_text: r.cited_text ?? null,
      })),
      citations: (researchEvidence.citations ?? []).map((c) => ({
        title: c.title,
        url: c.url,
        cited_text: c.cited_text,
        domain: c.domain,
      })),
      citation_text_blob: researchEvidence.citation_text_blob ?? null,
    },
    key_public_research_evidence: {
      status: researchEvidence.status,
      status_detail: researchEvidence.status_detail,
      research_unavailable: researchEvidence.research_unavailable === true,
      results: (researchEvidence.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        page_age: r.page_age,
        query: r.query,
        claim_or_summary: r.claim_or_summary ?? null,
        cited_text: r.cited_text ?? null,
        // Do not send encrypted blobs to the model prompt if avoidable — titles/urls/cited text enough for grounding
      })),
      citations: (researchEvidence.citations ?? []).map((c) => ({
        title: c.title,
        url: c.url,
        cited_text: c.cited_text,
        domain: c.domain,
      })),
      citation_text_blob: researchEvidence.citation_text_blob ?? null,
      chart: {
        current_goal: researchOk
          ? placeRequest
            ? "확인된 grounded 후보를 먼저 제시(가능하면 상위 3곳 선호; 1~2곳이면 그 수만큼 솔직 추천). 후보 제시 후에만 조건 질문"
            : "공개 검색 evidence에 있는 장소·사실만으로 답하기"
          : researchEvidence.status_detail === "research_search_not_used"
            ? "research_search_not_used — 구체 장소명 창작 금지, 확인 못 함 + 조건 1개"
            : researchEvidence.status_detail === "research_insufficient"
              ? "research_insufficient — 장소명 창작 금지, 확인 못 함 + 조건 1개로 다음 검색 연결"
              : "research_unavailable — 장소명 창작 금지, 확인 못 한 점 솔직히 + 조건 1개",
        allowed: researchOk
          ? placeRequest
            ? [
                "evidence grounded 후보 1곳 이상 제시(3곳 선호 목표)",
                "1곳이면 1곳, 2곳이면 2곳, 3곳 이상이면 상위 3곳 중심",
                "후보 제시 후 확인 질문 1개(선택)",
              ]
            : ["evidence 장소 후보", "식별 가능한 지역·음식 종류", "확인 질문 1개"]
          : ["확인된 후보만(있을 때)", "확인 못 함 솔직 안내", "조건 1개 질문"],
        forbidden: [
          "evidence 없는 식당명",
          ...(placeRequest && researchOk
            ? ["확인된 후보가 있는데 분위기·음식 종류 확인 질문만으로 종료"]
            : []),
          "출처 없는 평점·영업시간·주차·가격·주소·역출구·건물·층수",
          "보험 언급·보험 초대",
          "지도/네이버/카카오에서 직접 찾아보세요 책임 전가",
        ],
      },
    },
  };

  const emitMessages = repairRaw
    ? [
        { role: "user", content: JSON.stringify(emitPayload, null, 2) },
        { role: "assistant", content: [{ type: "text", text: repairRaw }] },
        { role: "user", content: repairMessage },
      ]
    : [{ role: "user", content: JSON.stringify(emitPayload, null, 2) }];

  requestTrace.push({
    phase: focusedCorrection ? "focused_correction" : "emit",
    tools: ["emit_borrowed_senses"],
  });
  const once = await postAnthropicMessages({
    fetchImpl,
    signal,
    apiKey,
    model,
    maxTokens: 2048,
    temperature: temp,
    system,
    tools: [BORROWED_SENSES_TOOL],
    toolChoice: { type: "tool", name: "emit_borrowed_senses" },
    messages: emitMessages,
    startedAt,
  });
  if (once.provider_timing && requestTrace.length > 0) {
    Object.assign(requestTrace[requestTrace.length - 1], once.provider_timing);
  }
  if (!once.ok) {
    return {
      ...once,
      public_research_evidence: researchEvidence,
      provider_request_trace: requestTrace,
      provider_timing: once.provider_timing ?? null,
    };
  }
  const parsed = extractParsedFromResponse(once.data);
  if (!parsed) {
    return {
      ok: false,
      error: "CLAUDE_JSON_PARSE_FAIL",
      data: once.data,
      raw: once.raw,
      public_research_evidence: researchEvidence,
      provider_request_trace: requestTrace,
      provider_timing: once.provider_timing ?? null,
    };
  }
  return {
    ok: true,
    parsed,
    data: once.data,
    raw: once.raw,
    public_research_evidence: researchEvidence,
    provider_request_trace: requestTrace,
    provider_timing: once.provider_timing ?? null,
    reasoning_stripped: once.reasoning_stripped === true,
  };
}

/**
 * Borrowed / Claude-Full probe.
 * shadow_sketch: observation candidate (S6 may still speak for customer).
 * claude_full: customer-answer candidate for KEY safety-pin verify + finalize/seal.
 */
export async function runBorrowedSensesShadowProbe({
  question = "",
  directive = null,
  decision = null,
  history = [],
  previousAnswerSummary = "",
  s6FinalAnswer = "",
  visualBlocks = [],
  factBoundary = null,
  reflection = null,
  reality = null,
  publicResearchEvidence = null,
  relatedPastJudgments = null,
  relatedPastOriginals = null,
  documentEvidence = null,
  directPdfAttachment = null,
  documentDirectMeta = null,
  answerMode = "shadow_sketch",
  focusedCorrection = null,
  startedAt = null,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = Number(env.KEY_BORROWED_SENSES_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
} = {}) {
  const apiKey = resolveAnthropicApiKey(env);
  const base = {
    schema_version:
      answerMode === "claude_full" ? "claude_full_emit_v1" : S7_BORROWED_SENSES_SCHEMA_B,
    shadow_only: answerMode !== "claude_full",
    customer_text_changed: false,
    final_answer_source: answerMode === "claude_full" ? "claude_candidate" : "s6",
    s6_final_answer: String(s6FinalAnswer ?? "").trim(),
    provider: null,
    error: null,
    borrowed: null,
    gate: null,
    raw: null,
    attempts: 0,
    call_phase: decision || directive ? "post_decision" : "pre_decision",
    answer_mode: answerMode,
    focused_correction_used: Boolean(focusedCorrection),
  };

  if (!apiKey) {
    return {
      ...base,
      error: "ANTHROPIC_NOT_CONFIGURED",
    };
  }

  const model = String(env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL ?? DEFAULT_MODEL).trim();
  // Claude-Full: offer search; Claude chooses. Shadow: KEY may still pre-enable by question type.
  const publicResearchEnabled =
    answerMode === "claude_full"
      ? !focusedCorrection
      : !focusedCorrection && shouldEnablePublicWebSearch({ question, decision, history });
  const { pack: contextPack, context_pack_ms } = buildClaudeFullContextPack({
    history,
    previousAnswerSummary,
    question,
    documentEvidence,
    relatedPastOriginals:
      relatedPastOriginals ??
      (answerMode === "claude_full" ? relatedPastJudgments : null),
  });
  const userPayload = buildUserPayload({
    question,
    directive,
    decision,
    history,
    previousAnswerSummary,
    s6FinalAnswer,
    visualBlocks,
    factBoundary,
    reflection,
    reality,
    publicResearchEvidence,
    relatedPastJudgments,
    relatedPastOriginals,
    documentEvidence,
    answerMode,
    focusedCorrection,
    contextPack,
  });
  if (documentDirectMeta && typeof documentDirectMeta === "object") {
    userPayload.direct_document = {
      attached: documentDirectMeta.direct_document_attached === true,
      document_id: documentDirectMeta.document_id ?? null,
      mime_type: documentDirectMeta.mime_type ?? null,
      file_size_bytes: documentDirectMeta.file_size_bytes ?? null,
      original_filename: documentDirectMeta.original_filename ?? null,
      note: documentDirectMeta.direct_document_attached
        ? "Original PDF is attached as an Anthropic document block. KEY did not pre-summarize it."
        : documentDirectMeta.document_fallback_reason
          ? `Original PDF not attached (${documentDirectMeta.document_fallback_reason}).`
          : "Original PDF not attached.",
    };
    if (!String(question ?? "").trim()) {
      userPayload.customer_question = "";
      userPayload.upload_without_question = true;
      userPayload.direct_document.note = `${userPayload.direct_document.note} Customer uploaded PDF without a question — open with the most helpful natural explanation.`;
    }
  }
  if (publicResearchEnabled && !directPdfAttachment?.pdfBase64) {
    userPayload.public_research = {
      enabled: true,
      provider_tool: ANTHROPIC_WEB_SEARCH_TOOL.name,
      tool_type: ANTHROPIC_WEB_SEARCH_TOOL.type,
      max_uses: ANTHROPIC_WEB_SEARCH_TOOL.max_uses,
      search_before_clarify:
        answerMode === "claude_full" ? false : needsFreshPublicFacts({ question, history }),
      claude_chooses_search: answerMode === "claude_full",
      note:
        answerMode === "claude_full"
          ? "web_search is available. Claude chooses whether to use it. KEY does not pre-lock search by question type alone."
          : "Search first when fresh public facts are needed; then emit_borrowed_senses. Do not ask preference-only questions before searching on explicit recommend/find requests.",
    };
  }

  let lastRaw = null;
  let lastError = "CLAUDE_JSON_PARSE_FAIL";
  let lastPublicResearch = emptyResearchEvidence();
  let cachedResearchEvidence = null;
  let lastRequestTrace = [];
  let lastProviderTiming = null;
  let parseRetryUsed = false;
  let leadershipRetryCount = 0;
  let timeoutRetryUsed = false;
  let activeTimeoutMs =
    Number(timeoutMs) ||
    (publicResearchEnabled ? PUBLIC_RESEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  let attempts = 0;
  const maxAttempts = focusedCorrection ? 1 : answerMode === "claude_full" ? 3 : 5;
  let reasoningStripped = false;
  let toolPermissionCheck = null;

  try {
    while (attempts < maxAttempts) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
      const attemptTemp =
        attempts === 1 ? temperature : Math.min(0.22, Number(temperature) || DEFAULT_TEMPERATURE);

      let repairRaw = null;
      let repairReason = "json";
      if (focusedCorrection) {
        repairRaw =
          String(
            focusedCorrection.previous_customer_answer ??
              focusedCorrection.previous_voice_raw_candidate ??
              "",
          ).trim() || null;
        repairReason = "focused_correction";
      } else if (parseRetryUsed && lastRaw) {
        repairRaw = lastRaw;
        repairReason = "json";
      } else if (answerMode !== "claude_full" && leadershipRetryCount > 0 && lastRaw) {
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
          publicResearchEnabled: answerMode === "claude_full" ? false : publicResearchEnabled,
          precomputedResearchEvidence: cachedResearchEvidence,
          answerMode,
          startedAt,
          focusedCorrection,
          directPdfAttachment,
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

      if (result.public_research_evidence) {
        lastPublicResearch = result.public_research_evidence;
        // Cache successful/empty/error research so emit retries do not re-search
        if (!result.research_failed) {
          cachedResearchEvidence = result.public_research_evidence;
        }
      }
      if (result.provider_request_trace) {
        lastRequestTrace = result.provider_request_trace;
      }
      if (result.provider_timing) {
        lastProviderTiming = result.provider_timing;
      }
      if (result.reasoning_stripped === true) reasoningStripped = true;

      // Full request (PDF + context) over safety cap — never call provider, never retry, never RAG.
      if (result.error === "REQUEST_PAYLOAD_TOO_LARGE") {
        const estimated =
          typeof result.estimated_request_bytes === "number"
            ? result.estimated_request_bytes
            : result.provider_timing?.input_bytes ?? null;
        return {
          ...base,
          error: "REQUEST_PAYLOAD_TOO_LARGE",
          provider: null,
          model,
          attempts: 0,
          public_research_enabled: false,
          public_research_evidence: lastPublicResearch,
          provider_request_trace: lastRequestTrace,
          estimated_request_bytes: estimated,
          document_direct: {
            ...(documentDirectMeta && typeof documentDirectMeta === "object"
              ? {
                  document_id: documentDirectMeta.document_id ?? null,
                  mime_type: documentDirectMeta.mime_type ?? null,
                  file_size_bytes: documentDirectMeta.file_size_bytes ?? null,
                }
              : {}),
            direct_document_attached: false,
            estimated_request_bytes: estimated,
            document_fallback_used: true,
            document_fallback_reason: "request_payload_too_large",
          },
          provider_call_count: 0,
          provider_speed: buildProviderSpeedSummary({
            context_pack_ms,
            attempts: 0,
            parseRetryUsed: false,
            leadershipRetryCount: 0,
            timeoutRetryUsed: false,
            lastRequestTrace,
            lastProviderTiming,
            focusedCorrection,
          }),
        };
      }

      // Typed research contract failures — do not outer-retry (would duplicate search)
      if (result.research_failed) {
        return {
          ...base,
          error: result.error,
          provider: "anthropic",
          model,
          attempts,
          public_research_enabled: publicResearchEnabled,
          public_research_evidence: lastPublicResearch,
          provider_request_trace: lastRequestTrace,
          research_failed: true,
          provider_speed: buildProviderSpeedSummary({
            context_pack_ms,
            attempts,
            parseRetryUsed,
            leadershipRetryCount,
            timeoutRetryUsed,
            lastRequestTrace,
            lastProviderTiming,
            focusedCorrection,
          }),
        };
      }

      if (!result.ok && (result.error?.startsWith("CLAUDE_API_") || result.error?.startsWith("provider_error") || result.error === "web_search_disabled_400" || result.error === "rate_limit" || result.error === "timeout")) {
        return {
          ...base,
          error: result.error,
          provider: "anthropic",
          attempts,
          public_research_enabled: publicResearchEnabled,
          public_research_evidence: result.public_research_evidence ?? lastPublicResearch,
          provider_request_trace: lastRequestTrace,
          provider_speed: buildProviderSpeedSummary({
            context_pack_ms,
            attempts,
            parseRetryUsed,
            leadershipRetryCount,
            timeoutRetryUsed,
            lastRequestTrace,
            lastProviderTiming,
            focusedCorrection,
          }),
        };
      }

      lastRaw = result.raw;
      if (result.ok && result.parsed) {
        const borrowed =
          answerMode === "claude_full"
            ? normalizeClaudeFullOutput(result.parsed)
            : normalizeBorrowedOutput(result.parsed, s6FinalAnswer, question);
        if (answerMode === "claude_full") {
          toolPermissionCheck = permissionCheckProposedToolActions({
            proposed: borrowed.proposed_tool_actions,
            env,
          });
          borrowed.tool_permission_check = toolPermissionCheck;
        }
        const gate = gateBorrowedSensesOutput({
          borrowed,
          directive,
          history,
          question,
          visualBlocks,
        });

        // Claude-Full: never retry for leadership / next_decision / tone / table absence.
        if (
          answerMode !== "claude_full" &&
          !focusedCorrection &&
          (gate.missing_next_decision || gate.missing_proposal_direction) &&
          leadershipRetryCount < 3
        ) {
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
          // Never persist raw provider blobs that may contain thinking — tool JSON only
          raw: null,
          borrowed,
          gate,
          error: null,
          attempts,
          public_research_enabled: publicResearchEnabled,
          public_research_evidence: lastPublicResearch,
          provider_request_trace: lastRequestTrace,
          reasoning_stripped: reasoningStripped,
          tool_permission_check: toolPermissionCheck,
          document_direct: documentDirectMeta ?? null,
          provider_speed: buildProviderSpeedSummary({
            context_pack_ms,
            attempts,
            parseRetryUsed,
            leadershipRetryCount,
            timeoutRetryUsed,
            lastRequestTrace,
            lastProviderTiming,
            focusedCorrection,
          }),
        };
      }

      lastError = result.error ?? "CLAUDE_JSON_PARSE_FAIL";

      if (!focusedCorrection && lastError === "CLAUDE_TIMEOUT" && !timeoutRetryUsed) {
        timeoutRetryUsed = true;
        activeTimeoutMs = Math.max(TIMEOUT_RETRY_MS, PUBLIC_RESEARCH_TIMEOUT_MS);
        continue;
      }

      if (!focusedCorrection && lastError === "CLAUDE_JSON_PARSE_FAIL" && !parseRetryUsed) {
        parseRetryUsed = true;
        continue;
      }

      break;
    }

    return {
      ...base,
      error: lastError,
      raw: null,
      provider: "anthropic",
      model,
      attempts,
      public_research_enabled: publicResearchEnabled,
      public_research_evidence: lastPublicResearch,
      provider_request_trace: lastRequestTrace,
      provider_speed: buildProviderSpeedSummary({
        context_pack_ms,
        attempts,
        parseRetryUsed,
        leadershipRetryCount,
        timeoutRetryUsed,
        lastRequestTrace,
        lastProviderTiming,
        focusedCorrection,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      error: /abort|timeout/i.test(msg) ? "CLAUDE_TIMEOUT" : "CLAUDE_FETCH_ERROR",
      provider: "anthropic",
      attempts,
      public_research_enabled: publicResearchEnabled,
      public_research_evidence: lastPublicResearch,
      provider_request_trace: lastRequestTrace,
      provider_speed: buildProviderSpeedSummary({
        context_pack_ms,
        attempts,
        parseRetryUsed,
        leadershipRetryCount,
        timeoutRetryUsed,
        lastRequestTrace,
        lastProviderTiming,
        focusedCorrection,
      }),
    };
  }
}

function buildProviderSpeedSummary({
  context_pack_ms = null,
  attempts = 0,
  parseRetryUsed = false,
  leadershipRetryCount = 0,
  timeoutRetryUsed = false,
  lastRequestTrace = [],
  lastProviderTiming = null,
  focusedCorrection = null,
} = {}) {
  const researchRounds = (Array.isArray(lastRequestTrace) ? lastRequestTrace : []).filter(
    (t) => t?.phase === "research",
  ).length;
  const retry_count =
    (parseRetryUsed ? 1 : 0) +
    Number(leadershipRetryCount || 0) +
    (timeoutRetryUsed ? 1 : 0);
  return {
    context_pack_ms: typeof context_pack_ms === "number" ? context_pack_ms : null,
    provider_request_start_ms: lastProviderTiming?.provider_request_start_ms ?? null,
    provider_request_complete_ms: lastProviderTiming?.provider_request_complete_ms ?? null,
    provider_duration_ms: lastProviderTiming?.provider_duration_ms ?? null,
    ttft_ms: lastProviderTiming?.ttft_ms ?? null,
    ttft_basis: lastProviderTiming?.ttft_basis ?? null,
    input_bytes: lastProviderTiming?.input_bytes ?? null,
    input_tokens: lastProviderTiming?.input_tokens ?? null,
    output_tokens: lastProviderTiming?.output_tokens ?? null,
    attempt_count: Number(attempts) || 0,
    retry_count,
    research_tool_round_count: researchRounds,
    focused_correction: Boolean(focusedCorrection),
  };
}

export {
  S7_BORROWED_SENSES_SCHEMA,
  S7_BORROWED_SENSES_SCHEMA_B,
  summarizeVisualBlocks,
  buildUserPayload,
  buildQuestionLeadershipHint,
  buildSessionGoalPayload,
  buildDecisionPayload,
  mapConversationHistory,
};
