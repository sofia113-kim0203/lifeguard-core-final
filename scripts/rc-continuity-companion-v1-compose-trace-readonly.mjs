/**
 * READ ONLY — RC continuity compose trace hop audit (local, no code change).
 */
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/rc-continuity-companion-v1-compose-trace-readonly-evidence.json",
);

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
          data: { id: "cust-rc-trace", display_name: "QA", memory_version: 1 },
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
            payload = { data: [], error: null, count: 0 };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function probe(question, history = []) {
  const result = await handleHomeBrainFactRequest({
    question,
    history,
    userSupabase: buildMockSupabase(),
    customerId: "cust-rc-trace",
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "cust-rc-trace",
      ANTHROPIC_API_KEY: "mock-key",
    },
    fetchImpl: async () => new Response("", { status: 200 }),
    requestStartedAt: Date.now(),
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });
  const sdt = result.sales_director_trace ?? {};
  const p10 = sdt.p10_4_key_path_trace ?? {};
  return {
    question,
    answer_preview: String(result.answerText ?? "").slice(0, 200),
    response_source: result.response_source ?? null,
    paths: {
      finalize_trace_present: Boolean(sdt.finalize_trace),
      finalize_trace_compose_mode: sdt.finalize_trace?.key_compose_trace?.compose_mode ?? null,
      p10_build_key_compose_mode: p10.build_key_structured_response?.compose_mode ?? null,
      p10_build_key_called: p10.build_key_structured_response?.called ?? null,
      hul_generation_mode: p10.hul?.generation_mode ?? null,
    },
    companion_cluster: p10.companion_cluster ?? null,
  };
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
  const rows = [
    await probe("그 이야기 이어서.", []),
    await probe("그 이야기 이어서.", [{ role: "user", content: "오늘 너무 힘들었어." }]),
    await probe("지난번 우리가 이야기했던 부담 줄이기, 어떻게 됐어?", [
      { role: "user", content: "보험료 부담이 너무 커요." },
      { role: "assistant", content: "부담 줄이는 방향부터 같이 보면 됩니다." },
    ]),
  ];
  const payload = {
    document: "rc_continuity_companion_v1_compose_trace_readonly_evidence",
    mode: "READ ONLY · trace hop audit · no product change",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    root_cause_hypothesis:
      "finalize_trace never attached to sales_director_trace; p10_4_key_path_trace carries compose_mode",
    probes: rows,
    jerry: "STOP — audit only",
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(rows, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
