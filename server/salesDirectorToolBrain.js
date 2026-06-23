/**
 * P6-2B-1 — Sales Director Tool Brain (first slice).
 * Allowed: Snapshot, Memory, Gap (via existing Tom gap path only).
 * Forbidden: Search, Claim, Recommendation, Design, Truth Gate expansion.
 */
import { composeP5BrainStateAwareAnswer } from "./p5BrainStateAwareAnswer.js";
import { P5_BRAIN_PILOT_KEYS } from "./p5BrainPilotQuestions.js";
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";

export const SALES_DIRECTOR_TOOL_SLICES = {
  SNAPSHOT: "snapshot",
  MEMORY: "memory",
  GAP: "gap",
};

/** Explicitly out of scope for P6-2B-1 — recorded in trace only. */
export const SALES_DIRECTOR_TOOL_FORBIDDEN = [
  "search",
  "claim",
  "recommendation",
  "design",
];

export const SALES_DIRECTOR_TOOL_BRAIN_SLICES = {
  INSURANCE_PRESENCE: "insurance_presence",
  PREMIUM_BURDEN: "premium_burden",
};

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .replace(/[?!.?！？。]/g, "")
    .trim()
    .toLowerCase();
}

export function matchToolBrainSliceQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;

  if (
    /내\s*보험\s*(있|가입|들)/.test(q) ||
    /보험\s*(있어|가입했|들었)/.test(q) ||
    q === "내 보험 있어"
  ) {
    return SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE;
  }

  if (/보험료.*(부담|비싼|높)/.test(q)) {
    return SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN;
  }

  return null;
}

export function planSalesDirectorToolBrain({
  question = "",
  loadedContext = null,
  modeDecision = null,
  pilotKey = null,
} = {}) {
  const slice = matchToolBrainSliceQuestion(question);
  if (!slice) {
    return { run: false, slice: null, tools: [], reason: "no_slice_match" };
  }

  // Pilot path already uses snapshot for premium burden — Tom handles; trace snapshot there.
  if (slice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN && pilotKey) {
    return {
      run: false,
      slice,
      tools: [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT],
      reason: "pilot_already_handles",
      snapshot_trace_only: true,
    };
  }

  const tools = [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT];
  if (loadedContext?.memory === "present") {
    tools.push(SALES_DIRECTOR_TOOL_SLICES.MEMORY);
  }
  if (modeDecision?.mode === "sales_director_factory_gap_mode") {
    tools.push(SALES_DIRECTOR_TOOL_SLICES.GAP);
  }

  return {
    run: true,
    slice,
    tools,
    forbidden_skipped: SALES_DIRECTOR_TOOL_FORBIDDEN,
  };
}

function composeInsurancePresenceAnswer(customerContextBundle, loadedContext) {
  const policies = customerContextBundle?.policies ?? [];
  const hasSnapshotPolicies =
    loadedContext?.policies === "present" && policies.length > 0;

  if (!hasSnapshotPolicies) {
    return {
      text: "지금은 등록된 가입 보험 정보를 찾지 못했어요. 보험 정보를 저장해 주시면 같이 확인해 볼게요.",
      policies: [],
      policy_count: 0,
      snapshot_used: true,
      memory_used: false,
    };
  }

  const memoryUsed =
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0;
  const lines = ["가입된 보험이 있는 것은 확인돼요."];
  if (memoryUsed) {
    lines.push("기억해 둔 상담 내용도 있어요. 어떤 부분부터 같이 볼까요?");
  } else {
    lines.push("어떤 부분이 궁금하신지 말씀해 주세요.");
  }

  return {
    text: lines.join("\n"),
    policies,
    policy_count: policies.length,
    snapshot_used: true,
    memory_used: memoryUsed,
  };
}

function composePremiumBurdenToolAnswer(customerContextBundle, loadedContext) {
  const policies = customerContextBundle?.policies ?? [];
  const hasSnapshotPolicies =
    loadedContext?.policies === "present" && policies.length > 0;

  if (!hasSnapshotPolicies) {
    return {
      text: [
        "현재 확인되는 가입 보험이 없어요.",
        "보험 정보를 저장해 주시면 보험료 부담을 같이 보면 됩니다.",
      ].join("\n"),
      policies: [],
      policy_count: 0,
      snapshot_used: true,
      memory_used: false,
      guarded: true,
    };
  }

  const composed = composeP5BrainStateAwareAnswer(
    P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN,
    "",
    customerContextBundle,
  );
  const memoryUsed =
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0;

  return {
    text: composed.ok ? composed.text : "가입된 보험이 있는 것은 확인돼요.",
    policies,
    policy_count: policies.length,
    snapshot_used: true,
    memory_used: memoryUsed,
    guarded: composed.ok !== true,
  };
}

/**
 * Run P6-2B-1 tool slice — returns handled agentTurn shape or null.
 */
export function runSalesDirectorToolBrainSlice({
  plan,
  question = "",
  customerContextBundle = null,
  loadedContext = null,
  consultationIntent = null,
} = {}) {
  if (!plan?.run || !plan.slice) return null;

  let composed;
  if (plan.slice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE) {
    composed = composeInsurancePresenceAnswer(customerContextBundle, loadedContext);
  } else if (plan.slice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN) {
    composed = composePremiumBurdenToolAnswer(customerContextBundle, loadedContext);
  } else {
    return null;
  }

  const toolBrainTrace = {
    status: "p6_2b_1",
    slice: plan.slice,
    tools_called: plan.tools ?? [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT],
    forbidden_skipped: plan.forbidden_skipped ?? SALES_DIRECTOR_TOOL_FORBIDDEN,
    snapshot_insurance_used: composed.snapshot_used === true,
    memory_used: composed.memory_used === true,
    policy_count_from_snapshot: composed.policy_count ?? 0,
  };

  return {
    handled: true,
    agentTurn: {
      text: composed.text,
      tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
      consultationIntent,
      toolUsed: null,
      responseSource: "sales_director_tool_brain",
      factBundle: {
        question,
        policy_count: composed.policy_count ?? 0,
        policies: composed.policies ?? [],
        memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
        customer_context_used: true,
        snapshot_tool_used: composed.snapshot_used === true,
        memory_tool_used: composed.memory_used === true,
        tool_brain_slice: plan.slice,
        p5_brain_guarded: composed.guarded === true,
      },
      tomGapVoiceHandled: false,
      trace: {
        agent: "sales_director_tool_brain",
        tool_brain: toolBrainTrace,
        customer_context_used: true,
      },
      toolBrainTrace,
    },
  };
}

export function buildSnapshotToolTraceOnly({ plan, loadedContext, customerContextBundle }) {
  if (!plan?.snapshot_trace_only) return null;
  return {
    status: "p6_2b_1",
    slice: plan.slice,
    tools_called: plan.tools ?? [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT],
    forbidden_skipped: SALES_DIRECTOR_TOOL_FORBIDDEN,
    snapshot_insurance_used: loadedContext?.policies === "present",
    memory_used:
      loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0,
    policy_count_from_snapshot: customerContextBundle?.policies?.length ?? 0,
    delegated_to: "pilot_handler",
  };
}
