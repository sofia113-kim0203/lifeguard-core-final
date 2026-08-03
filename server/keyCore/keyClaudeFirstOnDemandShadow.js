/**
 * TOKEN BOMB S1 — On-demand Shadow request builder (Candidate only).
 * Builds DECIDE_OR_ANSWER shadow bodies for size/composition compare.
 * Never sent to Provider in this slice. Live Claude body stays unchanged.
 */

import { createHash } from "node:crypto";

export const KEY_ON_DEMAND_DECIDE_OR_ANSWER_PROMPT = `[KEY_ON_DEMAND_DECIDE_OR_ANSWER]
이번 요청에는 고객 질문과 최소 대화 맥락,
RESOURCE_MANIFEST와 AUTHORITY_MANIFEST만 제공될 수 있다.
RESOURCE_MANIFEST의 resource_available=true는
KEY가 해당 자료를 공급할 수 있다는 뜻이다.
content_provided=true인 경우에만
그 자료 또는 사실의 실제 내용이 이번 요청에 제공된 것이다.
목록에 자료가 있다는 이유로
원본·차트·장부·기억·검색 결과의 내용이
이미 제공됐다고 가정하지 않는다.
현재 실제로 제공된 내용만으로 고객 질문에 충분히 답할 수 있으면
FINAL_ANSWER를 선택한다.
고객의 판단이나 결론을 실제로 바꾸는 핵심 자료가 부족하면
필요한 resource_id와 fact_scope만 MATERIAL_REQUEST로 지정한다.
단순히 더 많은 자료가 있으면 좋다는 이유로 요청하지 않는다.
“관련 자료 전체”를 요청하지 않는다.
DECIDE_OR_ANSWER 단계에서 MATERIAL_REQUEST를 선택했다면
고객용 임시 답변, 추천, 권유, 선제 설명과 후속 조치를 출력하지 않는다.
자료가 없거나 공급할 수 없더라도 동일 요청을 반복하지 않는다.
확인 가능한 범위와 한계를 반영해 같은 Claude가 최종 답변할 수 있어야 한다.
확정 계약 수와 목록은 지정된 확정 권위에서만 사용한다.
담보 행 수, 문서 수, 고객 진술, 과거 KEY 답변 또는 일부 원본의 숫자로
전체 계약 수를 만들지 않는다.
검토 후보 문서 사실을 고객의 확정 가입 사실로 바꾸지 않는다.
partial 또는 unknown 자료를 전체 확인으로 표현하지 않는다.
FINAL_ANSWER를 선택한 경우에는
현재 질문에 직접 답하고,
근거가 충분한 판단·추천·권유,
고객이 미리 알아야 할 내용과 실제 다음 행동을
자연스럽고 완결된 하나의 KEY 답변으로 제공한다.`;

const SHADOW_BASE_IDENTITY = [
  "너는 고객이 만나는 유일한 AI 보험 주치의 KEY다.",
  "사실의 범위 안에서 책임 있게 판단한다.",
  "내부 시스템·필드명·JSON·sidecar를 고객에게 노출하지 않는다.",
  "TURN_MODE=DECIDE_OR_ANSWER 이다.",
  "AUTHORITY_MANIFEST가 없거나 content_provided=false인 fact_scope는",
  "고객별 확정 계약 수·목록·담보를 새로 만들지 않는다.",
].join("\n");

export const ACTION_SEMANTIC_CONTRACT = Object.freeze({
  REQUEST_TRANSPORT_SELECTED: false,
  actions: ["FINAL_ANSWER", "MATERIAL_REQUEST"],
  material_request_fields: [
    "RESOURCE_ID",
    "FACT_SCOPE",
    "REASON_CODE",
    "NEEDS_WEB_VERIFICATION",
    "SEARCH_SCOPE",
    "CAN_FINALIZE_IF_UNAVAILABLE",
  ],
});

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function stableResourceHash(resourceId = "") {
  const raw = String(resourceId ?? "").trim();
  if (!raw) return "res_empty";
  return `rh_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

function utf8Bytes(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

function stripBase64ForHash(node) {
  if (Array.isArray(node)) return node.map(stripBase64ForHash);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "data" && typeof v === "string" && v.length > 32) {
      out[k] = `__omitted_b64_len_${v.length}__`;
      continue;
    }
    if (k === "base64" && typeof v === "string") {
      out[k] = `__omitted_b64_len_${v.length}__`;
      continue;
    }
    out[k] = stripBase64ForHash(v);
  }
  return out;
}

export function stableBodyHash(body) {
  const canonical = JSON.stringify(stripBase64ForHash(body ?? {}));
  return createHash("sha256").update(canonical).digest("hex");
}

function isNonEmptyObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Size/composition metrics for an Anthropic-shaped body. No raw customer content.
 */
export function measureAnthropicRequestMetrics({
  system = null,
  messages = null,
  tools = null,
  inventory = null,
} = {}) {
  const systemBlocks = Array.isArray(system) ? system : [];
  const msgs = Array.isArray(messages) ? messages : [];
  let systemChars = 0;
  for (const b of systemBlocks) {
    systemChars += String(b?.text ?? "").length;
  }
  let userTextChars = 0;
  let imageCount = 0;
  let imageTotalBytes = 0;
  for (const msg of msgs) {
    const content = Array.isArray(msg?.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === "text") {
        userTextChars += String(block.text ?? "").length;
        continue;
      }
      if (block?.type === "image" || block?.type === "document") {
        imageCount += 1;
        const data = block?.source?.data ?? block?.data ?? "";
        if (typeof data === "string" && data) {
          imageTotalBytes += Math.floor((data.length * 3) / 4);
        }
      }
    }
  }
  const toolList = Array.isArray(tools) ? tools : [];
  const body = { system: systemBlocks, messages: msgs, tools: toolList };
  const bodyJson = JSON.stringify(body);
  const totalChars = bodyJson.length;
  const totalBytes = utf8Bytes(bodyJson);
  const inv = inventory && typeof inventory === "object" ? inventory : {};
  return {
    total_chars: totalChars,
    total_bytes: totalBytes,
    system_chars: systemChars,
    user_text_chars: userTextChars,
    image_count: imageCount,
    image_total_bytes: imageTotalBytes,
    system_block_count: systemBlocks.length,
    message_count: msgs.length,
    tool_count: toolList.length,
    web_tool_present: toolList.some(
      (t) =>
        String(t?.type ?? "").includes("web_search") ||
        String(t?.name ?? "").includes("web_search"),
    ),
    resource_manifest_count: Array.isArray(inv.resource_manifest)
      ? inv.resource_manifest.length
      : 0,
    authority_entry_count: Number(inv.authority_entry_count) || 0,
    full_chart_present: inv.full_chart_present === true,
    full_ledger_present: inv.full_ledger_present === true,
    prior_consultation_present: inv.prior_consultation_present === true,
    prior_original_present: inv.prior_original_present === true,
    current_attachment_content_present: inv.current_attachment_content_present === true,
    body_hash: stableBodyHash(body),
  };
}

function buildManifestItem({
  resourceId,
  resourceType,
  safeLabel,
  verificationStatus = "unknown",
  availableFactScopes = [],
  resourceAvailable = true,
  contentProvided = false,
  currentTurnAttachment = false,
  originalAvailable = false,
  observedAt = null,
}) {
  return {
    resource_id: stableResourceHash(resourceId),
    resource_type: String(resourceType ?? "unknown"),
    safe_label: String(safeLabel ?? resourceType ?? "resource"),
    verification_status: String(verificationStatus ?? "unknown"),
    available_fact_scopes: Array.isArray(availableFactScopes)
      ? availableFactScopes.map(String)
      : [],
    resource_available: resourceAvailable === true,
    content_provided: contentProvided === true,
    current_turn_attachment: currentTurnAttachment === true,
    original_available: originalAvailable === true,
    observed_at: observedAt == null ? null : String(observedAt),
  };
}

/**
 * Index-only RESOURCE_MANIFEST from availability flags / synthetic fixture inputs.
 * Never embeds chart/ledger/memory bodies or base64.
 */
export function buildOnDemandResourceManifest({
  chartAvailable = false,
  ledgerAvailable = false,
  readyCardAvailable = false,
  priorConsultationAvailable = false,
  memoryAvailable = false,
  claimBriefAvailable = false,
  insuranceClockAvailable = false,
  lifeLedgerAvailable = false,
  paymentTruthAvailable = false,
  signupAvailable = false,
  currentAttachments = [],
  priorOriginalsAvailable = false,
} = {}) {
  const items = [];
  if (chartAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "verified_customer_chart",
        resourceType: "verified_customer_chart",
        safeLabel: "verified_customer_chart",
        verificationStatus: "verified_available",
        availableFactScopes: ["verified_confirmed_coverages", "review_candidates"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (ledgerAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "verified_policy_ledger",
        resourceType: "verified_policy_ledger",
        safeLabel: "verified_policy_ledger",
        verificationStatus: "verified_available",
        availableFactScopes: ["confirmed_contract_count", "confirmed_contract_list"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (readyCardAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "ready_card",
        resourceType: "ready_card",
        safeLabel: "ready_card",
        availableFactScopes: ["ready_card_meta"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (priorConsultationAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "prior_consultation",
        resourceType: "prior_consultation",
        safeLabel: "prior_consultation",
        availableFactScopes: ["prior_consultation_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (memoryAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "memory_bundle",
        resourceType: "memory_bundle",
        safeLabel: "memory_bundle",
        availableFactScopes: ["memory_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (claimBriefAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "claim_brief",
        resourceType: "claim_brief",
        safeLabel: "claim_brief",
        availableFactScopes: ["active_claim_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (insuranceClockAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "insurance_clock",
        resourceType: "insurance_clock",
        safeLabel: "insurance_clock",
        availableFactScopes: ["clock_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (lifeLedgerAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "life_ledger",
        resourceType: "life_ledger",
        safeLabel: "life_ledger",
        availableFactScopes: ["life_ledger_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (paymentTruthAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "payment_truth",
        resourceType: "payment_truth",
        safeLabel: "payment_truth",
        availableFactScopes: ["payment_truth_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (signupAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "signup_onboarding",
        resourceType: "signup_onboarding",
        safeLabel: "signup_onboarding",
        availableFactScopes: ["signup_index"],
        resourceAvailable: true,
        contentProvided: false,
      }),
    );
  }
  if (priorOriginalsAvailable) {
    items.push(
      buildManifestItem({
        resourceId: "prior_vault_originals",
        resourceType: "prior_original",
        safeLabel: "prior_original_index",
        availableFactScopes: ["prior_original_index"],
        resourceAvailable: true,
        contentProvided: false,
        originalAvailable: true,
      }),
    );
  }
  const attaches = Array.isArray(currentAttachments) ? currentAttachments : [];
  for (let i = 0; i < attaches.length; i += 1) {
    const row = attaches[i] || {};
    const id = String(row.document_id ?? `current_attach_${i + 1}`).trim();
    items.push(
      buildManifestItem({
        resourceId: id,
        resourceType: "current_turn_attachment",
        safeLabel: `current_attachment_${i + 1}`,
        verificationStatus: "current_turn",
        availableFactScopes: ["current_original"],
        resourceAvailable: true,
        contentProvided: false,
        currentTurnAttachment: true,
        originalAvailable: Boolean(row.base64 || row.bytes_available),
      }),
    );
  }
  return items;
}

export function buildOnDemandAuthorityManifest({
  ledgerAvailable = false,
  chartAvailable = false,
  currentAttachments = [],
  contentProvideCurrentAttachments = false,
  evidenceScope = "unknown",
  publicEvidenceStatus = "not_available",
} = {}) {
  const ledgerHash = stableResourceHash("verified_policy_ledger");
  const chartHash = stableResourceHash("verified_customer_chart");
  const attachCount = Array.isArray(currentAttachments) ? currentAttachments.length : 0;
  const providedCount =
    contentProvideCurrentAttachments === true ? attachCount : 0;
  return {
    confirmed_contract_count: {
      resource_id: ledgerHash,
      fact_scope: "confirmed_contract_count",
      resource_available: ledgerAvailable === true,
      content_provided: false,
    },
    confirmed_contract_list: {
      resource_id: ledgerHash,
      fact_scope: "confirmed_contract_list",
      resource_available: ledgerAvailable === true,
      content_provided: false,
    },
    confirmed_coverage_details: {
      resource_id: chartHash,
      fact_scope: "verified_confirmed_coverages",
      resource_available: chartAvailable === true,
      content_provided: false,
    },
    review_candidate_details: {
      resource_id: chartHash,
      fact_scope: "review_candidates",
      resource_available: chartAvailable === true,
      content_provided: false,
    },
    current_originals: {
      resource_available_count: attachCount,
      content_provided_count: providedCount,
    },
    evidence_scope: ["complete", "partial", "unknown"].includes(evidenceScope)
      ? evidenceScope
      : "unknown",
    public_evidence_status: ["provided", "available", "not_available"].includes(
      publicEvidenceStatus,
    )
      ? publicEvidenceStatus
      : "not_available",
  };
}

function countAuthorityEntries(authority) {
  if (!authority || typeof authority !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(authority)) {
    if (k === "evidence_scope" || k === "public_evidence_status") continue;
    if (k === "current_originals") {
      n += 1;
      continue;
    }
    if (v && typeof v === "object") n += 1;
  }
  return n;
}

/**
 * Minimal thread: last few role+text turns only (synthetic/safe). Not full history dump.
 */
export function buildMinimalThreadContext({
  minimalThread = null,
  history = null,
  maxTurns = 2,
} = {}) {
  if (Array.isArray(minimalThread) && minimalThread.length) {
    return deepClone(minimalThread).slice(-Math.max(1, maxTurns));
  }
  if (!Array.isArray(history) || !history.length) return [];
  return history
    .slice(-Math.max(1, maxTurns))
    .map((row) => ({
      role: String(row?.role ?? "user"),
      text: String(row?.text ?? row?.content ?? "").slice(0, 240),
    }));
}

function buildShadowSystemText() {
  return `${SHADOW_BASE_IDENTITY}\n\n${KEY_ON_DEMAND_DECIDE_OR_ANSWER_PROMPT}`;
}

function buildCurrentQuestionPriorityText(question = "") {
  const q = String(question ?? "");
  return [
    "[CURRENT_CUSTOMER_REQUEST — HIGHEST RESPONSE PRIORITY]",
    q,
    "[RESPONSE_SCOPE]",
    "최종 답변의 범위는 현재 고객 요청이 결정한다.",
    "TURN_MODE=DECIDE_OR_ANSWER 에서는 MATERIAL_REQUEST 시 고객용 반쪽 답변을 쓰지 않는다.",
  ].join("\n");
}

function buildImageBlock(row) {
  const data = String(row?.base64 ?? "").trim();
  if (!data) return null;
  const mediaType = String(row?.mediaType ?? "image/jpeg").trim() || "image/jpeg";
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data,
    },
  };
}

function detectLiveHeavyFlags(liveUserPayload = null, liveBody = null) {
  const payloadJson = liveUserPayload ? JSON.stringify(liveUserPayload) : "";
  const bodyJson = liveBody ? JSON.stringify(stripBase64ForHash(liveBody)) : "";
  const hay = `${payloadJson}\n${bodyJson}`;
  return {
    full_chart_present:
      /"verified_customer_chart"|verified_document_coverages|review_candidates/.test(
        hay,
      ) && /"available_verified_evidence"|"personal_chart"|"key_confirmed_source_facts"/.test(hay)
        ? true
        : /verified_document_coverages/.test(hay) && hay.length > 2000,
    full_ledger_present: /VERIFIED_POLICY_LEDGER|confirmed_contracts|active_distinct_count/.test(
      hay,
    ),
    prior_consultation_present: /prior_consultation|related_turns|PRIOR_ASSISTANT/.test(hay),
    prior_original_present:
      /retained_past_originals|vault_document|previous_turn_attachment/.test(hay) &&
      /"type":"image"|"type":"document"/.test(bodyJson),
  };
}

function buildOneShadowBody({
  question,
  minimalThread,
  resourceManifest,
  authorityManifest,
  liveTools = null,
  includeTools = true,
  currentAttachments = [],
  contentProvideAttachments = false,
  variant,
}) {
  const systemText = buildShadowSystemText();
  const system = [{ type: "text", text: systemText }];
  const packet = {
    TURN_MODE: "DECIDE_OR_ANSWER",
    RESOURCE_MANIFEST: resourceManifest,
    AUTHORITY_MANIFEST: authorityManifest,
    ACTION_SEMANTIC_CONTRACT: ACTION_SEMANTIC_CONTRACT,
    minimal_thread: minimalThread,
    note: "index_only_first_request_content_provided_false_unless_attachment_variant_A",
  };
  const content = [{ type: "text", text: JSON.stringify(packet) }];
  if (contentProvideAttachments === true) {
    for (const row of currentAttachments) {
      const block = buildImageBlock(row);
      if (block) content.push(block);
    }
  }
  content.push({
    type: "text",
    text: buildCurrentQuestionPriorityText(question),
  });
  const messages = [{ role: "user", content }];
  const tools =
    includeTools === true && Array.isArray(liveTools) ? deepClone(liveTools) : [];
  const inventory = {
    variant,
    turn_mode: "DECIDE_OR_ANSWER",
    resource_manifest: deepClone(resourceManifest),
    authority_manifest: deepClone(authorityManifest),
    action_semantic_contract: deepClone(ACTION_SEMANTIC_CONTRACT),
    authority_entry_count: countAuthorityEntries(authorityManifest),
    full_chart_present: false,
    full_ledger_present: false,
    prior_consultation_present: false,
    prior_original_present: false,
    current_attachment_content_present:
      contentProvideAttachments === true &&
      currentAttachments.some((r) => String(r?.base64 ?? "").trim()),
    current_attachment_policy:
      variant === "content_first"
        ? "CURRENT_ATTACHMENT_CONTENT_FIRST"
        : "CURRENT_ATTACHMENT_MANIFEST_FIRST",
    current_attachment_policy_selected: false,
    request_transport_selected: false,
    web_search_placement_selected: false,
    key_preclassifier: false,
    decision_owner: "SAME_CLAUDE",
  };
  const metrics = measureAnthropicRequestMetrics({
    system,
    messages,
    tools,
    inventory,
  });
  return {
    system: deepClone(system),
    messages: deepClone(messages),
    tools: deepClone(tools),
    inventory: deepClone(inventory),
    metrics,
  };
}

/**
 * Build A/B Shadow bodies. Deep-independent from live objects.
 * Never pass return value to fetchImpl.
 */
export function buildClaudeFirstOnDemandShadowBodies({
  question = "",
  history = null,
  minimalThread = null,
  chart = null,
  policyTruthContext = null,
  readyCardMeta = null,
  priorConsultation = null,
  keyRelevantMemoryPacket = null,
  activeClaimCases = null,
  insuranceClockBrief = null,
  lifeLedgerBrief = null,
  paymentTruthBrief = null,
  signupOnboardingBrief = null,
  currentAttachments = null,
  priorOriginalsAvailable = false,
  liveTools = null,
  evidenceScope = "unknown",
  publicEvidenceStatus = "not_available",
} = {}) {
  const attaches = Array.isArray(currentAttachments)
    ? currentAttachments.map((row) => ({
        document_id: String(row?.document_id ?? "").trim() || null,
        mediaType: row?.mediaType ?? row?.media_type ?? "image/jpeg",
        base64: typeof row?.base64 === "string" ? row.base64 : "",
        bytes_available: Boolean(row?.base64 || row?.bytes_available),
      }))
    : [];

  const chartAvailable = isNonEmptyObject(chart);
  const ledgerAvailable = Boolean(
    policyTruthContext?.verified_policy_ledger ||
      policyTruthContext?.VERIFIED_POLICY_LEDGER ||
      hasNonEmptyArray(policyTruthContext?.confirmed_contracts) ||
      Number.isFinite(Number(policyTruthContext?.active_distinct_count)),
  );
  const availability = {
    chartAvailable,
    ledgerAvailable,
    readyCardAvailable: isNonEmptyObject(readyCardMeta),
    priorConsultationAvailable: isNonEmptyObject(priorConsultation),
    memoryAvailable: isNonEmptyObject(keyRelevantMemoryPacket),
    claimBriefAvailable: hasNonEmptyArray(activeClaimCases),
    insuranceClockAvailable: isNonEmptyObject(insuranceClockBrief),
    lifeLedgerAvailable: isNonEmptyObject(lifeLedgerBrief),
    paymentTruthAvailable: isNonEmptyObject(paymentTruthBrief),
    signupAvailable: isNonEmptyObject(signupOnboardingBrief),
    currentAttachments: attaches,
    priorOriginalsAvailable: priorOriginalsAvailable === true,
  };

  const resourceManifest = buildOnDemandResourceManifest(availability);
  const authorityManifestBase = buildOnDemandAuthorityManifest({
    ledgerAvailable,
    chartAvailable,
    currentAttachments: attaches,
    contentProvideCurrentAttachments: false,
    evidenceScope,
    publicEvidenceStatus,
  });
  const authorityManifestContent = buildOnDemandAuthorityManifest({
    ledgerAvailable,
    chartAvailable,
    currentAttachments: attaches,
    contentProvideCurrentAttachments: true,
    evidenceScope,
    publicEvidenceStatus,
  });
  const thread = buildMinimalThreadContext({
    minimalThread,
    history,
    maxTurns: 2,
  });

  const contentFirst = buildOneShadowBody({
    question,
    minimalThread: thread,
    resourceManifest: deepClone(resourceManifest).map((row) => {
      if (row.current_turn_attachment === true) {
        return { ...row, content_provided: true };
      }
      return { ...row, content_provided: false };
    }),
    authorityManifest: authorityManifestContent,
    liveTools,
    includeTools: true,
    currentAttachments: attaches,
    contentProvideAttachments: true,
    variant: "content_first",
  });

  const manifestFirst = buildOneShadowBody({
    question,
    minimalThread: thread,
    resourceManifest: deepClone(resourceManifest).map((row) => ({
      ...row,
      content_provided: false,
    })),
    authorityManifest: authorityManifestBase,
    liveTools,
    includeTools: true,
    currentAttachments: attaches,
    contentProvideAttachments: false,
    variant: "manifest_first",
  });

  // Tools-excluded metrics companions (not provider bodies).
  contentFirst.metrics_tools_excluded = measureAnthropicRequestMetrics({
    system: contentFirst.system,
    messages: contentFirst.messages,
    tools: [],
    inventory: contentFirst.inventory,
  });
  manifestFirst.metrics_tools_excluded = measureAnthropicRequestMetrics({
    system: manifestFirst.system,
    messages: manifestFirst.messages,
    tools: [],
    inventory: manifestFirst.inventory,
  });

  return {
    content_first: contentFirst,
    manifest_first: manifestFirst,
    meta: {
      FIRST_TURN_MODE_CANDIDATE: "DECIDE_OR_ANSWER",
      DECISION_OWNER: "SAME_CLAUDE",
      KEY_PRECLASSIFIER: 0,
      CURRENT_ATTACHMENT_POLICY_SELECTED: false,
      REQUEST_TRANSPORT_SELECTED: false,
      WEB_SEARCH_PLACEMENT_SELECTED: false,
      SHADOW_PROVIDER_CALL: 0,
    },
  };
}

export function compareLiveAndShadowBodies({
  liveBody = null,
  liveUserPayload = null,
  liveTools = null,
  shadow = null,
} = {}) {
  const heavy = detectLiveHeavyFlags(liveUserPayload, liveBody);
  const liveSystem = liveBody?.system ?? null;
  const liveMessages = liveBody?.messages ?? null;
  const liveMetrics = measureAnthropicRequestMetrics({
    system: liveSystem,
    messages: liveMessages,
    tools: liveTools ?? liveBody?.tools ?? null,
    inventory: {
      ...heavy,
      current_attachment_content_present:
        Number(measureAnthropicRequestMetrics({
          system: liveSystem,
          messages: liveMessages,
          tools: [],
        }).image_count) > 0,
      resource_manifest: [],
      authority_entry_count: 0,
    },
  });
  liveMetrics.full_chart_present = heavy.full_chart_present;
  liveMetrics.full_ledger_present = heavy.full_ledger_present;
  liveMetrics.prior_consultation_present = heavy.prior_consultation_present;
  liveMetrics.prior_original_present = heavy.prior_original_present;

  const cf = shadow?.content_first?.metrics || measureAnthropicRequestMetrics({});
  const mf = shadow?.manifest_first?.metrics || measureAnthropicRequestMetrics({});
  const liveBytes = Number(liveMetrics.total_bytes) || 0;
  const cfBytes = Number(cf.total_bytes) || 0;
  const mfBytes = Number(mf.total_bytes) || 0;
  const ratio = (live, shadowBytes) =>
    live > 0 ? Number(((live - shadowBytes) / live).toFixed(6)) : 0;

  return {
    LIVE_CURRENT: liveMetrics,
    SHADOW_CONTENT_FIRST: cf,
    SHADOW_MANIFEST_FIRST: mf,
    shadow_content_first_byte_reduction: Math.max(0, liveBytes - cfBytes),
    shadow_manifest_first_byte_reduction: Math.max(0, liveBytes - mfBytes),
    shadow_content_first_reduction_ratio: ratio(liveBytes, cfBytes),
    shadow_manifest_first_reduction_ratio: ratio(liveBytes, mfBytes),
    CURRENT_ATTACHMENT_POLICY_SELECTED: false,
    REQUEST_TRANSPORT_SELECTED: false,
  };
}

/**
 * Safe provider-fetch observation record (no body/system/question/base64).
 */
export function buildProviderFetchObservation({
  providerFetchIndex = 0,
  body = null,
  stopReason = null,
  usage = null,
  serverToolUseCount = 0,
  webSearchResultCount = 0,
  webSearchErrorPresent = false,
  priorHeavyContextReplayed = false,
} = {}) {
  const metrics = measureAnthropicRequestMetrics({
    system: body?.system,
    messages: body?.messages,
    tools: body?.tools,
  });
  return {
    provider_fetch_index: Number(providerFetchIndex) || 0,
    body_chars: metrics.total_chars,
    body_bytes: metrics.total_bytes,
    system_chars: metrics.system_chars,
    system_block_count: metrics.system_block_count,
    message_count: metrics.message_count,
    image_block_count: metrics.image_count,
    image_total_bytes: metrics.image_total_bytes,
    tool_count: metrics.tool_count,
    body_hash: metrics.body_hash,
    stop_reason: stopReason == null ? null : String(stopReason),
    server_tool_use_count: Number(serverToolUseCount) || 0,
    web_search_result_count: Number(webSearchResultCount) || 0,
    web_search_error_present: webSearchErrorPresent === true,
    usage:
      usage && typeof usage === "object"
        ? {
            input_tokens: Number(usage.input_tokens) || 0,
            output_tokens: Number(usage.output_tokens) || 0,
            cache_creation_input_tokens:
              Number(usage.cache_creation_input_tokens) || 0,
            cache_read_input_tokens: Number(usage.cache_read_input_tokens) || 0,
          }
        : null,
    prior_heavy_context_replayed: priorHeavyContextReplayed === true,
  };
}

export function assertNoRawCustomerTelemetry(obj) {
  const s = JSON.stringify(obj);
  if (/data:image\/|base64,[A-Za-z0-9+/]{80,}/.test(s)) {
    throw new Error("RAW_CUSTOMER_CONTENT_IN_TELEMETRY:base64");
  }
  if (/주민등록|전화번호|010-\d{4}|contract_number"\s*:\s*"[A-Z0-9-]{8,}/i.test(s)) {
    throw new Error("RAW_CUSTOMER_CONTENT_IN_TELEMETRY:pii_pattern");
  }
  return true;
}
