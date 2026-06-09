/**
 * Structured insurance field extraction from OCR text (Korean policy / coverage analysis documents).
 * No LLM — regex and insurer catalog only.
 */

export const KOREAN_INSURERS = [
  { pattern: /KB손해보험|KB손해/g, name: "KB손해보험" },
  { pattern: /삼성화재(?:해상)?(?:보험)?/g, name: "삼성화재" },
  { pattern: /현대해상(?:화재)?(?:보험)?/g, name: "현대해상" },
  { pattern: /DB손해보험|DB손보/g, name: "DB손해보험" },
  { pattern: /한화손해보험/g, name: "한화손해보험" },
  { pattern: /한화생명(?:보험)?/g, name: "한화생명" },
  { pattern: /메리츠화재(?:보험)?|메리츠(?:화재)?/g, name: "메리츠화재" },
  { pattern: /NH농협생명/g, name: "NH농협생명" },
  { pattern: /NH농협손해보험/g, name: "NH농협손해보험" },
  { pattern: /교보생명/g, name: "교보생명" },
  { pattern: /신한생명/g, name: "신한생명" },
  { pattern: /삼성생명/g, name: "삼성생명" },
  { pattern: /흥국생명/g, name: "흥국생명" },
  { pattern: /미래에셋생명/g, name: "미래에셋생명" },
  { pattern: /AIA생명/g, name: "AIA생명" },
  { pattern: /라이나생명/g, name: "라이나생명" },
  { pattern: /동양생명/g, name: "동양생명" },
  { pattern: /푸본현대생명/g, name: "푸본현대생명" },
  { pattern: /MG손해보험/g, name: "MG손해보험" },
  { pattern: /롯데손해보험/g, name: "롯데손해보험" },
  { pattern: /하나손해보험/g, name: "하나손해보험" },
  { pattern: /AXA손해보험/g, name: "AXA손해보험" },
];

const COVERAGE_CATEGORY_PATTERNS = [
  { pattern: /실손(?:의료비)?(?:보험)?/i, category: "실손의료비", policy_type: "indemnity" },
  { pattern: /암(?:진단|보험|치료)?/i, category: "암보장", policy_type: "cancer" },
  { pattern: /운전자(?:상해)?(?:보험)?/i, category: "운전자", policy_type: "auto" },
  { pattern: /건강보험/i, category: "건강보험", policy_type: "health" },
  { pattern: /종신(?:보험)?/i, category: "종신", policy_type: "whole_life" },
  { pattern: /연금(?:보험)?/i, category: "연금", policy_type: "annuity" },
  { pattern: /상해(?:보험)?/i, category: "상해", policy_type: "accident" },
  { pattern: /치아(?:보험)?/i, category: "치아", policy_type: "dental" },
  { pattern: /간병(?:보험)?/i, category: "간병", policy_type: "care" },
];

const PRODUCT_LINE_PATTERN =
  /(?:간편(?:가입)?|무배당|뉴|더\s*)?[\w가-힣()ⅡⅢ0-9./\-]{3,60}?(?:보험|실손|플랜|상해)(?:\([^)]{0,30}\))?[\w가-힣()ⅡⅢ0-9./\-]{0,30}/g;

const PREMIUM_PATTERN = /(\d{1,3}(?:,\d{3})+)\s*원/g;

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeInsurerName(name) {
  return String(name ?? "").replace(/\s+/g, "").trim();
}

function normalizeProductName(name) {
  return normalizeWhitespace(name).replace(/\s+/g, " ").slice(0, 120);
}

function detectInsurerInText(text) {
  const found = [];
  for (const entry of KOREAN_INSURERS) {
    const re = new RegExp(entry.pattern.source, entry.pattern.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      found.push({ name: entry.name, index: match.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

function detectCoverageCategories(text) {
  const categories = [];
  for (const entry of COVERAGE_CATEGORY_PATTERNS) {
    if (entry.pattern.test(text)) categories.push(entry.category);
  }
  return Array.from(new Set(categories));
}

function inferPolicyType(text) {
  for (const entry of COVERAGE_CATEGORY_PATTERNS) {
    if (entry.pattern.test(text)) return entry.policy_type;
  }
  return null;
}

function parsePremiumAmount(match) {
  const digits = String(match ?? "").replace(/[^\d]/g, "");
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isCoverageAnalysisDocument(text) {
  return /가입현황|보장분석|기준담보/.test(text);
}

function extractAllPremiums(text) {
  const premiums = [];
  const re = new RegExp(PREMIUM_PATTERN.source, PREMIUM_PATTERN.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const amount = parsePremiumAmount(match[1]);
    if (amount && amount >= 5_000 && amount <= 5_000_000) premiums.push(amount);
  }
  return premiums;
}

function extractNumberedInsurerSlots(text) {
  const slots = [];
  const re = /\((\d{1,2})\)\s*[\n\r]?\s*([\w가-힣]+(?:화재|생명|손해|손보)?)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const insurerRaw = match[2].trim();
    const insurerEntry = KOREAN_INSURERS.find((entry) => entry.pattern.test(insurerRaw));
    if (insurerEntry) {
      slots.push({ index: Number(match[1]), insurer_name: insurerEntry.name });
    }
  }
  return slots;
}

function extractProductLines(text) {
  const lines = String(text).split(/\n/);
  const products = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeWhitespace(lines[i]);
    if (!line || line.length < 4) continue;
    if (/^(SUCCESS|품별|가입현황|기준담보|만기|원|\(무\)|내돈|The|H)$/.test(line)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(line)) continue;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(line)) continue;
    if (/^\(\d{1,2}\)$/.test(line)) continue;
    if (/^[\w가-힣]+(?:화재|생명|손해|손보)$/.test(line)) continue;

    if (/보험|실손|플랜|상해|알파Plus/.test(line) && !/보험료미제공/.test(line)) {
      let product = line;
      if (line === "건강보험" && i > 0) {
        const prev = normalizeWhitespace(lines[i - 1]);
        const prevInsurer = KOREAN_INSURERS.find((entry) => entry.pattern.test(prev));
        if (prevInsurer) product = `${prevInsurer.name} ${line}`;
        else if (/^[\w가-힣]{2,10}$/.test(prev) && !/보험|화재|생명/.test(prev)) {
          product = `${prev} ${line}`;
        }
      }
      if (/^간편한\d+/.test(product)) product = `간편한${product.replace(/^간편한/, "")}`;
      if (/^메리츠\s*간편한/.test(line) || (lines[i - 1]?.trim() === "(무)" && /^메리츠/.test(line))) {
        product = normalizeWhitespace(line.replace(/^메리츠\s*/, "간편한"));
        if (!product.startsWith("간편한")) product = `간편한${product}`;
      }
      if (product === "알파Plus보" || product === "알파Plus보/") product = "알파Plus보험";
      if (/무배당뉴하이카운전자상해/.test(product)) {
        product = "뉴하이카운전자상해보험(Hi2304)";
      }
      if (product === "실손의료비보험2004") product = "실손의료비보험2004";
      products.push(normalizeProductName(product));
    }
  }

  const merged = [];
  for (const product of products) {
    if (merged.length > 0) {
      const last = merged[merged.length - 1];
      if (product.startsWith("보험(") && !last.includes("보험")) {
        merged[merged.length - 1] = normalizeProductName(`${last}${product}`);
        continue;
      }
    }
    merged.push(product);
  }

  return merged.filter((p) => p.length >= 4);
}

function extractColumnInsurers(text) {
  const lines = String(text).split(/\n/).map((line) => line.trim());
  const insurers = [];
  for (const line of lines) {
    if (/^\(\d{1,2}\)$/.test(line)) continue;
    const entry = KOREAN_INSURERS.find((item) => item.pattern.test(line) && line.length < 20);
    if (entry && !insurers.includes(entry.name)) insurers.push(entry.name);
  }
  return insurers;
}

function extractCoverageAnalysisPolicies(text) {
  const numberedSlots = extractNumberedInsurerSlots(text);
  const columnInsurers = extractColumnInsurers(text);
  const products = extractProductLines(text);
  const premiums = extractAllPremiums(text);

  const count = Math.max(
    numberedSlots.length,
    columnInsurers.length,
    products.length,
    premiums.length,
  );

  const policies = [];
  for (let i = 0; i < count; i += 1) {
    const insurer =
      numberedSlots[i]?.insurer_name ??
      columnInsurers[i] ??
      columnInsurers[0] ??
      null;
    const product = products[i] ?? null;
    const monthlyPremium = premiums[i] ?? null;

    if (!insurer && !product) continue;

    let insurerName = insurer;
    let productName = product;

    if (productName && !insurerName) {
      const embedded = KOREAN_INSURERS.find((entry) => entry.pattern.test(productName));
      if (embedded) {
        insurerName = embedded.name;
        productName = productName.replace(embedded.pattern, "").trim();
      }
    }

    if (!productName && insurerName) productName = "건강보험";
    if (!insurerName || !productName) continue;

    const block = `${insurerName} ${productName}`;
    policies.push({
      insurer_name: insurerName,
      product_name: productName,
      policy_type: inferPolicyType(block),
      monthly_premium: monthlyPremium,
      coverage_categories: detectCoverageCategories(block),
      coverage_summary: {
        categories: detectCoverageCategories(block),
        extract_source: "coverage_analysis_layout",
        ...(monthlyPremium ? { monthly_premium_detected: monthlyPremium } : {}),
      },
    });
  }

  return policies;
}

function extractProductCandidates(block) {
  const matches = block.match(PRODUCT_LINE_PATTERN) ?? [];
  return matches
    .map((value) => normalizeProductName(value))
    .filter((value) => value.length >= 4 && !/^(보험료|만기|납입)/.test(value));
}

function pickBestProduct(block, insurerName) {
  const candidates = extractProductCandidates(block);
  if (candidates.length === 0) return null;

  const scored = candidates.map((product) => {
    let score = product.length;
    if (product.includes("보험")) score += 10;
    if (insurerName && product.includes(insurerName.replace(/보험|화재|생명|손해/g, ""))) score += 5;
    if (/실손|건강|운전자|암/.test(product)) score += 8;
    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.product ?? null;
}

function extractPremiumFromBlock(block) {
  const premiums = extractAllPremiums(block);
  return premiums.length ? premiums[0] : null;
}

function splitIntoPolicyBlocks(text) {
  const normalized = String(text ?? "").replace(/\r/g, "\n");
  const numberedBlocks = normalized
    .split(/(?=\(\d{1,2}\)\s*[\n\r]?\s*[\w가-힣])/g)
    .filter((b) => b.trim().length > 20);
  if (numberedBlocks.length >= 2) return numberedBlocks;

  const insurers = detectInsurerInText(normalized);
  if (insurers.length <= 1) return [normalized];

  const blocks = [];
  for (let i = 0; i < insurers.length; i += 1) {
    const start = insurers[i].index;
    const end = i + 1 < insurers.length ? insurers[i + 1].index : normalized.length;
    const slice = normalized.slice(start, end).trim();
    if (slice.length > 15) blocks.push(slice);
  }
  return blocks.length ? blocks : [normalized];
}

function isValidExtractedPolicy(policy) {
  const product = String(policy?.product_name ?? "");
  const insurer = String(policy?.insurer_name ?? "");
  if (!insurer || product.length < 5) return false;
  if (/^(내돈|기본플랜|원|만기|The|H|해약환)/.test(product)) return false;
  if (/내돈\s/.test(product)) return false;
  if (!/보험|실손|플랜|상해|알파Plus/.test(product)) return false;
  if (/^보험\(/.test(product) && product.length < 12) return false;
  return true;
}

function policyKey(insurer, product) {
  return `${normalizeInsurerName(insurer)}::${normalizeProductName(product).toLowerCase()}`;
}

function buildPolicyFromBlock(block, fallbackInsurer = null) {
  const insurers = detectInsurerInText(block);
  const insurer = insurers[0]?.name ?? fallbackInsurer;
  if (!insurer) return null;

  const product = pickBestProduct(block, insurer);
  if (!product) return null;

  const monthlyPremium = extractPremiumFromBlock(block);
  const categories = detectCoverageCategories(block);
  const policyType = inferPolicyType(block + product);

  return {
    insurer_name: insurer,
    product_name: product,
    policy_type: policyType,
    monthly_premium: monthlyPremium,
    coverage_categories: categories,
    coverage_summary: {
      categories,
      extract_source: "ocr_text",
      ...(monthlyPremium ? { monthly_premium_detected: monthlyPremium } : {}),
    },
  };
}

/**
 * @param {string} ocrText
 * @param {{ documentType?: string, filename?: string }} context
 */
export function extractInsuranceFromOcrText(ocrText, context = {}) {
  const text = String(ocrText ?? "").trim();
  if (!text || text.length < 20) {
    return {
      policies: [],
      policy_count: 0,
      insurers: [],
      premiums: [],
      coverage_categories: [],
      extraction_confidence: 0,
      raw_text_length: text.length,
    };
  }

  const policyMap = new Map();

  if (isCoverageAnalysisDocument(text)) {
    for (const policy of extractCoverageAnalysisPolicies(text)) {
      const key = policyKey(policy.insurer_name, policy.product_name);
      if (!policyMap.has(key)) policyMap.set(key, policy);
    }
  }

  const blocks = splitIntoPolicyBlocks(text);
  for (const block of blocks) {
    const policy = buildPolicyFromBlock(block);
    if (!policy) continue;
    const key = policyKey(policy.insurer_name, policy.product_name);
    if (!policyMap.has(key)) {
      policyMap.set(key, policy);
      continue;
    }
    const existing = policyMap.get(key);
    if (!existing.monthly_premium && policy.monthly_premium) {
      existing.monthly_premium = policy.monthly_premium;
      existing.coverage_summary.monthly_premium_detected = policy.monthly_premium;
    }
  }

  if (policyMap.size === 0) {
    const insurersInDoc = detectInsurerInText(text).map((entry) => entry.name);
    const uniqueInsurers = Array.from(new Set(insurersInDoc));
    const products = extractProductLines(text);
    for (let i = 0; i < Math.max(uniqueInsurers.length, products.length); i += 1) {
      const insurer = uniqueInsurers[i] ?? uniqueInsurers[0];
      const product = products[i];
      if (!insurer || !product) continue;
      const key = policyKey(insurer, product);
      if (policyMap.has(key)) continue;
      policyMap.set(key, {
        insurer_name: insurer,
        product_name: product,
        policy_type: inferPolicyType(product),
        monthly_premium: extractAllPremiums(text)[i] ?? null,
        coverage_categories: detectCoverageCategories(`${insurer} ${product}`),
        coverage_summary: {
          categories: detectCoverageCategories(`${insurer} ${product}`),
          extract_source: "ocr_text_fallback",
        },
      });
    }
  }

  const policies = Array.from(policyMap.values()).filter(isValidExtractedPolicy);
  const insurers = Array.from(new Set(policies.map((p) => p.insurer_name)));
  const premiums = policies.map((p) => p.monthly_premium).filter(Boolean);
  const coverageCategories = Array.from(
    new Set(policies.flatMap((p) => p.coverage_categories ?? [])),
  );

  const extractionConfidence = policies.length > 0
    ? Math.min(0.95, 0.5 + policies.length * 0.08 + (premiums.length > 0 ? 0.1 : 0))
    : insurers.length > 0
      ? 0.35
      : 0;

  return {
    policies,
    policy_count: policies.length,
    insurers,
    premiums,
    coverage_categories: coverageCategories,
    extraction_confidence: Number(extractionConfidence.toFixed(3)),
    document_type: context.documentType ?? null,
    filename: context.filename ?? null,
    raw_text_length: text.length,
  };
}

export function mergeInsuranceExtractions(extractions) {
  const policyMap = new Map();

  for (const extraction of extractions ?? []) {
    for (const policy of extraction?.policies ?? []) {
      const key = policyKey(policy.insurer_name, policy.product_name);
      if (!policyMap.has(key)) {
        policyMap.set(key, { ...policy });
        continue;
      }
      const existing = policyMap.get(key);
      if (!existing.monthly_premium && policy.monthly_premium) {
        existing.monthly_premium = policy.monthly_premium;
      }
      existing.coverage_categories = Array.from(
        new Set([...(existing.coverage_categories ?? []), ...(policy.coverage_categories ?? [])]),
      );
      existing.coverage_summary = {
        ...(existing.coverage_summary ?? {}),
        ...(policy.coverage_summary ?? {}),
        categories: existing.coverage_categories,
      };
    }
  }

  const policies = Array.from(policyMap.values()).filter(isValidExtractedPolicy);
  return {
    policies,
    policy_count: policies.length,
    insurers: Array.from(new Set(policies.map((p) => p.insurer_name))),
    coverage_categories: Array.from(new Set(policies.flatMap((p) => p.coverage_categories ?? []))),
  };
}
