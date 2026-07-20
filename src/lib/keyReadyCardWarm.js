/**
 * Triangle v2.2 T2 — fire-and-forget READY CARD warm on login / chat entry.
 * Never blocks UI. Never calls Claude.
 */

import { fetchCustomerApi } from "./customerApiAuth.js";

const ROUTE_PATH = "/api/key-ready-card-warm";

/**
 * @param {{ sessionId?: string|null }} [options]
 * @returns {Promise<{ ok: boolean, status?: string, ready_card_build_ms?: number|null }>}
 */
export async function warmKeyReadyCard({ sessionId = null } = {}) {
  try {
    const { payload } = await fetchCustomerApi(ROUTE_PATH, {
      body: {
        session_id: sessionId ? String(sessionId).trim() : null,
      },
    });
    return {
      ok: payload?.ok === true,
      status: payload?.status ?? "miss",
      prepared_at: payload?.prepared_at ?? null,
      card_version: payload?.card_version ?? null,
      ready_card_build_ms:
        typeof payload?.ready_card_build_ms === "number" ? payload.ready_card_build_ms : null,
      claude_called: payload?.claude_called === true,
    };
  } catch {
    return { ok: false, status: "miss", ready_card_build_ms: null, claude_called: false };
  }
}

/** Silent warm — never throw into chat UI. */
export function warmKeyReadyCardFireAndForget({ sessionId = null } = {}) {
  void warmKeyReadyCard({ sessionId }).catch(() => {});
}
