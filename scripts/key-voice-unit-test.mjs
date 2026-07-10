/**
 * KEY Voice — unit tests (directive, gate, safe utterance; no live Claude).
 */
import assert from "node:assert/strict";
import {
  buildKeyVoiceDirective,
  buildDirectiveSituationFromDecision,
  deriveKeyVoiceQuestionFocus,
} from "../server/keyCore/keyVoiceDirective.js";
import { buildDecision } from "../server/keyCore/keyDecision.js";
import { buildReflection } from "../server/keyCore/keyReflection.js";
import { gateKeyVoiceAnswer } from "../server/keyCore/keyVoiceGate.js";
import { buildKeyVoiceSafeUtterance } from "../server/keyCore/keyVoiceSpeak.js";
import { isKeyVoiceActive } from "../server/keyCore/oneKeyCoreFlags.js";
import { buildKeyVoiceVisualBlocks } from "../server/keyCore/keyVoiceVisualBlocks.js";
import {
  gateKeyVoiceVisualBlocks,
  assertCoverageGapNeutral,
  assertTextBlockPremiumConsistency,
} from "../server/keyCore/keyVoiceBlockGate.js";

process.env.KEY_VOICE = "on";
assert.equal(isKeyVoiceActive(), true);

const mockDecision = {
  situation_key: "premium_burden",
  direct_answer_hint: "보험료 부담이시군요.",
  key_judgment: "여러 건이 등록돼 있어서, 한 건이 아니라 전체 납입을 먼저 보는 게 맞습니다.",
  direction: { type: "offer_direction", move: "22건 전체 월 보험료부터 확인하는 게 좋겠습니다" },
  invite: { allowed: true, prompt: "여기부터 같이 보실까요?" },
  decision_complete: true,
  fact_selection: {
    facts_spoken: [
      { fact_id: "policy_count", value: "22", source: "factory" },
      { fact_id: "insurer", value: "삼성생명", source: "factory" },
      { fact_id: "product", value: "실손의료비보험", source: "factory" },
      { fact_id: "monthly_premium", value: "45000", source: "factory" },
    ],
    facts_withheld: [{ fact: "structure_breakdown", reason: "unknown_declared" }],
  },
};

assert.equal(deriveKeyVoiceQuestionFocus("안녕하세요"), "greeting");
assert.equal(deriveKeyVoiceQuestionFocus("내 보험료 얼마야?"), "premium_amount");

const greetingDirective = buildKeyVoiceDirective({ question: "안녕하세요", decision: mockDecision });
assert.equal(greetingDirective.question_focus, "greeting");
assert.equal(greetingDirective.facts_to_speak.length, 0);

const premiumDirective = buildKeyVoiceDirective({ question: "내 보험료 얼마야?", decision: mockDecision });
assert.equal(premiumDirective.answer_mode, "analysis_consulting");
assert.equal(premiumDirective.schema_version, "key-voice-directive-v3");
assert.ok(premiumDirective.intimacy_policy?.speak_to_customer_not_report);
assert.ok(premiumDirective.number_forward_policy?.enabled);
assert.ok(premiumDirective.number_forward_policy?.separate_premium_from_policy_count);
assert.ok(premiumDirective.premium_scope_policy?.separation_required);
assert.equal(premiumDirective.optional_claims.length, 4);
assert.equal(premiumDirective.facts_to_speak.length, 4);

const overviewDirective = buildKeyVoiceDirective({ question: "내보험 분석해줘", decision: mockDecision });
assert.equal(overviewDirective.question_focus, "policy_overview");
assert.ok(overviewDirective.premium_scope_policy?.preferred_phrases?.length >= 3);
assert.ok(overviewDirective.answer_shape?.some((line) => /scope/.test(line)));

const premiumAnalysisDirective = buildKeyVoiceDirective({ question: "내보험료 분석해줘", decision: mockDecision });
assert.equal(premiumAnalysisDirective.question_focus, "policy_overview");

const cancerDirective = buildKeyVoiceDirective({ question: "암보험 괜찮아?", decision: mockDecision });
assert.equal(cancerDirective.answer_mode, "analysis_consulting");
assert.ok(cancerDirective.required_claims.length >= 4);
assert.ok(cancerDirective.allowed_numbers.includes("22"));

const cancerGood =
  "암 보장이 궁금하시군요. 지금 목록만으로는 충분·부족을 단정하기 어렵습니다. 제가 먼저 암 진단비·수술비·치료비 항목부터 확인하겠습니다. 그다음 보험료 대비 유지 우선순위와 추가로 짚을 보장을 나누겠습니다.";
const cancerGate = gateKeyVoiceAnswer({ text: cancerGood, directive: cancerDirective });
assert.equal(cancerGate.ok, true, cancerGate.reasons?.join("; "));

const cancerHonestAbsence =
  "암 보장이 궁금하시군요. 지금 등록 목록만으로는 충분·부족을 단정할 수 없고, 암 진단비·수술비·치료비는 아직 확인되지 않습니다. 보장 공백 여부도 지금은 단정할 수 없습니다. 제가 먼저 암 진단비·수술비·치료비 항목부터 확인하겠습니다.";
const cancerHonestGate = gateKeyVoiceAnswer({ text: cancerHonestAbsence, directive: cancerDirective });
assert.equal(cancerHonestGate.ok, true, cancerHonestGate.reasons?.join("; "));

const cancerBadCalc = "암 보장을 보면 나머지 21건도 확인이 필요합니다.";
const cancerBadGate = gateKeyVoiceAnswer({ text: cancerBadCalc, directive: cancerDirective });
assert.equal(cancerBadGate.ok, false);
assert.equal(cancerBadGate.forbidden_fact_violation, true);

const goodAnswer =
  "보험료가 궁금하시군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 계약별 납입액이 더 확인되어야 전체 흐름을 정확히 볼 수 있어요.";
const goodGate = gateKeyVoiceAnswer({ text: goodAnswer, directive: premiumDirective });
assert.equal(goodGate.ok, true, goodGate.reasons?.join("; "));

const blurAnswer =
  "보험료가 궁금하시군요. 22건, 월 4만5천 원 기준으로 전체 보험료 흐름을 보면 부담이 크지 않습니다.";
const blurGate = gateKeyVoiceAnswer({ text: blurAnswer, directive: premiumDirective });
assert.equal(blurGate.ok, false);
assert.ok(
  blurGate.reasons.some((r) => r.startsWith("voice_forbidden:")),
  blurGate.reasons?.join("; "),
);

const badAnswer = "보험료는 99만 원입니다. 현대해상 암보험 가입하세요.";
const badGate = gateKeyVoiceAnswer({ text: badAnswer, directive: premiumDirective });
assert.equal(badGate.ok, false);
assert.equal(badGate.forbidden_fact_violation, true);

const safe = buildKeyVoiceSafeUtterance(greetingDirective);
assert.ok(/안녕|반갑/.test(safe));
assert.ok(!/22건/.test(safe));

const safePremium = buildKeyVoiceSafeUtterance(premiumDirective);
assert.ok(/그중/.test(safePremium));
assert.ok(/정리 중/.test(safePremium));
assert.ok(!/22건, 월/.test(safePremium));
assert.ok(!/기준으로 전체 보험료/.test(safePremium));

const safeOverview = buildKeyVoiceSafeUtterance(overviewDirective);
assert.ok(/그중|등록된 계약/.test(safeOverview));
assert.ok(/정리 중|계약별/.test(safeOverview));

const premiumBlocks = buildKeyVoiceVisualBlocks({ directive: premiumDirective });
assert.ok(premiumBlocks.some((b) => b.type === "premium_summary_table"));
const premiumText =
  "등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 제가 순서대로 정리해드릴게요.";
const premiumBlockGate = gateKeyVoiceVisualBlocks({
  blocks: premiumBlocks,
  text: premiumText,
  directive: premiumDirective,
});
assert.ok(premiumBlockGate.accepted_count >= 1, JSON.stringify(premiumBlockGate.omitted));

const badPremiumBlock = {
  type: "premium_summary_table",
  title: "확인된 납입 요약",
  columns: ["구분", "확인값", "비고"],
  rows: [["확인 월 납입액", "44,500원", "삼성생명 실손의료비보험"]],
};
const badPremiumConsistency = assertTextBlockPremiumConsistency(
  premiumText,
  badPremiumBlock,
  premiumDirective,
);
assert.equal(badPremiumConsistency.ok, false);

const cancerBlocks = buildKeyVoiceVisualBlocks({ directive: cancerDirective });
assert.ok(cancerBlocks.some((b) => b.type === "coverage_gap_table"));
const gapNeutral = assertCoverageGapNeutral(cancerBlocks.find((b) => b.type === "coverage_gap_table"));
assert.equal(gapNeutral.ok, true);

const badGapBlock = {
  type: "coverage_gap_table",
  title: "암 보장 점검표",
  columns: ["보장 항목", "확인 상태", "다음 확인"],
  rows: [["암 진단비", "부족", "위험"]],
};
const badGapNeutral = assertCoverageGapNeutral(badGapBlock);
assert.equal(badGapNeutral.ok, false);

// --- S7-A Decision interprets Reflection (raw soft must NOT reach Speak) ---
const softReality = {
  policies_present: true,
  policy_count: 22,
  domain: "insurance",
  policies: [
    {
      insurer_name: "삼성생명",
      product_name: "실손의료비보험",
      monthly_premium: 45000,
    },
  ],
};

// A. premium worry reflection → Decision premium_burden / adequacy; Directive from Decision fields
{
  const qA = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionA = buildReflection({ customerSaid: qA, reality: softReality });
  assert.ok(
    reflectionA.situation_reading.some((r) => /보험료가 이대로 괜찮은지/.test(r)),
    JSON.stringify(reflectionA.situation_reading),
  );
  assert.equal(reflectionA.reading_confidence, "hypothesis");

  const decisionA = buildDecision({
    reflection: reflectionA,
    reality: softReality,
    question: qA,
  });
  assert.ok(
    decisionA.situation_key === "premium_burden" ||
      decisionA.response_priority === "premium_adequacy_check",
    JSON.stringify({
      situation_key: decisionA.situation_key,
      response_priority: decisionA.response_priority,
    }),
  );
  assert.match(String(decisionA.key_situation_judgment ?? ""), /적정|효율|보험료/);
  assert.ok(String(decisionA.key_next_move ?? "").trim().length > 0);

  const dirA = buildKeyVoiceDirective({ question: qA, decision: decisionA });
  assert.ok(String(dirA.key_situation_judgment ?? "").trim().length > 0);
  assert.ok(String(dirA.key_next_move ?? "").trim().length > 0);
  assert.equal(dirA.soft_customer_reading, null);
  assert.deepEqual(dirA.facts_to_speak, decisionA.fact_selection.facts_spoken);

  const sitA = buildDirectiveSituationFromDecision(decisionA);
  assert.equal(sitA.key_situation_judgment, decisionA.key_situation_judgment);
  assert.equal(sitA.key_next_move, decisionA.key_next_move);
}

// B. "내 보험료 얼마야?" → fact_lookup; no emotional soft guidance
{
  const qB = "내 보험료 얼마야?";
  const reflectionB = buildReflection({ customerSaid: qB, reality: softReality });
  const decisionB = buildDecision({
    reflection: reflectionB,
    reality: softReality,
    question: qB,
  });
  assert.ok(
    decisionB.response_priority === "fact_lookup" ||
      decisionB.situation_key === "enrolled_policy_list",
    JSON.stringify({
      situation_key: decisionB.situation_key,
      response_priority: decisionB.response_priority,
    }),
  );
  assert.match(String(decisionB.key_situation_judgment ?? ""), /사실|조회|보험료/);
  const dirB = buildKeyVoiceDirective({ question: qB, decision: decisionB });
  assert.equal(dirB.response_priority, decisionB.response_priority);
  assert.equal(dirB.soft_customer_reading, null);
  assert.equal(dirB.soft_response_guidance, null);
  assert.ok(!/emotional|soft possibility|MAY gently/i.test(JSON.stringify(dirB)));
}

// C. low confidence / empty readings: still has key_next_move from question classify
{
  const qC = "내 보험료 얼마야?";
  const decisionC = buildDecision({
    reflection: { situation_reading: [], reading_confidence: "low" },
    reality: softReality,
    question: qC,
  });
  assert.ok(
    String(decisionC.key_next_move ?? decisionC.direction?.move ?? "").trim().length > 0,
    JSON.stringify(decisionC),
  );
  assert.ok(decisionC.decision_complete === true);
}

// D. Reflection vs facts: premium worry reflection but facts_spoken still from reality
{
  const qD = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionD = buildReflection({ customerSaid: qD, reality: softReality });
  const decisionD = buildDecision({
    reflection: reflectionD,
    reality: softReality,
    question: qD,
  });
  assert.ok(
    decisionD.fact_selection.facts_spoken.some((f) => f.fact_id === "policy_count"),
  );
  assert.ok(
    decisionD.fact_selection.facts_spoken.some((f) => f.fact_id === "monthly_premium"),
  );
  assert.equal(
    decisionD.fact_selection.facts_spoken.find((f) => f.fact_id === "insurer")?.value,
    "삼성생명",
  );
  assert.ok(!/불안|힘드/.test(String(decisionD.key_judgment ?? "")));
}

// E. facts_to_speak unchanged when only hypothesis fields differ
{
  const qE = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionE = buildReflection({ customerSaid: qE, reality: softReality });
  const decisionWithHyp = buildDecision({
    reflection: reflectionE,
    reality: softReality,
    question: qE,
  });
  const baseFacts = {
    ...mockDecision,
    customer_situation_hypothesis: ["보험료가 이대로 괜찮은지 마음에 걸릴 수 있음"],
    key_situation_judgment: "고객이 보험료 적정성·효율을 먼저 확인하고 싶어 하는 상황으로 본다.",
    response_priority: "premium_adequacy_check",
    key_next_move: mockDecision.direction.move,
    confirm_question: mockDecision.invite.prompt,
  };
  const dirWith = buildKeyVoiceDirective({ question: qE, decision: baseFacts });
  const dirWithout = buildKeyVoiceDirective({
    question: qE,
    decision: {
      ...mockDecision,
      customer_situation_hypothesis: null,
      key_situation_judgment: null,
      response_priority: null,
      key_next_move: null,
      confirm_question: null,
    },
  });
  assert.deepEqual(dirWith.facts_to_speak, dirWithout.facts_to_speak);
  assert.deepEqual(dirWith.key_judgment, dirWithout.key_judgment);
  assert.deepEqual(
    decisionWithHyp.fact_selection.facts_spoken.map((f) => f.fact_id),
    ["policy_count", "insurer", "product", "monthly_premium"],
  );
}

console.log("KEY_VOICE_UNIT_TEST ok=true");
