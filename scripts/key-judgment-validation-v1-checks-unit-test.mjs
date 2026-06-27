/**
 * KEY Judgment Validation v1 — utilization checks unit tests.
 */
import assert from "node:assert/strict";

import {
  assessJudgmentStep,
  aggregateJudgmentValidation,
  classifyUtilization,
} from "./key-judgment-validation-v1-checks.mjs";

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

let passed = 0;
let failed = 0;

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

await record(
  await runCase("memory used when factory used", async () => {
    const u = classifyUtilization({
      axis: "memory",
      factoryAudit: { memory: { available: true, loaded: true, used: true, record_count: 2 } },
      judgmentAudit: { fact_count: { memory_fact_count: 1 }, judgment_count: 1 },
      answerText: "예전에 비슷한 부담을 나눈 적이 있어요.",
    });
    assert.equal(u.level, "used");
  }),
);

await record(
  await runCase("memory honest absence when unavailable", async () => {
    const u = classifyUtilization({
      axis: "memory",
      factoryAudit: { memory: { available: false, loaded: false, used: false, record_count: 0 } },
      judgmentAudit: { fact_count: { memory_fact_count: 0 }, judgment_count: 0 },
      answerText: "지금은 확인된 기억이 없어요.",
    });
    assert.equal(u.level, "honest_absence");
  }),
);

await record(
  await runCase("gap disconnect when loaded not used", async () => {
    const u = classifyUtilization({
      axis: "coverage_gap",
      factoryAudit: {
        coverage_gap: { available: true, loaded: true, used: false, record_count: 3 },
        primary_disconnect: { factory: "coverage_gap", disconnect: "loaded_not_used" },
      },
      judgmentAudit: { fact_count: { coverage_gap_fact_count: 0 }, judgment_count: 1 },
      answerText: "가입된 보험은 1개 확인돼요.",
    });
    assert.equal(u.level, "loaded_not_used");
    assert.ok(u.disconnect);
  }),
);

await record(
  await runCase("aggregate by axis", async () => {
    const steps = [
      assessJudgmentStep({
        id: "J01",
        axis: "memory",
        question: "q",
        answerText: "확인된 기억 없어요",
        factoryAudit: { memory: { available: false, loaded: false, used: false } },
        judgmentAudit: {},
      }),
      assessJudgmentStep({
        id: "J04",
        axis: "coverage_gap",
        question: "q",
        answerText: "암 쪽 볼 여지",
        factoryAudit: {
          coverage_gap: { available: true, loaded: true, used: true, record_count: 1 },
        },
        judgmentAudit: { fact_count: { coverage_gap_fact_count: 1 }, judgment_count: 1 },
      }),
    ];
    const agg = aggregateJudgmentValidation(steps);
    assert.equal(agg.questions_probed, 2);
    assert.equal(agg.by_axis.memory.total, 1);
    assert.equal(agg.by_axis.coverage_gap.used, 1);
  }),
);

console.log(
  `\nKEY Judgment Validation v1 checks: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
