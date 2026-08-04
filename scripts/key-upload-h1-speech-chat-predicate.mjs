/**
 * Phase 7 — P-H1-SPEECH predicate (Tom lock 2026-08-04)
 *
 * FORBIDDEN: scanning leftover symbol names (enableSystemMessage, notifySystemMessage, …)
 * REQUIRED: observe actual customer-chat timeline for KEY-outside system sentences.
 *
 * A KEY-outside system sentence is a row that lands in the customer conversation
 * as role=system (or explicit system_message event metadata), i.e. not a KEY
 * sealed assistant turn and not a local DocumentsPanel banner that never persists
 * to customer chat.
 */

export const P_H1_SPEECH_ID = "P-H1-SPEECH";

export const P_H1_SPEECH_STATEMENT =
  "DocumentsPanel upload path: KEY-outside system sentences in customer chat = 0";

/**
 * @param {object} message
 * @returns {boolean}
 */
export function isKeyOutsideSystemSentence(message) {
  if (!message || typeof message !== "object") return false;

  const role = String(message.role ?? "").toLowerCase();
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};

  // KEY sealed / assistant speech is never a KEY-outside system sentence.
  if (role === "assistant" || role === "key") return false;
  if (metadata.key_sealed === true || metadata.sealed_by_key === true) return false;

  // Local UI-only banners (success/error on DocumentsPanel) are not customer chat.
  if (metadata.channel === "documents_panel_banner" || metadata.ui_local === true) {
    return false;
  }

  if (role === "system") return true;
  if (metadata.event === "system_message") return true;
  if (metadata.key_outside_system === true) return true;
  if (metadata.source === "document_upload_system_chat") return true;

  return false;
}

/**
 * @param {object[]} messages - customer conversation rows (or harness-normalized turns)
 * @param {{ surface?: string }} [opts]
 * @returns {{ ok: boolean, id: string, key_outside_system_count: number, offenders: object[] }}
 */
export function evaluatePh1Speech(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const offenders = list
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isKeyOutsideSystemSentence(message))
    .map(({ message, index }) => ({
      index,
      role: message.role ?? null,
      event: message.metadata?.event ?? null,
      source: message.metadata?.source ?? null,
      content_len: String(message.content ?? message.message ?? "").length,
    }));

  return {
    id: P_H1_SPEECH_ID,
    statement: P_H1_SPEECH_STATEMENT,
    surface: opts.surface ?? "DocumentsPanel",
    ok: offenders.length === 0,
    key_outside_system_count: offenders.length,
    offenders,
    // Explicit anti-pattern marker for harness audits
    forbidden_check: "symbol_name_residue_scan",
    check_mode: "customer_chat_timeline",
  };
}

/**
 * Normalize mixed harness traces into chat messages for P-H1-SPEECH.
 * Ignores network/symbol observations; only keeps chat-shaped rows.
 */
export function normalizeChatTimeline(traceRows = []) {
  return (Array.isArray(traceRows) ? traceRows : [])
    .filter((row) => row && typeof row === "object")
    .filter((row) => {
      if (row.kind === "symbol_scan" || row.kind === "bundle_string_scan") return false;
      return (
        row.role != null ||
        row.metadata?.event === "system_message" ||
        row.channel === "customer_conversations"
      );
    })
    .map((row) => ({
      role: row.role,
      content: row.content ?? row.message ?? "",
      metadata: row.metadata ?? {},
    }));
}
