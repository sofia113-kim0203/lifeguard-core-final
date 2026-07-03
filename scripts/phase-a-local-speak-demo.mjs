/**
 * Phase A — local sample first + follow-up sentences for Tom audit (no Preview URL).
 */
import {
  buildDu1InputBundle,
  buildPhaseAFollowUpCustomerSpeak,
  composeDu1WithEpistemicTrace,
} from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";

function buildLoadedContext(flags = {}) {
  return {
    profile: "present",
    policies: flags.policies ? "present" : "empty",
    documents: "present",
    memory: flags.memory ? "present" : "empty",
    conversations: { status: flags.conversation ? "present" : "empty" },
  };
}

function buildSnapshot(flags = {}) {
  return {
    context_snapshot_id: "snap-demo",
    flags: {
      has_policies: Boolean(flags.policies),
      has_memory: Boolean(flags.memory),
      has_recent_conversation: Boolean(flags.conversation),
    },
    bundle: {
      policies: flags.policies ?? [],
      memoryFacts: flags.memoryFacts ?? [],
      recentConversation: flags.conversation ?? { hasHistory: false },
    },
  };
}

const document = {
  id: "demo-doc",
  original_filename: "운전자보험증권.pdf",
  customer_hint_type: "insurance_policy",
};

const snapshot = buildSnapshot({
  policies: [{ id: "p-real", product_name: "실손의료비보험" }],
  memoryFacts: [{ fact_value: "운전자 쪽을 먼저 챙기는 편" }],
  memory: true,
  conversation: {
    hasHistory: true,
    latestUserMessages: ["운전자보험도 필요한지 궁금해요"],
  },
});
const loadedContext = buildLoadedContext({ policies: true, memory: true, conversation: true });

const judgment = buildKeyFirstJudgment({
  document,
  keyInterprets: { document_kind_guess: "insurance_policy", hold: { needed: false } },
});

const intakeBundle = buildDu1InputBundle({
  document,
  contextSnapshot: snapshot,
  loadedContext,
  keyFirstJudgment: judgment,
});
const firstSpeak = composeDu1WithEpistemicTrace(intakeBundle).text;

const followUp = buildPhaseAFollowUpCustomerSpeak({
  document,
  contextSnapshot: snapshot,
  loadedContext,
  multiExtraction: {
    policies: [{ field_count: 2, fields: { product_name: "운전자보험 플러스", insurer_name: "현대해상" } }],
  },
  linkedPolicyIds: ["p-new"],
});

console.log("=== Phase A Local Speak Demo ===");
console.log("\n[Upload first explanation]");
console.log(firstSpeak);
console.log("\n[Post-extract follow-up]");
console.log(followUp?.text ?? "(null)");
console.log("\n[Customer felt change — 1 line]");
console.log("파일 이름만 읽는 게 아니라, 내 보험·대화 맥락에 맞춰 받아들이고 확인했다고 말해 준다.");
