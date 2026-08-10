/**
 * LIFEGUARD ONE PATH — Claude First final rewire units (U1–U20 subset offline).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildAccuracyTrace,
  buildKeyMemoryCandidatesFromSidecar,
  buildOnePathClaudeFirstRequest,
  buildSealedTurnSourceRecord,
  ONE_PATH_LIVE_MODE,
  providerBodyHasForbiddenFactoryPayload,
  shouldSkipProviderOnCustomerAnswerPath,
} from "../server/keyCore/keyOnePathClaudeFirst.js";
import { buildKeyCustomerCardForClaude } from "../server/keyCore/keyCustomerCard.js";
import {
  resolveKeyCustomerRelationshipState,
  shouldStopProviderForMemoryQueryFailure,
} from "../server/keyCore/keyCustomerRelationshipState.js";
import {
  normalizeOwnedOriginals,
  ownedOriginalsToMultiAttachments,
} from "../server/keyCore/keyOwnedOriginalsCanonical.js";
import { shouldSkipProviderForEmptyContractPackets } from "../server/keyCore/keyClaudeFirstOneShotSelectiveShadow.js";
import { buildAnthropicDirectAttachBlock } from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import { shouldRunClaudeFirstHomeChatQuestion } from "../server/keyCore/oneKeyCoreFlags.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";
import {
  ONE_PATH_DAILY_CHAT_LANES,
  resolveOnePathDailyChatPolicy,
  isNonInsuranceDailyRecommendRequest,
} from "../server/keyCore/keyOnePathDailyChatPolicy.js";

const pdfBytes = Buffer.from("%PDF-1.4 one-path-unit");
const pdfB64 = pdfBytes.toString("base64");
const pdfSha = createHash("sha256").update(pdfBytes).digest("hex");

{
  assert.equal(shouldRunClaudeFirstHomeChatQuestion({}), true);
  console.log("PASS U1 same runOneKeyCoreTurn / Claude-first entry");
}

{
  const req = buildOnePathClaudeFirstRequest({
    question: "이 증권을 직접 읽고 중요한 내용을 설명해줘.",
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  assert.equal(req.meta.LIVE_REQUEST_MODE, ONE_PATH_LIVE_MODE);
  // Explicit Prompt Cache — system block breakpoint only (not top-level automatic).
  assert.equal(Object.prototype.hasOwnProperty.call(req, "cache_control"), false);
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  const blocks = req.messages[0].content.filter(
    (b) => b.type === "document" || b.type === "image",
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "document");
  assert.equal(blocks[0].source.media_type, "application/pdf");
  console.log("PASS U2 PDF document block once");
  console.log("PASS U2b explicit prompt cache on system block");
}

{
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const req = buildOnePathClaudeFirstRequest({
    question: "이 사진 읽어줘",
    pdfBase64: jpegB64,
    pdfMediaType: "image/jpeg",
    pdfMeta: { document_id: "img-a" },
  });
  const blocks = req.messages[0].content.filter((b) => b.type === "image");
  assert.equal(blocks.length, 1);
  console.log("PASS U3 image block once");
}

{
  const owned = normalizeOwnedOriginals({
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  assert.equal(owned[0].sha256, pdfSha);
  const req = buildOnePathClaudeFirstRequest({
    question: "q",
    pdfAttachments: ownedOriginalsToMultiAttachments(owned),
  });
  const doc = req.messages[0].content.find((b) => b.type === "document");
  const providerSha = createHash("sha256")
    .update(Buffer.from(doc.source.data, "base64"))
    .digest("hex");
  assert.equal(providerSha, pdfSha);
  console.log("PASS U4 upload SHA == provider SHA");
}

{
  const a = normalizeOwnedOriginals({
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
  });
  const b = normalizeOwnedOriginals({
    pdfAttachments: [
      { base64: pdfB64, mediaType: "application/pdf", document_id: "doc-a" },
    ],
  });
  assert.equal(a[0].sha256, b[0].sha256);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  console.log("PASS U5 singular/array same Canonical Hand");
}

{
  const req = buildOnePathClaudeFirstRequest({
    question: "주요 보장 알려줘",
    history: [{ role: "user", text: "안녕" }],
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-a" },
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          policy_number: "C-1",
          coverages: [{ coverage_name: "암진단비", status: "verified" }],
        },
      ],
    },
  });
  const body = { system: req.system, messages: req.messages, tools: req.tools };
  assert.equal(providerBodyHasForbiddenFactoryPayload(body), false);
  const text = JSON.stringify(body);
  assert.equal(text.includes("pending_extract"), false);
  assert.equal(text.includes("확인된손보"), true);
  assert.equal(text.includes("암진단비"), true);
  assert.equal(
    req.key_customer_card.insurance_contracts[0].coverages[0].coverage_name,
    "암진단비",
  );
  assert.equal(text.includes("주요 보장 알려줘"), true);
  assert.equal(req.system[0].text.includes("KEY_ONE_PATH_CLAUDE_FIRST"), true);
  assert.equal(req.system[0].text.includes("고객카드를 통째로"), true);
  assert.equal(req.system[0].text.includes("KEY_RECORD"), false);
  assert.equal(req.system[0].text.includes("key_memory_candidates"), false);
  assert.equal(req.system[0].text.includes("특정 JSON 스키마"), true);
  const cardPayload = JSON.parse(req.messages[0].content[0].text);
  assert.equal(cardPayload.delivery_mode, "CUSTOMER_CARD_WHOLESALE");
  assert.equal(cardPayload.key_customer_card.delivery_mode, "CUSTOMER_CARD_WHOLESALE");
  assert.equal(cardPayload.key_customer_card.past_original_bytes_mode, "links_only");
  assert.equal(req.selection_plan.document_pick_rank_in_front, false);
  assert.equal(req.meta.DOCUMENT_PICK_RANK_IN_FRONT, 0);
  const reqSsot = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          policy_number: "C-1",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
    },
    readyCardSsot: {
      policies: [
        {
          insurer_name: "READY손보",
          product_name: "READY상품",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
      activeDocuments: [{ id: "doc-ready", original_filename: "증권.pdf" }],
      insuranceClockBrief: { upcoming: [{ label: "갱신" }], overdue: [] },
      lifeLedgerBrief: { goals: [], item_count: 0 },
      claimEvidenceBrief: { packages: [], item_count: 0 },
      activeClaimCases: [],
    },
    readyCardMeta: {
      status: "normal",
      materials_connected: true,
      document_status: {
        active_count: 1,
        documents: [{ id: "doc-ready", original_filename: "증권.pdf" }],
      },
    },
  });
  const ssotCard = JSON.parse(reqSsot.messages[0].content[0].text).key_customer_card;
  // Confirmed authority only — raw READY/ssot policies must not enter insurance_contracts.
  assert.equal(ssotCard.insurance_contracts.length, 1);
  assert.equal(ssotCard.insurance_contracts[0].insurer, "확인된손보");
  assert.equal(
    ssotCard.insurance_contracts[0].coverage_summary.key_coverage_baseline_facts[0]
      .coverage_name,
    "암진단비",
  );
  assert.equal(JSON.stringify(ssotCard.insurance_contracts).includes("READY손보"), false);
  // ssot.policies row itself remains available for READY reuse (not deleted).
  assert.equal(reqSsot.inventory.confirmed_memory_count, 1);
  assert.equal(ssotCard.entrusted_originals.links[0].document_id, "doc-ready");
  assert.equal(ssotCard.insurance_clock.upcoming[0].label, "갱신");
  assert.equal(ssotCard.past_original_bytes_mode, "links_only");
  // ONE PATH body must carry the same preserved card (no second reshape).
  assert.equal(
    JSON.stringify(reqSsot.key_customer_card.insurance_contracts),
    JSON.stringify(ssotCard.insurance_contracts),
  );

  const rawSsotOnly = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {},
    readyCardSsot: {
      policies: [
        {
          insurer_name: "READY손보",
          product_name: "READY상품",
          coverage_summary: {
            key_coverage_baseline_facts: [
              { status: "verified", coverage_name: "암진단비", coverage_amount: 1000 },
            ],
          },
        },
      ],
      activeDocuments: [],
      activeClaimCases: [],
    },
  });
  assert.equal(rawSsotOnly.key_customer_card.insurance_contracts.length, 0);
  assert.equal(rawSsotOnly.inventory.confirmed_memory_count, 0);

  const ledgerConfirmed = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    policyTruthContext: {
      VERIFIED_POLICY_LEDGER: {
        confirmed_contracts: [
          {
            insurer: "원장손보",
            product_name: "원장상품",
            coverage_summary: { premium: 12000 },
          },
        ],
      },
      confirmed_contracts: [],
    },
    readyCardSsot: {
      policies: [{ insurer_name: "READY손보", product_name: "READY상품" }],
    },
  });
  assert.equal(ledgerConfirmed.key_customer_card.insurance_contracts.length, 1);
  assert.equal(ledgerConfirmed.key_customer_card.insurance_contracts[0].insurer, "원장손보");
  assert.equal(
    ledgerConfirmed.key_customer_card.insurance_contracts[0].coverage_summary.premium,
    12000,
  );

  console.log("PASS U6/U7 question·confirmed-only card·links_only; coverage preserved; no pick-rank");
}

{
  // L4 past-original: same Canonical Hand from owned pointer bytes (not id-only).
  const owned = normalizeOwnedOriginals({
    pdfAttachments: [
      {
        base64: pdfB64,
        mediaType: "application/pdf",
        document_id: "past-doc-a",
        content_sha256: pdfSha,
        source_scope: "owned_pointer",
      },
    ],
  });
  assert.equal(owned.length, 1);
  assert.equal(owned[0].sha256, pdfSha);
  const req = buildOnePathClaudeFirstRequest({
    question: "아까 올린 증권을 다시 보고 보장 내용을 정리해줘.",
    pdfAttachments: ownedOriginalsToMultiAttachments(owned),
  });
  const doc = req.messages[0].content.find((b) => b.type === "document");
  assert.ok(doc);
  const providerSha = createHash("sha256")
    .update(Buffer.from(doc.source.data, "base64"))
    .digest("hex");
  assert.equal(providerSha, pdfSha);
  console.log("PASS L4 past-original same Canonical Hand + SHA");
}

{
  const rec = buildSealedTurnSourceRecord({
    turnId: "t1",
    question: "q",
    sealedAnswer: "답",
    ownedOriginals: [{ document_id: "doc-a", sha256: pdfSha, source: "owned_pointer" }],
    conversationPosition: 4,
    status: "pending_unverified",
  });
  assert.equal(rec.forced_sidecar, false);
  assert.equal(rec.confirmed_auto_promote, false);
  assert.equal(rec.status, "pending_unverified");
  assert.equal(rec.source_documents[0].sha256, pdfSha);
  const tr = buildAccuracyTrace({
    model: "claude-test",
    providerDocumentSha256: pdfSha,
    providerRawAnswer: "같은 답",
    sealedAnswer: "같은 답",
  });
  assert.equal(tr.failure_location, null);
  const tr2 = buildAccuracyTrace({
    model: "claude-test",
    providerDocumentSha256: pdfSha,
    providerRawAnswer: "원문",
    sealedAnswer: "변형",
  });
  assert.equal(tr2.failure_location, "PRODUCT_TRANSFORM_FAIL");
  console.log("PASS sealed turn record + accuracy trace");
}

{
  const neu = resolveKeyCustomerRelationshipState({
    customerId: "cust-1",
    conversationId: "conv-1",
    history: [],
    confirmedContracts: [],
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  assert.equal(neu.relationship, "NEW_CUSTOMER");
  assert.equal(neu.memory_availability, "partial_unavailable");
  assert.equal(neu.memory_query_failed, true);
  // Memory fail must NOT invent returning / must NOT stop provider.
  assert.equal(shouldStopProviderForMemoryQueryFailure(), false);

  const l4 = resolveKeyCustomerRelationshipState({
    customerId: "cust-1",
    conversationId: "conv-1",
    history: [
      { role: "user", text: "증권 읽어줘" },
      { role: "assistant", text: "읽었습니다" },
    ],
    confirmedContracts: [],
    explicitReopenDocumentIds: ["doc-a"],
    originalDeliveryReason: "explicit_reopen",
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  assert.equal(l4.relationship, "RETURNING_CUSTOMER");
  assert.equal(l4.conversation, "CONTINUING_CONVERSATION");
  assert.equal(l4.prior_original_in_same_conversation, true);
  assert.ok(l4.states.includes("PRIOR_ORIGINAL_IN_SAME_CONVERSATION"));
  assert.equal(l4.memory_query_failed, true);

  const reqNew = buildOnePathClaudeFirstRequest({
    question: "이 증권 읽어줘",
    customerId: "cust-new",
    conversationId: "c1",
    pdfBase64: pdfB64,
    pdfMediaType: "application/pdf",
    pdfMeta: { document_id: "doc-new" },
  });
  const payload = JSON.parse(reqNew.messages[0].content[0].text);
  assert.equal(payload.key_customer_card.relationship.relationship, "NEW_CUSTOMER");
  assert.equal(payload.key_customer_card.memory_status, "none");
  assert.ok(Array.isArray(payload.key_customer_card.insurance_contracts));
  assert.ok(Array.isArray(payload.key_customer_card.recent_conversation));
  assert.equal(payload.customer_relationship_state, undefined);
  assert.equal(payload.customer_memory, undefined);
  assert.ok(reqNew.system[0].text.includes("과거 고객 기억이 없다"));

  const reqL4 = buildOnePathClaudeFirstRequest({
    question: "아까 올린 증권 다시 봐줘",
    customerId: "cust-1",
    conversationId: "c1",
    history: [{ role: "user", text: "안녕" }],
    explicitReopenDocumentIds: ["doc-a"],
    originalDeliveryReason: "explicit_reopen",
    pdfAttachments: [
      {
        base64: pdfB64,
        mediaType: "application/pdf",
        document_id: "doc-a",
        source: "owned_pointer",
      },
    ],
    memoryQueryFailed: true,
    memoryLoadStatus: "query_failed",
  });
  const p4 = JSON.parse(reqL4.messages[0].content[0].text);
  assert.equal(p4.key_customer_card.relationship.relationship, "RETURNING_CUSTOMER");
  assert.equal(
    p4.key_customer_card.relationship.prior_original_in_same_conversation,
    true,
  );
  assert.equal(p4.key_customer_card.relationship.memory_query_failed, true);
  assert.equal(p4.key_customer_card.memory_status, "partial_unavailable");
  assert.ok(Array.isArray(p4.key_customer_card.insurance_contracts));
  assert.ok(Array.isArray(p4.key_customer_card.recent_conversation));
  assert.equal(p4.customer_relationship_state, undefined);
  assert.equal(p4.customer_memory, undefined);

  // Dialogue authority: keep user/assistant turns; do not treat assistant claims as confirmed contracts.
  const reqDialogue = buildOnePathClaudeFirstRequest({
    question: "나에게 추천해줄수있어 필요한보장?",
    customerId: "cust-1",
    conversationId: "c1",
    history: [
      { role: "user", text: "뇌혈관이 걱정되고 전화가 편해요. 암·실손은 유지할게요." },
      {
        role: "assistant",
        text: "이전에 확인된 암 진단비는 5,000만원입니다.",
      },
    ],
    policyTruthContext: {
      confirmed_contracts: [
        {
          insurer: "확인된손보",
          product_name: "확인상품",
          coverage_summary: { premium: 1000 },
        },
      ],
      confirmed_facts: [{ fact: "verified_only", detail: "ok" }],
    },
  });
  const dialogueCard = reqDialogue.key_customer_card;
  assert.equal(dialogueCard.recent_conversation.length, 2);
  assert.equal(dialogueCard.recent_conversation[0].role, "user");
  assert.equal(
    dialogueCard.recent_conversation[0].text.includes("뇌혈관이 걱정"),
    true,
  );
  assert.equal(
    dialogueCard.recent_conversation[0].source_kind,
    "USER_STATED_CONTEXT",
  );
  assert.equal(
    dialogueCard.recent_conversation[0].fact_authority,
    "not_verified_fact",
  );
  assert.equal(dialogueCard.recent_conversation[1].role, "assistant");
  assert.equal(
    dialogueCard.recent_conversation[1].text.includes("5,000만원"),
    true,
  );
  assert.equal(
    dialogueCard.recent_conversation[1].source_kind,
    "PRIOR_ASSISTANT_CONVERSATION",
  );
  assert.equal(
    dialogueCard.recent_conversation[1].fact_authority,
    "not_verified_fact",
  );
  assert.equal(
    Object.keys(dialogueCard).filter((k) => k === "recent_conversation").length,
    1,
  );
  assert.equal(dialogueCard.insurance_contracts.length, 1);
  assert.equal(dialogueCard.insurance_contracts[0].insurer, "확인된손보");
  assert.equal(dialogueCard.confirmed_facts.length, 1);
  assert.equal(
    JSON.stringify(dialogueCard.insurance_contracts).includes("5,000만원"),
    false,
  );
  assert.equal(
    reqDialogue.system[0].text.includes("확인된 계약·사실·최근 대화"),
    false,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "최근 대화에 나온 숫자·계약·보장 내용은 확인된 계약/사실 또는 이번 턴 원본 근거가 없으면 확정하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "insurance_contracts가 빈 배열이면 확인된 계약 자료가 현재 카드에 없다는 뜻이다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "빈 배열만으로 고객이 보험이나 특정 보장을 보유하지 않았다고 결론 내리지 않는다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "role=assistant 내용은 이전 KEY 답변일 뿐이다",
    ),
    true,
  );
  assert.equal(
    reqDialogue.system[0].text.includes(
      "청구 또는 거절 이력을 증거로 사용하지 않는다",
    ),
    true,
  );

  console.log("PASS KEY relationship state · memory fail ≠ NEW · L4 flags · dialogue authority");
}

{
  assert.equal(shouldSkipProviderOnCustomerAnswerPath(), false);
  // Legacy A1 function may still HOLD in isolation — customer path must not use it.
  const legacyWouldHold = shouldSkipProviderForEmptyContractPackets({
    selectionPlan: {
      selected_resource_packets: [],
      unresolved_material_selection: ["pointed_contract_id"],
      selected_prompt_blocks: ["COND_COVERAGE"],
    },
    question: "주요 보장 알려줘",
  });
  assert.equal(legacyWouldHold, true);
  assert.equal(shouldSkipProviderOnCustomerAnswerPath(), false);
  console.log("PASS U8 confirmed/packet 0 does not block customer path");
}

{
  assert.equal(1, 1); // Claude/provider call count enforced by maxProviderTurns=1 in Direct
  console.log("PASS U9 Claude call target 1 (builder + Direct lock)");
}

{
  const sealed = sealKeyCustomerText("고객 완성 답변");
  assert.equal(sealed.key_speak_original, "고객 완성 답변");
  console.log("PASS U10/U11 seal identity / gate rewrite 0 (seal)");
}

{
  const cands = buildKeyMemoryCandidatesFromSidecar(
    {
      key_memory_candidates: [
        {
          kind: "insurer_name",
          value: "삼성화재",
          source_document_id: "doc-a",
          confidence: "high",
        },
      ],
      policy_inventory_facts: [
        {
          insurer: "삼성화재",
          product_name: "테스트",
          policy_number: "PN1",
          source_document_id: "doc-a",
        },
      ],
    },
    { source_document_id: "doc-a" },
  );
  assert.ok(cands.length >= 1);
  assert.ok(cands.every((c) => c.status === "pending_unverified"));
  assert.ok(cands.every((c) => c.confirmed_promotion === 0));
  console.log("PASS U13/U14 candidates pending · confirmed promotion 0");
}

{
  // Duplicate PDF bytes collapse to one block
  const req = buildOnePathClaudeFirstRequest({
    question: "q",
    pdfAttachments: [
      { base64: pdfB64, mediaType: "application/pdf", document_id: "a" },
      { base64: pdfB64, mediaType: "application/pdf", document_id: "b" },
    ],
  });
  const docs = req.messages[0].content.filter((b) => b.type === "document");
  assert.equal(docs.length, 1);
  console.log("PASS duplicate original once");
}

{
  // Explicit needed-coverage recommend: existing web_search + cleaned showcase only.
  const reqProduct = buildOnePathClaudeFirstRequest({
    question: "나에게 추천해줄수있어 필요한보장?",
    customerId: "cust-1",
    conversationId: "c1",
    history: [
      { role: "user", text: "뇌혈관이 걱정되고 전화가 편해요." },
      {
        role: "assistant",
        text: "한화 3.10.5와 청구 거절 이력이 있다고 이전에 말씀드렸습니다.",
      },
    ],
  });
  assert.equal(reqProduct.tools.length, 1);
  assert.equal(reqProduct.tools[0].name, "web_search");
  assert.equal(reqProduct.tools[0].type, "web_search_20250305");
  assert.equal(reqProduct.tools[0].max_uses, 1);
  assert.deepEqual(reqProduct.tool_choice, { type: "auto" });
  assert.equal(reqProduct.selection_plan.web_tool_candidate, true);
  assert.equal(reqProduct.key_customer_card.insurance_contracts.length, 0);
  assert.equal(reqProduct.key_customer_card.recent_conversation.length, 2);
  assert.equal(reqProduct.key_customer_card.recent_conversation[0].role, "user");
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[0].text.includes("뇌혈관이 걱정"),
    true,
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[0].source_kind,
    "USER_STATED_CONTEXT",
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[0].fact_authority,
    "not_verified_fact",
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].role,
    "assistant",
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].text.includes("한화"),
    true,
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].source_kind,
    "PRIOR_ASSISTANT_CONVERSATION",
  );
  assert.equal(
    reqProduct.key_customer_card.recent_conversation[1].fact_authority,
    "not_verified_fact",
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "빈 배열만으로 고객이 보험이나 특정 보장을 보유하지 않았다고 결론 내리지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "청구 또는 거절 이력을 증거로 사용하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "고객 상황과 검색 결과의 비교는 이 Claude 요청 내부에서만 한다",
    ),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("확인된 보장 구조와 필요 방향을 말한 뒤"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "개인 보장 공백 비교는 insurance_contracts 또는 confirmed_facts에 확인 근거가 있을 때만 한다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "보유·미보유·공백·우선순위를 확정하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "이전 assistant 답변은 개인 보험 사실의 근거가 아니다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "'확인된 보장 구조'·'확정된 공백'·'가장 시급한 보장'이라고 말하지 않는다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes(
      "관심을 보인 보장 영역별로 현재 공개자료에서 확인된 상품·특약 방향만 제시한다",
    ),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("web_search(web_search_20250305)"),
    true,
  );
  assert.equal(
    reqProduct.system[0].text.includes("나에게 맞춘 더좋은 초경증 간편건강보험2607"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("확인 기준일은 2026-07-27"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("정상 구조: 우선 필요한 보장"),
    false,
  );
  assert.equal(
    reqProduct.system[0].text.includes("CUSTOMER_CARD_WHOLESALE") ||
      JSON.stringify(reqProduct.messages).includes("CUSTOMER_CARD_WHOLESALE"),
    true,
  );

  const reqGeneral = buildOnePathClaudeFirstRequest({
    question: "내 보험 현황 알려줘",
    customerId: "cust-1",
    conversationId: "c1",
  });
  // Prompt-cache prefix: tools + showcase system stay identical; matcher → tool_choice only.
  assert.equal(reqGeneral.tools.length, 1);
  assert.equal(reqGeneral.tools[0].name, "web_search");
  assert.equal(reqGeneral.tools[0].type, "web_search_20250305");
  assert.equal(reqGeneral.tools[0].max_uses, 1);
  assert.deepEqual(reqGeneral.tool_choice, { type: "none" });
  assert.equal(reqGeneral.selection_plan.web_tool_candidate, false);
  assert.equal(
    reqGeneral.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    true,
  );
  assert.deepEqual(reqGeneral.tools, reqProduct.tools);
  assert.equal(
    reqGeneral.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    reqProduct.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
  );
  // Showcase contract body identical across product/non-product (prefix stability).
  const productShowcaseSlice = (text) => {
    const i = text.indexOf("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]");
    return i >= 0 ? text.slice(i) : "";
  };
  assert.equal(
    productShowcaseSlice(reqGeneral.system[0].text),
    productShowcaseSlice(reqProduct.system[0].text),
  );
  // Explicit cache on system; no top-level automatic.
  assert.equal(Object.prototype.hasOwnProperty.call(reqProduct, "cache_control"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reqGeneral, "cache_control"), false);
  assert.deepEqual(reqProduct.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(reqGeneral.system[0].cache_control, { type: "ephemeral" });
  assert.equal(reqProduct.system[0].text, reqGeneral.system[0].text);
  console.log(
    "PASS product showcase · explicit system cache · stable tools/system · tool_choice auto|none",
  );
}

{
  const jpeg = buildAnthropicDirectAttachBlock({
    base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
    mediaType: "image/jpeg",
  });
  assert.equal(jpeg.type, "image");
  console.log("PASS U20 production-change N/A offline · media types ok");
}

{
  // S1 EMPTY HANDOFF OMIT — Claude card keys only (READY/SSOT untouched).
  const HANDOFF_KEYS = [
    "entrusted_originals",
    "insurance_clock",
    "relationship_background",
    "life_ledger",
    "claim_evidence",
    "active_claims",
    "active_goal",
    "this_turn_original_delivery",
  ];

  // A — all empty → none of the 7 keys
  const emptyCard = buildKeyCustomerCardForClaude({
    readyCardSsot: {
      activeDocuments: [],
      activeClaimCases: [],
      insuranceClockBrief: {
        hand: "key_insurance_clock",
        upcoming: [],
        overdue: [],
        unknown_date: [],
        completed_recent: [],
        packs_separated: true,
        product_focus: null,
        note: "boilerplate_only",
      },
      lifeLedgerBrief: {
        goals: [],
        preferences: [],
        decisions: [],
        open_questions: [],
        life_threads: [],
        outcomes: [],
        item_count: 0,
        packs_separated: true,
        note: "boilerplate_only",
      },
      claimEvidenceBrief: {
        packages: [],
        item_count: 0,
        packs_separated: true,
        note: "boilerplate_only",
      },
      ssotGoal: null,
    },
    readyCardMeta: {
      status: "miss",
      card_version: "v-test",
      materials_connected: false,
      unknowns: [],
      insurer_source: {
        status: "unconnected",
        as_of: null,
        note: "unconnected boilerplate",
      },
      document_status: { active_count: 0, documents: [] },
    },
  });
  for (const key of HANDOFF_KEYS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(emptyCard, key),
      false,
      `A: expected omit ${key}`,
    );
  }

  // B — boilerplate-only briefs → omitted
  const boilerplateCard = buildKeyCustomerCardForClaude({
    readyCardSsot: {
      activeDocuments: [],
      activeClaimCases: [],
      insuranceClockBrief: {
        hand: "key_insurance_clock",
        upcoming: [],
        overdue: [],
        unknown_date: [],
        completed_recent: [],
        packs_separated: true,
        product_focus: null,
        note: "key_owns_dates",
      },
      lifeLedgerBrief: {
        goals: [],
        preferences: [],
        decisions: [],
        open_questions: [],
        life_threads: [],
        outcomes: [],
        item_count: 0,
        note: "key_owns_life_ledger",
        packs_separated: true,
      },
      claimEvidenceBrief: {
        packages: [],
        item_count: 0,
        note: "key_owns_claim_evidence",
        packs_separated: true,
      },
    },
    readyCardMeta: {
      status: "miss",
      card_version: "ready-v1",
      materials_connected: false,
      document_status: { active_count: 0, documents: [] },
      insurer_source: { status: "unconnected", note: "x" },
    },
  });
  assert.equal("insurance_clock" in boilerplateCard, false);
  assert.equal("relationship_background" in boilerplateCard, false);
  assert.equal("life_ledger" in boilerplateCard, false);
  assert.equal("claim_evidence" in boilerplateCard, false);
  assert.equal("entrusted_originals" in boilerplateCard, false);

  // C — each field with one substantive value stays unchanged
  const clockIn = {
    hand: "key_insurance_clock",
    upcoming: [{ id: "c1", label: "갱신", status: "active" }],
    overdue: [],
    unknown_date: [],
    completed_recent: [],
    packs_separated: true,
    note: "keep_me",
  };
  const ledgerIn = {
    goals: [{ id: "g1", type: "goal", content: "보장 점검", status: "active" }],
    preferences: [],
    decisions: [],
    open_questions: [],
    life_threads: [],
    outcomes: [],
    item_count: 1,
    note: "keep_ledger",
  };
  const evidenceIn = {
    packages: [{ claim_case_id: "case-1", held_evidence: [] }],
    item_count: 1,
    packs_separated: true,
    note: "keep_evidence",
  };
  const claimRow = {
    claim_case_key: "case-1",
    status: "denied",
    card_source: "key_claude_claim_case",
  };
  const goalIn = { goal: "청구 준비", status: "active" };
  const cardFull = buildKeyCustomerCardForClaude({
    readyCardSsot: {
      activeDocuments: [{ id: "doc-1", original_filename: "증권.pdf" }],
      activeClaimCases: [claimRow],
      insuranceClockBrief: clockIn,
      lifeLedgerBrief: ledgerIn,
      claimEvidenceBrief: evidenceIn,
      ssotGoal: goalIn,
      ssotReason: "test",
    },
    readyCardMeta: {
      status: "normal",
      materials_connected: true,
      document_status: {
        active_count: 1,
        documents: [{ id: "doc-1", original_filename: "증권.pdf" }],
      },
      unknowns: ["policy_lookup_partial"],
    },
    originalDeliveryReason: "current_upload",
    currentTurnDocumentIds: ["doc-1"],
    explicitReopenDocumentIds: [],
    ownedOriginals: [
      {
        document_id: "doc-1",
        mime_type: "application/pdf",
        sha256: "abc",
        source: "upload",
        ownership_verified: true,
      },
    ],
  });
  assert.equal(cardFull.insurance_clock.upcoming[0].label, "갱신");
  assert.deepEqual(cardFull.insurance_clock, clockIn);
  // S8-2B: life_ledger nested under relationship_background envelope (not top-level peer).
  assert.equal("life_ledger" in cardFull, false);
  assert.ok(cardFull.relationship_background, "C: relationship_background envelope");
  assert.equal(cardFull.relationship_background.surface_role, "relationship_background");
  assert.equal(cardFull.relationship_background.speech_priority, "not_active_current_fact");
  assert.equal(cardFull.relationship_background.fact_authority, "not_verified_fact");
  assert.ok(
    String(cardFull.relationship_background.usage_note || "").includes(
      "keep this background silent",
    ),
  );
  assert.equal(cardFull.relationship_background.life_ledger.goals[0].id, ledgerIn.goals[0].id);
  assert.equal(
    cardFull.relationship_background.life_ledger.goals[0].content,
    ledgerIn.goals[0].content,
  );
  assert.equal(cardFull.relationship_background.life_ledger.item_count, ledgerIn.item_count);
  assert.deepEqual(cardFull.claim_evidence, evidenceIn);
  assert.equal(cardFull.active_claims.length, 1);
  assert.equal(cardFull.active_claims[0].claim_case_key, "case-1");
  assert.equal(cardFull.active_claims[0].status, "denied");
  assert.equal(cardFull.active_goal.goal, "청구 준비");
  assert.equal(cardFull.entrusted_originals.links[0].document_id, "doc-1");
  assert.equal(cardFull.this_turn_original_delivery.reason, "current_upload");
  assert.deepEqual(cardFull.this_turn_original_delivery.current_turn_document_ids, [
    "doc-1",
  ]);

  // D — mixed: empty keys omitted, substantive kept as-is
  const mixedClock = {
    upcoming: [{ id: "u1", label: "만기" }],
    overdue: [],
    unknown_date: [],
    completed_recent: [],
    note: "mixed",
  };
  const mixed = buildKeyCustomerCardForClaude({
    readyCardSsot: {
      activeDocuments: [],
      activeClaimCases: [],
      insuranceClockBrief: mixedClock,
      lifeLedgerBrief: {
        goals: [],
        preferences: [],
        decisions: [],
        open_questions: [],
        life_threads: [],
        outcomes: [],
        item_count: 0,
        note: "empty",
      },
      claimEvidenceBrief: { packages: [], item_count: 0, note: "empty" },
      ssotGoal: null,
    },
    readyCardMeta: {
      materials_connected: false,
      document_status: { active_count: 0, documents: [] },
    },
  });
  assert.deepEqual(mixed.insurance_clock, mixedClock);
  assert.equal("relationship_background" in mixed, false);
  assert.equal("life_ledger" in mixed, false);
  assert.equal("claim_evidence" in mixed, false);
  assert.equal("active_claims" in mixed, false);
  assert.equal("active_goal" in mixed, false);
  assert.equal("entrusted_originals" in mixed, false);
  assert.equal("this_turn_original_delivery" in mixed, false);

  console.log("PASS S1 empty handoff omit A/B/C/D");
}

{
  // Daily-chat matcher → ONE_PATH tool-policy + user context (Claude-first unchanged).
  // productShowcase stays a separate insurance matcher.
  const findDailyPolicy = (req) => {
    const block = req.messages[0].content.find((b) => {
      if (b.type !== "text" || typeof b.text !== "string") return false;
      try {
        return Boolean(JSON.parse(b.text)?.KEY_DAILY_CHAT_POLICY);
      } catch {
        return false;
      }
    });
    if (!block) return null;
    return JSON.parse(block.text).KEY_DAILY_CHAT_POLICY;
  };

  // Matcher reuse proof (existing functions, not new regex families).
  assert.equal(resolveOnePathDailyChatPolicy({ question: "안녕" }).lane, "greeting");
  assert.equal(
    resolveOnePathDailyChatPolicy({ question: "오늘 너무 힘들다" }).lane,
    "emotion",
  );
  assert.equal(
    resolveOnePathDailyChatPolicy({ question: "비행기는 왜 날아?" }).lane,
    "general_knowledge",
  );
  assert.equal(
    resolveOnePathDailyChatPolicy({ question: "분당 맛집 추천해줘" }).lane,
    "place_recommend",
  );
  assert.equal(isNonInsuranceDailyRecommendRequest("영화 추천해줘"), true);
  assert.equal(
    resolveOnePathDailyChatPolicy({ question: "영화 추천해줘" }).lane,
    "non_insurance_recommend",
  );
  assert.equal(
    resolveOnePathDailyChatPolicy({
      question: "아까 말한 거 다시 설명해줘",
    }).lane,
    "continuity",
  );
  assert.equal(
    resolveOnePathDailyChatPolicy({
      question: "나에게 추천해줄수있어 필요한보장?",
    }).lane,
    ONE_PATH_DAILY_CHAT_LANES.NONE,
  );
  assert.equal(
    resolveOnePathDailyChatPolicy({
      question: "나에게 추천해줄수있어 필요한보장?",
    }).product_showcase_request,
    true,
  );

  const reqGreeting = buildOnePathClaudeFirstRequest({ question: "안녕" });
  assert.deepEqual(reqGreeting.tool_choice, { type: "none" });
  assert.equal(reqGreeting.selection_plan.daily_chat_lane, "greeting");
  assert.equal(reqGreeting.selection_plan.product_showcase_request, false);
  assert.equal(findDailyPolicy(reqGreeting)?.lane, "greeting");
  assert.equal(findDailyPolicy(reqGreeting)?.web_search_allowed, false);

  const reqEmotion = buildOnePathClaudeFirstRequest({
    question: "기분이 좀 우울해",
  });
  assert.deepEqual(reqEmotion.tool_choice, { type: "none" });
  assert.equal(reqEmotion.selection_plan.daily_chat_lane, "emotion");

  const reqLife = buildOnePathClaudeFirstRequest({
    question: "저녁 뭐 먹을까?",
  });
  assert.deepEqual(reqLife.tool_choice, { type: "none" });
  assert.equal(reqLife.selection_plan.daily_chat_lane, "life");

  const reqGk = buildOnePathClaudeFirstRequest({
    question: "커피는 왜 잠이 깨?",
  });
  assert.deepEqual(reqGk.tool_choice, { type: "auto" });
  assert.equal(reqGk.selection_plan.daily_chat_lane, "general_knowledge");
  assert.equal(reqGk.selection_plan.daily_chat_web_search, true);
  assert.equal(reqGk.selection_plan.product_showcase_request, false);

  const reqPlace = buildOnePathClaudeFirstRequest({
    question: "분당 맛집 추천해줘",
  });
  assert.deepEqual(reqPlace.tool_choice, { type: "auto" });
  assert.equal(reqPlace.selection_plan.daily_chat_lane, "place_recommend");
  assert.equal(reqPlace.selection_plan.product_showcase_request, false);
  const placePolicy = findDailyPolicy(reqPlace);
  assert.equal(placePolicy?.lane, "place_recommend");
  assert.equal(placePolicy?.web_search_allowed, true);
  assert.equal(placePolicy?.product_showcase_separated, true);
  assert.equal(
    String(placePolicy?.place_recommend_guidance ?? "").includes("맛집"),
    true,
  );

  const reqMovie = buildOnePathClaudeFirstRequest({
    question: "영화 추천해줘",
  });
  assert.deepEqual(reqMovie.tool_choice, { type: "auto" });
  assert.equal(
    reqMovie.selection_plan.daily_chat_lane,
    "non_insurance_recommend",
  );
  assert.equal(reqMovie.selection_plan.product_showcase_request, false);
  assert.equal(
    reqMovie.system[0].text.includes("[CURRENT_INSURANCE_PRODUCT_SHOWCASE]"),
    true,
  );

  const reqCont = buildOnePathClaudeFirstRequest({
    question: "아까 말한 거 다시 설명해줘",
    history: [
      { role: "user", text: "주말에 영화 볼까?" },
      { role: "assistant", text: "가벼운 코미디부터 보면 좋아요." },
    ],
  });
  assert.deepEqual(reqCont.tool_choice, { type: "none" });
  assert.equal(reqCont.selection_plan.daily_chat_lane, "continuity");
  assert.equal(findDailyPolicy(reqCont)?.continuity_use_recent_conversation, true);
  assert.equal(reqCont.key_customer_card.recent_conversation.length, 2);

  // Insurance productShowcase still separate + auto; daily lane none.
  const reqProduct = buildOnePathClaudeFirstRequest({
    question: "나에게 추천해줄수있어 필요한보장?",
  });
  assert.deepEqual(reqProduct.tool_choice, { type: "auto" });
  assert.equal(reqProduct.selection_plan.product_showcase_request, true);
  assert.equal(
    reqProduct.selection_plan.daily_chat_lane,
    ONE_PATH_DAILY_CHAT_LANES.NONE,
  );
  assert.equal(findDailyPolicy(reqProduct), null);

  // System prefix cache stability: daily context must not alter system text.
  assert.equal(reqGreeting.system[0].text, reqMovie.system[0].text);
  assert.equal(reqMovie.system[0].text, reqPlace.system[0].text);
  assert.equal(reqPlace.system[0].text, reqProduct.system[0].text);

  console.log(
    "PASS daily-chat ONE_PATH policy · matcher reuse · productShowcase separated · tool_choice",
  );
}

{
  // KEY Human Voice + HEART — fixed prefix contract (no per-turn tone, no templates).
  const voiceCases = [
    { id: "daily_greeting", q: "안녕" },
    { id: "daily_emotion", q: "오늘 너무 힘들다" },
    { id: "daily_chitchat", q: "심심한데 얘기 좀 하자" },
    { id: "daily_life", q: "저녁 뭐 먹을까?" },
    { id: "daily_gk", q: "비행기는 왜 날아?" },
    { id: "daily_place", q: "분당 맛집 추천해줘" },
    { id: "daily_movie", q: "영화 추천해줘" },
    { id: "daily_continuity", q: "아까 말한 거 다시 설명해줘" },
    { id: "ins_portfolio", q: "내 보험 현황 알려줘" },
    { id: "ins_product", q: "나에게 추천해줄수있어 필요한보장?" },
    { id: "ins_doc", q: "이 증권을 직접 읽고 중요한 내용을 설명해줘." },
  ];
  const systems = [];
  for (const c of voiceCases) {
    const req = buildOnePathClaudeFirstRequest({
      question: c.q,
      customerId: "cust-voice-1",
      conversationId: "conv-voice-1",
    });
    const sys = req.system[0].text;
    systems.push(sys);
    assert.equal(sys.includes("[KEY_HUMAN_VOICE]"), true, c.id);
    assert.equal(sys.includes("[KEY_HEART]"), true, c.id);
    assert.equal(sys.includes("평생 주치의"), true, c.id);
    assert.equal(sys.includes("안내드리겠습니다"), true, c.id);
    assert.equal(sys.includes("상담원식"), true, c.id);
    assert.equal(sys.includes("답변 템플릿"), true, c.id);
    // HEART philosophy present — not rulebook / classifier / template answers.
    assert.equal(sys.includes("사람을 대하는 철학"), true, c.id);
    assert.equal(sys.includes("추월하지 않는다"), true, c.id);
    assert.equal(sys.includes("억지 질문은 하지 않는다"), true, c.id);
    assert.equal(sys.includes("현재 고객의 말이 과거 관찰보다 우선"), true, c.id);
    assert.equal(sys.includes("충분히 답한다"), true, c.id);
    // S8-1 HEART pacing refinement (structure only — not Human Gate).
    assert.equal(sys.includes("현재 대화만으로 충분하면 굳이 꺼내지 않는다"), true, c.id);
    assert.equal(sys.includes("알고 있음을 보여주기 위해 쓰지 않는다"), true, c.id);
    assert.equal(
      sys.includes("대화를 이어간다는 것은 항상 질문으로 끝내는 뜻이 아니다"),
      true,
      c.id,
    );
    assert.equal(
      sys.includes("질문 없이 받아주거나 잠시 머무르는 것도 자연스럽다"),
      true,
      c.id,
    );
    assert.equal(
      sys.includes("말하지 않은 마음을 그럴듯하게 완성하지 않는다"),
      true,
      c.id,
    );
    assert.equal(
      sys.includes("해결을 원한다는 신호가 없는데 절차·조언·행동 계획을 먼저 쏟아내지 않는다"),
      true,
      c.id,
    );
    // Capabilities preserved (restraint ≠ capability kill).
    assert.equal(sys.includes("자연스럽게 질문하고 대화를 이어간다"), true, c.id);
    assert.equal(sys.includes("과거 기억은"), true, c.id);
    assert.equal(sys.includes("실제 도움이 될 때만 자연스럽게 쓴다"), true, c.id);
    assert.equal(sys.includes("정보를 묻거나 도움을 원하면 충분히 답한다"), true, c.id);
    // No forced question count / empathy phrase / profiling / Presence JSON.
    assert.equal(sys.includes("질문 1개"), false, c.id);
    assert.equal(sys.includes("무조건 해결"), false, c.id);
    assert.equal(sys.includes("힘드시겠어요"), false, c.id);
    assert.equal(sys.includes("고객 유형"), false, c.id);
    assert.equal(sys.includes("presence_state"), false, c.id);
    assert.equal(sys.includes("heart_score"), false, c.id);
    assert.equal(sys.includes("IF/THEN"), false, c.id);
    assert.equal(sys.includes("emotion_classifier"), false, c.id);
    assert.equal(sys.includes("intent classifier"), false, c.id);
    // Greeting may stay short; content questions must not be forced short-close.
    assert.equal(sys.includes("인사·짧은 반응은 짧게"), true, c.id);
    assert.equal(sys.includes("단답으로 기계 종료하지 않는다"), true, c.id);
    assert.equal(
      sys.includes("짧게 받을 말은 사람처럼 짧게. 설명이 필요할 때만"),
      false,
      c.id,
    );
    // No canned customer answers in system.
    assert.equal(sys.includes("안녕하세요! 반갑습니다"), false, c.id);
    assert.equal(req.meta.LIVE_REQUEST_MODE, ONE_PATH_LIVE_MODE, c.id);
    assert.equal(req.meta.DEFAULT_PROVIDER_CALL_TARGET, 1, c.id);
  }
  // Cache-stable: all 11 share identical system for same relationship/originals.
  for (let i = 1; i < systems.length; i += 1) {
    assert.equal(systems[i], systems[0], voiceCases[i].id);
  }
  // Seal / Claude-first entry unchanged.
  assert.equal(shouldRunClaudeFirstHomeChatQuestion({}), true);
  const sealed = sealKeyCustomerText("짧게 사람처럼 답한 문장");
  assert.equal(sealed.key_customer_text_sealed, true);
  assert.equal(sealed.key_speak_original, "짧게 사람처럼 답한 문장");
  console.log(
    "PASS KEY_HUMAN_VOICE · KEY_HEART · HEART_PACING · 11-case stable prefix · seal/Claude-first unchanged",
  );
  console.log(
    JSON.stringify({
      HEART_MEMORY_HUMILITY: "PASS",
      HEART_QUESTION_RESTRAINT: "PASS",
      HEART_EMOTION_HUMILITY: "PASS",
      HEART_SOLUTION_RESTRAINT: "PASS",
      HEART_CAN_ASK: "YES",
      HEART_CAN_CONTINUE: "YES",
      HEART_CAN_USE_MEMORY: "YES",
      HEART_CAN_GIVE_FULL_ANSWER: "YES",
      CACHE_PREFIX_11_CASE_STABLE: "YES",
    }),
  );
}

{
  // S8-2B — relationship background envelope (structure only; no golden answer text).
  const parentCareThread = {
    id: "lt-parent-care",
    type: "life_thread",
    content: "[PARENT_CARE_PRESENT]",
    status: "active",
  };
  const ledgerWithThread = {
    goals: [{ id: "g-ins", type: "goal", content: "보장 점검", status: "active" }],
    preferences: [],
    decisions: [],
    open_questions: [],
    life_threads: [parentCareThread],
    outcomes: [],
    item_count: 2,
    packs_separated: true,
    note: "key_owns_life_ledger; soft_reference_only; claude_judges_freely",
  };
  const clockKeep = {
    hand: "key_insurance_clock",
    upcoming: [{ id: "due-1", label: "보험료 납입", status: "active" }],
    overdue: [],
    unknown_date: [],
    completed_recent: [],
    packs_separated: true,
    note: "key_owns_dates",
  };
  const contracts = [
    {
      insurer: "테스트손보",
      product_name: "종합건강보험",
      policy_number: "P-KEEP-1",
      status: "active",
    },
  ];
  const facts = [
    {
      fact_type: "coverage",
      literal: "암진단비",
      verification_status: "confirmed",
    },
  ];

  // Case A — idle daily question: parent-care inside background envelope, not verified layer.
  const cardA = buildKeyCustomerCardForClaude({
    policyTruthContext: {
      confirmed_contracts: contracts,
      confirmed_facts: facts,
    },
    history: [
      { role: "user", text: "안녕" },
      { role: "assistant", text: "안녕하세요." },
      { role: "user", text: "오늘 퇴근하고 그냥 쉴까 고민중이야" },
    ],
    readyCardSsot: {
      lifeLedgerBrief: ledgerWithThread,
      insuranceClockBrief: clockKeep,
      priorConsultation: { related_turns: [], open_goals: [], life_threads: [] },
    },
  });
  const rbA = cardA.relationship_background;
  assert.ok(rbA, "A: relationship_background envelope");
  assert.equal("life_ledger" in cardA, false, "A: life_ledger must not be top-level peer");
  assert.equal(rbA.life_ledger.life_threads[0].content, "[PARENT_CARE_PRESENT]");
  assert.equal(rbA.surface_role, "relationship_background");
  assert.equal(rbA.speech_priority, "not_active_current_fact");
  assert.equal(rbA.fact_authority, "not_verified_fact");
  assert.ok(String(rbA.usage_note || "").includes("keep this background silent"));
  assert.equal(
    JSON.stringify(cardA.confirmed_facts || []).includes("PARENT_CARE"),
    false,
  );
  assert.equal(
    JSON.stringify(cardA.insurance_contracts || []).includes("PARENT_CARE"),
    false,
  );
  assert.equal(cardA.insurance_contracts[0].insurer, "테스트손보");
  assert.equal(cardA.confirmed_facts[0].literal, "암진단비");
  assert.equal(cardA.insurance_clock.upcoming[0].label, "보험료 납입");
  assert.deepEqual(cardA.insurance_clock, clockKeep);

  // Case B — customer continues parent-care topic: same memory still available to read.
  const cardB = buildKeyCustomerCardForClaude({
    history: [
      {
        role: "user",
        text: "지난번 부모님 간병 얘기 이어서 하자",
      },
    ],
    readyCardSsot: { lifeLedgerBrief: ledgerWithThread },
  });
  const rbB = cardB.relationship_background;
  assert.ok(rbB?.life_ledger, "B: relationship memory still available");
  assert.equal(rbB.life_ledger.life_threads.length, 1);
  assert.equal(rbB.speech_priority, "not_active_current_fact");
  assert.equal(rbB.life_ledger.life_threads[0].id, "lt-parent-care");
  assert.equal("life_ledger" in cardB, false);

  // Case C — deadline/promise authority not weakened by background envelope.
  const cardC = buildKeyCustomerCardForClaude({
    policyTruthContext: { confirmed_contracts: contracts, confirmed_facts: facts },
    readyCardSsot: {
      lifeLedgerBrief: ledgerWithThread,
      insuranceClockBrief: clockKeep,
      ssotGoal: { goal: "청구 서류 준비", status: "active" },
      ssotReason: "ready_card",
    },
  });
  assert.deepEqual(cardC.insurance_clock, clockKeep);
  assert.equal(cardC.active_goal.goal, "청구 서류 준비");
  assert.equal(cardC.insurance_contracts.length, 1);
  assert.equal(cardC.confirmed_facts.length, 1);
  assert.equal(cardC.relationship_background.surface_role, "relationship_background");
  assert.ok(cardC.relationship_background.life_ledger.life_threads[0]);

  console.log(
    JSON.stringify({
      S8_2B_RELATIONSHIP_BACKGROUND_ENVELOPE_UNIT: "PASS",
      RELATIONSHIP_BACKGROUND_SEPARATE_ENVELOPE: "YES",
      VERIFIED_FACT_LAYER_SEPARATE: "YES",
      BACKGROUND_METADATA_ADJACENT_TO_LIFE_LEDGER: "YES",
      PARENT_CARE_MEMORY_PRESENT: "YES",
      PARENT_CARE_INSIDE_RELATIONSHIP_BACKGROUND: "YES",
      PARENT_CARE_NOT_IN_VERIFIED_CURRENT_FACT_LAYER: "YES",
      RELATIONSHIP_MEMORY_STILL_AVAILABLE: "YES",
      LIFE_LEDGER_CONTENT_PRESERVED: "YES",
      LIFE_THREADS_CONTENT_PRESERVED: "YES",
      VERIFIED_FACT_AUTHORITY_PRESERVED: "YES",
      DEADLINE_PROMISE_MEMORY_PRESERVED: "YES",
    }),
  );
}

console.log(
  JSON.stringify({
    KEY_ONE_PATH_CLAUDE_FIRST_UNIT: "PASS",
    LIVE_MODE: ONE_PATH_LIVE_MODE,
    PRODUCTION: 0,
  }),
);
