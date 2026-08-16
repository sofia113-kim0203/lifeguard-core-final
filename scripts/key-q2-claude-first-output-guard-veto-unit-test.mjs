/**
 * Q2-CLAUDE-FIRST-PREEMIT-PRESEAL-VETO — match-only; monopoly outlet; no rewrite.
 */
import assert from "node:assert/strict";
import {
  decideQ2PreEmitVeto,
  decideQ2PreSealVeto,
  violatesClaudeFirstOutputGuardMatchers,
  Q2_OUTPUT_GUARD_LEAK_REASON,
} from "../server/keyCore/keyClaudeFirstOutputGuardVeto.js";
import { createImmediateAnswerDeltaStream } from "../server/keyCore/keyClaudeFirstSentenceCommit.js";
import {
  isProgressOnlyCustomerAnswer,
  stripProgressLeadFromCustomerText,
} from "../server/keyCore/keyRecordSidecar.js";
import { applyCommittedStreamToSealed } from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  repairKoreanSentenceBoundarySpace,
  sealKeyCustomerText,
} from "../server/keyCore/keyCustomerTextSeal.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "../server/keyCore/keyCustomerMonopoly.js";
import { finalizeKeyCustomerText } from "../server/keyCore/keyCustomerMonopoly.js";
import { applyLifeguardCustomerOutputGuard } from "../server/lifeguardOutputGuard.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("Q2-T1 engine term matcher fires; clean prose does not", () => {
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers("Coverage Gap을 정리하면…"),
    true,
  );
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers(
      "이 계약만 놓고 보면 수술비 중심이에요.",
    ),
    false,
  );
});

test("Q2-T2 inventory dump matcher fires; 월 보험료 is not a leak", () => {
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers("현재 3건의 보험이 있으세요."),
    true,
  );
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers("월 보험료는 32,000원입니다."),
    false,
  );
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers("현재 보험료부터 보면 부담이 있어요."),
    false,
  );
  assert.equal(
    violatesClaudeFirstOutputGuardMatchers("보장 분석부터 같이 보면 좋겠어요."),
    false,
  );
});

test("Q2-T3 pre-emit veto aborts before onDelta (no SSE leak)", () => {
  const emitted = [];
  let abortReason = null;
  const stream = createImmediateAnswerDeltaStream({
    onCommit(chunk) {
      const slice = String(chunk ?? "");
      const q2 = decideQ2PreEmitVeto({
        slice,
        committedSoFar: stream.getCommitted(),
      });
      if (q2.veto) {
        if (q2.monopoly) {
          abortReason = q2.reason;
          return { keep: false, abort: true, reason: q2.reason };
        }
        return { keep: false };
      }
      emitted.push(slice);
      return { keep: true };
    },
  });
  // Push complete sentence units ending with boundary.
  stream.pushAnswerText("안녕하세요.\n");
  stream.pushAnswerText("안녕하세요.\nCoverage Gap이 있어요.\n");
  stream.pushAnswerText("안녕하세요.\nCoverage Gap이 있어요.\n월 보험료는 32,000원입니다.\n");
  stream.flush();
  assert.equal(stream.isAborted(), false);
  assert.equal(abortReason, null);
  assert.equal(emitted.some((s) => /Coverage\s*Gap/i.test(s)), false);
  assert.equal(emitted.join("").includes("안녕하세요"), true);
  assert.equal(emitted.join("").includes("월 보험료는 32,000원"), true);
});

test("Q2-T4 pre-seal monopoly only when the whole remainder is a dump", () => {
  const dump = decideQ2PreSealVeto(
    "등록된 서류 2건을 보면 이렇게예요.",
  );
  assert.equal(dump.veto, true);
  assert.equal(dump.monopoly, true);
  assert.equal(dump.reason, Q2_OUTPUT_GUARD_LEAK_REASON);

  const mixed = decideQ2PreSealVeto(
    "월 보험료는 32,000원입니다. coverage_gap 엔진 결과입니다.",
  );
  assert.equal(mixed.monopoly, false);
  assert.equal(mixed.cleaned.includes("월 보험료는 32,000원"), true);
  assert.equal(/coverage_gap/i.test(mixed.cleaned), false);
});

test("Q2-T5 veto path uses monopoly outlet — not GUARD_FALLBACK rewrite", () => {
  const leak = "추천 엔진이 이렇게 말해요.";
  const rewritten = applyLifeguardCustomerOutputGuard(leak);
  assert.notEqual(rewritten, leak);
  const outlet = finalizeKeyCustomerText("", { failureMode: true });
  assert.equal(outlet.customerText, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
  assert.notEqual(outlet.customerText, rewritten);
});

test("Q2-T6 clean answer unchanged by matchers", () => {
  const clean =
    "솔직히 말하면, 이 계약 하나만으로는 보장이 충분하다고 보기 어려워요.";
  assert.equal(violatesClaudeFirstOutputGuardMatchers(clean), false);
  assert.equal(decideQ2PreSealVeto(clean).veto, false);
  assert.equal(
    decideQ2PreEmitVeto({ slice: clean + "\n", committedSoFar: "" }).veto,
    false,
  );
});

test("tool-round stream is a new document — no .00만원 / .요 glue", () => {
  const tableRound = "| 상해수술비 | 100만원 |\n| 질병1~5종수술비 (2종·4종) | 미확인 |\n";
  const glueStream = createImmediateAnswerDeltaStream();
  glueStream.pushAnswerText("금액을 확인해볼게요.");
  glueStream.pushAnswerText(tableRound);
  glueStream.flush();
  const glued = glueStream.getCommitted();
  assert.equal(/\.00만원/.test(glued), false);
  assert.equal(glued.includes("100만원"), true);
  assert.equal(glued.includes("금액을 확인해볼게요.\n| 상해수술비 | 100만원 |"), true);

  const weather = createImmediateAnswerDeltaStream();
  weather.pushAnswerText("찾아볼게요.");
  weather.pushAnswerText("오늘은 흐려요.");
  weather.flush();
  assert.equal(weather.getCommitted().includes("찾아볼게요.요"), false);
  assert.equal(weather.getCommitted().includes("찾아볼게요.\n오늘은 흐려요."), true);

  const sameDoc = createImmediateAnswerDeltaStream();
  sameDoc.pushAnswerText("수술비 걱정은 당연한 거예요.");
  sameDoc.pushAnswerText("수술비 걱정은 당연한 거예요. 보험료를 줄이면서도 지킬 수 있어요.");
  sameDoc.flush();
  assert.equal(
    sameDoc.getCommitted(),
    "수술비 걱정은 당연한 거예요. 보험료를 줄이면서도 지킬 수 있어요.",
  );
});

test("Korean sentence jam gets a boundary space — not 3.10.5 coverage codes", () => {
  assert.equal(
    repairKoreanSentenceBoundarySpace("있어요.오늘 비가 와요."),
    "있어요. 오늘 비가 와요.",
  );
  assert.equal(
    repairKoreanSentenceBoundarySpace("맞아요.지금 이어서 볼게요."),
    "맞아요. 지금 이어서 볼게요.",
  );
  assert.equal(
    repairKoreanSentenceBoundarySpace("으로 보입니다.우산 챙기세요."),
    "으로 보입니다. 우산 챙기세요.",
  );
  assert.equal(
    repairKoreanSentenceBoundarySpace("있어요. 오늘"),
    "있어요. 오늘",
  );
  assert.equal(
    repairKoreanSentenceBoundarySpace("있어요.\n오늘"),
    "있어요.\n오늘",
  );
  assert.equal(
    repairKoreanSentenceBoundarySpace("질병수술비 (3.10.5간편) 30만원"),
    "질병수술비 (3.10.5간편) 30만원",
  );
  assert.equal(
    sealKeyCustomerText("있어요.오늘 비가 와요.").key_speak_original,
    "있어요. 오늘 비가 와요.",
  );

  const jammed = createImmediateAnswerDeltaStream();
  jammed.pushAnswerText("있어요.오늘 비가 와요.");
  jammed.flush();
  assert.equal(jammed.getCommitted().includes("있어요.오늘"), false);
  assert.equal(jammed.getCommitted().includes("있어요. 오늘"), true);

  const catchUp = createImmediateAnswerDeltaStream();
  catchUp.pushAnswerText("있어요.");
  catchUp.catchUpFinalAnswer("있어요.오늘 비가 와요.", { stopReason: "end_turn" });
  catchUp.flush();
  assert.equal(catchUp.getCommitted().includes("있어요.오늘"), false);
  assert.equal(catchUp.getCommitted().includes("있어요. 오늘"), true);

  const reseal = applyCommittedStreamToSealed({
    sealed: sealKeyCustomerText("초안"),
    committedText: "있어요.오늘 비가 와요.",
    usedFailure: false,
  });
  assert.equal(reseal.key_speak_original.includes("있어요.오늘"), false);
  assert.equal(reseal.key_speak_original.includes("있어요. 오늘"), true);
});

test("progress lead is not accumulated into the final body", () => {
  assert.equal(isProgressOnlyCustomerAnswer("금액을 확인해볼게요."), true);
  assert.equal(isProgressOnlyCustomerAnswer("한꺼번에 볼게요."), true);
  assert.equal(isProgressOnlyCustomerAnswer("금액을 한번에 다 볼게요."), true);
  assert.equal(isProgressOnlyCustomerAnswer("정리해서 말씀드릴게요."), true);
  assert.equal(isProgressOnlyCustomerAnswer("확인됐어요."), true);
  const stacked = [
    "수술비 걱정은 당연한 거예요.",
    "금액을 확인해볼게요.",
    "한꺼번에 볼게요.",
    "확인됐어요.",
    "질병수술비는 30만원이에요.",
  ].join("\n");
  const cleaned = stripProgressLeadFromCustomerText(stacked);
  assert.equal(cleaned.includes("확인해볼게요"), false);
  assert.equal(cleaned.includes("한꺼번에 볼게요"), false);
  assert.equal(cleaned.includes("확인됐어요"), false);
  assert.equal(cleaned.includes("수술비 걱정은 당연한 거예요."), true);
  assert.equal(cleaned.includes("질병수술비는 30만원이에요."), true);
  const sealed = applyCommittedStreamToSealed({
    sealed: sealKeyCustomerText(stacked),
    committedText: stacked,
    usedFailure: false,
  });
  assert.equal(sealed.key_speak_original.includes("확인해볼게요"), false);
  assert.equal(sealed.key_speak_original.includes("30만원"), true);
});

if (process.exitCode) {
  console.error("Q2 claude-first output guard veto unit tests FAILED");
  process.exit(1);
}
console.log("Q2 claude-first output guard veto unit tests PASSED");
