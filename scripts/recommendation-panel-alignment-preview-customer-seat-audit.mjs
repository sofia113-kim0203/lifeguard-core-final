/**
 * Recommendation Panel Alignment — Preview customer-seat audit (observation only).
 * Tom: chat → panel must feel like the same KEY continues speaking.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import {
  KEY_RECOMMENDATION_PANEL_LIMITATION,
  auditTomPanelAlignmentSeat,
  buildRecommendationPanelContinuation,
} from "../src/lib/recommendationPanelKeyVoice.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "recommendation-panel-alignment-preview-customer-seat-evidence.json");

const CHAT_Q_RECOMMEND = "추천해줘.";
const CHAT_Q_PRIORITY = "지금 뭐부터 추가하면 좋을까?";

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function extractAnswer(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    responseSource: done.response_source ?? null,
    classificationIntent:
      done.consultation_intent ??
      done.sales_director_trace?.p10_4_key_path_trace?.classificationIntent ??
      null,
  };
}

function pickTop2(payload = {}) {
  const top2 = payload.customer_visible_top2 ?? payload.customerVisibleTop2 ?? [];
  return Array.isArray(top2) ? top2.slice(0, 2) : [];
}

async function fetchRecommendations({ previewBase, token, bypassSecret }) {
  const url = `${previewBase.replace(/\/$/, "")}/api/customer-recommendations`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-vercel-protection-bypass": bypassSecret,
    },
    body: JSON.stringify({ skip_claude: true }),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload };
}

async function probeChat({ previewBase, token, bypassSecret, question }) {
  const probe = await fetchBypassSse({
    previewBase,
    token,
    question,
    history: [],
    bypassSecret,
  });
  const events = parseSse(probe.stdout);
  return extractAnswer(events);
}

async function main() {
  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  loadPreviewProbeEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const bypass = resolveBypassSecret();
  const resolved = resolvePreviewProbeEnv({ previewBase: previewBaseArg });
  if (!resolved.previewBase || !bypass) {
    console.error("BLOCKED — preview URL and bypass required");
    process.exit(1);
  }

  const token = await mintPreviewProbeJwt(resolved);
  const [chatRecommend, chatPriority, recApi] = await Promise.all([
    probeChat({
      previewBase: resolved.previewBase,
      token,
      bypassSecret: bypass,
      question: CHAT_Q_RECOMMEND,
    }),
    probeChat({
      previewBase: resolved.previewBase,
      token,
      bypassSecret: bypass,
      question: CHAT_Q_PRIORITY,
    }),
    fetchRecommendations({ previewBase: resolved.previewBase, token, bypassSecret: bypass }),
  ]);

  const recTop2 = pickTop2(recApi.payload);
  const panelContinuation = buildRecommendationPanelContinuation(recTop2);

  const seatRecommend = auditTomPanelAlignmentSeat({
    chatAnswer: chatRecommend.answerText,
    panelContinuation,
    panelLimitation: KEY_RECOMMENDATION_PANEL_LIMITATION,
    responseSource: chatRecommend.responseSource,
  });

  const seatPriority = auditTomPanelAlignmentSeat({
    chatAnswer: chatPriority.answerText,
    panelContinuation,
    panelLimitation: KEY_RECOMMENDATION_PANEL_LIMITATION,
    responseSource: chatPriority.responseSource,
  });

  const evidence = {
    schema_version: "recommendation-panel-alignment-preview-customer-seat-v1",
    audit: "recommendation_panel_alignment_preview_customer_seat",
    note: "Observation only — Tom PASS/close. Jerry does not declare PASS.",
    slice_design: "fixtures/key-judgment-validation-v1/recommendation-panel-alignment-slice-design-v1.json",
    preview_base: resolved.previewBase,
    git_commit: gitShortSha(),
    observed_at: new Date().toISOString(),
    tom_completion_criterion: "채팅 → 패널 → 같은 사람인가?",
    flow: ["chat 추천해줘", "chat priority path", "panel continuation voice", "Tom seat audit"],
    chat_recommend: {
      question: CHAT_Q_RECOMMEND,
      ...chatRecommend,
      gap_03_note:
        chatRecommend.responseSource === "sales_director_guarded_hold"
          ? "recommendation_request — KEY orchestrator OFF; panel alignment alone cannot unify this path (GAP-03)"
          : null,
    },
    chat_priority: {
      question: CHAT_Q_PRIORITY,
      ...chatPriority,
    },
    panel_voice: {
      rec_top2_count: recTop2.length,
      continuation: panelContinuation,
      limitation: KEY_RECOMMENDATION_PANEL_LIMITATION,
      next_step_sample: recTop2.length ? "그럼 앞으로는, 위 축부터 순서대로 함께 확인하면 됩니다." : null,
    },
    recommendation_api: {
      ok: recApi.ok,
      status: recApi.status,
      top2_labels: recTop2.map((item) => item.coverage_label ?? item.coverage_category),
    },
    panel_ui_on_preview_bundle: false,
    panel_ui_note: "Preview bundle may predate RecommendationPanelKeyView — Tom visual seat requires deploy of panel alignment code",
    tom_primary_flow: {
      question: CHAT_Q_RECOMMEND,
      expected_for_slice_close: "Tom visual YES on chat → panel after deploy",
      current_api_probe: seatRecommend,
    },
    tom_aligned_flow: {
      question: CHAT_Q_PRIORITY,
      note: "KEY judgment path — panel voice parity probe",
      current_api_probe: seatPriority,
    },
    tom_preview_questions: {
      q1_not_new_screen: "패널이 독립적으로 시작하지 않고 대화를 이어받는가?",
      q2_same_key: "KEY가 계속 설명하고 있다고 느껴지는가?",
      q3_phase_bc_flow: "Phase B judgment → panel continuation → Phase C next step 흐름이 이어지는가?",
    },
    status: "awaiting_tom_preview_seat_review",
    jerry_pass_declaration: "none",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ out: OUT, seatPriority: seatPriority.pass_heuristic, seatRecommend: seatRecommend.pass_heuristic }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
