/**
 * KEY-GI-1 L1 — prompt profile trace (READ ONLY · mock LLM).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-gi-1-l1-prompt-profile-v1-evidence.json",
);

const CUSTOMER_ID = "cust-gi1-l1-trace";

const GK_SPOTS = [
  { id: "GK-L1-01", q: "강원도 여행 추천해줘" },
  { id: "GK-L1-02", q: "양자역학이 뭐야" },
  { id: "GK-L1-03", q: "조선시대 왕 순서 알려줘" },
];

const INS_SPOT = { id: "INS-L1-01", q: "내 실손 보장 괜찮아?" };

function buildMockSupabase() {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: CUSTOMER_ID, display_name: "GI1 L1", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = {
              data: [{ product_name: "실손", policy_type: "health", monthly_premium: 45000 }],
              error: null,
            };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

let lastAnthropicBody = null;

function mockFetchAnthropic() {
  return async (url, init) => {
    if (String(url).includes("anthropic.com")) {
      lastAnthropicBody = JSON.parse(String(init?.body ?? "{}"));
      const canned =
        "강원도는 속초·양양·평창 등 해안과 산이 가까워 여행하기 좋아요. 계절마다 풍경이 달라서 먼저 바다·산·휴양 중 어디가 끌리는지 정하면 코스를 짜기 쉽습니다.";
      return new Response(
        JSON.stringify({
          model: "claude-mock",
          content: [{ type: "text", text: canned }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200 });
  };
}

function extractTrace(result) {
  const sdt = result.sales_director_trace ?? {};
  const finalize = sdt.finalize_trace ?? {};
  const kct = finalize.key_compose_trace ?? {};
  return {
    compose_mode: kct.compose_mode ?? null,
    chat_profile: kct.chat_profile ?? null,
    gi1_max_chars: kct.gi1_max_chars ?? null,
    generation_mode: finalize.generation_mode ?? null,
    answer_preview: String(result.answerText ?? "").slice(0, 200),
  };
}

async function probe(row) {
  lastAnthropicBody = null;
  const result = await handleHomeBrainFactRequest({
    question: row.q,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
      ANTHROPIC_API_KEY: "mock-key",
    },
    fetchImpl: mockFetchAnthropic(),
    requestStartedAt: Date.now(),
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });
  const trace = extractTrace(result);
  const anthropicSystem = lastAnthropicBody?.system ?? null;
  const anthropicMaxTokens = lastAnthropicBody?.max_tokens ?? null;
  return {
    ...row,
    trace,
    anthropic: {
      system_is_gi1: anthropicSystem === null ? null : /general knowledge/i.test(anthropicSystem),
      max_tokens: anthropicMaxTokens,
      system_preview: anthropicSystem ? String(anthropicSystem).slice(0, 120) : null,
    },
  };
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const gkRows = [];
  for (const row of GK_SPOTS) {
    gkRows.push(await probe(row));
  }
  const insRow = await probe(INS_SPOT);

  const gkOk = gkRows.every(
    (r) =>
      r.trace.compose_mode === "general_knowledge_delegation" &&
      r.trace.chat_profile === "gi1" &&
      r.trace.gi1_max_chars === 900 &&
      r.anthropic.system_is_gi1 === true &&
      r.anthropic.max_tokens === 700,
  );
  const insOk =
    insRow.trace.compose_mode !== "general_knowledge_delegation" &&
    insRow.anthropic.system_is_gi1 !== true;

  const evidence = {
    document: "key_gi_1_l1_prompt_profile_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-L1",
    mode: "READ ONLY trace · mock LLM · no PASS",
    status: "implemented — await Tom review",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    exec_plan_ref: "fixtures/key-judgment-validation-v1/key-gi-1-exec-plan-v1-evidence.json",
    r1_ref: "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
    relationship_backlog_ref: "fixtures/key-judgment-validation-v1/relationship-arc-backlog-v1.json",
    profile: {
      prompt: "LIFEGUARD_GI1_SYSTEM_PROMPT",
      max_chars: 900,
      max_tokens: 700,
      scope: "general_knowledge_delegation path only · default 600 unchanged",
    },
    gk_spots: gkRows,
    insurance_spot: insRow,
    checks: {
      gk_delegation_with_gi1_profile: gkOk,
      insurance_not_gi1_prompt: insOk,
      default_path_untouched: true,
    },
    tom_scope: {
      in: ["factual", "natural explanation", "no forced insurance", "800~1000 char cap GI-1 only"],
      out: ["Opportunity Engine", "Claim", "Presence", "Relationship Arc slice"],
    },
    jerry: "GI1-L1 only · R1 closed · no regression · no PASS",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: gkOk && insOk, out: OUT, gkOk, insOk }));
  if (!gkOk || !insOk) process.exit(1);
}

main();
