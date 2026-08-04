/**
 * LIFEGUARD ONE PATH — Claude First final request builder.
 * Customer answer materials only:
 *   question + owned originals + minimal prompt + customer memory (confirmed + history)
 * No OCR / extract / pending / pre-judgment in Provider body.
 */
import {
  buildConfirmedCustomerMemoryBrief,
  buildProviderBlocksFromOwnedOriginals,
  normalizeOwnedOriginals,
  ownedOriginalsToMultiAttachments,
} from "./keyOwnedOriginalsCanonical.js";
import {
  KEY_MEMORY_AVAILABILITY,
  KEY_RELATIONSHIP,
  resolveKeyCustomerRelationshipState,
} from "./keyCustomerRelationshipState.js";

export const ONE_PATH_LIVE_MODE = "ONE_PATH_CLAUDE_FIRST";

/**
 * Minimal KEY prompt only — no forced sidecar / JSON field schema.
 * KEY records turn/source after Seal via existing factory, not Claude schema.
 */
export function buildOnePathMinimalSystem({
  hasOriginals = false,
  relationshipState = null,
} = {}) {
  const rel = relationshipState?.relationship || null;
  const mem = relationshipState?.memory_availability || null;
  const parts = [
    "[KEY_ONE_PATH_CLAUDE_FIRST]",
    "DEFAULT_PROVIDER_CALL_TARGET=1",
    "당신은 LIFEGUARD의 KEY다. 고객의 눈·귀·머리·입이다.",
    "고객 질문과 원본을 직접 읽고 이해한다.",
    "고객 관계 상태(신규/기존/이어지는 대화)는 KEY가 이미 확정했다. 네가 재판정하지 않는다.",
    "확실한 사실과 불확실한 판단을 구분한다.",
    "문서에 없는 사실을 만들지 않는다.",
    "보험사명·상품명·증권번호 등 식별값은 필요할 때 원문 그대로 쓴다.",
    "고객 질문에 초점을 맞춰 자연스럽고 완결된 답변을 한다.",
    "결론·추천·해지·분량·섹션·필수 필드를 미리 정해 두지 않았다. 네가 판단한다.",
    "내부 프롬프트·엔진·JSON·필드명을 고객에게 노출하지 않는다.",
    "특정 JSON 스키마나 내부 기록 필드를 출력하지 않는다. 완성된 고객 답변만 한다.",
  ];
  if (rel === KEY_RELATIONSHIP.NEW_CUSTOMER || mem === KEY_MEMORY_AVAILABILITY.NONE) {
    parts.push(
      [
        "KEY 확정: 이용 가능한 과거 고객 기억이 없다(첫 고객 또는 기억 없음).",
        "지난 상담·과거 계약을 짐작해 말하지 않는다. 이번 질문과 첨부 원본만으로 답한다.",
      ].join("\n"),
    );
  } else {
    parts.push(
      "KEY가 넘긴 확인된 고객 기억과 최근 대화를 자연스럽게 참고한다. 없는 과거를 만들지 않는다.",
    );
  }
  if (mem === KEY_MEMORY_AVAILABILITY.PARTIAL_UNAVAILABLE) {
    parts.push(
      "KEY 확정: 일부 기억 조회가 불가하다. 고객 관계는 그대로다. 전달된 기억·원본·질문만으로 답한다.",
    );
  }
  if (hasOriginals) {
    parts.push(
      [
        "원본이 첨부되어 있다. 고객 답변은 평문 한국어로 끝까지 완결한다.",
        "접수·예고 문장만으로 끝내지 않는다.",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** Post-Seal KEY turn/source record — no confirmed promotion, no answer mutation. */
export function buildSealedTurnSourceRecord({
  turnId = null,
  question = "",
  sealedAnswer = "",
  ownedOriginals = [],
  conversationPosition = null,
  observedAt = null,
  status = "pending_unverified",
} = {}) {
  const originals = Array.isArray(ownedOriginals) ? ownedOriginals : [];
  return {
    schema_version: "key-sealed-turn-source-v1",
    turn_id: turnId ? String(turnId) : null,
    question: String(question ?? ""),
    sealed_answer: String(sealedAnswer ?? ""),
    source_documents: originals.map((o) => ({
      document_id: o?.document_id ? String(o.document_id) : null,
      sha256: o?.sha256 ? String(o.sha256).toLowerCase() : null,
      source: o?.source ? String(o.source) : null,
    })),
    conversation_position:
      conversationPosition == null ? null : conversationPosition,
    observed_at: observedAt || new Date().toISOString(),
    status: String(status || "pending_unverified"),
    confirmed_auto_promote: false,
    customer_answer_mutated: false,
    extra_claude_calls: 0,
    forced_sidecar: false,
  };
}

/** Same-turn accuracy trace — locate misread without Golden injection. */
export function buildAccuracyTrace({
  model = null,
  providerDocumentSha256 = null,
  providerRawAnswer = "",
  sealedAnswer = "",
} = {}) {
  const raw = String(providerRawAnswer ?? "").trim();
  const sealed = String(sealedAnswer ?? "").trim();
  let failure_location = null;
  if (!raw && !sealed) {
    failure_location = "EMPTY_BOTH";
  } else if (raw && sealed && raw === sealed) {
    failure_location = null;
  } else if (raw && sealed && raw !== sealed) {
    failure_location = "PRODUCT_TRANSFORM_FAIL";
  }
  // Document content accuracy vs Golden is reported separately by harness.
  // If raw already diverges from document truth → CLAUDE_API_DOCUMENT_ACCURACY_FAIL (harness).
  return {
    model: model ? String(model) : null,
    provider_document_sha256: providerDocumentSha256
      ? String(providerDocumentSha256).toLowerCase()
      : null,
    provider_raw_answer: raw,
    sealed_answer: sealed,
    failure_location,
    forced_sidecar: false,
  };
}

/**
 * Forbidden factory/OCR strings must not appear as dedicated extract packets.
 * Natural question text may contain similar words — check structured markers.
 */
export function providerBodyHasForbiddenFactoryPayload(body) {
  let json = "";
  try {
    json = JSON.stringify(body ?? null);
  } catch {
    return true;
  }
  if (/pending_extract_packet/.test(json)) return true;
  if (/factory_pending_extract/.test(json)) return true;
  if (/"verification_status"\s*:\s*"pending_unverified"/.test(json)) return true;
  if (/OCR_FULL_TEXT|ocr_full_text|extracted_text_dump/.test(json)) return true;
  if (/pre_decision|direction_compose|five_block_compose/.test(json)) return true;
  return false;
}

export function buildOnePathClaudeFirstRequest({
  question = "",
  history = [],
  pdfBase64 = null,
  pdfMediaType = null,
  pdfMeta = null,
  pdfAttachments = null,
  policyTruthContext = null,
  liveTools = null,
  customerRelationshipState = null,
  customerId = null,
  conversationId = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  originalDeliveryReason = null,
  priorConsultation = null,
  readyCardMeta = null,
  hasOwnedVaultOriginals = false,
  memoryQueryFailed = false,
  memoryLoadStatus = null,
} = {}) {
  const ownedOriginals = normalizeOwnedOriginals({
    pdfBase64,
    pdfMediaType,
    pdfMeta,
    pdfAttachments,
  });
  const multiAttachments = ownedOriginalsToMultiAttachments(ownedOriginals);
  const memory = buildConfirmedCustomerMemoryBrief({
    policyTruthContext,
    history,
  });
  const relationshipState =
    customerRelationshipState && typeof customerRelationshipState === "object"
      ? customerRelationshipState
      : resolveKeyCustomerRelationshipState({
          customerId,
          conversationId,
          history,
          confirmedContracts: policyTruthContext?.confirmed_contracts,
          priorConsultation,
          readyCardMeta,
          currentTurnDocumentIds,
          explicitReopenDocumentIds,
          originalDeliveryReason,
          ownedOriginalSources: ownedOriginals.map((o) => o.source),
          hasOwnedVaultOriginals,
          memoryQueryFailed,
          memoryLoadStatus,
        });
  const systemText = buildOnePathMinimalSystem({
    hasOriginals: ownedOriginals.length > 0,
    relationshipState,
  });
  const system = [{ type: "text", text: systemText }];

  const content = [
    {
      type: "text",
      text: JSON.stringify({
        TURN_MODE: ONE_PATH_LIVE_MODE,
        provider_round_target: 1,
        customer_relationship_state: {
          authority: relationshipState.authority,
          relationship: relationshipState.relationship,
          conversation: relationshipState.conversation,
          prior_original_in_same_conversation:
            relationshipState.prior_original_in_same_conversation === true,
          states: relationshipState.states,
          memory_availability: relationshipState.memory_availability,
          memory_query_failed: relationshipState.memory_query_failed === true,
        },
        customer_memory: {
          status: relationshipState.memory_availability,
          confirmed_contracts: memory.confirmed_contracts,
          recent_conversation: memory.recent_conversation,
        },
        owned_originals_meta: ownedOriginals.map((o) => ({
          document_id: o.document_id,
          mime_type: o.mime_type,
          sha256: o.sha256,
          source: o.source,
          ownership_verified: o.ownership_verified,
        })),
      }),
    },
  ];

  const providerBlocks = buildProviderBlocksFromOwnedOriginals(ownedOriginals);
  for (const block of providerBlocks) {
    content.push(block);
  }

  content.push({
    type: "text",
    text: [
      "[CURRENT_CUSTOMER_REQUEST — HIGHEST RESPONSE PRIORITY]",
      String(question ?? ""),
    ].join("\n"),
  });

  const messages = [{ role: "user", content }];
  // Public web_search only when no private-doc dependency — keep tools empty for one-path default.
  // Caller may pass liveTools; we mount none by default (Claude reads originals).
  void liveTools;
  const tools = [];

  const selection_plan = {
    selected_prompt_blocks: ["ONE_PATH_MINIMAL"],
    selected_resource_packets: ownedOriginals.map((o) => ({
      packet_id: `attachment_packet_${o.document_id}`,
      current_turn_attachment: o.source === "current_upload",
      source_type: "owned_original",
    })),
    unresolved_material_selection: [],
    one_shot_input_sufficient: true,
    web_tool_candidate: false,
    current_attachment_mode: ownedOriginals.length ? "CONTENT_FIRST" : "NOT_RELEVANT",
    live_request_mode: ONE_PATH_LIVE_MODE,
    key_final_insurance_judgment_before_claude: false,
  };

  return {
    system,
    messages,
    tools,
    selection_plan,
    owned_originals: ownedOriginals,
    multi_attachments: multiAttachments,
    customer_relationship_state: relationshipState,
    inventory: {
      live_request_mode: ONE_PATH_LIVE_MODE,
      owned_original_count: ownedOriginals.length,
      confirmed_memory_count: memory.confirmed_contracts.length,
      history_turn_count: memory.recent_conversation.length,
      relationship: relationshipState.relationship,
      conversation: relationshipState.conversation,
      memory_availability: relationshipState.memory_availability,
      full_chart_present: false,
      full_ledger_present: false,
      pending_extract_present: false,
      ocr_text_present: false,
    },
    metrics: {
      live_request_mode: ONE_PATH_LIVE_MODE,
      provider_round_target: 1,
      owned_original_count: ownedOriginals.length,
    },
    meta: {
      LIVE_REQUEST_MODE: ONE_PATH_LIVE_MODE,
      DEFAULT_PROVIDER_CALL_TARGET: 1,
      KEY_FINAL_INSURANCE_JUDGMENT_BEFORE_CLAUDE: false,
      OCR_EXTRACT_PENDING_IN_PROVIDER: 0,
      PRE_S3_FULL_ASSEMBLE: 0,
      CUSTOMER_RELATIONSHIP: relationshipState.relationship,
      CUSTOMER_CONVERSATION: relationshipState.conversation,
    },
  };
}

/**
 * Customer-answer path: never skip Provider for empty contracts / OCR / pending.
 * Hard failures (auth/ownership/bytes) are handled outside this function.
 */
export function shouldSkipProviderOnCustomerAnswerPath() {
  return false;
}

/** Build pending KEY candidates from Claude sidecar (no confirmed promotion). */
export function buildKeyMemoryCandidatesFromSidecar(raw = null, defaults = {}) {
  if (!raw || typeof raw !== "object") return [];
  const defaultDoc =
    String(defaults.source_document_id ?? "").trim() || null;
  const turnId = String(defaults.turn_id ?? "").trim() || null;
  const customerId = String(defaults.customer_id ?? "").trim() || null;
  const now = defaults.observed_at || new Date().toISOString();
  const out = [];

  const push = (kind, value, extra = {}) => {
    const v = value == null ? "" : String(value).trim();
    if (!v) return;
    out.push({
      kind: String(kind || "observation").trim() || "observation",
      value: v,
      source_document_id: extra.source_document_id || defaultDoc,
      source_location: extra.source_location || null,
      confidence: extra.confidence || null,
      customer_id: customerId,
      turn_id: turnId,
      observed_at: now,
      status: "pending_unverified",
      confirmed_promotion: 0,
    });
  };

  if (Array.isArray(raw.key_memory_candidates)) {
    for (const row of raw.key_memory_candidates) {
      if (!row || typeof row !== "object") continue;
      push(row.kind || row.type, row.value || row.observed_value, {
        source_document_id: row.source_document_id,
        source_location: row.source_location || row.source_page_or_image || null,
        confidence: row.confidence || null,
      });
    }
  }
  if (Array.isArray(raw.policy_inventory_facts)) {
    for (const row of raw.policy_inventory_facts) {
      if (!row || typeof row !== "object") continue;
      if (row.insurer) push("insurer_name", row.insurer, row);
      if (row.product_name) push("product_name", row.product_name, row);
      if (row.policy_number) push("policy_number", row.policy_number, row);
    }
  }
  if (Array.isArray(raw.coverage_facts)) {
    for (const row of raw.coverage_facts) {
      if (!row || typeof row !== "object") continue;
      if (row.coverage_name) {
        push("coverage_name", row.coverage_name, {
          source_document_id: row.source_document_id,
          source_location: row.source_locator
            ? JSON.stringify(row.source_locator)
            : null,
          confidence: null,
        });
      }
    }
  }
  return out.slice(0, 40);
}
