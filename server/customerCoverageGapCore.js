/**
 * Phase 26 Step 1B — Customer Memory + Coverage Gap Engine + Claude explanation.
 */

import { analyzeCoverageGaps } from "./coverageGapAnalysisEngine.js";
import { buildCoverageGapInputFromMemory } from "./coverageGapInputBuilder.js";
import { loadUnifiedCustomerState, resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import {
  buildStructuredMemoryProfile,
  loadCustomerMemorySnapshot,
  mapMemoryFactsForResponse,
} from "./customerMemorySnapshot.js";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { createClient } from "@supabase/supabase-js";

const GAP_LEVEL_ORDER = { critical: 0, high: 1, medium: 2, low: 3, sufficient: 4 };
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, maintain: 4, monitor: 5 };

const CATEGORY_LABELS = {
  cancer: "암",
  brain: "뇌혈관",
  heart: "심혈관",
  surgery: "수술비",
  hospitalization: "입원비",
  medical_expense: "실손",
  death: "사망",
  disability: "장해",
  driver: "운전자",
  dental: "치아",
  dementia_care: "치매/간병",
  family_protection: "가족 보장",
  corporate_group: "법인/단체",
};

const COVERAGE_GAP_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance coverage gap explanation assistant.",
  "Explain only using the provided customer memory summary and pre-computed coverage gap analysis JSON.",
  "Do not invent policies, health conditions, coverage amounts, underwriting outcomes, or product recommendations.",
  "If information is missing from customer memory, explicitly say it is not recorded in memory.",
  "Include: (1) memory-based context, (2) currently insufficient coverage, (3) coverage that can be maintained, (4) top priority reinforcement items.",
  "Do not make final underwriting approval/decline decisions or recommend specific insurance products.",
  "Respond in Korean with clear headings and bullet points.",
].join(" ");

function createUserSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;
  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

function mapGapLevel(item) {
  if (item.coverage_type === "corporate_group" && item.status === "unknown") {
    return "low";
  }
  if (item.status === "adequate") return "sufficient";
  if (item.status === "missing" && item.severity === "high") return "critical";
  if (item.status === "missing") return "high";
  if (item.status === "insufficient") return "medium";
  if (item.status === "duplicate") return "low";
  return "low";
}

function mapCurrentStatus(item) {
  if (item.status === "adequate") return "held";
  if (item.status === "missing") return "missing";
  if (item.status === "insufficient") return "insufficient";
  if (item.status === "duplicate") return "duplicate";
  if (item.coverage_type === "corporate_group") return "not_evaluated";
  return "unknown";
}

function deriveActionCode(item, gapLevel) {
  if (item.coverage_type === "corporate_group") return "skip_corporate_group";
  if (gapLevel === "sufficient") return "maintain_coverage";
  if (gapLevel === "critical" || gapLevel === "high") return "review_coverage";
  if (gapLevel === "medium") return "check_coverage_level";
  if (item.status === "duplicate") return "resolve_duplicate";
  return "add_memory_context";
}

function mapPriority(item, gapLevel) {
  if (gapLevel === "sufficient") return "maintain";
  if (gapLevel === "critical") return "urgent";
  if (gapLevel === "high") return "high";
  if (gapLevel === "medium") return "medium";
  if (item.status === "duplicate") return "monitor";
  return "low";
}

export function transformCoverageGapResults(analysis, input, memoryFactsUsed = []) {
  const items = (analysis.coverage_gaps ?? []).map((item) => {
    const gap_level = mapGapLevel(item);
    return {
      coverage_category: item.coverage_type,
      coverage_label: CATEGORY_LABELS[item.coverage_type] ?? item.coverage_type,
      current_status: mapCurrentStatus(item),
      gap_level,
      gap_reason_codes: item.gap_reason_codes ?? [],
      action_code: deriveActionCode(item, gap_level),
      priority: mapPriority(item, gap_level),
      memory_sources_used: item.evidence_fact_keys ?? [],
      confidence: item.confidence ?? "medium",
      requires_agent_review: item.requires_agent_review ?? false,
      evidence_codes: item.evidence_codes ?? [],
    };
  });

  items.sort(
    (left, right) =>
      (GAP_LEVEL_ORDER[left.gap_level] ?? 99) - (GAP_LEVEL_ORDER[right.gap_level] ?? 99) ||
      (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99),
  );

  const top_gaps = items
    .filter((item) => ["critical", "high", "medium"].includes(item.gap_level))
    .slice(0, 3);
  const maintained_coverage = items.filter((item) => item.gap_level === "sufficient");
  const priority_actions = items
    .filter((item) => ["urgent", "high", "medium"].includes(item.priority))
    .slice(0, 5);

  return {
    customer_id: analysis.customer_id,
    overall_risk: analysis.overall_severity ?? "low",
    gap_score: analysis.gap_score ?? 0,
    generated_at: analysis.generated_at,
    items,
    top_gaps,
    maintained_coverage,
    priority_actions,
    duplicate_warnings: analysis.duplicate_warnings ?? [],
    unknown_items: analysis.unknown_items ?? [],
    agent_review_items: analysis.agent_review_items ?? [],
    input_summary: {
      customer_profile: input.customer_profile,
      insurance_holdings_count: input.insurance_holdings?.length ?? 0,
      health_profile_recorded: Boolean(
        input.health_profile?.conditions ||
          input.health_profile?.medications ||
          input.health_profile?.surgery_history,
      ),
    },
    used_memory_sources: input.memory_sources_used ?? [],
    memory_facts_used: mapMemoryFactsForResponse(memoryFactsUsed),
  };
}

export function sanitizeCoverageGapStructuredForPrompt(coverageGapResult = {}) {
  const pickItem = (item) => ({
    coverage_category: item.coverage_category ?? null,
    coverage_label: item.coverage_label ?? null,
    current_status: item.current_status ?? null,
    gap_level: item.gap_level ?? null,
    priority: item.priority ?? null,
    gap_reason_codes: item.gap_reason_codes ?? [],
    action_code: item.action_code ?? null,
    evidence_codes: item.evidence_codes ?? [],
    confidence: item.confidence ?? null,
    requires_agent_review: item.requires_agent_review ?? false,
  });

  return {
    overall_risk: coverageGapResult.overall_risk ?? null,
    gap_score: coverageGapResult.gap_score ?? null,
    items: (coverageGapResult.items ?? []).map(pickItem),
    top_gaps: (coverageGapResult.top_gaps ?? []).map(pickItem),
    maintained_coverage: (coverageGapResult.maintained_coverage ?? []).map(pickItem),
    priority_actions: (coverageGapResult.priority_actions ?? []).map(pickItem),
  };
}

export function buildCoverageGapExplanationPrompt(structuredMemory, coverageGapResult) {
  const structuredGap = sanitizeCoverageGapStructuredForPrompt(coverageGapResult);
  const user = [
    "Explain the coverage gap analysis to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "B. coverage_gap_analysis (structured codes only — do not invent Korean factory actions):",
    JSON.stringify(structuredGap, null, 2),
    "",
    "Required sections in Korean:",
    "1) 고객 Memory 기준 현재 상황",
    "2) 부족한 보장",
    "3) 유지해도 되는 보장",
    "4) 우선 보강 항목",
    "5) Memory에 없는 정보 (있다면 명시)",
  ].join("\n");

  return { system: COVERAGE_GAP_SYSTEM_RULES, user };
}

async function resolveCustomerId(supabase) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { ok: false, reason: "UNAUTHORIZED", error_message: "Authentication required." };
  }
  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.id) {
    return { ok: false, reason: "CUSTOMER_PROFILE_NOT_FOUND", error_message: "Customer profile not found." };
  }
  return { ok: true, customerId: profile.id };
}

export async function loadCoverageAnalysisContext(supabase, customerId) {
  const unified = await loadUnifiedCustomerState(supabase, customerId);
  const snapshot = unified.snapshot;
  const policies = unified.policies ?? [];
  const health = unified.health;

  const input = buildCoverageGapInputFromMemory({
    snapshot,
    policies,
    health,
  });

  const analysis = analyzeCoverageGaps({
    customer_id: customerId,
    memory: input.memory_facts,
  });

  const structuredMemory = buildStructuredMemoryProfile(snapshot);
  const coverageGapResult = transformCoverageGapResults(
    analysis,
    input,
    snapshot.facts ?? [],
  );
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  return {
    snapshot,
    structuredMemory,
    input,
    analysis,
    coverageGapResult,
    policies,
    health,
    active_policy_count: policyFields.active_policy_count,
    active_policy_count_source: policyFields.active_policy_count_source,
    active_policy_ids: policyFields.active_policy_ids,
    policy_count: policyFields.policy_count,
  };
}

export async function handleCustomerCoverageGapRequest({
  authHeader = null,
  testCustomerId = null,
  adminSupabase = null,
  skipClaude = false,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  let supabase = adminSupabase;
  let customerId = testCustomerId;

  if (!supabase) {
    supabase = createUserSupabaseClient(authHeader, env);
    if (!supabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
    }
    const resolved = await resolveCustomerId(supabase);
    if (!resolved.ok) return resolved;
    customerId = resolved.customerId;
  }

  if (!customerId) {
    return { ok: false, reason: "CUSTOMER_ID_REQUIRED", error_message: "customer_id is required." };
  }

  const context = await loadCoverageAnalysisContext(supabase, customerId);

  // FACTORY-SPEAK-02-S1 — coverage gap factory must not speak to customers via Claude explanation.
  const claudeExplanation = null;
  const claudeMeta = {
    skipped: true,
    reason: "FACTORY_SPEAK_02_S1",
    explanation_mode: "blocked",
  };

  return {
    ok: true,
    customer_id: customerId,
    memory_used: (context.snapshot.fact_count ?? 0) > 0,
    memory_version: context.snapshot.memory_version ?? 0,
    memory_fact_count: context.snapshot.fact_count ?? 0,
    used_memory_sources: context.coverageGapResult.used_memory_sources,
    structured_memory: context.structuredMemory,
    coverage_gap_result: context.coverageGapResult,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerCoverageGapBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
