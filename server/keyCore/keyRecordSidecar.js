/**
 * Non-blocking KEY record sidecar — terminal channel after customer_answer.
 * Never drives Claude tools / Continue / second Claude. Parse failures are ignored.
 */

export const KEY_RECORD_SIDECAR_START = "<<<KEY_RECORD>>>";
export const KEY_RECORD_SIDECAR_END = "<<<END_KEY_RECORD>>>";

const PROGRESS_ONLY_RE =
  /^(?:네[,.]?\s*)?(?:알겠습니다[,.]?\s*)?(?:찾아볼게(?:요)?|확인해\s*볼게(?:요)?|확인해볼게(?:요)?|분석해\s*드릴게(?:요)?|분석해드릴게(?:요)?|기록하고\s*분석하겠습니다|먼저\s*확인하겠습니다|잠시만\s*기다려\s*주세요)[.!]?\s*$/u;

/**
 * Strip incomplete/complete sidecar from streamed text before customer SSE.
 * Once START marker appears, only the prefix before it is customer-visible.
 */
export function stripKeyRecordFromStreamText(text = "") {
  const raw = String(text ?? "");
  const startIdx = raw.indexOf(KEY_RECORD_SIDECAR_START);
  if (startIdx < 0) return raw;
  return raw.slice(0, startIdx).trimEnd();
}

/**
 * Split sealed provider text into customer_answer + parsed key_record.
 * Broken / missing sidecar → key_record null (customer_answer still kept).
 */
export function splitCustomerAnswerAndKeyRecord(text = "") {
  const raw = String(text ?? "");
  const startIdx = raw.indexOf(KEY_RECORD_SIDECAR_START);
  if (startIdx < 0) {
    return {
      customer_answer: raw.trim(),
      key_record: null,
      sidecar_present: false,
      sidecar_ok: false,
      sidecar_error: null,
    };
  }
  const customer_answer = raw.slice(0, startIdx).trim();
  const afterStart = raw.slice(startIdx + KEY_RECORD_SIDECAR_START.length);
  const endIdx = afterStart.indexOf(KEY_RECORD_SIDECAR_END);
  const jsonSlice = (endIdx >= 0 ? afterStart.slice(0, endIdx) : afterStart).trim();
  if (!jsonSlice) {
    return {
      customer_answer,
      key_record: null,
      sidecar_present: true,
      sidecar_ok: false,
      sidecar_error: "empty_sidecar",
    };
  }
  try {
    const parsed = JSON.parse(jsonSlice);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        customer_answer,
        key_record: null,
        sidecar_present: true,
        sidecar_ok: false,
        sidecar_error: "sidecar_not_object",
      };
    }
    return {
      customer_answer,
      key_record: parsed,
      sidecar_present: true,
      sidecar_ok: true,
      sidecar_error: null,
    };
  } catch (err) {
    return {
      customer_answer,
      key_record: null,
      sidecar_present: true,
      sidecar_ok: false,
      sidecar_error: String(err?.message ?? err).slice(0, 120),
    };
  }
}

/** True when the only customer text is a deferral / progress promise. */
export function isProgressOnlyCustomerAnswer(text = "") {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length > 120) return false;
  return PROGRESS_ONLY_RE.test(t);
}

/**
 * System addendum for document-attach turns — sidecar after completed answer.
 * No record_* tools. No fill-pressure reading script.
 */
export function buildKeyRecordSidecarHint({
  documentIds = [],
  primaryDocumentId = null,
} = {}) {
  const ids = [
    ...new Set(
      [...(Array.isArray(documentIds) ? documentIds : []), primaryDocumentId]
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const idLine = ids.length
    ? `source_document_id 후보: ${ids.join(", ")}`
    : "source_document_id를 알면 반드시 넣는다.";
  return [
    "원본 첨부가 있다. 고객 답변은 평문 한국어로 먼저 끝까지 완결한다.",
    "접수·예고 문장으로 끝내지 않는다. '찾아볼게요', '확인해볼게요', '분석해드릴게요', '기록하고 분석하겠습니다'처럼 나중에 하겠다는 말만 남기지 않는다.",
    "고객 답변이 끝난 뒤에만, 아래 내부 채널을 한 번 붙일 수 있다. 고객에게 이 채널·JSON·필드명을 말하지 않는다.",
    `${KEY_RECORD_SIDECAR_START}`,
    '{"policy_inventory_facts":[{"insurer":"","product_name":"","contract_date":null,"payment_term":null,"maturity_date":null,"monthly_premium":null,"policy_number":null,"contract_status":null,"source_document_id":"","source_page_or_image":null,"verification_status":"document_read","uncertain_fields":[]}],"coverage_facts":[],"visual_blocks":[],"uncertain_fields":[]}',
    `${KEY_RECORD_SIDECAR_END}`,
    "policy_inventory_facts에는 원본에 명시된 계약만 넣는다. 추론·추천·유지/해지 의견·가입 건수 요약 숫자는 넣지 않는다. 원본에 없는 값은 null 또는 uncertain_fields로 둔다.",
    "visual_blocks는 같은 답변에 표·카드가 필요할 때만 넣는다. 없으면 [].",
    "내부 채널이 없거나 JSON이 깨져도 고객 답변은 그대로 둔다.",
    idLine,
  ].join("\n");
}

export function normalizeKeyRecordSidecar(raw = null, defaults = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      policy_inventory_facts: [],
      coverage_facts: [],
      visual_blocks: [],
      uncertain_fields: [],
      confirmed_source_facts: [],
      coverage_baseline_facts: [],
    };
  }
  const defaultDocId =
    defaults.source_document_id != null && String(defaults.source_document_id).trim()
      ? String(defaults.source_document_id).trim()
      : null;
  const policy_inventory_facts = normalizePolicyInventoryFacts(
    raw.policy_inventory_facts,
    { source_document_id: defaultDocId },
  );
  const coverage_facts = Array.isArray(raw.coverage_facts)
    ? raw.coverage_facts.filter((r) => r && typeof r === "object")
    : [];
  const visual_blocks = Array.isArray(raw.visual_blocks) ? raw.visual_blocks : [];
  const uncertain_fields = Array.isArray(raw.uncertain_fields)
    ? raw.uncertain_fields.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  // Optional legacy-shaped arrays if Claude still emits them inside sidecar.
  const confirmed_source_facts = Array.isArray(raw.confirmed_source_facts)
    ? raw.confirmed_source_facts
    : [];
  const coverage_baseline_facts = Array.isArray(raw.coverage_baseline_facts)
    ? raw.coverage_baseline_facts
    : Array.isArray(raw.coverage_facts)
      ? coverage_facts
      : [];
  return {
    policy_inventory_facts,
    coverage_facts,
    visual_blocks,
    uncertain_fields,
    confirmed_source_facts,
    coverage_baseline_facts,
  };
}

export function normalizePolicyInventoryFacts(rawFacts = [], defaults = {}) {
  const rows = Array.isArray(rawFacts) ? rawFacts : [];
  const defaultDocId =
    defaults.source_document_id != null && String(defaults.source_document_id).trim()
      ? String(defaults.source_document_id).trim()
      : null;
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const insurer = pickStr(row.insurer ?? row.insurer_name);
    const product_name = pickStr(row.product_name ?? row.product);
    const monthly_premium = pickPremium(row.monthly_premium ?? row.premium);
    const policy_number = pickStr(row.policy_number ?? row.contract_number);
    const contract_date = pickStr(row.contract_date ?? row.effective_from);
    const maturity_date = pickStr(row.maturity_date);
    const payment_term = pickStr(row.payment_term ?? row.payment_period);
    const contract_status = pickStr(row.contract_status);
    const source_document_id = pickStr(row.source_document_id) || defaultDocId;
    const source_page_or_image =
      row.source_page_or_image != null
        ? String(row.source_page_or_image).trim() || null
        : row.source_locator?.page != null
          ? String(row.source_locator.page)
          : null;
    if (!source_document_id) continue;
    if (!insurer && !product_name && monthly_premium == null && !policy_number) continue;
    const verification_status = "document_read";
    const uncertain_fields = Array.isArray(row.uncertain_fields)
      ? row.uncertain_fields.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const fact = {
      insurer,
      product_name,
      contract_date,
      payment_term,
      maturity_date,
      monthly_premium,
      policy_number,
      contract_status,
      source_document_id,
      source_page_or_image,
      verification_status,
      uncertain_fields,
      ...(defaults.source_content_sha256
        ? { source_content_sha256: String(defaults.source_content_sha256).trim().toLowerCase() }
        : row.source_content_sha256
          ? { source_content_sha256: String(row.source_content_sha256).trim().toLowerCase() }
          : {}),
    };
    const key = policyInventoryDedupeKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

export function policyInventoryDedupeKey(fact = {}) {
  const pn = String(fact.policy_number ?? "").trim();
  if (pn) return `pn:${pn.toLowerCase()}`;
  return [
    "fp",
    String(fact.insurer ?? "").trim().toLowerCase(),
    String(fact.product_name ?? "").trim().toLowerCase(),
    String(fact.contract_date ?? "").trim(),
    fact.monthly_premium != null ? String(fact.monthly_premium) : "",
    String(fact.maturity_date ?? "").trim(),
    String(fact.source_document_id ?? "").trim(),
  ].join("|");
}

export function policyInventoryStrongFingerprint(fact = {}) {
  const insurer = String(fact.insurer ?? "").trim().toLowerCase();
  const product = String(fact.product_name ?? "").trim().toLowerCase();
  const contract_date = String(fact.contract_date ?? "").trim();
  const premium = fact.monthly_premium != null ? String(fact.monthly_premium) : "";
  const maturity = String(fact.maturity_date ?? "").trim();
  if (!insurer || !product || !contract_date || !premium || !maturity) return null;
  return `${insurer}|${product}|${contract_date}|${premium}|${maturity}`;
}

function pickStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function pickPremium(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const digits = String(v).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}
