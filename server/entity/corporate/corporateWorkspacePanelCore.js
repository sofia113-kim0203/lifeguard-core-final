/**
 * CorporatePanel Presentation Hand — corp-workspace-v1 display only (CORP-G1).
 * Principle 13: Panel expresses Contract — does not modify it.
 * KEY not here.
 */
import { createClient } from "@supabase/supabase-js";
import { CORPORATE_WORKSPACE_V1, loadCorporateWorkspaceContext } from "./corporateWorkspace.js";

export const CORPORATE_WORKSPACE_DEMO_ENTITY_ID = "564dc47d-286c-48e4-b221-3fe06b983e17";

/** CC-5 minimum trust-continuity bind — group + employees only (Tom: not full yet). */
export const CC5_MIN_BIND_ZONE_KEYS = ["group", "employees"];

export const PANEL_SECTION_DEFS = [
  { key: "basic", title: "법인 기본정보" },
  { key: "employees", title: "임직원 보장" },
  { key: "group", title: "단체보험" },
  { key: "tax", title: "세무/재무 리스크" },
  { key: "executive", title: "대표자 보장" },
  { key: "contracts", title: "법인 계약 문서" },
];

const STATUS_LABELS = {
  maintain: "유지",
  priority: "우선 검토",
  deferred: "확인 필요",
  unlinked: "연결 예정",
};

function createServiceRoleSupabaseClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function resolveCorporateWorkspaceEntityId(entityId, env = process.env) {
  const fromQuery = String(entityId ?? "").trim();
  if (fromQuery) return fromQuery;
  const fromEnv = String(
    env.CORPORATE_WORKSPACE_ENTITY_ID ?? env.VITE_CORPORATE_WORKSPACE_ENTITY_ID ?? "",
  ).trim();
  if (fromEnv) return fromEnv;
  return CORPORATE_WORKSPACE_DEMO_ENTITY_ID;
}

/**
 * Pure mapper — corp-workspace-v1 view → CorporatePanel section cards (display only).
 */
export function mapWorkspaceViewToPanelSections(view) {
  const zonesByKey = Object.fromEntries((view?.zones ?? []).map((zone) => [zone.zone, zone]));

  return PANEL_SECTION_DEFS.map((section) => {
    const zone = zonesByKey[section.key] ?? null;
    if (!zone) {
      return {
        key: section.key,
        title: section.title,
        status: "unlinked",
        statusLabel: STATUS_LABELS.unlinked,
        reason: null,
        provenance: null,
        confidence: null,
        itemLabel: null,
        linked: false,
      };
    }

    return {
      key: section.key,
      title: section.title,
      status: zone.status,
      statusLabel: STATUS_LABELS[zone.status] ?? zone.status,
      reason: zone.reason,
      provenance: zone.provenance,
      confidence: zone.confidence,
      itemLabel: zone.label,
      linked: true,
    };
  });
}

export async function handleCorporateWorkspaceViewRequest({ entityId, env = process.env } = {}) {
  const resolvedEntityId = resolveCorporateWorkspaceEntityId(entityId, env);
  const supabase = createServiceRoleSupabaseClient(env);

  if (!supabase) {
    return { ok: false, reason: "SUPABASE_UNAVAILABLE" };
  }

  try {
    const context = await loadCorporateWorkspaceContext(supabase, resolvedEntityId);
    const view = context.view;

    if (!view || view.contract_version !== CORPORATE_WORKSPACE_V1) {
      return { ok: false, reason: "WORKSPACE_VIEW_INVALID" };
    }

    return {
      ok: true,
      entity_id: resolvedEntityId,
      view,
      panel_sections: mapWorkspaceViewToPanelSections(view),
      contract_version: view.contract_version,
      generated_from: view.generated_from,
      display_version: view.display_version,
      invented_display: view.invented_display === false,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "WORKSPACE_LOAD_FAILED",
      error_message: error instanceof Error ? error.message : String(error),
    };
  }
}
