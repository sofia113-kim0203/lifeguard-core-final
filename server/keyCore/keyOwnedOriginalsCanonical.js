/**
 * ONE PATH — Canonical owned originals Hand.
 * Normalize pdfBase64 / pdfAttachments / vault / pointer into one list
 * before Provider document/image blocks are built.
 */
import { createHash } from "node:crypto";
import {
  buildAnthropicDirectAttachBlock,
  normalizeClaudeDirectAttachMediaType,
} from "./keyClaudeFullDocumentDirect.js";

export const OWNED_ORIGINALS_MAX = 6;

function sha256Base64(base64) {
  try {
    const buf = Buffer.from(String(base64 ?? ""), "base64");
    if (!buf.length) return { byteLength: 0, sha256: null };
    return {
      byteLength: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  } catch {
    return { byteLength: 0, sha256: null };
  }
}

/**
 * @returns {Array<{
 *   document_id: string,
 *   mime_type: string,
 *   original_bytes_base64: string,
 *   sha256: string|null,
 *   byte_length: number,
 *   ownership_verified: boolean,
 *   source: "current_upload"|"owned_pointer",
 * }>}
 */
export function normalizeOwnedOriginals({
  pdfBase64 = null,
  pdfMediaType = null,
  pdfMeta = null,
  pdfAttachments = null,
  max = OWNED_ORIGINALS_MAX,
} = {}) {
  const cap = Math.min(Math.max(Number(max) || OWNED_ORIGINALS_MAX, 1), 8);
  const rows = [];
  const pushRow = (row, sourceHint) => {
    if (!row || typeof row !== "object") return;
    const b64 = row.base64 || row.pdfBase64 || row.original_bytes_base64 || null;
    if (!b64 || typeof b64 !== "string") return;
    const mime = normalizeClaudeDirectAttachMediaType(
      row.mediaType || row.media_type || row.mime_type || pdfMediaType || null,
    );
    const document_id =
      String(row.document_id || row.id || pdfMeta?.document_id || "").trim() ||
      `owned_${rows.length + 1}`;
    const hash = sha256Base64(b64);
    const source =
      sourceHint ||
      (row.source === "owned_pointer" || row.vault_recall_mode
        ? "owned_pointer"
        : "current_upload");
    rows.push({
      document_id,
      mime_type: mime || "application/pdf",
      original_bytes_base64: b64,
      sha256: hash.sha256,
      byte_length: hash.byteLength,
      ownership_verified: row.ownership_verified !== false,
      source,
    });
  };

  if (Array.isArray(pdfAttachments) && pdfAttachments.length) {
    for (const row of pdfAttachments) {
      pushRow(row, row?.source || null);
    }
  } else if (pdfBase64) {
    pushRow(
      {
        base64: pdfBase64,
        mediaType: pdfMediaType,
        document_id: pdfMeta?.document_id,
        ownership_verified: true,
      },
      "current_upload",
    );
  }

  // Dedupe by sha256 then document_id. Current upload first.
  const out = [];
  const seenSha = new Set();
  const seenId = new Set();
  const ordered = [
    ...rows.filter((r) => r.source === "current_upload"),
    ...rows.filter((r) => r.source !== "current_upload"),
  ];
  for (const row of ordered) {
    if (out.length >= cap) break;
    if (!row.ownership_verified) continue;
    const sha = row.sha256 || "";
    const id = row.document_id;
    if (sha && seenSha.has(sha)) continue;
    if (id && seenId.has(id)) continue;
    if (sha) seenSha.add(sha);
    if (id) seenId.add(id);
    out.push(row);
  }
  return out;
}

export function ownedOriginalsToMultiAttachments(ownedOriginals = []) {
  return (Array.isArray(ownedOriginals) ? ownedOriginals : []).map((row) => ({
    document_id: row.document_id,
    mediaType: row.mime_type,
    base64: row.original_bytes_base64,
    content_sha256: row.sha256,
    ownership_verified: row.ownership_verified === true,
    source: row.source,
  }));
}

export function buildProviderBlocksFromOwnedOriginals(ownedOriginals = []) {
  const blocks = [];
  for (const row of Array.isArray(ownedOriginals) ? ownedOriginals : []) {
    const block = buildAnthropicDirectAttachBlock({
      base64: row.original_bytes_base64,
      mediaType: row.mime_type,
    });
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Compact confirmed/verified memory only — never pending extract. */
export function buildConfirmedCustomerMemoryBrief({
  policyTruthContext = null,
  history = null,
  maxHistory = 6,
} = {}) {
  const confirmed = Array.isArray(policyTruthContext?.confirmed_contracts)
    ? policyTruthContext.confirmed_contracts
    : [];
  const memory = {
    confirmed_contracts: confirmed.slice(0, 12).map((c) => ({
      insurer: c.insurer || c.company_name || null,
      product_name: c.product_name || c.product_label || null,
      policy_number: c.policy_number || null,
      status: c.status || c.contract_status || null,
      contract_id: c.contract_id || c.id || null,
    })),
    recent_conversation: (Array.isArray(history) ? history : [])
      .slice(-Math.max(0, Number(maxHistory) || 6))
      .map((h) => ({
        role: h?.role === "assistant" ? "assistant" : "user",
        text: String(h?.text ?? h?.content ?? "").slice(0, 800),
      }))
      .filter((h) => h.text.trim()),
  };
  return memory;
}
