/**
 * KEY-GI-1 R1 — General Knowledge Delegation trace (READ ONLY).
 * Proves GK → lifeguardChatCore · insurance/RC paths preserved.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
);

const CUSTOMER_ID = "cust-gi1-r1-delegation";

const GK_SAMPLES = [
  { id: "GK-R1-01", q: "양자컴퓨터가 뭐야?" },
  { id: "GK-R1-02", q: "강원도 여행 추천해줘" },
  { id: "GK-R1-03", q: "유럽 배낭여행 준비물 알려줘." },
  { id: "GK-R1-04", q: "고혈압 줄이는 생활" },
];

const INSURANCE_SAMPLES = [
  { id: "INS-R1-01", q: "암보험 부족한가" },
  { id: "INS-R1-02", q: "뭐 가입해야 해" },
  { id: "INS-R1-03", q: "실손보험에서 다이어트 치료는 보장돼?" },
];

const RC_SAMPLES = [
  { id: "RC-R1-01", q: "안녕" },
  { id: "RC-R1-02", q: "오랜만이야" },
  { id: "RC-R1-03", q: "고마워" },
  { id: "RC-R1-04", q: "다음에 또 올게" },
  { id: "RC-R1-05", q: "지난번 말한 거 기억해?" },
];

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
          data: { id: CUSTOMER_ID, display_name: "GI1 QA", memory_version: 1 },
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
          if (table === "customer_memory_facts") {
            payload = {
              data: [{ fact_key: "worry", fact_value: "보험료 부담" }],
              error: null,
              count: 1,
            };
          }
          if (table === "customer_context_snapshots") {
            payload = {
              data: [
                {
                  id: "snap-gi1-r1",
                  context_snapshot_id: "snap-gi1-r1",
                  customer_id: CUSTOMER_ID,
                  payload: {},
                },
              ],
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

function extractTrace(result) {
  const sdt = result.sales_director_trace ?? {};
  const p10 = sdt.p10_4_key_path_trace ?? {};
  const finalize = sdt.finalize_trace ?? {};
  const kct = finalize.key_compose_trace ?? p10.build_key_structured_response ?? {};
  return {
    response_source: result.response_source ?? null,
    compose_mode: kct.compose_mode ?? finalize.generation_mode ?? null,
    generation_mode: finalize.generation_mode ?? null,
    skip_reason: kct.skip_reason ?? null,
    gk_delegation:
      kct.compose_mode === "general_knowledge_delegation" ||
      finalize.generation_mode === "general_knowledge_delegation",
    key_relational: kct.compose_mode === "key_relational",
    answer_preview: String(result.answerText ?? "").slice(0, 160),
  };
}

async function probeQuestion(row) {
  const result = await handleHomeBrainFactRequest({
    question: row.q,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
      ANTHROPIC_API_KEY: "mock-key-gi1-r1",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "GI1 R1 mock lifeguardChatCore factual answer for trace." }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    requestStartedAt: Date.now(),
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });
  return {
    id: row.id,
    question: row.q,
    ok: result.ok !== false,
    trace: extractTrace(result),
  };
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const gkRows = [];
  for (const row of GK_SAMPLES) {
    gkRows.push(await probeQuestion(row));
  }
  const insRows = [];
  for (const row of INSURANCE_SAMPLES) {
    insRows.push(await probeQuestion(row));
  }
  const rcRows = [];
  for (const row of RC_SAMPLES) {
    rcRows.push(await probeQuestion(row));
  }

  const gkDelegated = gkRows.filter((r) => r.trace.gk_delegation).length;
  const gkRelational = gkRows.filter((r) => r.trace.key_relational).length;
  const insGkLeak = insRows.filter((r) => r.trace.gk_delegation).length;
  const rcGkLeak = rcRows.filter((r) => r.trace.gk_delegation).length;

  const evidence = {
    document: "key_gi_1_r1_delegation_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-R1",
    label: "General Knowledge Delegation trace",
    mode: "READ ONLY · orchestrator ON · mock Claude",
    status: "measured — no PASS declaration",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    r2_ref: "fixtures/key-judgment-validation-v1/key-gi-1-r2-v1-evidence.json",
    flow: "orchestrator → GK eligible → lifeguardChatCore delegation",
    changed_files: [
      "server/homeAgentTom.js",
      "server/homeBrainFactCore.js",
      "server/humanUnderstandingLoop.js",
    ],
    gk_delegation_summary: {
      total: gkRows.length,
      delegated: gkDelegated,
      key_relational: gkRelational,
      expect: "all GK → general_knowledge_delegation · not key_relational",
    },
    insurance_preserve_summary: {
      total: insRows.length,
      gk_leaks: insGkLeak,
      expect: "no general_knowledge_delegation",
    },
    rc_spot_summary: {
      total: rcRows.length,
      gk_leaks: rcGkLeak,
      expect: "RC not hijacked by GK delegation",
    },
    gk_rows: gkRows,
    insurance_rows: insRows,
    rc_rows: rcRows,
    jerry: "R1 Delegation trace · no PASS",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      out: OUT,
      gk_delegated: gkDelegated,
      gk_relational: gkRelational,
      ins_leak: insGkLeak,
      rc_leak: rcGkLeak,
    }),
  );
}

main();
