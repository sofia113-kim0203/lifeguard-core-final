/**
 * KEY Voice — unit tests (directive, gate, safe utterance; no live Claude).
 */
import assert from "node:assert/strict";
import { buildKeyVoiceDirective, deriveKeyVoiceQuestionFocus } from "../server/keyCore/keyVoiceDirective.js";
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

console.log("KEY_VOICE_UNIT_TEST ok=true");
