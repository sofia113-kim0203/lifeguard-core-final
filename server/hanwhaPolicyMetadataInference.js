const HANWHA_CARRIER = {
  carrier_name: "한화손해보험",
  carrier_type: "non_life_insurance",
};

const PRODUCT_RULES = [
  {
    pattern: /^3ten55_se_2/i,
    product_name: "한화 더 경증 간편건강보험Ⅱ",
    product_type: "health_insurance",
    underwriting_program: "Simplified",
    policy_type: "약관",
  },
  {
    pattern: /^3ten55_yeon/i,
    product_name: "한화 더 경증 간편건강보험Ⅱ 연금형",
    product_type: "health_insurance",
    underwriting_program: "Simplified",
    policy_type: "약관",
  },
  {
    pattern: /^100cancer/i,
    product_name: "한화 100세암보험",
    product_type: "cancer_insurance",
    underwriting_program: "Standard",
    policy_type: "약관",
  },
  {
    pattern: /^311_yeon/i,
    product_name: "한화 311 연금보험",
    product_type: "annuity_insurance",
    underwriting_program: "Standard",
    policy_type: "약관",
  },
  {
    pattern: /^DRIVER/i,
    product_name: "한화 운전자보험",
    product_type: "auto_insurance",
    underwriting_program: "Standard",
    policy_type: "약관",
  },
  {
    pattern: /^directmedical/i,
    product_name: "한화 다이렉트 의료실비보험",
    product_type: "health_insurance",
    underwriting_program: "Direct",
    policy_type: "약관",
  },
  {
    pattern: /^directsilson_conver/i,
    product_name: "한화 다이렉트 실손의료비보험",
    product_type: "health_insurance",
    underwriting_program: "Direct",
    policy_type: "약관",
  },
];

function slugifyFilename(filename) {
  return String(filename ?? "")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function parseVersionFromFilename(filename) {
  const paren = String(filename ?? "").match(/\((\d{4})\)/);
  if (paren) return `무배당${paren[1]}`;
  const inline = String(filename ?? "").match(/(\d{4})_03/i);
  if (inline) return `무배당${inline[1]}`;
  return "unknown";
}

function parseEffectiveDate(filename) {
  const version = parseVersionFromFilename(filename);
  const yearMonth = version.match(/(\d{4})/);
  if (!yearMonth) return null;
  const code = yearMonth[1];
  const year = `20${code.slice(0, 2)}`;
  const month = code.slice(2, 4);
  return `${year}-${month}-01`;
}

export function inferHanwhaPolicyMetadataFromFilename(sourceFileName) {
  const file = String(sourceFileName ?? "").trim();
  if (!file) throw new Error("source_file_name_required");
  const base = file.replace(/\.pdf$/i, "");
  const rule = PRODUCT_RULES.find((entry) => entry.pattern.test(base));
  if (!rule) throw new Error(`hanwha_product_not_recognized:${file}`);

  return {
    ...HANWHA_CARRIER,
    product_name: rule.product_name,
    product_code: slugifyFilename(file),
    product_type: rule.product_type,
    underwriting_program: rule.underwriting_program,
    policy_type: rule.policy_type,
    version: parseVersionFromFilename(file),
    effective_date: parseEffectiveDate(file),
    source_file_name: file.endsWith(".pdf") ? file : `${file}.pdf`,
    visibility: "shared",
    knowledge_type: "policy_terms",
  };
}

export function buildHanwhaTargetStoragePath(metadata) {
  return `hanwha/${metadata.product_code}/${metadata.source_file_name}`;
}
