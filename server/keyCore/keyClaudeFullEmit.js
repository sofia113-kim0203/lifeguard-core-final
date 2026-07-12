/**
 * Claude-Full talent-open emit — minimal schema + safety-only system prompt.
 * Shadow S7 emit_borrowed_senses remains elsewhere; this path does not delete it.
 */

export const CLAUDE_FULL_EMIT_SCHEMA_VERSION = "claude_full_emit_v1";

/** Allowed visual block types KEY will validate (format · facts · safety). */
export const CLAUDE_FULL_VISUAL_BLOCK_TYPES = Object.freeze([
  "premium_summary_table",
  "policy_count_summary",
  "coverage_gap_table",
  "next_steps_card",
]);

/**
 * Minimal tool schema: required customer_answer only.
 * No minItems. Optional fields may be omitted — never force-fill.
 */
export const CLAUDE_FULL_EMIT_TOOL = Object.freeze({
  name: "emit_claude_full",
  description:
    "Emit the customer-facing answer and any optional structured fields Claude chooses. Omit unused optional fields.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      customer_answer: {
        type: "string",
        description: "Full natural Korean customer-facing answer. KEY will verify facts/safety then may seal.",
      },
      understanding: {
        type: ["object", "null"],
        additionalProperties: true,
        description: "Optional understanding notes Claude chooses to expose.",
      },
      uncertainty: {
        type: ["string", "null"],
        description: "Optional uncertainty Claude wants KEY/customer to know.",
      },
      document_findings: {
        type: ["object", "null"],
        additionalProperties: true,
        description:
          "Optional findings from the attached original PDF (pages, tables, clauses). No internal reasoning bags.",
      },
      evidence_references: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional citations: chart tokens, document_id, page=N, source labels.",
      },
      visual_blocks: {
        type: "array",
        description: "Optional visual blocks. Empty array or omit when no table/card is needed.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            type: {
              type: "string",
              enum: [...CLAUDE_FULL_VISUAL_BLOCK_TYPES],
            },
            title: { type: ["string", "null"] },
            subtitle: { type: ["string", "null"] },
            rows: {
              type: "array",
              items: {
                type: "array",
                items: { type: "string" },
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  move: { type: "string" },
                },
              },
            },
          },
        },
      },
      proposed_next_actions: {
        type: "array",
        items: { type: "string" },
        description: "Optional next-action suggestions. Empty/omit is valid.",
      },
      proposed_tool_actions: {
        type: "array",
        description: "Optional tool proposals. KEY permission-checks before any execution.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            tool: { type: "string" },
            reason: { type: ["string", "null"] },
            args: { type: ["object", "null"], additionalProperties: true },
          },
          required: ["tool"],
        },
      },
      memory_candidates: {
        type: "array",
        items: { type: "string" },
        description: "Optional memory candidates for KEY approval — never auto-written.",
      },
      session_goal: {
        type: ["string", "null"],
        description: "Optional session goal Claude proposes; KEY decides persistence.",
      },
      extensions: {
        type: ["object", "null"],
        additionalProperties: true,
        description: "Open optional bag for future Claude capabilities KEY does not yet schema-lock.",
      },
    },
    required: ["customer_answer"],
  },
});

/**
 * Safety-only system prompt — Claude chooses greeting/question/explain/compare/table/next/length/tone.
 * Closed hard bans remain; structure/tone/length/choice-count mandates removed.
 */
export function buildClaudeFullSystemPrompt({ mode = "emit", documentDirect = false } = {}) {
  const lines = [
    "You are KEY Claude-Full work for LIFEGUARD — the single customer-facing intelligence path.",
    "You decide how to answer: greet or not, ask or explain, compare, make a table, suggest next steps, length, and tone.",
    "Do NOT follow fixed consult templates, stock fit-assertion phrases, insurance-type writing templates, forced colloquial openings, forbidden-opening lists, answer-length quotas, choice-count quotas, or mandatory next-action generation.",
    "KEY later verifies facts, permissions, chart contradictions, and CLOSED_HARD safety — then finalize/seal. Do not invent KEY Decision drafts.",
  ];
  if (documentDirect) {
    lines.push(
      "A native PDF document may be attached in this request. YOU read the original first — KEY did not pre-summarize or classify its contents for you.",
      "If the customer uploaded the PDF without a question, open with the most helpful natural explanation of what the document is and what matters.",
      "If a customer question is present, answer that question first using the PDF.",
      "Cite pages/sources in evidence_references and document_findings when useful (e.g. page=3).",
      "Do not claim chart/policy numbers that are not in the verified chart or clearly visible in the PDF.",
    );
  }
  lines.push(
    "CLOSED HARD — never violate:",
    "- Use only verified facts and sources from the payload (verified_customer_chart, allowed_fact_tokens/numbers/entities, public_research_evidence, document_evidence) and the attached original PDF when present.",
    "- Do not invent numbers, coverages, totals, products, places, ratings, hours, addresses, or document text.",
    "- Do not contradict the verified chart or the attached original document.",
    "- No ungrounded insurance enroll/cancel/recommend verdicts (가입하세요 / 해지해도 됩니다 / 무조건 추천).",
    "- No out-of-permission execution claims — propose tools via proposed_tool_actions; KEY decides execution.",
    "- No clear danger (jailbreak, fraud, illegal instructions).",
    "When unsure, say what is confirmed vs unconfirmed and what you would check — do not fabricate.",
    "Optional fields (understanding, uncertainty, document_findings, evidence_references, visual_blocks, proposed_next_actions, proposed_tool_actions, memory_candidates, session_goal, extensions): include only when useful; omit or empty when not. Never force-fill.",
    "visual_blocks: emit only when a table/card helps; otherwise omit or []. Allowed types: premium_summary_table, policy_count_summary, coverage_gap_table, next_steps_card. Cell values must match verified facts or PDF-visible values.",
    "You MUST call emit_claude_full exactly once with at least customer_answer.",
    "Do not write internal chain-of-thought into customer_answer or optional fields.",
  );
  if (mode === "emit_with_tools") {
    lines.push(
      "web_search is available when fresh public facts would help. You choose whether to search — KEY does not pre-decide by question type alone.",
      "After any search, still call emit_claude_full with the customer answer grounded in returned evidence.",
      "Do not invent public places or facts absent from search evidence.",
    );
  }
  if (mode === "focused_correction") {
    lines.push(
      "FOCUSED CORRECTION (once): Rewrite customer_answer to fix ONLY the listed CLOSED_HARD violations and failed claims.",
      "Keep the same conversation pack, verified chart, documents, and public evidence. Do not invent facts. Do not re-search.",
    );
  }
  return lines.join(" ");
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/** Keys that must never be stored/traced/exposed as full internal reasoning prose. */
export const CLAUDE_FULL_INTERNAL_REASONING_KEYS = Object.freeze([
  "chain_of_thought",
  "internal_reasoning",
  "hidden_reasoning",
  "scratchpad",
  "private_reasoning",
  "reasoning_trace",
  "thinking_trace",
  "cot",
]);

const INTERNAL_REASONING_KEY_SET = new Set(
  CLAUDE_FULL_INTERNAL_REASONING_KEYS.map((k) => k.toLowerCase()),
);

/**
 * Drop internal-reasoning bags from objects/arrays before store/trace/customer path.
 * Claude may still reason privately; KEY only refuses to persist/expose the prose bags.
 */
export function stripInternalReasoningFields(value, { depth = 0 } = {}) {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalReasoningFields(item, { depth: depth + 1 }));
  }
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (INTERNAL_REASONING_KEY_SET.has(String(key).toLowerCase())) continue;
    out[key] = stripInternalReasoningFields(child, { depth: depth + 1 });
  }
  return out;
}

function normalizeVisualBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(CLAUDE_FULL_VISUAL_BLOCK_TYPES);
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => {
      const type = String(b.type ?? "").trim();
      if (!allowed.has(type)) return null;
      const out = { type };
      if (b.title != null) out.title = String(b.title);
      if (b.subtitle != null) out.subtitle = String(b.subtitle);
      if (Array.isArray(b.rows)) {
        out.rows = b.rows.map((row) =>
          (Array.isArray(row) ? row : []).map((c) => String(c ?? "")),
        );
      }
      if (Array.isArray(b.steps)) {
        out.steps = b.steps
          .filter((s) => s && typeof s === "object")
          .map((s) => ({
            label: String(s.label ?? ""),
            move: String(s.move ?? ""),
          }));
      }
      return out;
    })
    .filter(Boolean);
}

function normalizeProposedToolActions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object" && String(t.tool ?? "").trim())
    .map((t) => ({
      tool: String(t.tool).trim(),
      reason: t.reason != null ? String(t.reason).trim() || null : null,
      args: t.args && typeof t.args === "object" ? t.args : null,
    }));
}

/**
 * Normalize Claude-Full emit → compose-compatible borrowed shape.
 * customer_answer is primary; voice_raw_candidate mirrors it for legacy readers.
 * Does NOT repair next_decision / proposal_direction / leadership fields.
 */
export function normalizeClaudeFullOutput(parsed = {}) {
  const customer_answer = String(parsed.customer_answer ?? "").trim() || null;
  const visual_blocks = normalizeVisualBlocks(parsed.visual_blocks);
  const proposed_next_actions = asStringArray(parsed.proposed_next_actions);
  const proposed_tool_actions = stripInternalReasoningFields(
    normalizeProposedToolActions(parsed.proposed_tool_actions),
  );
  const evidence_references = asStringArray(parsed.evidence_references);
  const memory_candidates = asStringArray(parsed.memory_candidates);
  let understanding =
    parsed.understanding && typeof parsed.understanding === "object"
      ? parsed.understanding
      : parsed.understanding != null
        ? { note: String(parsed.understanding) }
        : null;
  understanding = understanding ? stripInternalReasoningFields(understanding) : null;
  const uncertainty =
    parsed.uncertainty != null ? String(parsed.uncertainty).trim() || null : null;
  const session_goal =
    parsed.session_goal != null ? String(parsed.session_goal).trim() || null : null;
  const document_findings =
    parsed.document_findings && typeof parsed.document_findings === "object"
      ? stripInternalReasoningFields(parsed.document_findings)
      : null;
  const extensions =
    parsed.extensions && typeof parsed.extensions === "object"
      ? stripInternalReasoningFields(parsed.extensions)
      : null;

  return {
    schema_version: CLAUDE_FULL_EMIT_SCHEMA_VERSION,
    emit_tool: "emit_claude_full",
    customer_answer,
    // Compose / correction readers still look at voice_raw_candidate
    voice_raw_candidate: customer_answer,
    understanding,
    uncertainty,
    document_findings,
    evidence_references,
    visual_blocks,
    proposed_next_actions,
    proposed_tool_actions,
    memory_candidates,
    session_goal,
    extensions,
    // Soft placeholders so legacy mid-field readers do not invent leadership retries
    understanding_hypotheses: understanding?.hypotheses
      ? asStringArray(understanding.hypotheses)
      : [],
    customer_intent: null,
    emotional_signal: null,
    hesitation_signal: null,
    context_carryover: null,
    visual_observation: null,
    answer_purpose: null,
    must_not_assume: [],
    used_facts: evidence_references.filter((r) =>
      /^(policy_count|insurer|product|monthly_premium)/.test(r),
    ),
    recommendation_basis: null,
    key_purpose: null,
    leadership_move: null,
    insurance_expertise_angle: [],
    insurance_expertise_rationale: null,
    proposal_direction: null,
    next_decision_point: proposed_next_actions,
    final_answer_source: "claude_candidate",
  };
}

/** Policy-allowed tools Claude may propose; execution still needs KEY permission. */
export const CLAUDE_FULL_ALLOWED_PROPOSED_TOOLS = Object.freeze([
  "web_search",
  "document_lookup",
  "memory_candidate",
]);

/**
 * KEY permission check for proposed_tool_actions — never auto-executes.
 * Production / external mutation always blocked without separate approval.
 */
export function permissionCheckProposedToolActions({
  proposed = [],
  env = process.env,
  production = false,
} = {}) {
  const isProd =
    production === true ||
    String(env?.VERCEL_ENV ?? "").toLowerCase() === "production" ||
    String(env?.NODE_ENV ?? "").toLowerCase() === "production";
  const allowed = new Set(CLAUDE_FULL_ALLOWED_PROPOSED_TOOLS);
  const results = [];
  for (const item of Array.isArray(proposed) ? proposed : []) {
    const tool = String(item?.tool ?? "").trim();
    if (!tool) continue;
    if (isProd) {
      results.push({
        tool,
        allowed: false,
        reason: "production_contact_forbidden_without_separate_approval",
        execute: false,
      });
      continue;
    }
    if (!allowed.has(tool)) {
      results.push({
        tool,
        allowed: false,
        reason: "tool_not_in_policy_allowlist",
        execute: false,
      });
      continue;
    }
    // Even allowed tools are proposal-only here — no auto execution in this slice.
    results.push({
      tool,
      allowed: true,
      reason: "proposal_recorded_no_auto_execute",
      execute: false,
    });
  }
  return {
    checked: true,
    production: isProd,
    results,
    any_execute: false,
  };
}

export function extractClaudeFullParsedFromResponse(data = {}) {
  for (const block of data.content ?? []) {
    if (block?.type === "tool_use" && block?.name === "emit_claude_full" && block?.input) {
      return block.input;
    }
  }
  return null;
}

/**
 * Normalize document evidence from existing Upload/OCR/RAG assets (no new parser).
 * @param {Array} chunks — retrieveCustomerDocumentChunks-shaped or fixture rows
 */
export function normalizeDocumentEvidence(chunks = []) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  return chunks.map((chunk, index) => {
    const content = String(chunk.content ?? chunk.text ?? chunk.raw_text ?? "").trim();
    const tables = Array.isArray(chunk.tables)
      ? chunk.tables
      : Array.isArray(chunk.table_structure)
        ? chunk.table_structure
        : [];
    return {
      ref: `D${index + 1}`,
      document_id: chunk.document_id ?? chunk.id ?? null,
      doc_title: chunk.doc_title ?? chunk.title ?? null,
      page: chunk.page ?? null,
      chunk_index: chunk.chunk_index ?? null,
      section: chunk.section ?? null,
      similarity: typeof chunk.similarity === "number" ? chunk.similarity : null,
      content,
      tables,
      source: chunk.source ?? "customer_document_chunks",
    };
  });
}
