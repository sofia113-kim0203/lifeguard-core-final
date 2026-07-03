/**
 * Load entity record + membership for API passthrough (CC-2 Hand).
 * Read-only — staging/demo corporate validation entity.
 */
import { ENTITY_TYPES } from "./entityTypes.js";

export async function loadEntityContextRecords(
  supabase,
  { conversationContext = {}, customerId = null, authUserId = null } = {},
) {
  if (!supabase) {
    return { entityRecord: null, membership: null, load_error: "supabase_required" };
  }

  const entityType = String(conversationContext.entity_type ?? "").trim().toLowerCase();
  const entityId = conversationContext.entity_id ? String(conversationContext.entity_id) : null;

  if (entityType !== ENTITY_TYPES.CORPORATE || !entityId) {
    return { entityRecord: null, membership: null };
  }

  const { data: entityRow, error: entityError } = await supabase
    .from("entities")
    .select("id, entity_type, entity_status, entity_scope, display_name, memory_version, metadata_json")
    .eq("id", entityId)
    .maybeSingle();

  if (entityError || !entityRow) {
    return {
      entityRecord: null,
      membership: null,
      load_error: entityError?.message ?? "entity_record_not_found",
    };
  }

  const entityRecord = {
    entity_id: entityRow.id,
    entity_type: entityRow.entity_type,
    entity_status: entityRow.entity_status,
    entity_scope: entityRow.entity_scope,
    display_name: entityRow.display_name,
    memory_version: entityRow.memory_version ?? 0,
    metadata_json: entityRow.metadata_json ?? {},
  };

  // RLS (lg_entity_memberships_self_select) scopes rows to auth.uid(); never use customerId here.
  let membership = null;
  let membershipQuery = supabase
    .from("entity_memberships")
    .select("entity_id, user_id, member_role, member_scope, status")
    .eq("entity_id", entityId)
    .eq("status", "active");
  if (authUserId) {
    membershipQuery = membershipQuery.eq("user_id", authUserId);
  }
  const { data: membershipRow } = await membershipQuery.maybeSingle();

  if (membershipRow) {
    membership = {
      entity_id: membershipRow.entity_id,
      user_id: membershipRow.user_id,
      member_role: membershipRow.member_role,
      member_scope: membershipRow.member_scope,
      status: membershipRow.status,
    };
  }

  return { entityRecord, membership, load_error: null };
}
