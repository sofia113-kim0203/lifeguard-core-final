/**
 * Targeted unit tests — S3 structured writer surgery (PRE-GATE contract).
 * No network / DB / Claude.
 */
import assert from "node:assert/strict";
import {
  applyConfirmedSourceFactsAttachProvenance,
  buildKeyTurnStructuredOutputConfig,
  buildKeyTurnStructuredOutputHint,
  customerTextHasStructuredJsonLeak,
  extractCustomerAnswerFromStructuredJsonPartial,
  parseKeyTurnStructuredResult,
  shouldUseKeyTurnStructuredWriter,
} from "../server/keyCore/keyRecordSidecar.js";
import {
  KEY_CONFIRMED_SOURCE_FACT_TYPES,
  normalizeKeyConfirmedSourceFacts,
  resolveKeyConfirmableFactsForPersist,
  selectKeyConfirmableSourceFacts,
} from "../server/documentPolicyUploadPersist.js";
import { ANTHROPIC_WEB_SEARCH_TOOL } from "../server/keyCore/keyBorrowedSensesSpeak.js";

const DOC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function planFor(...ids) {
  return {
    attachment_identities: ids.map((document_id, i) => ({
      original_index: i + 1,
      document_id,
      delivers_original_block: true,
    })),
  };
}

function onePathOriginalRequest(tools = []) {
  return {
    tools,
    selection_plan: {
      current_attachment_mode: "THIS_TURN_ORIGINAL",
      live_request_mode: "ONE_PATH_CLAUDE_FIRST",
    },
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// A — document/original + tools=[] → output_config.format present
test("A_document_lane_tools_empty_structured_output_config_present", () => {
  const enabled = shouldUseKeyTurnStructuredWriter({
    presenceTurn: false,
    ownedOriginalAttached: true,
    selectiveLiveRequest: onePathOriginalRequest([]),
    tools: [],
  });
  assert.equal(enabled, true);
  const output_config = buildKeyTurnStructuredOutputConfig(
    KEY_CONFIRMED_SOURCE_FACT_TYPES,
  );
  assert.equal(output_config.format.type, "json_schema");
  assert.deepEqual(output_config.format.schema.required, [
    "customer_answer",
    "confirmed_source_facts",
  ]);
  const propKeys = Object.keys(output_config.format.schema.properties);
  assert.equal(propKeys[0], "customer_answer");
  assert.equal(output_config.format.schema.additionalProperties, false);
  const body = {
    model: "claude-sonnet-4-6",
    stream: true,
    ...(enabled ? { output_config } : {}),
  };
  assert.ok(body.output_config?.format);
  assert.equal(body.output_config.format.type, "json_schema");
});

// B — product-showcase/web_search → output_config ABSENT
test("B_product_showcase_web_search_no_structured_output", () => {
  const tools = [ANTHROPIC_WEB_SEARCH_TOOL];
  const enabled = shouldUseKeyTurnStructuredWriter({
    presenceTurn: false,
    ownedOriginalAttached: true,
    selectiveLiveRequest: onePathOriginalRequest(tools),
    tools,
  });
  assert.equal(enabled, false);
  const body = {
    model: "claude-sonnet-4-6",
    tools,
    tool_choice: { type: "auto" },
    ...(enabled
      ? {
          output_config: buildKeyTurnStructuredOutputConfig(
            KEY_CONFIRMED_SOURCE_FACT_TYPES,
          ),
        }
      : {}),
  };
  assert.equal(body.output_config, undefined);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, "web_search");
});

// C — structured response facts reach provenance + Gate
test("C_structured_facts_reach_provenance_and_gate", () => {
  const raw = JSON.stringify({
    customer_answer: "원본 기준으로 확인했습니다.",
    confirmed_source_facts: [
      {
        fact_type: "insurer",
        literal: "한화손해보험",
        source_document_id: DOC_A,
      },
      {
        fact_type: "product_name",
        literal: "간편건강보험",
        source_document_id: DOC_A,
      },
    ],
  });
  const parsed = parseKeyTurnStructuredResult(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.confirmed_source_facts[0].literal_value, "한화손해보험");
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: parsed.confirmed_source_facts,
    attachmentIdentityPlan: planFor(DOC_A),
  });
  assert.equal(prov.facts.length, 2);
  const normalized = normalizeKeyConfirmedSourceFacts(prov.facts, {
    source_document_id: prov.defaultSourceDocumentId,
  });
  assert.equal(normalized.length, 2);
  const gated = selectKeyConfirmableSourceFacts({
    facts: normalized,
    activeDocumentId: DOC_A,
    ownedActiveDocumentId: DOC_A,
  });
  assert.equal(gated.accepted.length, 2);
  assert.equal(gated.ownership_ok, true);
});

// D — stream decoder: customer deltas = answer only; escapes; no JSON leak
test("D_stream_customer_answer_only_no_json_framing", () => {
  const answer = '한화 "특약" 줄바꿈\n그리고 \\백슬래시';
  const full = JSON.stringify({
    customer_answer: answer,
    confirmed_source_facts: [
      { fact_type: "insurer", literal: "한화", source_document_id: DOC_A },
    ],
  });
  const deltas = [];
  for (let n = 1; n <= full.length; n += 1) {
    const partial = full.slice(0, n);
    const extracted = extractCustomerAnswerFromStructuredJsonPartial(partial);
    if (extracted.customer_answer) {
      deltas.push(extracted.customer_answer);
      assert.equal(customerTextHasStructuredJsonLeak(extracted.customer_answer), false);
      assert.doesNotMatch(extracted.customer_answer, /"customer_answer"\s*:/);
      assert.doesNotMatch(extracted.customer_answer, /"confirmed_source_facts"\s*:/);
      assert.doesNotMatch(extracted.customer_answer, /^\s*\{/);
    }
  }
  assert.ok(deltas.length > 0);
  const last = deltas[deltas.length - 1];
  assert.equal(last, answer);
  assert.match(last, /한화/);
  assert.match(last, /특약/);
  assert.match(last, /\n/);
  assert.match(last, /\\/);
});

test("D_unicode_escape_in_customer_answer", () => {
  const partial =
    '{"customer_answer":"\\uD55C\\uD654 보험","confirmed_source_facts":[]}';
  const extracted = extractCustomerAnswerFromStructuredJsonPartial(partial);
  assert.equal(extracted.complete, true);
  assert.equal(extracted.customer_answer, "한화 보험");
});

// F — wrong source_document_id dropped by existing provenance
test("F_wrong_source_document_id_dropped_by_provenance", () => {
  const parsed = parseKeyTurnStructuredResult(
    JSON.stringify({
      customer_answer: "설명",
      confirmed_source_facts: [
        {
          fact_type: "insurer",
          literal: "wrong-doc",
          source_document_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        },
        {
          fact_type: "product_name",
          literal: "ok",
          source_document_id: DOC_A,
        },
      ],
    }),
  );
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: parsed.confirmed_source_facts,
    attachmentIdentityPlan: planFor(DOC_A, DOC_B),
  });
  assert.equal(prov.facts.length, 1);
  assert.equal(prov.facts[0].literal_value, "ok");
});

// G — structured parse fail → confirmed 0, no raw JSON as customer answer
test("G_structured_parse_fail_no_persist_no_leak", () => {
  const broken = '{"customer_answer":"부분","confirmed_source_facts":';
  const parsed = parseKeyTurnStructuredResult(broken);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.confirmed_source_facts.length, 0);
  assert.equal(parsed.customer_answer, "");
  const streamed = extractCustomerAnswerFromStructuredJsonPartial(broken);
  assert.equal(streamed.customer_answer, "부분");
  assert.equal(customerTextHasStructuredJsonLeak(streamed.customer_answer), false);
  assert.equal(customerTextHasStructuredJsonLeak(broken), true);
});

test("schema_hint_and_lane_guards", () => {
  assert.equal(
    shouldUseKeyTurnStructuredWriter({
      presenceTurn: true,
      ownedOriginalAttached: true,
      selectiveLiveRequest: onePathOriginalRequest([]),
      tools: [],
    }),
    false,
  );
  assert.equal(
    shouldUseKeyTurnStructuredWriter({
      presenceTurn: false,
      ownedOriginalAttached: false,
      selectiveLiveRequest: onePathOriginalRequest([]),
      tools: [],
    }),
    false,
  );
  assert.equal(
    shouldUseKeyTurnStructuredWriter({
      presenceTurn: false,
      ownedOriginalAttached: true,
      selectiveLiveRequest: {
        tools: [],
        selection_plan: { current_attachment_mode: "CARD_ONLY" },
      },
      tools: [],
    }),
    false,
  );
  const hint = buildKeyTurnStructuredOutputHint({ documentIds: [DOC_A] });
  assert.match(hint, /KEY_TURN_STRUCTURED_OUTPUT/);
  assert.match(hint, /confirmed_source_facts/);
  assert.match(hint, /KEY_RECORD sidecar/);
  assert.match(hint, /금지/);
});

await testAsync("E_empty_confirmed_no_auto_promotion", async () => {
  const parsed = parseKeyTurnStructuredResult(
    JSON.stringify({
      customer_answer: "원본에서 확인 가능한 계약 사실이 없습니다.",
      confirmed_source_facts: [],
    }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.confirmed_source_facts.length, 0);
  const prov = applyConfirmedSourceFactsAttachProvenance({
    facts: parsed.confirmed_source_facts,
    attachmentIdentityPlan: planFor(DOC_A),
  });
  assert.equal(prov.facts.length, 0);
  const resolved = await resolveKeyConfirmableFactsForPersist({
    supabase: null,
    customerId: "cust",
    activeDocumentId: DOC_A,
    facts: [],
  });
  assert.equal(resolved.accepted.length, 0);
  assert.equal(resolved.gate.attempted, false);
});

if (process.exitCode) {
  console.error("KEY_S3_STRUCTURED_WRITER_UNIT=FAIL");
} else {
  console.log("KEY_S3_STRUCTURED_WRITER_UNIT=PASS");
}
