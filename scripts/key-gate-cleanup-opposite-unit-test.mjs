/**
 * Gate cleanup opposite test — proven-wrong / leak / push must still block.
 * Good speech must still emit. No network. Claude-first live path functions only.
 */
import assert from "node:assert/strict";
import {
  buildClaudeFirstSpeakAllowlistForEmitBlock,
  decideS10fPreEmitEmitDecision,
  hardOnlySafetyCheck,
  hasWholeAnswerMonopolyHard,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { decideQ2PreEmitVeto } from "../server/keyCore/keyClaudeFirstOutputGuardVeto.js";
import { detectFactIdentityMismatch } from "../server/keyCore/keyCustomerIdentitySeparation.js";
import { recommendationOrTerminationRisk } from "../server/keyCore/keyVoiceGate.js";

const DOC = "f8532a47-0592-4dc1-a291-9c2e2d06606c";
const COVERAGES = [
  { coverage_name: "질병1~5종수술비IV (수술1회당)(1종)", coverage_amount: "50만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(2종)", coverage_amount: "50만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(3종)", coverage_amount: "500만원" },
  { coverage_name: "질병1~5종수술비IV (수술1회당)(4종)", coverage_amount: "500만원" },
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

function s10f(slice, extra = {}) {
  return decideS10fPreEmitEmitDecision({
    slice,
    absenceEvidence: [],
    verifiedCoverages: COVERAGES,
    speakAllowlist: allow(),
    ...extra,
  });
}

function safety(text, extra = {}) {
  return hardOnlySafetyCheck(text, {
    allowed_numbers: allow().allowed_numbers,
    allowed_entities: allow().allowed_entities,
    allowed_number_provenances: allow().allowed_number_provenances,
    coverages: COVERAGES,
    confirmedFacts: FACTS,
    ...extra,
  });
}

/** Customer-visible block on the Claude-first path. */
function liveBlock(text, { identity = null, q2 = true } = {}) {
  const emit = s10f(text);
  const hard = safety(text, identity || {});
  const q2v = q2 ? decideQ2PreEmitVeto({ slice: text }) : { veto: false };
  const monopoly = hasWholeAnswerMonopolyHard(hard.hard) || q2v.monopoly === true;
  const emitVeto = emit.emit_decision === false;
  return {
    emit_decision: emit.emit_decision,
    gate_class: emit.gate_class,
    hard: hard.hard,
    monopoly,
    q2_veto: q2v.veto === true,
    customer_blocked: emitVeto || monopoly,
  };
}

const rows = [];
function check(id, expectBlock, got, note = "") {
  const pass = got.customer_blocked === expectBlock;
  rows.push({
    id,
    expect: expectBlock ? "BLOCK" : "LIVE",
    got: got.customer_blocked ? "BLOCK" : "LIVE",
    pass,
    emit: got.emit_decision,
    monopoly: got.monopoly,
    q2: got.q2_veto,
    hard: got.hard,
    gate_class: got.gate_class,
    note,
  });
  if (!pass) {
    console.error(`FAIL ${id} expect=${expectBlock ? "BLOCK" : "LIVE"} got=${got.customer_blocked ? "BLOCK" : "LIVE"}`);
    console.error(got);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${id}`);
  }
}

const goodPeriod =
  "- **보험기간:** 2024.12.03 ~ 2069.12.03 (100세만기, 20년납)";
const goodOnce = "| 질병1~5종수술비IV — 2종 (수술 1회당) | 50만원 |";
const goodKinds = "3·4종 수술은 각 500만 원으로 비중이 높아요.";

check("G1 100세만기+20년납", false, liveBlock(goodPeriod));
check("G2 수술 1회당 + 2종", false, liveBlock(goodOnce));
check("G3 3·4종 500만", false, liveBlock(goodKinds));

check(
  "B1 1종 50만 → 1종 500만",
  true,
  liveBlock("1종은 500만원입니다."),
  "CLEAR_MISMATCH must veto emit",
);
check(
  "B2 한화 → 삼성생명",
  false,
  liveBlock("삼성생명 계약입니다."),
  "48c09f0 insurer name is diagnostic, not jailbreak monopoly",
);
{
  const identity = {
    authenticatedCustomerIdentity: { name: { value: "김진우" } },
    documentSubjectIdentity: {
      insured: "김수정",
      same_as_authenticated_customer: false,
    },
  };
  const got = liveBlock("김수정님 본인이 고객입니다.", { identity });
  const detected = detectFactIdentityMismatch("김수정님 본인이 고객입니다.", identity);
  check("B3 타인 문서를 로그인 본인으로 단정", true, got, `identity.hard_fail=${detected.hard_fail}`);
}
check(
  "B4 coverage_gap 내부어",
  true,
  liveBlock("coverage_gap 분석 엔진 결과입니다."),
);
check(
  "B4b Factory/trace",
  true,
  liveBlock("Factory trace를 보면 됩니다."),
);
check(
  "B5 근거 있는 유지 조언은 살아남음",
  false,
  liveBlock("이 계약은 유지하는 쪽을 먼저 검토해볼 만합니다."),
);

{
  const advice = liveBlock("이 보장은 보완하는 게 좋겠습니다.");
  const risk = recommendationOrTerminationRisk("이 보장은 보완하는 게 좋겠습니다.");
  check(
    "G4 보완 권유는 살아남음",
    false,
    advice,
    `enroll_risk=${risk.recommendation_or_termination_risk}`,
  );
}

console.log(JSON.stringify({ opposite: rows }, null, 2));
if (process.exitCode) {
  console.error("key-gate-cleanup-opposite-unit-test FAILED");
  process.exit(1);
}
console.log("key-gate-cleanup-opposite-unit-test OK");
