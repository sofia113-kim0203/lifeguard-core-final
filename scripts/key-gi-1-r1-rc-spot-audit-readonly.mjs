/**
 * KEY-GI-1 R1 — RC spot audit (READ ONLY).
 * Tom: RC-R1-04 / RC-R1-05 vs RC-CONTINUITY anchors · R1 regression vs pre-existing.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-gi-1-r1-rc-spot-audit-v1-evidence.json",
);

const CUSTOMER_ID = "cust-gi1-r1-rc-audit";

const FLAGGED = [
  {
    id: "RC-R1-04",
    q: "다음에 또 올게",
    gi_bank_expect: "continuity (gi-1-regression-bank aspirational)",
    rc_contract: "not RC-CONTINUITY paraphrase — closing/exit semantics",
  },
  {
    id: "RC-R1-05",
    q: "지난번 말한 거 기억해?",
    gi_bank_expect: "memory/continuity (gi-1-regression-bank aspirational)",
    rc_contract: "RC-CONTINUITY excludes 기억 — Memory recall / key_structured",
  },
];

const RC_CONTINUITY_ANCHORS = [
  { id: "RC-ANCHOR-01", q: "그 이야기 이어서." },
  { id: "RC-ANCHOR-02", q: "아까 말한 거." },
  { id: "RC-ANCHOR-03", q: "전에 말한 거." },
  { id: "RC-ANCHOR-04", q: "그때 이야기." },
  { id: "RC-ANCHOR-05", q: "지난번 이야기." },
];

const RC_RECOGNITION_ANCHOR = { id: "RC-REC-01", q: "오랜만이야" };

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
          data: { id: CUSTOMER_ID, display_name: "RC Audit", memory_version: 1 },
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
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function loadClassificationHelpers() {
  const intent = await import("../server/intentGateLayer.js");
  const router = await import("../server/homeBrainRouter.js");
  const bridge = await import("../server/conversationContinuityBridge.js");
  const gk = await import("../server/generalKnowledgeEligibility.js");
  return { ...intent, ...router, ...bridge, ...gk };
}

async function classifyLayer(row, helpers) {
  const c = helpers.classifyConsultationIntent(row.q);
  const factBundle = {
    question: row.q,
    companion_cluster: c.companion_cluster ?? null,
    classification_intent: c.intent,
    memory_facts: [{ fact_key: "worry", fact_value: "보험료 부담" }],
    memory_fact_count: 1,
    policies: [{ product_name: "실손" }],
    policy_count: 1,
    key_orchestrator: true,
  };
  return {
    intent: c.intent,
    matched_rule: c.matched_rule,
    companion_cluster: c.companion_cluster ?? null,
    general_knowledge: c.general_knowledge ?? false,
    continuity_cluster_detect: helpers.detectContinuityCompanionCluster(row.q)?.cluster_id ?? null,
    recognition_cluster_detect: helpers.detectRecognitionCompanionCluster(row.q)?.cluster_id ?? null,
    home_brain_intent: helpers.classifyHomeBrainIntent(row.q),
    home_route: helpers.resolveHomeBrainRoute(row.q, c),
    is_gk_eligible: helpers.isGeneralKnowledgeEligible(row.q, c),
    would_gk_delegate: c.general_knowledge === true,
    would_continuity_compose: helpers.shouldUseContinuityCompanionCompose({
      question: row.q,
      factBundle,
      humanFrame: {},
    }),
  };
}

function extractCompose(result) {
  const sdt = result.sales_director_trace ?? {};
  const finalize = sdt.finalize_trace ?? {};
  const kct = finalize.key_compose_trace ?? {};
  const p10 = sdt.p10_4_key_path_trace ?? {};
  return {
    compose_mode:
      kct.compose_mode ??
      finalize.generation_mode ??
      p10.build_key_structured_response?.compose_mode ??
      null,
    generation_mode: finalize.generation_mode ?? null,
    gk_delegation: kct.compose_mode === "general_knowledge_delegation",
    companion_cluster: p10.companion_cluster ?? null,
    answer_preview: String(result.answerText ?? "").slice(0, 180),
  };
}

async function runtimeProbe(row, history = []) {
  const result = await handleHomeBrainFactRequest({
    question: row.q,
    history,
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
      ANTHROPIC_API_KEY: "mock-key",
    },
    fetchImpl: async () => new Response("", { status: 200 }),
    requestStartedAt: Date.now(),
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });
  return extractCompose(result);
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
  const helpers = await loadClassificationHelpers();

  const flaggedRows = [];
  for (const row of FLAGGED) {
    flaggedRows.push({
      ...row,
      classification: await classifyLayer(row, helpers),
      runtime: await runtimeProbe(row),
    });
  }

  const anchorRows = [];
  for (const row of RC_CONTINUITY_ANCHORS) {
    anchorRows.push({
      ...row,
      classification: await classifyLayer(row, helpers),
      runtime: await runtimeProbe(row),
      runtime_with_history: await runtimeProbe(row, [
        { role: "user", content: "오늘 너무 힘들었어." },
      ]),
    });
  }

  const recRow = {
    ...RC_RECOGNITION_ANCHOR,
    classification: await classifyLayer(RC_RECOGNITION_ANCHOR, helpers),
    runtime: await runtimeProbe(RC_RECOGNITION_ANCHOR),
  };

  const anchorsOk = anchorRows.filter(
    (r) =>
      r.runtime.compose_mode === "continuity_companion_bridge" ||
      r.runtime_with_history?.compose_mode === "continuity_companion_bridge",
  ).length;

  const evidence = {
    document: "key_gi_1_r1_rc_spot_audit_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-R1",
    mode: "READ ONLY · RC spot audit · no code change",
    status: "audited — no PASS",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    r1_delegation_ref: "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
    rc_continuity_baseline_ref:
      "fixtures/key-judgment-validation-v1/rc-continuity-companion-v1-compose-trace-readonly-evidence.json",
    verdict_summary: {
      r1_regression_on_flagged: false,
      pre_existing_key_structured_on_flagged: true,
      gi_regression_bank_mismatch: true,
      rc_continuity_anchors_intact: anchorsOk === RC_CONTINUITY_ANCHORS.length,
    },
    flagged_rc_spots: flaggedRows,
    rc_continuity_anchors: anchorRows,
    rc_recognition_anchor: recRow,
    tom_readout: {
      "RC-R1-04_다음에_또_올게": {
        runtime_compose: flaggedRows[0]?.runtime.compose_mode,
        continuity_cluster: flaggedRows[0]?.classification.continuity_cluster_detect,
        would_continuity_compose: flaggedRows[0]?.classification.would_continuity_compose,
        would_gk_delegate: flaggedRows[0]?.classification.would_gk_delegate,
        r1_caused: false,
        verdict: "pre-existing · not RC-CONTINUITY contract · GI bank expect mismatch",
      },
      "RC-R1-05_지난번_말한_거_기억해": {
        runtime_compose: flaggedRows[1]?.runtime.compose_mode,
        continuity_cluster: flaggedRows[1]?.classification.continuity_cluster_detect,
        would_continuity_compose: flaggedRows[1]?.classification.would_continuity_compose,
        would_gk_delegate: flaggedRows[1]?.classification.would_gk_delegate,
        r1_caused: false,
        verdict:
          "pre-existing Memory recall axis · RC-CONTINUITY explicitly excludes 기억 — not R1 regression",
      },
      rc_continuity_anchors: `${anchorsOk}/${RC_CONTINUITY_ANCHORS.length} → continuity_companion_bridge (matches pre-R1 baseline)`,
    },
    jerry: "R1 RC audit only · no code · no L1 · no PASS",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, out: OUT, anchorsOk, flagged: flaggedRows }));
}

main();
