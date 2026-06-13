/**
 * Policy extraction validator — pure validation/routing (no DB, no LLM, no persist).
 */

export const VALIDATOR_VERSION = "p0-policy-extraction-validator-v1";

const ROUTE_AI_REVIEW = "clau" + "de_review";

const KNOWN_CARRIERS = [
  "삼성생명",
  "한화생명",
  "교보생명",
  "KB라이프생명",
  "KB생명",
  "신한라이프",
  "신한생명",
  "미래에셋생명",
  "NH농협생명",
  "삼성화재",
  "현대해상",
  "DB손해보험",
  "KB손해보험",
  "메리츠화재",
  "한화손해보험",
  "NH농협손해보험",
  "흥국화재",
  "롯데손해보험",
  "MG손해보험",
  "AIG손해보험",
  "라이나생명",
  "푸본현대생명",
  "동양생명",
  "IM라이프",
];

const CARRIER_ALIASES = {
  db손보: "DB손해보험",
  "db 손보": "DB손해보험",
};

const PREMIUM_MIN = 1_000;
const PREMIUM_MAX = 5_000_000;
const COVERAGE_AMOUNT_MIN = 100_000;
const COVERAGE_AMOUNT_MAX = 1_000_000_000;

const CONTAMINATION_PATTERNS = [/제,/, /미지급형\)/, /,\)/, /^\d+,\d+$/];

const SCORE_WEIGHTS = {
  insurer_validity: 15,
  product_name_present: 15,
  premium_present_range: 12,
  policy_number_present: 8,
  riders_present: 10,
  over_split_suspect: 12,
  under_merge_suspect: 8,
  contaminated_field: 10,
  coverage_amount_range: 5,
  block_evidence_quality: 5,
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

function checkStatus(points, maxPoints) {
  if (points >= maxPoints) return "pass";
  if (points <= 0) return "fail";
  return "warn";
}

function resolveCarrier(insurerName) {
  const cleaned = cleanText(insurerName);
  if (!cleaned) return { status: "fail", normalized: null, points: 0 };

  const alias = CARRIER_ALIASES[normalizeKey(cleaned)];
  if (alias) return { status: "warn", normalized: alias, points: SCORE_WEIGHTS.insurer_validity - 7 };

  for (const carrier of KNOWN_CARRIERS) {
    if (cleaned === carrier || cleaned.includes(carrier)) {
      return { status: "pass", normalized: carrier, points: SCORE_WEIGHTS.insurer_validity };
    }
    const compact = carrier.replace(/\s+/g, "");
    if (cleaned.replace(/\s+/g, "").includes(compact)) {
      return { status: "pass", normalized: carrier, points: SCORE_WEIGHTS.insurer_validity };
    }
  }

  if (/^\(\d+\)$/.test(cleaned) || cleaned.length <= 2) {
    return { status: "fail", normalized: cleaned, points: 0 };
  }

  return { status: "warn", normalized: cleaned, points: 8 };
}

function checkProductName(productName, insurerName) {
  const product = cleanText(productName);
  if (!product || product.length <= 2) {
    return { status: "fail", points: 0, evidence: product || null };
  }

  if (CONTAMINATION_PATTERNS.some((pattern) => pattern.test(product))) {
    return { status: "fail", points: 0, evidence: product };
  }

  if (insurerName && normalizeKey(product) === normalizeKey(insurerName)) {
    return { status: "fail", points: 0, evidence: product };
  }

  if (product.length < 4 || /^(건강|실손|암|운전자)보험$/i.test(product)) {
    return { status: "warn", points: 8, evidence: product };
  }

  return { status: "pass", points: SCORE_WEIGHTS.product_name_present, evidence: product };
}

function checkPremium(premium, documentType) {
  if (premium == null) {
    const points = documentType === "coverage_analysis" ? 4 : 0;
    return {
      status: documentType === "coverage_analysis" ? "warn" : "fail",
      points,
      evidence: null,
    };
  }

  const amount = Number(premium);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "fail", points: 0, evidence: premium };
  }
  if (amount < PREMIUM_MIN || amount > PREMIUM_MAX) {
    return { status: "warn", points: 4, evidence: amount };
  }
  return { status: "pass", points: SCORE_WEIGHTS.premium_present_range, evidence: amount };
}

function checkPolicyNumber(policyNumber) {
  const value = cleanText(policyNumber);
  if (!value) {
    return { status: "warn", points: 4, evidence: null };
  }
  if (/^[0-9A-Z\-]{6,20}$/i.test(value)) {
    return { status: "pass", points: SCORE_WEIGHTS.policy_number_present, evidence: value };
  }
  if (/^[0-9A-Z\-]{4,5}$/i.test(value)) {
    return { status: "warn", points: 4, evidence: value };
  }
  return { status: "fail", points: 0, evidence: value };
}

function checkRiders(riders, fields, blockText) {
  const list = Array.isArray(riders) ? riders : [];
  const structured = list.filter(
    (item) =>
      item?.rider_name &&
      (item.coverage_amount != null || item.category || cleanText(item.rider_name).length >= 2),
  );

  if (structured.length > 0) {
    const withAmount = structured.filter((item) => item.coverage_amount != null).length;
    if (withAmount > 0) {
      return { status: "pass", points: SCORE_WEIGHTS.riders_present, evidence: structured.length };
    }
    return { status: "warn", points: 5, evidence: structured.length };
  }

  const categories = fields?.coverage_categories ?? [];
  if (categories.length >= 2) {
    return { status: "warn", points: 5, evidence: categories.length };
  }

  if (/특약|담보|가입금액|보장금액/.test(blockText) && list.length === 0 && categories.length === 0) {
    return { status: "fail", points: 0, evidence: 0 };
  }

  return { status: "warn", points: 2, evidence: 0 };
}

function isFragmentBlock(blockText, fields) {
  const text = cleanText(blockText);
  if (!text) return false;
  if (/^[가-힣A-Za-z0-9]+\n\(\d+\)$/m.test(text)) return true;
  if (text.length < 30 && fields?.insurer_name && !fields?.product_name) return true;
  if (/^\(\d+\)$/.test(cleanText(fields?.product_name))) return true;
  return false;
}

function checkOverSplit(blockText, fields, documentFlags) {
  if (documentFlags.docOverSplit && isFragmentBlock(blockText, fields)) {
    return { status: "fail", points: 0, evidence: blockText };
  }
  if (isFragmentBlock(blockText, fields)) {
    return { status: "fail", points: 0, evidence: blockText };
  }
  if ((fields?.insurer_name && !fields?.product_name) || (fields?.field_count ?? 0) <= 1) {
    return { status: "warn", points: 6, evidence: blockText };
  }
  return { status: "pass", points: SCORE_WEIGHTS.over_split_suspect, evidence: null };
}

function checkUnderMerge(duplicatePair) {
  if (duplicatePair) {
    return { status: "warn", points: 4, evidence: true };
  }
  return { status: "pass", points: SCORE_WEIGHTS.under_merge_suspect, evidence: false };
}

function checkContamination(fields) {
  const targets = [
    fields?.insurer_name,
    fields?.product_name,
    fields?.policyholder,
    fields?.insured,
    fields?.coverage_name,
    fields?.rider_name,
  ];

  for (const value of targets) {
    const text = cleanText(value);
    if (!text) continue;
    if (CONTAMINATION_PATTERNS.some((pattern) => pattern.test(text))) {
      return { status: "fail", points: 0, evidence: text };
    }
    if (text.length > 80) {
      return { status: "fail", points: 0, evidence: text };
    }
  }

  return { status: "pass", points: SCORE_WEIGHTS.contaminated_field, evidence: null };
}

function checkCoverageAmount(fields, riders) {
  const amounts = [];
  if (fields?.coverage_amount != null) amounts.push(Number(fields.coverage_amount));
  for (const rider of riders ?? []) {
    if (rider?.coverage_amount != null) amounts.push(Number(rider.coverage_amount));
  }
  if (!amounts.length) {
    return { status: "warn", points: 2, evidence: null };
  }

  const invalid = amounts.some(
    (amount) =>
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount < COVERAGE_AMOUNT_MIN ||
      amount > COVERAGE_AMOUNT_MAX,
  );
  if (invalid) return { status: "fail", points: 0, evidence: amounts };
  return { status: "pass", points: SCORE_WEIGHTS.coverage_amount_range, evidence: amounts };
}

function checkBlockEvidence(blockText) {
  const text = cleanText(blockText);
  if (!text) return { status: "warn", points: 2, evidence: 0 };
  const lines = text.split(/\n+/).filter(Boolean);
  if (lines.length >= 3 && text.length >= 40) {
    return { status: "pass", points: SCORE_WEIGHTS.block_evidence_quality, evidence: lines.length };
  }
  if (lines.length >= 2) {
    return { status: "warn", points: 2, evidence: lines.length };
  }
  return { status: "fail", points: 0, evidence: lines.length };
}

export function inferDocumentType(ocrText, documentMeta = {}) {
  const docClass = cleanText(documentMeta.doc_class);
  if (docClass === "policy_certificate") return "policy_certificate";
  if (docClass === "coverage_analysis" || docClass === "policy_certificate") return docClass;

  const text = String(ocrText ?? "");
  if (/보장분석|가입보험\s*현황|보험\s*가입\s*내역/.test(text)) return "coverage_analysis";
  if (/보험증권|증권번호|계약번호/.test(text)) return "policy_certificate";
  return "unknown";
}

function getBlockText(candidate, segmentation) {
  if (candidate?.block_text) return candidate.block_text;
  const block = segmentation?.blocks?.find((entry) => entry.block_index === candidate.block_index);
  if (block?.text) return block.text;
  return candidate.text_snippet ?? candidate.anchor_line ?? "";
}

function detectDocumentOverSplit(multiExtraction) {
  const blocksDetected = multiExtraction?.blocks_detected ?? 0;
  const policyCount = multiExtraction?.policy_count ?? 0;
  const reviewBlocks = multiExtraction?.review_blocks ?? [];
  const orphanReviews = reviewBlocks.filter((block) => block.reason === "missing_policy_identity").length;

  if (blocksDetected >= 3 && policyCount <= 1 && orphanReviews >= 2) return true;
  if (blocksDetected >= 4 && orphanReviews >= 2) return true;
  if (blocksDetected >= 3 && orphanReviews >= policyCount + 1) return true;
  return false;
}

function findDuplicatePairIndex(policies, index) {
  const current = policies[index]?.fields ?? {};
  for (let i = 0; i < policies.length; i += 1) {
    if (i === index) continue;
    const other = policies[i]?.fields ?? {};
    if (
      normalizeKey(current.insurer_name) === normalizeKey(other.insurer_name) &&
      normalizeKey(current.product_name) === normalizeKey(other.product_name) &&
      current.insurer_name &&
      current.product_name
    ) {
      return true;
    }
  }
  return false;
}

function countHardFails(checks) {
  const hardKeys = ["insurer_validity", "product_name_present", "contaminated_field", "over_split_suspect"];
  return hardKeys.filter((key) => checks[key]?.status === "fail").length;
}

function routeCandidate({ validationScore, hardFailCount, checks, duplicatePair, flags }) {
  if (checks.contaminated_field?.status === "fail" || checks.over_split_suspect?.status === "fail") {
    return "reject";
  }
  if (checks.insurer_validity?.status === "fail" || checks.product_name_present?.status === "fail") {
    return hardFailCount >= 2 ? "reject" : "manual_review";
  }
  if (duplicatePair) return ROUTE_AI_REVIEW;
  if (validationScore >= 75 && hardFailCount === 0) return "auto_save";
  if (validationScore >= 50) return ROUTE_AI_REVIEW;
  if (flags.includes("DOC_OVER_SPLIT")) return "manual_review";
  return "manual_review";
}

function routeDocument(candidateResults, documentScore, flags) {
  if (!candidateResults.length) return "manual_review";
  if (flags.includes("DOC_OVER_SPLIT") && !candidateResults.some((item) => item.route === "auto_save")) {
    return "manual_review";
  }
  const routes = candidateResults.map((item) => item.route);
  if (routes.every((route) => route === "auto_save") && documentScore >= 70) return "auto_save";
  if (routes.some((route) => route === ROUTE_AI_REVIEW)) return ROUTE_AI_REVIEW;
  if (routes.every((route) => route === "reject")) return "manual_review";
  if (routes.some((route) => route === "auto_save") && routes.some((route) => route !== "auto_save")) {
    return ROUTE_AI_REVIEW;
  }
  return "manual_review";
}

function validateCandidate(candidate, context) {
  const fields = candidate.fields ?? {};
  const riders = candidate.riders ?? [];
  const blockText = getBlockText(candidate, context.segmentation);
  const insurer = resolveCarrier(fields.insurer_name);

  const checks = {
    insurer_validity: {
      status: insurer.status,
      points: insurer.points,
      evidence: insurer.normalized,
    },
    product_name_present: checkProductName(fields.product_name, insurer.normalized),
    premium_present_range: checkPremium(fields.monthly_premium, context.documentType),
    policy_number_present: checkPolicyNumber(fields.policy_number),
    riders_present: checkRiders(riders, fields, blockText),
    over_split_suspect: checkOverSplit(blockText, fields, context.documentFlags),
    under_merge_suspect: checkUnderMerge(context.duplicatePair),
    contaminated_field: checkContamination(fields),
    coverage_amount_range: checkCoverageAmount(fields, riders),
    block_evidence_quality: checkBlockEvidence(blockText),
  };

  let validationScore = 0;
  for (const check of Object.values(checks)) {
    validationScore += check.points ?? 0;
  }
  validationScore = Math.max(0, Math.min(100, validationScore));

  const flags = [];
  if (context.documentFlags.docOverSplit) flags.push("DOC_OVER_SPLIT");
  if (context.duplicatePair) flags.push("UNDER_MERGE_SUSPECT");
  if (checks.premium_present_range.status === "warn" && fields.monthly_premium == null) {
    flags.push("PREMIUM_MISSING");
  }
  if (checks.riders_present.status === "warn" && (riders?.length ?? 0) === 0) {
    flags.push("RIDERS_EMPTY");
  }

  const hardFailCount = countHardFails(checks);
  const route = routeCandidate({ validationScore, hardFailCount, checks, duplicatePair: context.duplicatePair, flags });

  return {
    block_index: candidate.block_index ?? null,
    route,
    validation_score: validationScore,
    confidence: Number((validationScore / 100).toFixed(3)),
    checks,
    flags,
    hard_fail_count: hardFailCount,
  };
}

function validateReviewBlock(block, documentFlags) {
  const blockText = block?.block_text ?? block?.text ?? "";
  const fields = block?.fields ?? {};
  const fragment = isFragmentBlock(blockText, fields) || block?.reason === "missing_policy_identity";

  return {
    block_index: block?.block_index ?? null,
    route: fragment || documentFlags.docOverSplit ? "reject" : "manual_review",
    validation_score: 0,
    confidence: 0,
    checks: {
      over_split_suspect: {
        status: "fail",
        points: 0,
        evidence: blockText,
      },
    },
    flags: documentFlags.docOverSplit ? ["DOC_OVER_SPLIT"] : [],
    hard_fail_count: 1,
    source: "review_block",
  };
}

/**
 * Validate multi-policy extraction output before persistence.
 */
export function validatePolicyExtraction({
  ocrText = "",
  multiExtraction = {},
  segmentation = null,
  documentMeta = {},
} = {}) {
  const documentType = inferDocumentType(ocrText, documentMeta);
  const docOverSplit = detectDocumentOverSplit(multiExtraction);
  const documentFlags = { docOverSplit };
  const policies = multiExtraction.policies ?? [];

  const policyCandidates = policies.map((candidate, index) =>
    validateCandidate(candidate, {
      segmentation,
      documentType,
      documentFlags,
      duplicatePair: findDuplicatePairIndex(policies, index),
    }),
  );

  const reviewBlockCandidates = (multiExtraction.review_blocks ?? []).map((block) =>
    validateReviewBlock(block, documentFlags),
  );

  const candidates = [...policyCandidates, ...reviewBlockCandidates];

  let documentScore =
    candidates.length > 0
      ? Math.round(candidates.reduce((sum, item) => sum + item.validation_score, 0) / candidates.length)
      : 0;

  if (docOverSplit) documentScore = Math.max(0, documentScore - 15);
  if (candidates.some((item) => item.flags.includes("UNDER_MERGE_SUSPECT"))) {
    documentScore = Math.max(0, documentScore - 10);
  }

  const flags = [];
  if (docOverSplit) flags.push("DOC_OVER_SPLIT");

  const documentRoute = routeDocument(candidates, documentScore, flags);
  const summary = {
    auto_save_count: candidates.filter((item) => item.route === "auto_save").length,
    [`${ROUTE_AI_REVIEW}_count`]: candidates.filter((item) => item.route === ROUTE_AI_REVIEW).length,
    manual_review_count: candidates.filter((item) => item.route === "manual_review").length,
    reject_count: candidates.filter((item) => item.route === "reject").length,
  };

  return {
    validator_version: VALIDATOR_VERSION,
    document_type: documentType,
    document_route: documentRoute,
    document_score: documentScore,
    flags,
    candidates,
    review_blocks: multiExtraction.review_blocks ?? [],
    summary,
    pure_validation_only: true,
  };
}
