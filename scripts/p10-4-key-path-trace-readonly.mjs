/**
 * P10-4 READ ONLY — KEY path trace for cancer coverage_presence questions.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "fixtures/p10-4-key-path-trace");
const OUT_JSON = join(OUT_DIR, "key-path-trace-report.json");

const QUESTIONS = ["나 암보장있어?", "나는 암보장있어?", "암보험 있어?"];

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
          data: { id: "cust-p10-4-key", display_name: "QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = {
              data: [
                { product_name: "암진단", policy_type: "cancer", monthly_premium: 38000 },
                { product_name: "실손의료비", policy_type: "health", monthly_premium: 45000 },
              ],
              error: null,
            };
          }
          if (table === "customer_memory_facts") {
            payload = {
              data: [{ fact_key: "goal", fact_value: "보험 확인" }],
              error: null,
              count: 1,
            };
          }
          if (table === "analysis_jobs") {
            payload = {
              data: [
                {
                  id: "j1",
                  status: "completed",
                  result_json: {
                    coverage_gap: {
                      items: [
                        { coverage_type: "cancer", current_status: "held", coverage_label: "암" },
                        { coverage_type: "medical_expense", current_status: "held", coverage_label: "실손" },
                      ],
                    },
                  },
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

function mockClaudeFetch(answerText) {
  const short =
    answerText ??
    "관련해서는 가입된 것으로 확인돼요. 담보 범위는 이 자료만으로는 단정하기 어려워요.";
  const parts = short.match(/.{1,20}/gs) ?? [short];
  const sseBody = parts
    .map(
      (part) =>
        `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(part)}}}\n\n`,
    )
    .join("");
  return async () =>
    new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function traceScenario(question, { keyOn = false, label = "" } = {}) {
  const events = [];
  const streamHandlers = {
    _emitted: false,
    onDelta(text) {
      streamHandlers._emitted = true;
      events.push({ type: "delta", preview: String(text).slice(0, 120) });
    },
    onReplace(text) {
      events.push({ type: "replace", preview: String(text).slice(0, 120) });
    },
  };

  const env = { ...process.env, ANTHROPIC_API_KEY: "mock-key" };
  if (keyOn) {
    env.SALES_DIRECTOR_KEY_ORCHESTRATOR = "1";
    env.SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST = "cust-p10-4-key";
  } else {
    delete env.SALES_DIRECTOR_KEY_ORCHESTRATOR;
    delete env.SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST;
  }

  const result = await handleHomeBrainFactRequest({
    question,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: "cust-p10-4-key",
    env,
    fetchImpl: mockClaudeFetch(),
    requestStartedAt: Date.now(),
    streamHandlers,
  });

  const trace = result.sales_director_trace?.p10_4_key_path_trace ?? null;

  return {
    scenario: label || (keyOn ? "KEY_ON" : "KEY_OFF"),
    question,
    ok: result.ok === true,
    response_source: result.response_source ?? null,
    sales_director_mode: result.sales_director_mode ?? null,
    answerText_preview: String(result.answerText ?? "").slice(0, 300),
    sse: {
      event_types: events.map((e) => e.type),
      replace_count: events.filter((e) => e.type === "replace").length,
      delta_count: events.filter((e) => e.type === "delta").length,
    },
    key_path_trace: trace,
  };
}

const rows = [];
for (const question of QUESTIONS) {
  rows.push(await traceScenario(question, { keyOn: false, label: "legacy_KEY_OFF" }));
  rows.push(await traceScenario(question, { keyOn: true, label: "key_KEY_ON_allowlisted" }));
}

mkdirSync(OUT_DIR, { recursive: true });
const report = {
  readonly: true,
  audit: "p10_4_key_path_trace",
  generated_at: new Date().toISOString(),
  rows,
};
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
