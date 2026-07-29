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

const PRODUCT_KEYWORDS = [
  { pattern: /실손의료비|실손\s*의료|실손보험|실손의료/, label: "실손의료비보험", policy_type: "indemnity_medical" },
  { pattern: /종신보험|종신\s*보험/, label: "종신보험", policy_type: "whole_life" },
  { pattern: /암보험|암\s*보험|암진단/, label: "암보험", policy_type: "cancer" },
  { pattern: /건강보험|건강\s*보험/, label: "건강보험", policy_type: "health" },
  { pattern: /연금보험|연금\s*보험/, label: "연금보험", policy_type: "annuity" },
  { pattern: /운전자보험|운전자\s*보험/, label: "운전자보험", policy_type: "driver" },
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
  "(?=\\s*(?:상품명|보험상품|증권명|계약자|피보험자|수익자|보험수익자|지정수익자|사망보험금\\s*수익자|만기보험금\\s*수익자|보험료\\s*납입자|납입의무자|실제\\s*납입자|보험료\\s*부담자|월\\s*보험료|월보험료|월납|보험료|연\\s*보험료|합계\\s*보험료|납입기간|납기|보험기간|보장기간|가입일|계약일|보장개시|가입금액|보장금액|특약|특약명|보장명|주계약|담보|배서|효력발생일|변경일)\\s*[:：]|$)";

const REVIEW_TARGET_FIELDS = [
  "insurer_name",
  "product_name",
  "policyholder",
  "insured",
  "monthly_premium",
  "effective_from",
  "coverage_name",
  "coverage_amount",
];

export const POLICY_FIELD_LABELS = {
  insurer_name: "보험사",
  product_name: "상품명",
  policyholder: "계약자",
  insured: "피보험자",
  monthly_premium: "보험료",
  effective_from: "가입일",
  coverage_name: "담보/보장명",
  coverage_amount: "보장금액",
};

const LABEL_RULES = [
  {
    field: "insurer_name",
    patterns: [
      new RegExp(`보험사\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`보험회사\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      /보험사\s*[:：]?\s*([가-힣A-Za-z0-9]+(?:생명|화재|손해|라이프|해상))/i,
    ],
  },
  {
    field: "product_name",
    patterns: [
      new RegExp(`상품명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`보험상품\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`증권명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`담보\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "policyholder",
    patterns: [
      new RegExp(`계약자\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      /계약자\s*[:：]?\s*([가-힣]{2,6})/,
    ],
  },
  {
    field: "insured",
    patterns: [
      new RegExp(`피보험자\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`被保險者\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      /피보험자\s*[:：]?\s*([가-힣]{2,6})/,
    ],
  },
  {
    field: "monthly_premium",
    patterns: [
      /월\s*보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /월보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /월납\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /연\s*보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /합계\s*보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
      /납입\s*보험료\s*[:：]?\s*([0-9,]+)\s*원?/i,
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
      /담보금액\s*[:：]?\s*([0-9,]+)\s*(만원|억원|원)?/i,
    ],
    amount: true,
  },
  {
    field: "coverage_name",
    patterns: [
      new RegExp(`보장명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`주계약\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`담보\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "rider_name",
    patterns: [
      new RegExp(`특약\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
      new RegExp(`특약명\\s*[:：]?\\s*([^\\n]+?)${NEXT_LABEL}`, "i"),
    ],
  },
  {
    field: "effective_from",
    patterns: [
      /가입일\s*[:：]?\s*(\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)/i,
      /계약일\s*[:：]?\s*(\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)/i,
      /보장개시\s*[:：]?\s*(\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)/i,
    ],
    date: true,
  },
  {
    field: "policy_number",
    patterns: [
      /증권번호\s*[:：]?\s*([0-9A-Z\-]{6,})/i,
      /계약번호\s*[:：]?\s*([0-9A-Z\-]{6,})/i,
      /증번\s*[:：]?\s*([0-9A-Z\-]{6,})/i,
    ],
  },
];

const BLOCK_HEADER_PATTERNS = [/보장분석/, /보험증권/, /가입보험\s*현황/, /보험\s*가입\s*내역/];
const POLICY_NUMBER_LINE_PATTERN = /증권번호|계약번호|증번/;

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

function parseDateValue(raw) {
  const cleaned = String(raw ?? "")
    .replace(/년/g, "-")
    .replace(/월/g, "-")
    .replace(/일/g, "")
    .replace(/[.\s/]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const month = String(match[2]).padStart(2, "0");
  const day = String(match[3]).padStart(2, "0");
  return `${match[1]}-${month}-${day}`;
}

export function normalizeOcrTextVariants(text) {
  const raw = String(text ?? "").trim();
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const collapsed = joined.replace(/\s+/g, "");
  return { raw, lines, joined, collapsed };
}

function matchLabelField(variants, rule) {
  const sources = [variants.joined, variants.raw, ...variants.lines, variants.collapsed];
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
      if (rule.date) {
        const date = parseDateValue(match[1]);
        if (date) return date;
      }
      const cleaned = cleanValue(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function detectCarrier(variants) {
  for (const line of variants.lines) {
    for (const carrier of KNOWN_CARRIERS) {
      const compact = carrier.replace(/\s+/g, "");
      if (line.includes(carrier) || line.replace(/\s+/g, "").includes(compact)) {
        return carrier;
      }
    }
  }

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

function detectProductFromLines(variants) {
  for (const line of variants.lines) {
    for (const rule of PRODUCT_KEYWORDS) {
      if (!rule.pattern.test(line)) continue;
      const cleaned = cleanValue(line);
      if (cleaned.length >= 3) return cleaned;
      return rule.label;
    }
  }

  for (const rule of PRODUCT_KEYWORDS) {
    if (rule.pattern.test(variants.joined)) return rule.label;
  }
  return null;
}

function detectPremiumFromLines(variants) {
  for (const line of variants.lines) {
    if (!/보험료|월납|납입액|합계/.test(line)) continue;
    const match = line.match(/([0-9,]{3,})\s*원?/);
    if (!match?.[1]) continue;
    const amount = parseNumericAmount(match[1]);
    if (amount != null && amount >= 1000) return amount;
  }
  return null;
}

function detectNamesFromLines(variants) {
  const result = {};
  for (const line of variants.lines) {
    if (!result.policyholder) {
      const holder = line.match(/계약자\s*[:：]?\s*([가-힣]{2,6})(?:\s|$)/);
      if (holder?.[1]) result.policyholder = cleanValue(holder[1]);
    }
    if (!result.insured) {
      const insured = line.match(/피보험자\s*[:：]?\s*([가-힣]{2,6})(?:\s|$)/);
      if (insured?.[1]) result.insured = cleanValue(insured[1]);
    }
  }
  return result;
}

function parseShareLiteral(raw) {
  const s = String(raw ?? "");
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct?.[1]) return `${pct[1]}%`;
  const labeled = s.match(/지분\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/);
  if (labeled?.[1]) return `${labeled[1]}%`;
  return null;
}

function classifyBeneficiaryType(labelText = "") {
  const t = String(labelText ?? "");
  if (/사망/.test(t)) return "death_benefit";
  if (/만기/.test(t)) return "maturity_benefit";
  if (/입원/.test(t)) return "hospitalization_benefit";
  if (/지정/.test(t)) return "designated";
  return "beneficiary";
}

/** Evidence-backed funder labels only — 납입의무자 is contractual duty (= policyholder), not funder. */
function isActualPremiumFunderEvidenceLabel(labelText = "") {
  const t = String(labelText ?? "").replace(/\s+/g, "");
  if (/납입의무자/.test(t)) return false;
  return /실제납입자|보험료부담자|보험료납입자/.test(t);
}

function splitPartyNameList(raw) {
  return String(raw ?? "")
    .split(/\s*(?:,|\/|·|&|및)\s*/)
    .map((x) => cleanValue(x))
    .filter(Boolean)
    .map((name) => name.replace(/\([^)]*\)/g, "").replace(/\d+(?:\.\d+)?\s*%/g, "").trim())
    .filter(Boolean);
}

function splitBeneficiaryEntries(rest, type, source_line) {
  const text = String(rest ?? "").trim();
  if (!text) return [];
  // Prefer "이름 60%, 이름 40%" style pairs.
  const pairRe = /([가-힣A-Za-z0-9·.]{2,40}?)\s*(\d+(?:\.\d+)?)\s*%/g;
  const pairs = [];
  let m;
  while ((m = pairRe.exec(text)) !== null) {
    const name = cleanValue(m[1]);
    if (!name) continue;
    pairs.push({
      name,
      beneficiary_type: type,
      share: `${m[2]}%`,
      source_line,
    });
  }
  if (pairs.length > 0) return pairs;

  const share = parseShareLiteral(text);
  const names = splitPartyNameList(text);
  return names.map((name) => ({
    name,
    beneficiary_type: type,
    share,
    source_line,
  }));
}

function namesEqualParty(a, b) {
  const x = String(a ?? "").replace(/\s+/g, "");
  const y = String(b ?? "").replace(/\s+/g, "");
  if (!x || !y) return false;
  return x === y;
}

/**
 * Slice 8.1 — standard parties: policyholder / insured / beneficiaries (+ party_changes).
 * actual_premium_funder is optional tax evidence only when OCR shows a distinct funder.
 * Never invents funder from policyholder; never creates unknown payer objects.
 */
export function extractPartyStructuresFromBlock(blockText, { policyholder = null } = {}) {
  const variants = normalizeOcrTextVariants(blockText);
  const beneficiaries = [];
  const party_changes = [];
  const seenBen = new Set();
  let actual_premium_funder = null;

  const pushBeneficiary = (entry) => {
    const name = cleanValue(entry?.name);
    if (!name) return;
    const key = `${entry.beneficiary_type ?? ""}|${name}|${entry.share ?? ""}`;
    if (seenBen.has(key)) return;
    seenBen.add(key);
    beneficiaries.push({
      name,
      beneficiary_type: entry.beneficiary_type ?? "beneficiary",
      share: entry.share ?? null,
      effective_from: entry.effective_from ?? null,
      evidence_state: "verified",
      provenance: {
        source_line: entry.source_line ?? null,
      },
    });
  };

  for (const line of variants.lines) {
    const ben =
      line.match(
        /((?:사망보험금|만기보험금|입원)?\s*(?:지정)?(?:보험)?수익자)\s*[:：]?\s*(.+)$/i,
      ) || line.match(/(수익자)\s*[:：]?\s*(.+)$/i);
    if (ben) {
      const label = ben[1];
      const rest = ben[2];
      const type = classifyBeneficiaryType(label);
      for (const entry of splitBeneficiaryEntries(rest, type, line)) {
        pushBeneficiary(entry);
      }
    }

    // Optional tax fact — only evidence-backed funder labels, never 납입의무자.
    const funderMatch = line.match(
      /((?:실제\s*납입자|보험료\s*부담자|보험료\s*납입자))\s*[:：]?\s*(.+)$/i,
    );
    if (funderMatch && isActualPremiumFunderEvidenceLabel(funderMatch[1]) && !actual_premium_funder) {
      const names = splitPartyNameList(funderMatch[2]);
      const name = names[0] ?? null;
      // Distinct from policyholder only — do not clone policyholder as funder.
      if (name && !namesEqualParty(name, policyholder)) {
        actual_premium_funder = {
          name,
          evidence_state: "verified",
          provenance: {
            source_line: line,
            source_label: cleanValue(funderMatch[1]),
          },
        };
      }
    }

    const change = line.match(
      /(계약자|피보험자|수익자|보험료\s*납입자|실제\s*납입자|보험료\s*부담자)\s*변경\s*[:：]?\s*(.+?)\s*(?:→|->|⇒)\s*(.+?)(?:\s*$|\s+효력)/i,
    );
    if (change) {
      const roleRaw = cleanValue(change[1]);
      const party_role =
        /수익자/.test(roleRaw)
          ? "beneficiary"
          : /피보험자/.test(roleRaw)
            ? "insured"
            : /납입|부담/.test(roleRaw)
              ? "actual_premium_funder"
              : "policyholder";
      const effective =
        line.match(/효력(?:발생)?일\s*[:：]?\s*([0-9]{4}[.\-/년\s]*[0-9]{1,2}[.\-/월\s]*[0-9]{1,2}일?)/)?.[1] ??
        null;
      party_changes.push({
        party_role,
        previous_value: cleanValue(change[2]),
        new_value: cleanValue(change[3]),
        effective_date: effective ? cleanValue(effective) : null,
        evidence_state: "verified",
        provenance: { source_line: line },
      });
    }

    const endorsement = line.match(/배서\s*[:：]?\s*(.+)$/i);
    if (endorsement && /변경|수익자|계약자|납입|부담/.test(endorsement[1])) {
      const effective =
        line.match(/효력(?:발생)?일\s*[:：]?\s*([0-9]{4}[.\-/년\s]*[0-9]{1,2}[.\-/월\s]*[0-9]{1,2}일?)/)?.[1] ??
        variants.lines
          .map((l) =>
            l.match(/효력(?:발생)?일\s*[:：]?\s*([0-9]{4}[.\-/년\s]*[0-9]{1,2}[.\-/월\s]*[0-9]{1,2}일?)/)?.[1],
          )
          .find(Boolean) ??
        null;
      party_changes.push({
        party_role: /수익자/.test(endorsement[1])
          ? "beneficiary"
          : /납입|부담/.test(endorsement[1])
            ? "actual_premium_funder"
            : /피보험자/.test(endorsement[1])
              ? "insured"
              : "policyholder",
        previous_value: null,
        new_value: cleanValue(endorsement[1]),
        effective_date: effective ? cleanValue(effective) : null,
        evidence_state: "verified",
        provenance: { source_line: line },
      });
    }
  }

  // Standalone effective date line attaches to last change missing date.
  if (party_changes.length) {
    const dateLine = variants.lines
      .map((l) =>
        l.match(/효력(?:발생)?일\s*[:：]?\s*([0-9]{4}[.\-/년\s]*[0-9]{1,2}[.\-/월\s]*[0-9]{1,2}일?)/)?.[1],
      )
      .find(Boolean);
    if (dateLine) {
      for (const ch of party_changes) {
        if (!ch.effective_date) ch.effective_date = cleanValue(dateLine);
      }
    }
  }

  return { beneficiaries, actual_premium_funder, party_changes };
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

  for (const rule of PRODUCT_KEYWORDS) {
    if (!rule.pattern.test(source)) continue;
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
  if (extracted.effective_from) count += 1;
  if (extracted.policy_number) count += 1;
  if (extracted.coverage_categories?.length) count += 1;
  return count;
}

function hasIdentityAnchor(fields) {
  return Boolean(fields.insurer_name || fields.product_name || fields.coverage_name);
}

export function getMissingPolicyFields(fields = {}) {
  return REVIEW_TARGET_FIELDS.filter((field) => {
    if (field === "monthly_premium" || field === "coverage_amount") {
      return fields[field] == null;
    }
    return !fields[field];
  }).map((field) => POLICY_FIELD_LABELS[field] ?? field);
}

export function classifyPolicyExtractionOutcome(fields, fieldCount) {
  const identity = hasIdentityAnchor(fields);
  const success = fieldCount >= 2;
  const tier = success
    ? fieldCount >= 4 || (fields.insurer_name && fields.product_name)
      ? "full"
      : "minimal"
    : "review";
  return {
    success,
    minimal_eligible: success && tier === "minimal",
    tier,
    requires_manual_review: !success,
    has_identity_anchor: identity,
  };
}

export function buildOcrSnippet(ocrText, maxLength = 800) {
  const raw = String(ocrText ?? "").trim();
  if (!raw) return "";
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}…`;
}

export function isPolicyExtractionRetryEligible({ ingestStatus, metadataJson } = {}) {
  if (ingestStatus !== "ready") return false;
  const status = metadataJson?.policy_extraction_status ?? null;
  if (!status) return true;
  return status === "extraction_failed" || status === "pending_manual_review";
}

function detectCarrierOnLine(line) {
  for (const carrier of KNOWN_CARRIERS) {
    const compact = carrier.replace(/\s+/g, "");
    if (line.includes(carrier) || line.replace(/\s+/g, "").includes(compact)) {
      return carrier;
    }
  }
  return null;
}

function detectProductKeywordOnLine(line) {
  for (const rule of PRODUCT_KEYWORDS) {
    if (!rule.pattern.test(line)) continue;
    const cleaned = cleanValue(line);
    if (cleaned.length >= 3) return cleaned;
    return rule.label;
  }
  return null;
}

function isBlockHeaderLine(line) {
  return BLOCK_HEADER_PATTERNS.some((pattern) => pattern.test(line));
}

function classifyBlockSplitAnchor(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return null;

  if (POLICY_NUMBER_LINE_PATTERN.test(cleaned)) {
    return { type: "policy_number", line: cleaned };
  }

  const carrier = detectCarrierOnLine(cleaned);
  if (carrier && (cleaned === carrier || /^보험사\s*[:：]?/.test(cleaned))) {
    return { type: "carrier", line: cleaned, carrier };
  }

  if (/^상품명\s*[:：]|^증권명\s*[:：]|^보험상품\s*[:：]/i.test(cleaned)) {
    return { type: "product_label", line: cleaned };
  }

  return null;
}

function collectBlockSplitIndices(lines) {
  const carrierSplits = [];
  const productLabelSplits = [];
  const policyNumberSplits = [];
  let carrierSeen = 0;
  let productLabelSeen = 0;
  let policyNumberSeen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const anchor = classifyBlockSplitAnchor(lines[index]);
    if (!anchor) continue;

    if (anchor.type === "carrier") {
      if (carrierSeen > 0) carrierSplits.push({ index, anchor });
      carrierSeen += 1;
      continue;
    }

    if (anchor.type === "product_label") {
      if (productLabelSeen > 0) productLabelSplits.push({ index, anchor });
      productLabelSeen += 1;
      continue;
    }

    if (anchor.type === "policy_number") {
      if (policyNumberSeen > 0) policyNumberSplits.push({ index, anchor });
      policyNumberSeen += 1;
    }
  }

  if (carrierSplits.length) return carrierSplits;
  if (productLabelSplits.length) return productLabelSplits;
  return policyNumberSplits;
}

function findFirstBlockStart(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (classifyBlockSplitAnchor(lines[index])) return index;
  }
  return 0;
}

function buildBlockText(lines, start, end) {
  return lines.slice(start, end).join("\n").trim();
}

/**
 * Split OCR lines into policy block candidates using repeated insurer/product/premium anchors.
 */
export function segmentOcrIntoPolicyBlocks(ocrText) {
  const variants = normalizeOcrTextVariants(ocrText);
  const lines = variants.lines;
  if (!lines.length) {
    return { blocks: [], blocks_detected: 0, header_lines: [] };
  }

  const splitIndices = collectBlockSplitIndices(lines);
  const headerEnd = (() => {
    let end = 0;
    while (end < lines.length && (isBlockHeaderLine(lines[end]) || lines[end].length <= 2)) {
      end += 1;
    }
    return end;
  })();
  const headerLines = lines.slice(0, headerEnd);

  if (!splitIndices.length) {
    const start = Math.min(findFirstBlockStart(lines), headerEnd > 0 ? 0 : findFirstBlockStart(lines));
    const firstAnchor = classifyBlockSplitAnchor(lines[findFirstBlockStart(lines)] ?? "");
    return {
      blocks: [
        {
          block_index: 0,
          start_line: start,
          end_line: lines.length,
          text: variants.raw,
          anchor_type: firstAnchor?.type ?? "single",
          anchor_line: lines[findFirstBlockStart(lines)] ?? lines[0] ?? null,
        },
      ],
      blocks_detected: 1,
      header_lines: headerLines,
    };
  }

  const boundaries = [findFirstBlockStart(lines), ...splitIndices.map((entry) => entry.index), lines.length];
  const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
  const blocks = [];

  for (let i = 0; i < uniqueBoundaries.length - 1; i += 1) {
    const start = uniqueBoundaries[i];
    const end = uniqueBoundaries[i + 1];
    if (start >= end) continue;
    const blockLines = [...(start === uniqueBoundaries[0] ? headerLines : []), ...lines.slice(start, end)];
    const text = buildBlockText(blockLines, 0, blockLines.length);
    if (!text) continue;
    const anchor = classifyBlockSplitAnchor(lines[start]);
    blocks.push({
      block_index: blocks.length,
      start_line: start,
      end_line: end,
      text,
      anchor_type: anchor?.type ?? "section",
      anchor_line: lines[start] ?? null,
    });
  }

  return {
    blocks,
    blocks_detected: blocks.length,
    header_lines: headerLines,
  };
}

function detectRiderCategory(name) {
  const source = cleanValue(name);
  for (const rule of COVERAGE_RULES) {
    if (rule.pattern.test(source)) return rule.category;
  }
  return null;
}

function buildRiderItem({ rider_name, coverage_amount = null, source_line, notes = null }) {
  const name = cleanValue(rider_name);
  if (!name) return null;
  const category = detectRiderCategory(name);
  let confidence = 0.7;
  if (coverage_amount != null) confidence += 0.1;
  if (category) confidence += 0.1;
  return {
    rider_name: name,
    coverage_amount,
    category,
    notes: notes ?? source_line,
    source_line: cleanValue(source_line),
    confidence: Math.min(1, Number(confidence.toFixed(2))),
  };
}

/**
 * Parse rider/coverage rows from a single policy block (no persistence).
 */
export function extractRidersFromBlock(blockText) {
  const variants = normalizeOcrTextVariants(blockText);
  const riders = [];
  const seen = new Set();

  const pushRider = (item) => {
    if (!item) return;
    const key = `${item.rider_name}::${item.coverage_amount ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    riders.push(item);
  };

  for (const line of variants.lines) {
    const labelMatch = line.match(/특약\s*[:：]?\s*(.+)$/i);
    if (labelMatch?.[1]) {
      const amountMatch = labelMatch[1].match(/(.+?)\s+([0-9,]+)\s*(만원|억원|원)?$/);
      if (amountMatch) {
        pushRider(
          buildRiderItem({
            rider_name: amountMatch[1],
            coverage_amount: parseNumericAmount(amountMatch[2], amountMatch[3]),
            source_line: line,
          }),
        );
        continue;
      }
      pushRider(buildRiderItem({ rider_name: labelMatch[1], source_line: line }));
      continue;
    }

    const coverageLine = line.match(/^(?:담보|보장명|주계약)\s*[:：]?\s*(.+)$/i);
    if (coverageLine?.[1]) {
      const amountMatch = coverageLine[1].match(/(.+?)\s+([0-9,]+)\s*(만원|억원|원)?$/);
      if (amountMatch) {
        pushRider(
          buildRiderItem({
            rider_name: amountMatch[1],
            coverage_amount: parseNumericAmount(amountMatch[2], amountMatch[3]),
            source_line: line,
          }),
        );
      } else {
        pushRider(buildRiderItem({ rider_name: coverageLine[1], source_line: line }));
      }
      continue;
    }

    const tableMatch = line.match(/^([가-힣A-Za-z0-9\s]{2,30})\s+([0-9,]+)\s*(만원|억원|원)$/);
    if (tableMatch && /진단|보장|특약|수술|입원|실손|암|뇌|심장/.test(tableMatch[1])) {
      pushRider(
        buildRiderItem({
          rider_name: tableMatch[1],
          coverage_amount: parseNumericAmount(tableMatch[2], tableMatch[3]),
          source_line: line,
        }),
      );
    }
  }

  return riders;
}

function evaluatePolicyCandidateTier(fields, riders = []) {
  const hasPolicyNumber = Boolean(fields.policy_number);
  const hasInsurer = Boolean(fields.insurer_name);
  const hasProduct = Boolean(fields.product_name);
  const hasPremium = fields.monthly_premium != null;
  const hasPerson = Boolean(fields.policyholder || fields.insured);
  const hasRiderSignal = riders.length > 0 || (fields.coverage_categories?.length ?? 0) > 0;

  if (hasPolicyNumber || (hasInsurer && hasProduct)) return "A";
  if (hasInsurer && (hasPremium || hasPerson)) return "B";
  if (hasProduct && hasPremium && hasRiderSignal) return "C";
  return null;
}

function buildEmptyPolicyExtraction(ocrTextLength = 0) {
  return {
    success: false,
    minimal_eligible: false,
    tier: "review",
    requires_manual_review: true,
    confidence: 0,
    field_count: 0,
    missing_fields: Object.values(POLICY_FIELD_LABELS),
    fields: {
      insurer_name: null,
      product_name: null,
      policyholder: null,
      insured: null,
      beneficiaries: [],
      actual_premium_funder: null,
      party_changes: [],
      monthly_premium: null,
      payment_period: null,
      insurance_period: null,
      coverage_name: null,
      rider_name: null,
      coverage_amount: null,
      effective_from: null,
      policy_number: null,
      coverage_categories: [],
      policy_type: null,
    },
    riders: [],
    ocr_text_length: ocrTextLength,
  };
}

/**
 * Extract structured policy fields from one OCR block.
 */
export function extractPolicyFieldsFromBlock(blockText) {
  const variants = normalizeOcrTextVariants(blockText);
  if (!variants.raw) return buildEmptyPolicyExtraction(0);

  const fields = {};

  for (const rule of LABEL_RULES) {
    const value = matchLabelField(variants, rule);
    if (value != null && value !== "") fields[rule.field] = value;
  }

  if (!fields.insurer_name) {
    const carrier = detectCarrier(variants);
    if (carrier) fields.insurer_name = carrier;
  }

  if (!fields.product_name) {
    const product = detectProductFromLines(variants);
    if (product) fields.product_name = product;
  }

  if (fields.monthly_premium == null) {
    const premium = detectPremiumFromLines(variants);
    if (premium != null) fields.monthly_premium = premium;
  }

  const lineNames = detectNamesFromLines(variants);
  if (lineNames.policyholder) fields.policyholder = lineNames.policyholder;
  if (lineNames.insured) fields.insured = lineNames.insured;

  const partyStructures = extractPartyStructuresFromBlock(blockText, {
    policyholder: fields.policyholder ?? null,
  });
  fields.beneficiaries = partyStructures.beneficiaries;
  fields.actual_premium_funder = partyStructures.actual_premium_funder ?? null;
  fields.party_changes = partyStructures.party_changes;

  const coverage = detectCoverageCategories(variants);
  fields.coverage_categories = coverage.categories;
  fields.detected_coverages = coverage.coverages;
  if (!fields.policy_type) fields.policy_type = coverage.primaryPolicyType;

  const riders = extractRidersFromBlock(blockText);
  if (!fields.rider_name && riders[0]?.rider_name) {
    fields.rider_name = riders[0].rider_name;
  }
  if (fields.coverage_amount == null && riders[0]?.coverage_amount != null) {
    fields.coverage_amount = riders[0].coverage_amount;
  }

  const normalizedFields = {
    insurer_name: fields.insurer_name ?? null,
    product_name: fields.product_name ?? null,
    policyholder: fields.policyholder ?? null,
    insured: fields.insured ?? null,
    beneficiaries: Array.isArray(fields.beneficiaries) ? fields.beneficiaries : [],
    party_changes: Array.isArray(fields.party_changes) ? fields.party_changes : [],
    monthly_premium: fields.monthly_premium ?? null,
    payment_period: fields.payment_period ?? null,
    insurance_period: fields.insurance_period ?? null,
    coverage_name: fields.coverage_name ?? null,
    rider_name: fields.rider_name ?? null,
    coverage_amount: fields.coverage_amount ?? null,
    effective_from: fields.effective_from ?? null,
    policy_number: fields.policy_number ?? null,
    coverage_categories: fields.coverage_categories ?? [],
    policy_type: fields.policy_type ?? null,
  };
  // Optional tax fact only when verified distinct funder exists — omit when absent.
  if (fields.actual_premium_funder && fields.actual_premium_funder.name) {
    normalizedFields.actual_premium_funder = fields.actual_premium_funder;
  }

  const fieldCount = countPresentFields(normalizedFields);
  const candidateTier = evaluatePolicyCandidateTier(normalizedFields, riders);
  const outcome = classifyPolicyExtractionOutcome(normalizedFields, fieldCount);
  const success = Boolean(candidateTier) && outcome.success;
  const tier = candidateTier
    ? candidateTier === "A"
      ? fieldCount >= 4 || (normalizedFields.insurer_name && normalizedFields.product_name)
        ? "full"
        : "minimal"
      : "minimal"
    : "review";
  const confidence = Math.min(1, Number((fieldCount / 6).toFixed(3)));

  return {
    success,
    candidate_tier: candidateTier,
    minimal_eligible: success && tier === "minimal",
    tier,
    requires_manual_review: !success,
    confidence,
    field_count: fieldCount,
    missing_fields: getMissingPolicyFields(normalizedFields),
    fields: normalizedFields,
    riders,
    ocr_text_length: variants.raw.length,
  };
}

/**
 * Multi-policy OCR extraction (parser only — no DB writes).
 */
export function extractPoliciesFromOcrText(ocrText) {
  const variants = normalizeOcrTextVariants(ocrText);
  const segmentation = segmentOcrIntoPolicyBlocks(ocrText);
  const policies = [];
  const review_blocks = [];

  for (const block of segmentation.blocks) {
    const extraction = extractPolicyFieldsFromBlock(block.text);
    const blockResult = {
      block_index: block.block_index,
      start_line: block.start_line,
      end_line: block.end_line,
      anchor_type: block.anchor_type,
      anchor_line: block.anchor_line,
      ...extraction,
    };

    if (extraction.success && extraction.candidate_tier) {
      policies.push(blockResult);
    } else {
      review_blocks.push({
        block_index: block.block_index,
        start_line: block.start_line,
        end_line: block.end_line,
        anchor_type: block.anchor_type,
        anchor_line: block.anchor_line,
        reason: extraction.candidate_tier ? "insufficient_policy_fields" : "missing_policy_identity",
        missing_fields: extraction.missing_fields,
        field_count: extraction.field_count,
        fields: extraction.fields,
        riders: extraction.riders,
        text_snippet: buildOcrSnippet(block.text, 400),
      });
    }
  }

  if (!segmentation.blocks.length && variants.raw) {
    const extraction = extractPolicyFieldsFromBlock(variants.raw);
    if (extraction.success && extraction.candidate_tier) {
      policies.push({ block_index: 0, start_line: 0, end_line: variants.lines.length, ...extraction });
    } else {
      review_blocks.push({
        block_index: 0,
        reason: "insufficient_policy_fields",
        missing_fields: extraction.missing_fields,
        field_count: extraction.field_count,
        fields: extraction.fields,
        riders: extraction.riders,
        text_snippet: buildOcrSnippet(variants.raw, 400),
      });
    }
  }

  return {
    success: policies.length > 0,
    policy_count: policies.length,
    policies,
    blocks_detected: segmentation.blocks_detected,
    blocks_rejected: review_blocks.length,
    review_blocks,
    requires_manual_review: policies.length === 0,
    ocr_text_length: variants.raw.length,
  };
}

export function extractPolicyFieldsFromOcrText(ocrText) {
  const extraction = extractPolicyFieldsFromBlock(ocrText);
  const { riders, candidate_tier, ...legacy } = extraction;
  return legacy;
}
