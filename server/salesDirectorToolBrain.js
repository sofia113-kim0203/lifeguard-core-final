/**
 * P6-2B-1 — Sales Director Tool Brain (first slice).
 * Allowed: Snapshot, Memory, Gap (via existing Tom gap path only).
 * Forbidden: Search, Claim, Recommendation, Design, Truth Gate expansion.
 */
import { resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";

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

  if (/보험료.*(부담|비싼|비싸|높)/.test(q)) {
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

export function buildToolBrainFactSnapshot(
  customerContextBundle = null,
  loadedContext = null,
  unified = null,
) {
  const policies = customerContextBundle?.policies ?? [];
  const hasSnapshotPolicies =
    loadedContext?.policies === "present" && policies.length > 0;
  const memoryUsed =
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0;
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  return {
    policies: hasSnapshotPolicies ? policies : [],
    ...policyFields,
    snapshot_used: loadedContext?.policies === "present",
    memory_used: memoryUsed,
    memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
  };
}

function composeInsurancePresenceAnswer(customerContextBundle, loadedContext, unified = null) {
  const policies = customerContextBundle?.policies ?? [];
  const hasSnapshotPolicies =
    loadedContext?.policies === "present" && policies.length > 0;
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  if (!hasSnapshotPolicies) {
    return {
      text: "지금은 등록된 가입 보험 정보를 찾지 못했어요. 보험 정보를 저장해 주시면 같이 확인해 볼게요.",
      policies: [],
      ...policyFields,
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
    ...policyFields,
    snapshot_used: true,
    memory_used: memoryUsed,
  };
}

function composePremiumBurdenToolAnswer(customerContextBundle, loadedContext, unified = null) {
  const policies = customerContextBundle?.policies ?? [];
  const hasSnapshotPolicies =
    loadedContext?.policies === "present" && policies.length > 0;
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  if (!hasSnapshotPolicies) {
    return {
      text: [
        "현재 확인되는 가입 보험이 없어요.",
        "보험 정보를 저장해 주시면 보험료 부담을 같이 보면 됩니다.",
      ].join("\n"),
      policies: [],
      ...policyFields,
      snapshot_used: true,
      memory_used: false,
      guarded: true,
    };
  }

  const memoryUsed =
    loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0;

  return {
    text: "가입된 보험이 있는 것은 확인돼요.",
    policies,
    ...policyFields,
    snapshot_used: true,
    memory_used: memoryUsed,
    guarded: true,
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
  unified = null,
} = {}) {
  if (!plan?.run || !plan.slice) return null;

  let composed;
  if (plan.slice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE) {
    composed = composeInsurancePresenceAnswer(customerContextBundle, loadedContext, unified);
  } else if (plan.slice === SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN) {
    composed = composePremiumBurdenToolAnswer(customerContextBundle, loadedContext, unified);
  } else {
    return null;
  }

  const policyFields = resolveActivePolicyCountFromUnified(unified);

  const toolBrainTrace = {
    status: "p6_2b_1",
    slice: plan.slice,
    tools_called: plan.tools ?? [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT],
    forbidden_skipped: plan.forbidden_skipped ?? SALES_DIRECTOR_TOOL_FORBIDDEN,
    snapshot_insurance_used: composed.snapshot_used === true,
    memory_used: composed.memory_used === true,
    policy_count_from_snapshot: policyFields.active_policy_count,
    active_policy_count_from_snapshot: policyFields.active_policy_count,
  };

  return {
    handled: true,
    agentTurn: {
      text: composed.text,
      tomInternalRoute: "chat",
      consultationIntent,
      toolUsed: null,
      responseSource: "sales_director_tool_brain",
      factBundle: {
        question,
        ...policyFields,
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

export function buildSnapshotToolTraceOnly({
  plan,
  loadedContext,
  customerContextBundle,
  unified = null,
}) {
  if (!plan?.snapshot_trace_only) return null;
  const policyFields = resolveActivePolicyCountFromUnified(unified);
  return {
    status: "p6_2b_1",
    slice: plan.slice,
    tools_called: plan.tools ?? [SALES_DIRECTOR_TOOL_SLICES.SNAPSHOT],
    forbidden_skipped: SALES_DIRECTOR_TOOL_FORBIDDEN,
    snapshot_insurance_used: loadedContext?.policies === "present",
    memory_used:
      loadedContext?.memory === "present" && (customerContextBundle?.memoryFactCount ?? 0) > 0,
    policy_count_from_snapshot: policyFields.active_policy_count,
    active_policy_count_from_snapshot: policyFields.active_policy_count,
    delegated_to: "pilot_handler",
  };
}
