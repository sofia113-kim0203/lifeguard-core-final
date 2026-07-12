/**
 * Claude-Full talent-open — local unit tests (no network · no deploy · no commit).
 * Preview: probeOn (shadow|active) enables Claude-Full primary (no env mutation).
 * stage2Partial / Production remain excluded. S6 customer path blocked when Claude-Full on.
 */
import assert from "node:assert/strict";
import { buildReflection } from "../server/keyCore/keyReflection.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { buildClaudeFullContextPack } from "../server/keyCore/keyClaudeFullContextPack.js";
import { buildUserPayload, buildEarlyBorrowedFactBoundary, buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import {
  CLAUDE_FULL_EMIT_TOOL,
  buildClaudeFullSystemPrompt,
  normalizeClaudeFullOutput,
  permissionCheckProposedToolActions,
} from "../server/keyCore/keyClaudeFullEmit.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "../server/keyCore/keyCustomerMonopoly.js";
import { getKeyBorrowedSensesMode } from "../server/keyCore/oneKeyCoreFlags.js";

const softReality = {
  policy_count: 22,
  policies: [
    {
      insurer_name: "삼성생명",
      product_name: "실손의료비보험",
      monthly_premium: 45000,
    },
  ],
};

/** Minimal Claude-Full emit shape (D2: customer_answer + decision + session_goal). */
function goodClaudeFull(overrides = {}) {
  return {
    customer_answer:
      "보험료를 줄이고 싶으신 거죠. 확인된 22건 중 중복·납입부터 보면 좋을 것 같아요. 대표 실손 월 4만5천 원은 참고만 할게요.",
    session_goal: "보험료 부담 축부터 확인",
    decision: {
      situation_key: "premium_burden",
      key_judgment: "확인된 계약부터 납입·중복을 짚는 상황",
      key_next_move: "중복·납입부터 같이 볼까요?",
      direction: { type: "lead", move: "중복·납입부터" },
    },
    ...overrides,
  };
}

function makeFetch({ borrowed, s6Text = "S6_SHOULD_NOT_RUN", log = [], researchResults = null } = {}) {
  let borrowedN = 0;
  return async (_url, opts = {}) => {
    const body = JSON.parse(String(opts.body ?? "{}"));
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const hasEmitBorrowed = tools.some((t) => t?.name === "emit_borrowed_senses");
    const hasEmitFull = tools.some((t) => t?.name === "emit_claude_full");
    const hasSearch = tools.some((t) => t?.name === "web_search");
    // Research-only (shadow path)
    if (hasSearch && !hasEmitBorrowed && !hasEmitFull) {
      log.push("research");
      const results = Array.isArray(researchResults)
        ? researchResults
        : [
            {
              type: "web_search_result",
              url: "https://example.com/a",
              title: "서현 한정식 A",
              encrypted_content: "encFULL_A",
              page_age: "2026",
            },
          ];
      return {
        ok: true,
        async json() {
          return {
            stop_reason: "end_turn",
            usage: { server_tool_use: { web_search_requests: 1 }, input_tokens: 50, output_tokens: 20 },
            content: [
              {
                type: "server_tool_use",
                id: "srvtoolu_test",
                name: "web_search",
                input: { query: "분당 맛집" },
              },
              {
                type: "web_search_tool_result",
                tool_use_id: "srvtoolu_test",
                content: results,
              },
            ],
          };
        },
      };
    }
    if (hasEmitFull || hasEmitBorrowed) {
      borrowedN += 1;
      log.push("borrowed");
      const input =
        typeof borrowed === "function" ? borrowed(body, borrowedN, { tools, hasEmitFull }) : borrowed;
      const toolName = hasEmitFull ? "emit_claude_full" : "emit_borrowed_senses";
      // Accept either customer_answer (talent-open) or legacy voice_raw_candidate.
      let emitInput = input;
      if (hasEmitFull && input && !input.customer_answer && input.voice_raw_candidate) {
        emitInput = { ...input, customer_answer: input.voice_raw_candidate };
      }
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 100, output_tokens: 40 },
            content: [
              {
                type: "tool_use",
                name: toolName,
                input: emitInput,
              },
            ],
          };
        },
      };
    }
    log.push("s6");
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: "text", text: typeof s6Text === "function" ? s6Text() : s6Text }],
        };
      },
    };
  };
}

const previewActive = {
  KEY_VOICE: "on",
  KEY_BORROWED_SENSES: "active",
  VERCEL_ENV: "preview",
  ANTHROPIC_API_KEY: "test-key",
};

// Default flag remains shadow (no new env).
assert.equal(getKeyBorrowedSensesMode({}), "off");
assert.equal(getKeyBorrowedSensesMode({ KEY_BORROWED_SENSES: "shadow" }), "shadow");

// Minimal schema: required customer_answer + decision + session_goal (D2)
{
  const schema = CLAUDE_FULL_EMIT_TOOL.input_schema;
  assert.deepEqual(schema.required, ["customer_answer", "decision", "session_goal"]);
  assert.equal(schema.properties.proposed_next_actions.minItems, undefined);
  assert.equal(schema.properties.visual_blocks.minItems, undefined);
  assert.ok(schema.properties.extensions);
  assert.ok(schema.properties.decision?.required?.includes("key_judgment"));
  assert.ok(
    schema.properties.visual_blocks.items.properties.type.enum.includes("coverage_status_card"),
  );
  const prompt = buildClaudeFullSystemPrompt({ mode: "emit" });
  assert.equal(/consult paths: \(1\)/.test(prompt), false);
  assert.equal(/FORBIDDEN openings/.test(prompt), false);
  assert.equal(/구어체/.test(prompt), false);
  assert.equal(/next_decision_point MUST/.test(prompt), false);
  assert.equal(/맞아 보입니다/.test(prompt), false);
  assert.match(prompt, /Do not invent/i);
  assert.match(prompt, /verified/i);
  assert.match(prompt, /REQUIRED output fields/i);
  assert.match(prompt, /coverage_status_card/);
}

// D2 context pack + document evidence in payload
{
  const history = [];
  for (let i = 0; i < 20; i += 1) {
    history.push({ role: i % 2 === 0 ? "user" : "assistant", text: `turn-${i} 암보험` });
  }
  const pdfFixture = [
    {
      document_id: "doc-pdf-1",
      doc_title: "실손 약관",
      page: 12,
      chunk_index: 3,
      content: "면책기간은 가입 후 일정 기간 보장이 제한될 수 있습니다.",
      tables: [{ headers: ["항목", "내용"], rows: [["면책", "상품별"]] }],
      source: "customer_document_chunks",
    },
  ];
  const { pack, context_pack_ms } = buildClaudeFullContextPack({
    history,
    previousAnswerSummary: "직전 요약",
    question: "암보험 괜찮아?",
    documentEvidence: pdfFixture,
    relatedPastOriginals: [{ text: "예전에 암 진단비 물어봤던 원문", source: "past" }],
  });
  assert.equal(pack.recent_conversation_count, 12);
  assert.ok(pack.older_conversation_summary?.summary_text);
  assert.ok(pack.retained_past_original_count >= 1);
  assert.equal(pack.document_evidence_count, 1);
  assert.equal(pack.document_evidence[0].page, 12);
  assert.ok(pack.document_evidence[0].content.includes("면책기간"));
  assert.equal(pack.document_evidence[0].tables.length, 1);
  assert.equal(typeof context_pack_ms, "number");
  const boundary = buildEarlyBorrowedFactBoundary({ reality: softReality, question: "암보험?" });
  const payload = buildUserPayload({
    question: "암보험 괜찮아?",
    factBoundary: boundary,
    history,
    previousAnswerSummary: "직전 요약",
    answerMode: "claude_full",
    contextPack: pack,
    documentEvidence: pdfFixture,
  });
  assert.equal(payload.decision, null);
  assert.equal(payload.session_goal, null);
  assert.equal(payload.answer_mode, "claude_full");
  assert.equal(payload.schema_version, "claude_full_emit_v2");
  assert.ok(Array.isArray(payload.available_tools) && payload.available_tools.includes("emit_claude_full"));
  assert.ok(
    Array.isArray(payload.forbidden_behaviors) &&
      payload.forbidden_behaviors.includes("invent_facts"),
  );
  assert.equal(payload.reflection_situation_reading, null);
  assert.equal(payload.conversation_history, null);
  assert.equal(payload.document_evidence_count, 1);
  assert.equal(payload.document_evidence[0].page, 12);
  assert.ok(payload.document_evidence[0].content.includes("면책기간"));
  assert.ok(payload.related_past_originals?.length >= 1);
  assert.ok(payload.verified_customer_chart);
  assert.ok(payload.recent_conversation_originals?.length);
  assert.equal(payload.provider_input_policy?.claude_full_talent_open, true);
}

// Normalize: empty optional fields OK; customer_answer maps to voice_raw_candidate
{
  const n = normalizeClaudeFullOutput({
    customer_answer: "자연스러운 한 줄 답변입니다.",
  });
  assert.equal(n.customer_answer, "자연스러운 한 줄 답변입니다.");
  assert.equal(n.voice_raw_candidate, n.customer_answer);
  assert.deepEqual(n.visual_blocks, []);
  assert.deepEqual(n.proposed_next_actions, []);
  assert.equal(n.extensions, null);
}

// D2: decision + session_goal are Claude OUTPUT (normalized); KEY validates separately
{
  const n = normalizeClaudeFullOutput({
    customer_answer: "확인된 범위부터 말씀드릴게요.",
    session_goal: "암 보장 확인",
    decision: {
      situation_key: "coverage_assessment_cancer_axis",
      key_judgment: "암 보장부터 확인하는 편이 맞습니다.",
      key_situation_judgment: "암 축 우선 확인",
      key_next_move: "암 보장부터 볼지 정하기",
      direction: { type: "offer_direction", move: "암 보장부터 볼지 정하면 됩니다" },
      confirm_question: "어느 쪽부터 볼까요?",
    },
  });
  assert.equal(n.session_goal, "암 보장 확인");
  assert.equal(n.decision?.situation_key, "coverage_assessment_cancer_axis");
  assert.ok(n.decision?.key_judgment.includes("암"));
  assert.equal(n.decision?.direction?.type, "offer_direction");
}

{
  const { validateAndRecordClaudeDecision } = await import("../server/keyCore/keyDecision.js");
  const reality = {
    policy_count: 2,
    policies: [
      { insurer: "테스트생명", product_name: "실손", monthly_premium: 45000 },
      { insurer: "테스트화재", product_name: "암", monthly_premium: 30000 },
    ],
  };
  const reflection = buildReflection({
    customerSaid: "암보험 괜찮아?",
    reality,
  });
  const validated = validateAndRecordClaudeDecision({
    reflection,
    reality,
    question: "암보험 괜찮아?",
    borrowedUnderstanding: {
      customer_answer: "확인된 범위부터요.",
      session_goal: "암 보장 확인",
      decision: {
        situation_key: "coverage_assessment_cancer_axis",
        key_judgment: "암 보장부터 확인하는 편이 맞습니다.",
        direction: { type: "offer_direction", move: "암 보장부터 볼지 정하면 됩니다" },
        confirm_question: "어느 쪽부터 볼까요?",
      },
    },
  });
  assert.equal(validated.hypothesis_used?.decision_source, "claude_proposal_validated");
  assert.equal(validated.hypothesis_used?.claude_session_goal, "암 보장 확인");
  assert.ok(validated.fact_selection);
  assert.equal(validated.key_judgment.includes("암"), true);
}

// Internal reasoning bags stripped from understanding / extensions / proposed_* before store/trace
{
  const n = normalizeClaudeFullOutput({
    customer_answer: "확인된 22건 기준으로 말씀드릴게요.",
    understanding: {
      note: "절감 관심",
      chain_of_thought: "먼저 A를 생각하고 B를 비교한 뒤 C로 결론…",
      hypotheses: ["절감 목적일 수 있음"],
    },
    extensions: {
      useful_hint: "ok",
      internal_reasoning: "숨긴 추론 전문",
      nested: {
        scratchpad: "임시 메모",
        keep: "visible",
      },
    },
    proposed_tool_actions: [
      {
        tool: "web_search",
        reason: "최신 정보",
        args: { q: "분당", hidden_reasoning: "왜 검색하는지 장문" },
      },
    ],
    proposed_next_actions: ["납입부터"],
  });
  assert.equal(n.understanding?.note, "절감 관심");
  assert.equal(n.understanding?.chain_of_thought, undefined);
  assert.deepEqual(n.understanding?.hypotheses, ["절감 목적일 수 있음"]);
  assert.equal(n.extensions?.useful_hint, "ok");
  assert.equal(n.extensions?.internal_reasoning, undefined);
  assert.equal(n.extensions?.nested?.scratchpad, undefined);
  assert.equal(n.extensions?.nested?.keep, "visible");
  assert.equal(n.proposed_tool_actions[0].args?.q, "분당");
  assert.equal(n.proposed_tool_actions[0].args?.hidden_reasoning, undefined);
  const blob = JSON.stringify(n);
  assert.equal(/chain_of_thought|internal_reasoning|hidden_reasoning|scratchpad/.test(blob), false);
  assert.equal(n.customer_answer, "확인된 22건 기준으로 말씀드릴게요.");
}

// Permission: out-of-allowlist and production blocked (no execute)
{
  const preview = permissionCheckProposedToolActions({
    proposed: [
      { tool: "web_search", reason: "최신 정보" },
      { tool: "delete_production_db", reason: "hack" },
    ],
    env: { VERCEL_ENV: "preview" },
  });
  assert.equal(preview.any_execute, false);
  assert.equal(preview.results.find((r) => r.tool === "web_search")?.allowed, true);
  assert.equal(preview.results.find((r) => r.tool === "delete_production_db")?.allowed, false);

  const prod = permissionCheckProposedToolActions({
    proposed: [{ tool: "web_search" }],
    env: { VERCEL_ENV: "production" },
  });
  assert.equal(prod.results[0].allowed, false);
  assert.equal(prod.any_execute, false);
}

// 1) Natural answer passes without structure force · Claude 1 / S6 0
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const borrowed = goodClaudeFull();
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ borrowed, log }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(result.key_voice_trace.focused_correction_count, 0);
  assert.equal(result.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
  assert.equal(result.text, borrowed.customer_answer);
  assert.equal(result.key_voice_trace.visual_blocks_source, "claude_emit");
  assert.equal(result.key_voice_trace.shadow_probe_omitted?.omitted, true);
  assert.equal(
    result.key_voice_trace.shadow_probe_omitted?.reason,
    "claude_full_primary_path_no_post_response_observer",
  );
  assert.equal(result.key_voice_trace.d2_output_incomplete, false);
  assert.ok(result.key_voice_trace.latency_marks?.claude_full_emit);
  assert.equal(result.key_voice_trace.latency_marks?.borrowed_shadow_probe ?? null, null);
  assert.equal(
    result.decision_snapshot?.hypothesis_used?.decision_source,
    "claude_proposal_validated",
  );
}

// 2) visual_blocks absent / empty — PASS; next actions 0 — PASS
{
  const q = "보험 현황 간단히만 알려줘";
  const log = [];
  const borrowed = goodClaudeFull({
    customer_answer: "확인된 계약은 22건이에요. 더 깊게 볼 부분은 말씀해 주세요.",
    visual_blocks: [],
    proposed_next_actions: [],
  });
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ borrowed, log }),
    },
  );
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.text, borrowed.customer_answer);
  assert.deepEqual(result.visual_blocks ?? [], []);
  assert.equal(result.key_voice_trace.visual_blocks_source, "claude_emit");
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
}

// 3) Claude-emitted visual_blocks accepted (KEY does not rebuild)
{
  const q = "보험료 표로 보여줘";
  const log = [];
  const borrowed = goodClaudeFull({
    customer_answer:
      "등록 계약은 22건이고, 대표 삼성생명 실손의료비보험 월 4만5천 원이에요.",
    visual_blocks: [
      {
        type: "premium_summary_table",
        title: "보험료 요약",
        rows: [
          ["등록 계약 수", "22건", "전체 등록 기준"],
          ["대표 월 납입", "월 4만5천 원", "삼성생명 실손"],
        ],
      },
    ],
  });
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ borrowed, log }),
    },
  );
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.key_voice_trace.visual_blocks_source, "claude_emit");
  assert.ok((result.visual_blocks ?? []).length >= 1);
  assert.equal(result.visual_blocks[0].type, "premium_summary_table");
}

// 4) Search offered (Claude may choose) — tools include web_search + emit_claude_full
{
  const q = "분당 맛집 추천해줘";
  const log = [];
  let sawSearchOffer = false;
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: (body, _n, meta) => {
          if (meta?.tools?.some((t) => t?.name === "web_search")) sawSearchOffer = true;
          return goodClaudeFull({
            customer_answer: "가까운 후보를 찾아볼게요. 분위기를 알려주시면 더 좁혀드릴게요.",
            proposed_tool_actions: [{ tool: "web_search", reason: "장소 검색" }],
          });
        },
        log,
      }),
    },
  );
  assert.equal(sawSearchOffer, true);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.key_voice_trace.tool_permission_check?.any_execute, false);
  assert.equal(
    result.key_voice_trace.tool_permission_check?.results?.find((r) => r.tool === "web_search")
      ?.allowed,
    true,
  );
}

// 5) Out-of-permission tool proposal blocked (no execute)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: goodClaudeFull({
          proposed_tool_actions: [{ tool: "external_wire_transfer", reason: "송금" }],
        }),
        log,
      }),
    },
  );
  const blocked = result.key_voice_trace.tool_permission_check?.results?.find(
    (r) => r.tool === "external_wire_transfer",
  );
  assert.equal(blocked?.allowed, false);
  assert.equal(result.key_voice_trace.tool_permission_check?.any_execute, false);
  assert.equal(log.filter((x) => x === "s6").length, 0);
}

// 6) Hard violation → focused correction once → repaired success
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const hard =
    "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.";
  const repaired = "확인된 22건 기준으로 보험료 부담은 중복 가능성부터 같이 확인해보면 좋겠어요.";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: (_body, n) =>
          n === 1 ? goodClaudeFull({ customer_answer: hard }) : goodClaudeFull({ customer_answer: repaired }),
        log,
      }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 2);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.focused_correction_count, 1);
  assert.equal(result.key_voice_trace.claude_call_count, 2);
  assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
  assert.equal(result.key_voice_trace.used_failure_mode, false);
  assert.equal(result.text, repaired);
  assert.ok(result.key_voice_trace.shadow_probe_omitted?.omitted === true);
  assert.ok(result.key_voice_trace.latency_marks?.claude_full_emit);
  assert.equal(result.key_voice_trace.latency_marks?.borrowed_shadow_probe, null);
}

// 7) No hard → customer_answer rewrite 0 (single Claude call)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const answer = "확인된 22건 기준으로 중복부터 같이 보면 좋겠어요.";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: goodClaudeFull({ customer_answer: answer }),
        log,
      }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
  assert.equal(result.key_voice_trace.focused_correction_count, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(result.text, answer);
}

// 8) Hard → focused correction once still hard → honest failure (no S3/S4/S5/S6)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const hard =
    "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: goodClaudeFull({ customer_answer: hard }),
        log,
      }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 2);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.focused_correction_count, 1);
  assert.equal(result.key_voice_trace.claude_call_count, 2);
  assert.equal(result.key_voice_trace.used_failure_mode, true);
  assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
}

// 9) Shadow Preview — Claude-Full primary (S6 customer path blocked; no env mutation)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "shadow",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeFetch({ borrowed: goodClaudeFull(), log }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.focused_correction_count, 0);
  assert.equal(result.key_voice_trace.shadow_probe_omitted?.omitted, true);
  assert.equal(result.key_voice_trace.latency_marks?.borrowed_shadow_probe ?? null, null);
  assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
  assert.match(result.text, /22건|4만5천/);
}

// Chart builder: map coverage_summary.detected_coverages (no invent)
{
  const chart = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [
      {
        insurer_name: "삼성생명",
        product_name: "실손의료비보험",
        monthly_premium: 45000,
        coverage_summary: {
          detected_coverages: ["실손", "암"],
          coverage_categories: ["실손", "암"],
        },
      },
    ],
  });
  assert.deepEqual(chart.contracts[0].verified_fields.coverages, ["실손", "암"]);
  assert.equal(chart.contracts[0].unknown_fields.includes("coverages"), false);
  const empty = buildVerifiedCustomerChart({
    policy_count: 1,
    policies: [{ insurer_name: "A", product_name: "B", monthly_premium: 1 }],
  });
  assert.equal(empty.contracts[0].verified_fields.coverages, undefined);
  assert.ok(empty.contracts[0].unknown_fields.includes("coverages"));
}

console.log("key-claude-full-single-pass-unit-test: PASS");
