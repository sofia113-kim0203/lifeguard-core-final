/**
 * Gate cleanup 2 — real sentence + verified facts + Gate verdict + output.
 * LIVE for ordinary counseling. BLOCK only for proven-wrong / leak / identity.
 */
import assert from "node:assert/strict";
import {
  buildClaudeFirstSpeakAllowlistForEmitBlock,
  decideS10fPreEmitEmitDecision,
  hardOnlySafetyCheck,
  hasFactAmountEmitBlockHard,
  hasWholeAnswerMonopolyHard,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  decideQ2PreEmitVeto,
  decideQ2PreSealVeto,
} from "../server/keyCore/keyClaudeFirstOutputGuardVeto.js";
import { detectFactIdentityMismatch } from "../server/keyCore/keyCustomerIdentitySeparation.js";
import { recommendationOrTerminationRisk } from "../server/keyCore/keyVoiceGate.js";
import { polishLifeguardCustomerText } from "../server/lifeguardOutputGuard.js";

const DOC = "f8532a47-0592-4dc1-a291-9c2e2d06606c";
const COVERAGES = [
  { coverage_name: "질병1~5종수술비IV (수술1회당)(1종)", coverage_amount: "50만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(2종)", coverage_amount: "50만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(3종)", coverage_amount: "500만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(4종)", coverage_amount: "500만원" },
  { coverage_name: "암진단비", coverage_amount: "3000만원" },
];
const FACTS = [
  {
    fact_type: "product_name",
    literal_value: "한화 3.10.5 간편건강보험(세만기형) 무배당2411",
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  },
  {
    fact_type: "insurance_period",
    literal_value: "2024.12.03 ~ 2069.12.03 100세만기",
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  },
  {
    fact_type: "payment_period",
    literal_value: "20년납",
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  },
  {
    fact_type: "monthly_premium",
    literal_value: "32000",
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  },
  ...COVERAGES.map((c) => ({
    fact_type: "coverage_name",
    literal_value: c.coverage_name,
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  })),
  ...COVERAGES.map((c) => ({
    fact_type: "coverage_amount",
    literal_value: c.coverage_amount,
    source_document_id: DOC,
    confirmation_source: "key_claude_original_document",
  })),
];

function allow() {
  return buildClaudeFirstSpeakAllowlistForEmitBlock({
    reality: { policy_count: 1, policies: [{ insurer_name: "한화손해보험" }] },
    coverages: COVERAGES,
    confirmedFacts: FACTS,
  });
}

function judge(text, extra = {}) {
  const emit = decideS10fPreEmitEmitDecision({
    slice: text,
    absenceEvidence: [],
    verifiedCoverages: COVERAGES,
    speakAllowlist: allow(),
  });
  const hard = hardOnlySafetyCheck(text, {
    allowed_numbers: allow().allowed_numbers,
    allowed_entities: allow().allowed_entities,
    allowed_number_provenances: allow().allowed_number_provenances,
    coverages: COVERAGES,
    confirmedFacts: FACTS,
    ...extra,
  });
  const q2 = decideQ2PreEmitVeto({ slice: text });
  const monopoly = hasWholeAnswerMonopolyHard(hard.hard) || q2.monopoly === true;
  const sentenceDrop = emit.emit_decision === false || (q2.veto === true && q2.monopoly !== true);
  return {
    emit_decision: emit.emit_decision,
    gate_class: emit.gate_class,
    hard: hard.hard,
    monopoly,
    sentence_drop: sentenceDrop,
    q2_veto: q2.veto === true,
    customer_blocked: monopoly || emit.emit_decision === false,
    output: polishLifeguardCustomerText(text),
  };
}

const rows = [];
function check(id, expect, got, note = "") {
  const pass =
    expect === "LIVE"
      ? got.customer_blocked === false && got.monopoly === false
      : expect === "BLOCK"
        ? got.customer_blocked === true
        : expect === "MONOPOLY"
          ? got.monopoly === true
          : false;
  rows.push({
    id,
    expect,
    got: got.monopoly ? "MONOPOLY" : got.customer_blocked ? "BLOCK" : "LIVE",
    pass,
    monopoly: got.monopoly,
    hard: got.hard,
    gate_class: got.gate_class,
    note,
  });
  if (!pass) {
    console.error(`FAIL ${id} expect=${expect} got=${got.monopoly ? "MONOPOLY" : got.customer_blocked ? "BLOCK" : "LIVE"}`);
    console.error(got);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${id}`);
  }
}

check("L1 월 보험료", "LIVE", judge("월 보험료는 32,000원입니다."));
check("L2 현재 보험료", "LIVE", judge("현재 보험료부터 보면 부담이 있어요."));
check("L3 100세만기+20년납", "LIVE", judge("- **보험기간:** 2024.12.03 ~ 2069.12.03 (100세만기, 20년납)"));
check("L4 수술 1회당 + 2종", "LIVE", judge("| 질병1~5종수술비IV — 2종 (수술 1회당) | 50만원 |"));
check("L5 3·4종", "LIVE", judge("3·4종 수술은 각 500만 원으로 비중이 높아요."));
check(
  "L6 근거 있는 보완 조언",
  "LIVE",
  judge("수술비 중심으로 보이니, 암 진단 쪽은 보완하는 게 좋겠습니다."),
);
check(
  "L7 유지 검토 조언",
  "LIVE",
  judge("이 계약은 유지하는 쪽을 먼저 검토해볼 만합니다."),
);
check("L8 걱정되시는군요 말투", "LIVE", judge("걱정되시는군요. 월 보험료는 32,000원입니다."));
check("L9 질문 잘 받았습니다", "LIVE", judge("질문 잘 받았습니다. 100세만기, 20년납입니다."));
{
  const raw = "월 보험료는 32,000원입니다 😊";
  const got = judge(raw);
  check("L10 이모지는 제거되고 답은 산다", "LIVE", got);
  assert.equal(got.output.includes("😊"), false);
  assert.equal(got.output.includes("월 보험료는 32,000원"), true);
}
{
  const mixed = decideQ2PreSealVeto(
    "월 보험료는 32,000원입니다. coverage_gap 엔진 결과입니다.",
  );
  assert.equal(mixed.monopoly, false);
  assert.equal(mixed.cleaned.includes("월 보험료는 32,000원"), true);
  console.log("PASS L11 누설 문장만 제거, 보험료 문장은 유지");
}

check(
  "B1 1종 50만 → 1종 500만",
  "BLOCK",
  judge("1종은 500만원입니다."),
  "CLEAR_MISMATCH sentence veto",
);
check(
  "B2 한화 → 삼성생명",
  "LIVE",
  judge("삼성생명 계약입니다."),
  "48c09f0 insurer name is diagnostic, not whole-answer monopoly",
);
{
  const identity = {
    authenticatedCustomerIdentity: { name: { value: "김진우" } },
    documentSubjectIdentity: {
      insured: "김수정",
      same_as_authenticated_customer: false,
    },
  };
  const text = "김수정님 본인이 고객입니다.";
  const got = judge(text, identity);
  const detected = detectFactIdentityMismatch(text, identity);
  check("B3 타인 문서를 로그인 본인으로 단정", "MONOPOLY", got, `identity=${detected.hard_fail}`);
}
check(
  "B4 coverage_gap 내부어만 있는 답",
  "MONOPOLY",
  judge("coverage_gap 분석 엔진 결과입니다."),
);
check(
  "B5 Factory trace 내부 덤프",
  "MONOPOLY",
  judge("Factory trace를 보면 됩니다."),
);
{
  const present = judge("암 진단비가 없어요.");
  check("B6 원문에 있는 보장을 없다고 단정", "BLOCK", present);
}
{
  const missing = hardOnlySafetyCheck("암 진단비가 없어요.", {
    coverages: [{ coverage_name: "상해수술비 (3.10.5간편)", coverage_amount: "100만원" }],
  });
  assert.equal(missing.hard.includes("absence_contradicts_verified_coverage"), false);
  assert.equal(hasWholeAnswerMonopolyHard(missing.hard), false);
  console.log("PASS B7 못 찾음은 HARD가 아님");
}
{
  const advice = "이 보장은 보완하는 게 좋겠습니다.";
  assert.equal(recommendationOrTerminationRisk(advice).recommendation_or_termination_risk, false);
  assert.equal(hasFactAmountEmitBlockHard(judge(advice).hard), false);
}

console.log(JSON.stringify({ gate_cleanup_2: rows }, null, 2));
if (process.exitCode) {
  console.error("key-gate-cleanup-2-unit-test FAILED");
  process.exit(1);
}
console.log("key-gate-cleanup-2-unit-test OK");
