/**
 * P8-0 — Sales Director Judgment Audit (read-only diagnosis).
 * Measures what the answer actually uses: facts, judgment, limitation, empathy, questions.
 */
import { abstractMemoryThemes } from "./salesDirectorPersona.js";

const SNAPSHOT_FACT_PATTERNS = [
  /\d+\s*건(?:\s*확인|\s*가입|\s*보)?/,
  /(?:월\s*)?보험료\s*(?:약\s*)?\d[\d,]*\s*(?:만\s*)?원/,
  /\d[\d,]*\s*원/,
  /가입(?:은|된)?\s*(?:보|확)/,
  /(?:실손|암\s*관련|운전자|기타)\s*(?:쪽|상품)?/,
  /상품(?:명)?(?:은|이)?\s*(?:보|확)/,
  /보험\s*\d+/,
  /(?:삼성|현대|메리츠|KB|DB|한화|푸본|롯데|AIG)[^\n]{0,12}(?:실손|암|보험)/,
];

const MEMORY_FACT_PATTERNS = [
  /예전에\s*비슷한/,
  /지금까지\s*나눈/,
  /맥락으로\s*이해/,
  /흐름으로\s*받아/,
  /이전에\s*나눈/,
];

const GAP_FACT_PATTERNS = [
  /유지(?:\s*신호)?/,
  /(?:공백|볼\s*여지|점검(?:할)?\s*여지)/,
  /저장된\s*분석\s*기준/,
  /먼저\s*볼\s*여지/,
  /함께\s*점검(?:할)?\s*여지/,
  /유지하는\s*축/,
  /내부적(?:으로)?(?:는)?/,
  /부족\s*가능/,
  /(?:암|실손|운전자|뇌|심)[^\n]{0,8}(?:쪽|부분)?(?:을|를)?\s*(?:먼저\s*)?(?:볼|점검)/,
];

const PREMIUM_FACT_PATTERNS = [
  /(?:월\s*)?보험료(?:는|가|)\s*(?:약\s*)?\d[\d,]*\s*(?:만\s*)?원/,
  /확인(?:된| 가능한)\s*월\s*보험료(?:는|가)?\s*\d[\d,]*\s*원/,
  /보험료\s*합계(?:는|가)?\s*(?:약\s*)?\d[\d,]*\s*원/,
];

const PREMIUM_SNAPSHOT_OVERLAP_PATTERNS = [
  /(?:월\s*)?보험료\s*(?:약\s*)?\d[\d,]*\s*(?:만\s*)?원/,
  /\d[\d,]*\s*원/,
];

const LIMITATION_PATTERNS = [
  /단정(?:하|하기)\s*(?:어렵|불가)/,
  /확답(?:하기)?\s*어려/,
  /판단(?:하기)?\s*(?:불가|어렵)/,
  /확인(?:하기)?\s*(?:어렵|전|불가)/,
  /검증\s*전/,
  /아직\s*(?:숫자|확인|검증)/,
  /모르는\s*범위/,
  /이\s*정보만(?:으)?론/,
  /현재(?:로서는|는)?\s*확인\s*어려/,
  /자료(?:가)?\s*(?:더\s*)?필요/,
  /충분성(?:은)?\s*판단\s*불가/,
];

const JUDGMENT_PATTERNS = [
  /(?:암보장|보장|담보)(?:은|이)\s*(?:있(?:습니다|어요|음)?|없(?:습니다|어요|음)?)/,
  /(?:있(?:습니다|어요)|없(?:습니다|어요))(?![^\n]{0,20}(?:어려|불가|미확))/,
  /(?:좋(?:을|겠)(?:습니다|어요))/,
  /유지(?:하는\s*편|하(?:세요|는\s*게)|(?:\s*신호)?(?:가\s*있)?)/,
  /부담될\s*수\s*있(?:습니다|어요)?/,
  /(?:맞(?:아|습니다)|충분(?:합니다|해요)?)(?![^\n]{0,12}어려)/,
  /(?:필요(?:합니다|해요)|권(?:합니다|장))/,
];

const EMPATHY_PATTERNS = [
  /걱정(?:되|이)?(?:실|하)?(?:\s*수\s*있)?(?:습니다|어요)?/,
  /부담(?:이)?\s*(?:크|무겁|많)/,
  /(?:크게|특히)\s*느껴/,
  /혼자\s*감당/,
  /(?:불안|답답)(?:하)?(?:셔|하)?(?:도)?\s*괜찮/,
  /괜찮(?:아요|습니다)/,
  /이해(?:해|돼|합니다)/,
  /(?:함께|곁에서|차근차근)/,
  /천천히/,
  /(?:마음|고민)(?:이)?\s*(?:느껴|이해돼)/,
];

const QUESTION_PATTERNS = [
  /[?？]/,
  /(?:할까요|볼까요|알려주(?:실|시)|말씀해\s*주(?:실|시)|궁금하(?:신|세요))/,
];

export function splitAnswerSentences(text = "") {
  return String(text ?? "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?？])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function countPatternHits(text = "", patterns = []) {
  let count = 0;
  for (const pattern of patterns) {
    const matches = String(text ?? "").match(new RegExp(pattern.source, `${pattern.flags}g`));
    if (matches) count += matches.length;
  }
  return count;
}

function sentenceHasPattern(text = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifySentence(sentence = "", context = {}) {
  const limitation = sentenceHasPattern(sentence, LIMITATION_PATTERNS);
  const judgment = !limitation && sentenceHasPattern(sentence, JUDGMENT_PATTERNS);
  const empathy = sentenceHasPattern(sentence, EMPATHY_PATTERNS);
  const question = sentenceHasPattern(sentence, QUESTION_PATTERNS);

  let snapshotHits = countPatternHits(sentence, SNAPSHOT_FACT_PATTERNS);
  let memoryHits = countPatternHits(sentence, MEMORY_FACT_PATTERNS);
  let gapHits = countPatternHits(sentence, GAP_FACT_PATTERNS);
  let premiumHits = sentenceHasPattern(sentence, PREMIUM_FACT_PATTERNS) ? 1 : 0;

  if (premiumHits > 0) {
    const overlapHits = countPatternHits(sentence, PREMIUM_SNAPSHOT_OVERLAP_PATTERNS);
    snapshotHits = Math.max(0, snapshotHits - overlapHits);
  }

  if (memoryHits === 0 && context.memoryThemes?.length) {
    for (const theme of context.memoryThemes) {
      if (theme.length >= 4 && sentence.includes(theme.split(" ")[0])) {
        memoryHits += 1;
        break;
      }
    }
  }

  if (gapHits === 0 && context.gapSignals?.length) {
    for (const signal of context.gapSignals) {
      const label = String(signal).split(":")[0];
      if (label && sentence.includes(label)) {
        gapHits += 1;
        break;
      }
    }
  }

  return {
    snapshot_fact_count: snapshotHits,
    memory_fact_count: memoryHits,
    coverage_gap_fact_count: gapHits,
    premium_fact_count: premiumHits,
    judgment_count: judgment ? 1 : 0,
    limitation_count: limitation ? 1 : 0,
    empathy_count: empathy ? 1 : 0,
    question_count: question ? 1 : 0,
  };
}

export function auditAnswerExpressions(answerText = "", context = {}) {
  const sentences = splitAnswerSentences(answerText);
  const totals = {
    snapshot_fact_count: 0,
    memory_fact_count: 0,
    coverage_gap_fact_count: 0,
    premium_fact_count: 0,
    judgment_count: 0,
    limitation_count: 0,
    empathy_count: 0,
    question_count: 0,
  };

  for (const sentence of sentences) {
    const row = classifySentence(sentence, context);
    totals.snapshot_fact_count += row.snapshot_fact_count;
    totals.memory_fact_count += row.memory_fact_count;
    totals.coverage_gap_fact_count += row.coverage_gap_fact_count;
    totals.premium_fact_count += row.premium_fact_count;
    totals.judgment_count += row.judgment_count;
    totals.limitation_count += row.limitation_count;
    totals.empathy_count += row.empathy_count;
    totals.question_count += row.question_count;
  }

  const fact_count_total =
    totals.snapshot_fact_count +
    totals.memory_fact_count +
    totals.coverage_gap_fact_count +
    totals.premium_fact_count;

  return {
    sentences_analyzed: sentences.length,
    fact_count: {
      total: fact_count_total,
      snapshot_fact_count: totals.snapshot_fact_count,
      memory_fact_count: totals.memory_fact_count,
      coverage_gap_fact_count: totals.coverage_gap_fact_count,
      premium_fact_count: totals.premium_fact_count,
    },
    judgment_count: totals.judgment_count,
    limitation_count: totals.limitation_count,
    empathy_count: totals.empathy_count,
    question_count: totals.question_count,
  };
}

export function buildExpressionRatios(counts = {}) {
  const totalUnits =
    (counts.fact_count?.total ?? 0) +
    (counts.judgment_count ?? 0) +
    (counts.limitation_count ?? 0) +
    (counts.empathy_count ?? 0) +
    (counts.question_count ?? 0);

  const safeDiv = (value) => (totalUnits > 0 ? Number((value / totalUnits).toFixed(4)) : 0);

  return {
    fact_ratio: safeDiv(counts.fact_count?.total ?? 0),
    judgment_ratio: safeDiv(counts.judgment_count ?? 0),
    limitation_ratio: safeDiv(counts.limitation_count ?? 0),
    empathy_ratio: safeDiv(counts.empathy_count ?? 0),
    question_ratio: safeDiv(counts.question_count ?? 0),
    total_units: totalUnits,
  };
}

export function buildStructureFlags(counts = {}) {
  return {
    fact: (counts.fact_count?.total ?? 0) > 0,
    judgment: (counts.judgment_count ?? 0) > 0,
    limitation: (counts.limitation_count ?? 0) > 0,
    empathy: (counts.empathy_count ?? 0) > 0,
    question: (counts.question_count ?? 0) > 0,
  };
}

export function analyzeDirectorDisposition(ratios = {}, counts = {}, factoryAudit = null) {
  const composition = [
    { type: "empathy", label: "공감형", ratio: ratios.empathy_ratio ?? 0 },
    { type: "question", label: "질문형", ratio: ratios.question_ratio ?? 0 },
    { type: "judgment", label: "판단형", ratio: ratios.judgment_ratio ?? 0 },
    { type: "limitation", label: "보류형", ratio: ratios.limitation_ratio ?? 0 },
    { type: "fact", label: "사실활용형", ratio: ratios.fact_ratio ?? 0 },
  ].sort((left, right) => right.ratio - left.ratio);

  const evidence = factoryAudit?.answer_evidence ?? [];
  const factoryLoadedButUnusedInAnswer = {
    snapshot:
      evidence.includes("snapshot") && (counts.fact_count?.snapshot_fact_count ?? 0) === 0,
    memory: evidence.includes("memory") && (counts.fact_count?.memory_fact_count ?? 0) === 0,
    coverage_gap:
      evidence.includes("coverage_gap") &&
      (counts.fact_count?.coverage_gap_fact_count ?? 0) === 0,
  };

  return {
    primary_type: composition[0]?.type ?? null,
    primary_label: composition[0]?.label ?? null,
    composition,
    profile_summary: buildProfileSummary(composition, counts, ratios),
    hypothesis_signals: {
      empathy_over_judgment:
        (ratios.empathy_ratio ?? 0) > (ratios.judgment_ratio ?? 0),
      question_over_judgment:
        (ratios.question_ratio ?? 0) > (ratios.judgment_ratio ?? 0),
      judgment_below_limitation:
        (ratios.judgment_ratio ?? 0) < (ratios.limitation_ratio ?? 0),
      factory_evidence_without_answer_facts: Object.values(factoryLoadedButUnusedInAnswer).some(
        Boolean,
      ),
      factory_loaded_but_answer_underuses: factoryLoadedButUnusedInAnswer,
    },
  };
}

function buildProfileSummary(composition, counts, ratios) {
  const top = composition.slice(0, 2).map((item) => item.label);
  const judgmentVsLimitation =
    (counts.judgment_count ?? 0) === 0 && (counts.limitation_count ?? 0) > 0
      ? "판단보다 보류가 많음"
      : (counts.judgment_count ?? 0) > (counts.limitation_count ?? 0)
        ? "판단 표현이 보류보다 많음"
        : "판단·보류가 비슷하거나 보류 우세";

  return {
    dominant_styles: top,
    judgment_vs_limitation: judgmentVsLimitation,
    empathy_question_stack:
      (ratios.empathy_ratio ?? 0) + (ratios.question_ratio ?? 0) >
      (ratios.judgment_ratio ?? 0) + (ratios.fact_ratio ?? 0)
        ? "공감+질문 비중이 판단+사실보다 큼"
        : "판단+사실 비중이 공감+질문보다 큼",
  };
}

export function buildSalesDirectorJudgmentAudit({
  answerText = "",
  customerContextBundle = null,
  factoryAudit = null,
  answerEvidence = null,
} = {}) {
  const memoryFacts = customerContextBundle?.memoryFacts ?? [];
  const gapCtx = customerContextBundle?.coverageGapContext ?? null;
  const context = {
    memoryThemes: abstractMemoryThemes(memoryFacts),
    gapSignals: gapCtx?.signals ?? [],
  };

  const counts = auditAnswerExpressions(answerText, context);
  const ratios = buildExpressionRatios(counts);
  const structure = buildStructureFlags(counts);
  const mergedFactoryAudit = factoryAudit ?? { answer_evidence: answerEvidence ?? [] };
  const disposition = analyzeDirectorDisposition(ratios, counts, mergedFactoryAudit);

  return {
    audit: "p8_0_judgment",
    read_only: true,
    ...counts,
    structure,
    ratios,
    disposition,
    answer_evidence: answerEvidence ?? mergedFactoryAudit.answer_evidence ?? [],
  };
}

export function aggregateJudgmentAudits(audits = []) {
  const sum = {
    fact_count: {
      total: 0,
      snapshot_fact_count: 0,
      memory_fact_count: 0,
      coverage_gap_fact_count: 0,
      premium_fact_count: 0,
    },
    judgment_count: 0,
    limitation_count: 0,
    empathy_count: 0,
    question_count: 0,
  };

  for (const audit of audits) {
    sum.fact_count.total += audit.fact_count?.total ?? 0;
    sum.fact_count.snapshot_fact_count += audit.fact_count?.snapshot_fact_count ?? 0;
    sum.fact_count.memory_fact_count += audit.fact_count?.memory_fact_count ?? 0;
    sum.fact_count.coverage_gap_fact_count += audit.fact_count?.coverage_gap_fact_count ?? 0;
    sum.fact_count.premium_fact_count += audit.fact_count?.premium_fact_count ?? 0;
    sum.judgment_count += audit.judgment_count ?? 0;
    sum.limitation_count += audit.limitation_count ?? 0;
    sum.empathy_count += audit.empathy_count ?? 0;
    sum.question_count += audit.question_count ?? 0;
  }

  const ratios = buildExpressionRatios(sum);
  const disposition = analyzeDirectorDisposition(ratios, sum, {
    answer_evidence: ["snapshot", "memory", "coverage_gap"],
  });

  return {
    questions_analyzed: audits.length,
    ...sum,
    ratios,
    structure: buildStructureFlags(sum),
    disposition,
    per_question: audits,
  };
}
