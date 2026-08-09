/**
 * Non-blocking KEY record sidecar — terminal channel after customer_answer.
 * Never drives Claude tools / Continue / second Claude. Parse failures are ignored.
 *
 * Also hosts PRE-GATE structured writer helpers for ONE_PATH document/original lane
 * (Anthropic output_config.format). Sidecar remains for other lanes; structured lane
 * must not dual-write.
 */

export const KEY_RECORD_SIDECAR_START = "<<<KEY_RECORD>>>";
export const KEY_RECORD_SIDECAR_END = "<<<END_KEY_RECORD>>>";

/** Document/original + tools=[] only — never with web_search/citations. */
export function shouldUseKeyTurnStructuredWriter({
  presenceTurn = false,
  ownedOriginalAttached = false,
  selectiveLiveRequest = null,
  tools = null,
} = {}) {
  if (presenceTurn === true) return false;
  if (ownedOriginalAttached !== true) return false;
  if (!selectiveLiveRequest || typeof selectiveLiveRequest !== "object") return false;
  const mode = String(
    selectiveLiveRequest?.selection_plan?.current_attachment_mode ?? "",
  ).trim();
  if (mode !== "THIS_TURN_ORIGINAL") return false;
  const resolvedTools = Array.isArray(tools)
    ? tools
    : Array.isArray(selectiveLiveRequest?.tools)
      ? selectiveLiveRequest.tools
      : null;
  if (!Array.isArray(resolvedTools) || resolvedTools.length !== 0) return false;
  return true;
}

/**
 * Anthropic Messages API output_config for KEY turn result.
 * Property order: customer_answer first (required) for safe stream decode.
 */
export function buildKeyTurnStructuredOutputConfig(factTypes = []) {
  const types = [
    ...new Set(
      (Array.isArray(factTypes) ? factTypes : [])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const factItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      fact_type: types.length
        ? { type: "string", enum: types }
        : { type: "string" },
      literal: { type: "string" },
      source_document_id: { type: "string" },
    },
    required: ["fact_type", "literal", "source_document_id"],
  };
  return {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_answer: { type: "string" },
          confirmed_source_facts: {
            type: "array",
            items: factItem,
          },
        },
        required: ["customer_answer", "confirmed_source_facts"],
      },
    },
  };
}

/** System addendum — structured lane only; overrides ONE_PATH "no JSON" for this turn. */
export function buildKeyTurnStructuredOutputHint({
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
    ? `source_document_id 후보(서버 제공, 추측 금지): ${ids.join(", ")}`
    : "source_document_id는 서버가 준 ATTACHMENT_IDENTITY document_id만 쓴다. 생성·추측 금지.";
  const confirmedIdRule =
    ids.length > 1
      ? "원본이 여러 개면 각 confirmed_source_facts에 ATTACHMENT_IDENTITY의 document_id를 source_document_id로 넣는다."
      : ids.length === 1
        ? `원본이 하나면 source_document_id는 ${ids[0]}를 쓴다.`
        : "source_document_id를 모르면 해당 fact를 넣지 않는다.";
  return [
    "[KEY_TURN_STRUCTURED_OUTPUT]",
    "이 턴은 공식 Structured Output 계약이다. 위 지시 중 'JSON을 출력하지 않는다/완성된 고객 답변만'은 이 턴에 한해 적용하지 않는다.",
    "응답 본문은 schema에 맞는 JSON 객체 하나만 출력한다. KEY_RECORD sidecar·마크다운·여분 텍스트 금지.",
    "필드 순서: customer_answer 다음 confirmed_source_facts.",
    "customer_answer: 고객에게 보여줄 한국어 완결 답변(평문). JSON 키·스키마·내부 용어를 고객 답변에 넣지 않는다.",
    "confirmed_source_facts: 이번 턴 첨부 원본을 직접 읽고 원본에서 실제 확인한 사실만 {fact_type, literal, source_document_id}.",
    "금지: web/search·일반지식·conversation memory·추론·예상·inventory/OCR/candidate 자동승격·source_document_id 생성.",
    "확인할 사실이 없으면 confirmed_source_facts는 [].",
    confirmedIdRule,
    idLine,
  ].join("\n");
}

/**
 * Stream-safe: decode only the JSON string value of customer_answer.
 * Never returns JSON framing / keys.
 */
export function extractCustomerAnswerFromStructuredJsonPartial(rawText = "") {
  const raw = String(rawText ?? "");
  const m = /"customer_answer"\s*:\s*"/.exec(raw);
  if (!m) {
    return { customer_answer: "", started: false, complete: false, error: null };
  }
  let i = m.index + m[0].length;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      if (i + 1 >= raw.length) {
        return { customer_answer: out, started: true, complete: false, error: null };
      }
      const n = raw[i + 1];
      if (n === "u") {
        if (i + 5 >= raw.length) {
          return { customer_answer: out, started: true, complete: false, error: null };
        }
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return {
            customer_answer: out,
            started: true,
            complete: false,
            error: "bad_unicode_escape",
          };
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      if (Object.prototype.hasOwnProperty.call(map, n)) {
        out += map[n];
        i += 2;
        continue;
      }
      return {
        customer_answer: out,
        started: true,
        complete: false,
        error: "bad_escape",
      };
    }
    if (ch === '"') {
      return { customer_answer: out, started: true, complete: true, error: null };
    }
    out += ch;
    i += 1;
  }
  return { customer_answer: out, started: true, complete: false, error: null };
}

/** True when text still looks like structured JSON envelope (customer leak). */
export function customerTextHasStructuredJsonLeak(text = "") {
  const t = String(text ?? "");
  if (!t) return false;
  if (/"customer_answer"\s*:/.test(t)) return true;
  if (/"confirmed_source_facts"\s*:/.test(t)) return true;
  if (/^\s*\{\s*"customer_answer"/m.test(t)) return true;
  if (/^\s*\{\s*$/m.test(t) && t.includes("customer_answer")) return true;
  return false;
}

/**
 * Final structured JSON parse. Maps schema `literal` → Gate `literal_value`.
 * Parse failure → ok:false, facts:[], never treat raw JSON as customer_answer.
 */
export function parseKeyTurnStructuredResult(rawText = "") {
  const raw = String(rawText ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      error: "empty_structured_text",
      customer_answer: "",
      confirmed_source_facts: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message ?? err).slice(0, 120),
      customer_answer: "",
      confirmed_source_facts: [],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "structured_not_object",
      customer_answer: "",
      confirmed_source_facts: [],
    };
  }
  if (typeof parsed.customer_answer !== "string") {
    return {
      ok: false,
      error: "missing_customer_answer",
      customer_answer: "",
      confirmed_source_facts: [],
    };
  }
  if (!Array.isArray(parsed.confirmed_source_facts)) {
    return {
      ok: false,
      error: "missing_confirmed_source_facts",
      customer_answer: "",
      confirmed_source_facts: [],
    };
  }
  const confirmed_source_facts = [];
  for (const row of parsed.confirmed_source_facts) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const literal =
      row.literal_value != null && String(row.literal_value).trim() !== ""
        ? row.literal_value
        : row.literal;
    if (literal == null || String(literal).trim() === "") continue;
    confirmed_source_facts.push({
      fact_type: row.fact_type,
      literal_value: literal,
      source_document_id: row.source_document_id,
      ...(row.source_locator && typeof row.source_locator === "object"
        ? { source_locator: row.source_locator }
        : {}),
    });
  }
  return {
    ok: true,
    error: null,
    customer_answer: parsed.customer_answer,
    confirmed_source_facts,
  };
}

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
  const confirmedIdRule =
    ids.length > 1
      ? "원본이 여러 개면 confirmed_source_facts의 각 항목에 ATTACHMENT_IDENTITY의 document_id를 source_document_id로 반드시 넣는다. 추측 금지."
      : ids.length === 1
        ? `원본이 하나면 confirmed_source_facts의 source_document_id는 ${ids[0]}를 쓴다(생략 시 KEY가 그 문서로 귀속한다).`
        : "confirmed_source_facts에 source_document_id를 알면 넣는다.";
  return [
    "원본 첨부가 있다. 고객 답변은 평문 한국어로 먼저 끝까지 완결한다.",
    "접수·예고 문장으로 끝내지 않는다. '찾아볼게요', '확인해볼게요', '분석해드릴게요', '기록하고 분석하겠습니다'처럼 나중에 하겠다는 말만 남기지 않는다.",
    "고객 답변이 끝난 뒤에만, 아래 내부 채널을 한 번 붙일 수 있다. 고객에게 이 채널·JSON·필드명을 말하지 않는다.",
    `${KEY_RECORD_SIDECAR_START}`,
    '{"policy_inventory_facts":[{"insurer":"","product_name":"","contract_date":null,"payment_term":null,"maturity_date":null,"monthly_premium":null,"policy_number":null,"contract_status":null,"source_document_id":"","source_page_or_image":null,"verification_status":"document_read","uncertain_fields":[]}],"coverage_facts":[{"coverage_name":"","coverage_amount":null,"baseline_item_id":null,"source_document_id":"","source_locator":{"page":null,"source_text":null}}],"confirmed_source_facts":[],"visual_blocks":[],"uncertain_fields":[]}',
    `${KEY_RECORD_SIDECAR_END}`,
    "policy_inventory_facts에는 원본에 명시된 계약만 넣는다. 추론·추천·유지/해지 의견·가입 건수 요약 숫자는 넣지 않는다. 원본에 없는 값은 null 또는 uncertain_fields로 둔다. inventory는 후보/읽기 기록이며 confirmed_source_facts로 옮기거나 자동 승격하지 않는다.",
    "coverage_facts에는 원본에 담보명과 보장금액이 함께 명시된 항목만 넣는다. 각 항목에 coverage_name(또는 original_coverage_name), coverage_amount, source_document_id, source_locator(page·section·line·source_text 중 하나 이상)를 넣는다. baseline_item_id는 원본 담보명이 기준선 항목과 명확히 대응될 때만 넣는다(예: 일반암 진단 → cancer_diagnosis). 고객 의견·적정 필요금액·추론 금액·다른 계약 담보는 넣지 않는다. 원본에 해당 담보가 없으면 []. coverage_facts도 confirmed_source_facts로 변환하지 않는다.",
    "confirmed_source_facts는 inventory/coverage와 완전히 별도 필드다. 원본에서 직접 확인한 계약 사실만 {fact_type, literal_value, source_document_id, source_locator?}로 넣는다. 확인할 fact가 없으면 []가 정상이다. 최소 개수를 채우지 않는다. 추측·검색 일반정보·추천·의미 변환 금지. literal_value는 원문 그대로.",
    confirmedIdRule,
    "visual_blocks는 같은 답변에 표·카드가 필요할 때만 넣는다. 없으면 [].",
    "내부 채널이 없거나 JSON이 깨져도 고객 답변은 그대로 둔다.",
    idLine,
  ].join("\n");
}

/**
 * Attach-plan provenance for sidecar confirmed_source_facts (pre-Gate).
 * No attachmentIdentityPlan / empty owned ids → promote nothing ([]).
 * 1 doc: missing source_document_id falls back to that id; out-of-set dropped.
 * 2+ docs: each fact must carry source_document_id in the owned set.
 */
export function applyConfirmedSourceFactsAttachProvenance({
  facts = [],
  attachmentIdentityPlan = null,
} = {}) {
  const ownedIds = [
    ...new Set(
      (Array.isArray(attachmentIdentityPlan?.attachment_identities)
        ? attachmentIdentityPlan.attachment_identities
        : []
      )
        .map((row) => String(row?.document_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (!ownedIds.length) {
    return {
      facts: [],
      defaultSourceDocumentId: null,
      reason: "no_attachment_identity_plan",
    };
  }
  const rows = Array.isArray(facts) ? facts : [];
  if (ownedIds.length === 1) {
    const only = ownedIds[0];
    const out = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const sid = String(row.source_document_id ?? "").trim();
      if (sid && sid !== only) continue;
      out.push(sid ? row : { ...row, source_document_id: only });
    }
    return {
      facts: out,
      defaultSourceDocumentId: only,
      reason: null,
    };
  }
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const sid = String(row.source_document_id ?? "").trim();
    if (!sid || !ownedIds.includes(sid)) continue;
    out.push(row);
  }
  return {
    facts: out,
    defaultSourceDocumentId: null,
    reason: null,
  };
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
