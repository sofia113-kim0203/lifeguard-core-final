/**
 * OCR text → structured insurance policy fields (regex/heuristic, no LLM/mock).
 */

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

const COVERAGE_RULES = [
  { pattern: /실손의료비|실손\s*의료|실손보험|실손의료/, category: "실손", policy_type: "indemnity_medical" },
  { pattern: /암진단비|암\s*진단|암보험|암\s*보장/, category: "암", policy_type: "cancer" },
  { pattern: /뇌졸중|뇌혈관|뇌\s*진단|뇌경색/, category: "뇌", policy_type: "brain" },
  { pattern: /심장|심근경색|허혈성\s*심장/, category: "심장", policy_type: "heart" },
  { pattern: /수술비|수술\s*특약|수술\s*보장/, category: "수술", policy_type: "surgery" },
  { pattern: /입원일당|입원\s*특약|입원\s*보장|입원비/, category: "입원", policy_type: "hospitalization" },
  { pattern: /운전자|자동차\s*상해|교통상해/, category: "운전자", policy_type: "driver" },
];

const NEXT_LABEL =
  "(?=\\s*(?:상품명|보험상품|증권명|계약자|피보험자|월\\s*보험료|월납|보험료|납입기간|납기|보험기간|보장기간|가입금액|보장금액|특약|특약명|보장명|주계약)\\s*[:：]|$)";

const LABEL_RULES = [
  {
    field: "insurer_name",
    patterns: [
      new RegExp(`보험사\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`보험회사\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "product_name",
    patterns: [
      new RegExp(`상품명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`보험상품\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`증권명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  { field: "policyholder", patterns: [new RegExp(`계약자\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i")] },
  {
    field: "insured",
    patterns: [
      new RegExp(`피보험자\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`被保險者\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "monthly_premium",
    patterns: [
      /월\s*보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /월납\s*[:：]?\s*([0-9,]+)\s*원?/i,
      new RegExp(`보험료\\s*[:：]?\\s*([0-9,]+)\\s*원?${NEXT_LABEL}`, "i"),
    ],
    numeric: true,
  },
  {
    field: "payment_period",
    patterns: [
      new RegExp(`납입기간\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`납기\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "insurance_period",
    patterns: [
      new RegExp(`보험기간\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`보장기간\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "coverage_amount",
    patterns: [
      /가입금액\s*[:：]?\s*([0-9,]+)\s*(만원|억원|원)?/i,
      /보장금액\s*[:：]?\s*([0-9,]+)\s*(만원|억원|원)?/i,
    ],
    amount: true,
  },
  {
    field: "coverage_name",
    patterns: [
      new RegExp(`보장명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`주계약\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "rider_name",
    patterns: [
      new RegExp(`특약\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`특약명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
];

function cleanValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-·\s]+/, "")
    .trim();
}

function parseNumericAmount(raw, unit = "") {
  const digits = String(raw ?? "").replace(/,/g, "").trim();
  if (!digits || !/^\d+$/.test(digits)) return null;
  let amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  const normalizedUnit = String(unit ?? "").trim();
  if (normalizedUnit.includes("억")) amount *= 100_000_000;
  else if (normalizedUnit.includes("만")) amount *= 10_000;
  return amount;
}

export function normalizeOcrTextVariants(text) {
  const raw = String(text ?? "").trim();
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const collapsed = joined.replace(/\s+/g, "");
  return { raw, lines, joined, collapsed };
}

function matchLabelField(variants, rule) {
  const sources = [variants.joined, variants.raw, variants.collapsed];
  for (const source of sources) {
    for (const pattern of rule.patterns) {
      const match = source.match(pattern);
      if (!match?.[1]) continue;
      if (rule.numeric) {
        const amount = parseNumericAmount(match[1]);
        if (amount != null) return amount;
      }
      if (rule.amount) {
        const amount = parseNumericAmount(match[1], match[2]);
        if (amount != null) return amount;
      }
      const cleaned = cleanValue(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function detectCarrier(variants) {
  const sources = [variants.joined, variants.collapsed, variants.raw];
  for (const source of sources) {
    for (const carrier of KNOWN_CARRIERS) {
      if (source.includes(carrier.replace(/\s+/g, "")) || source.includes(carrier)) {
        return carrier;
      }
    }
  }
  return null;
}

function detectCoverageCategories(variants) {
  const source = variants.joined;
  const categories = [];
  const coverages = [];
  let primaryPolicyType = null;

  for (const rule of COVERAGE_RULES) {
    if (!rule.pattern.test(source)) continue;
    if (!categories.includes(rule.category)) categories.push(rule.category);
    coverages.push(rule.category);
    if (!primaryPolicyType) primaryPolicyType = rule.policy_type;
  }

  return { categories, coverages, primaryPolicyType };
}

function countPresentFields(extracted) {
  let count = 0;
  if (extracted.insurer_name) count += 1;
  if (extracted.product_name) count += 1;
  if (extracted.policyholder) count += 1;
  if (extracted.insured) count += 1;
  if (extracted.monthly_premium != null) count += 1;
  if (extracted.payment_period) count += 1;
  if (extracted.insurance_period) count += 1;
  if (extracted.coverage_name) count += 1;
  if (extracted.rider_name) count += 1;
  if (extracted.coverage_amount != null) count += 1;
  if (extracted.coverage_categories?.length) count += 1;
  return count;
}

export function extractPolicyFieldsFromOcrText(ocrText) {
  const variants = normalizeOcrTextVariants(ocrText);
  const fields = {};

  for (const rule of LABEL_RULES) {
    const value = matchLabelField(variants, rule);
    if (value != null && value !== "") fields[rule.field] = value;
  }

  if (!fields.insurer_name) {
    const carrier = detectCarrier(variants);
    if (carrier) fields.insurer_name = carrier;
  }

  const coverage = detectCoverageCategories(variants);
  fields.coverage_categories = coverage.categories;
  fields.detected_coverages = coverage.coverages;
  fields.policy_type = coverage.primaryPolicyType;

  const fieldCount = countPresentFields(fields);
  const confidence = Math.min(1, Number((fieldCount / 6).toFixed(3)));
  const success = fieldCount >= 2;

  return {
    success,
    confidence,
    field_count: fieldCount,
    fields: {
      insurer_name: fields.insurer_name ?? null,
      product_name: fields.product_name ?? null,
      policyholder: fields.policyholder ?? null,
      insured: fields.insured ?? null,
      monthly_premium: fields.monthly_premium ?? null,
      payment_period: fields.payment_period ?? null,
      insurance_period: fields.insurance_period ?? null,
      coverage_name: fields.coverage_name ?? null,
      rider_name: fields.rider_name ?? null,
      coverage_amount: fields.coverage_amount ?? null,
      coverage_categories: fields.coverage_categories ?? [],
      policy_type: fields.policy_type ?? null,
    },
    ocr_text_length: variants.raw.length,
  };
}
