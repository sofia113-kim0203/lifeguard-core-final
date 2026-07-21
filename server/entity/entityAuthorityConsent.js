/**
 * Corporate authority / consent / delegation (Slice 2).
 * Separate from personal customer_consents.
 * Membership roster ≠ third-party consent. Representative ≠ all employee data.
 */

export const AUTHORITY_TYPES = Object.freeze([
  "representative",
  "delegated_manager",
  "employee_self",
]);

export const CONSENT_SCOPES = Object.freeze([
  "corporate_profile",
  "corporate_documents",
  "insurance_consultation",
  "claim_support",
]);

export const AUTHORITY_STATUSES = Object.freeze(["active", "revoked", "expired"]);

export const ENTITY_LEVEL_SUBJECT = null;

function nowMs(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.getTime() : Date.now();
}

export function isAuthorityRowActive(row = null, { now = new Date() } = {}) {
  if (!row || typeof row !== "object") return false;
  if (String(row.status ?? "").trim() !== "active") return false;
  if (row.revoked_at) return false;
  if (row.expires_at) {
    const exp = new Date(row.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= nowMs(now)) return false;
  }
  return true;
}

/**
 * Load authority rows for a holder on one entity (JWT user client or admin).
 * Marks expired rows in-memory; does not write unless expireImpl provided.
 */
export async function loadHolderAuthorityGrants({
  supabase = null,
  entityId = null,
  holderUserId = null,
  now = new Date(),
} = {}) {
  const eid = String(entityId ?? "").trim();
  const hid = String(holderUserId ?? "").trim();
  if (!supabase || !eid || !hid) {
    return { ok: false, reason: "missing_args", grants: [], scopes_entity_level: [], subjects: {} };
  }

  const { data, error } = await supabase
    .from("entity_authority_consents")
    .select(
      "id, entity_id, holder_user_id, subject_user_id, granted_by_user_id, authority_type, consent_scope, status, granted_at, revoked_at, expires_at, source, evidence_id",
    )
    .eq("entity_id", eid)
    .eq("holder_user_id", hid)
    .eq("status", "active");

  if (error) {
    return {
      ok: false,
      reason: error.message || "query_failed",
      grants: [],
      scopes_entity_level: [],
      subjects: {},
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const active = [];
  for (const row of rows) {
    if (!isAuthorityRowActive(row, { now })) continue;
    active.push(row);
  }

  const scopes_entity_level = [
    ...new Set(
      active
        .filter((r) => r.subject_user_id == null || r.subject_user_id === "")
        .map((r) => String(r.consent_scope)),
    ),
  ];

  const subjects = {};
  for (const row of active) {
    const sid = row.subject_user_id != null ? String(row.subject_user_id).trim() : "";
    if (!sid) continue;
    if (!subjects[sid]) subjects[sid] = new Set();
    subjects[sid].add(String(row.consent_scope));
  }
  const subjects_plain = Object.fromEntries(
    Object.entries(subjects).map(([k, v]) => [k, [...v]]),
  );

  return {
    ok: true,
    reason: null,
    grants: active,
    scopes_entity_level,
    subjects: subjects_plain,
    authority_types: [...new Set(active.map((r) => String(r.authority_type)))],
  };
}

export function hasEntityLevelScope(grantPack = null, scope = "") {
  const want = String(scope ?? "").trim();
  if (!want || !grantPack?.ok) return false;
  return (grantPack.scopes_entity_level ?? []).includes(want);
}

export function hasSubjectScope(grantPack = null, subjectUserId = null, scope = "") {
  const sid = String(subjectUserId ?? "").trim();
  const want = String(scope ?? "").trim();
  if (!sid || !want || !grantPack?.ok) return false;
  const scopes = grantPack.subjects?.[sid];
  return Array.isArray(scopes) && scopes.includes(want);
}

/**
 * Filter corporate documents by authority:
 * - no subject → needs corporate_documents entity-level
 * - subject set (column or metadata) → needs that subject + corporate_documents
 * Never upgrades access. Fail-closed on missing grants.
 */
export function filterDocumentsByAuthority(documents = [], grantPack = null) {
  const rows = Array.isArray(documents) ? documents : [];
  if (!grantPack?.ok) return [];
  if (!hasEntityLevelScope(grantPack, "corporate_documents")) {
    // Still allow subject-scoped docs if explicitly granted.
    return rows.filter((doc) => {
      const sid = resolveDocumentSubjectUserId(doc);
      return sid && hasSubjectScope(grantPack, sid, "corporate_documents");
    });
  }
  return rows.filter((doc) => {
    const sid = resolveDocumentSubjectUserId(doc);
    if (!sid) return true;
    return hasSubjectScope(grantPack, sid, "corporate_documents");
  });
}

export function resolveDocumentSubjectUserId(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const direct = String(doc.subject_user_id ?? "").trim();
  if (direct) return direct;
  const meta =
    doc.metadata_json && typeof doc.metadata_json === "object" ? doc.metadata_json : {};
  const fromMeta = String(meta.subject_user_id ?? meta.employee_user_id ?? "").trim();
  return fromMeta || null;
}

/**
 * Claude Hand authority brief — never invents consent; lists known grants only.
 */
export function buildAuthorityHandBrief(grantPack = null) {
  if (!grantPack?.ok) {
    return {
      authority_verified: false,
      allowed_scopes_entity_level: [],
      allowed_subject_count: 0,
      consent_deadlines: [],
      note: "no_active_corporate_authority_consent",
      membership_is_not_consent: true,
    };
  }
  // Insurance Clock Slice 1 — project SSOT expires_at only (no invented dates).
  const consent_deadlines = (Array.isArray(grantPack.grants) ? grantPack.grants : [])
    .filter((g) => g?.expires_at)
    .map((g) => ({
      id: g.id ?? null,
      entity_id: g.entity_id ?? null,
      consent_scope: g.consent_scope ?? null,
      expires_at: g.expires_at,
      evidence_id: g.evidence_id ?? null,
      status: g.status ?? null,
    }))
    .slice(0, 24);
  return {
    authority_verified: (grantPack.scopes_entity_level?.length ?? 0) > 0,
    allowed_scopes_entity_level: [...(grantPack.scopes_entity_level ?? [])],
    allowed_subject_count: Object.keys(grantPack.subjects ?? {}).length,
    authority_types: [...(grantPack.authority_types ?? [])],
    consent_deadlines,
    membership_is_not_consent: true,
    note:
      (grantPack.scopes_entity_level?.length ?? 0) > 0
        ? "consult_only_within_listed_scopes"
        : "no_entity_level_authority",
  };
}

/**
 * Whether entity-level corporate Hand materials may load for consultation.
 * Requires insurance_consultation or corporate_profile (chart). Docs gated separately.
 */
export function canLoadCorporateProfileHand(grantPack = null) {
  return (
    hasEntityLevelScope(grantPack, "corporate_profile") ||
    hasEntityLevelScope(grantPack, "insurance_consultation")
  );
}

/**
 * Slice 3 — Corporate Claim Guardian may create/hydrate corporate claims only with
 * active entity-level claim_support. Membership alone is never enough.
 */
export function canSupportCorporateClaims(grantPack = null) {
  return hasEntityLevelScope(grantPack, "claim_support");
}

export async function revokeAuthorityGrant({
  supabase = null,
  grantId = null,
  now = new Date(),
  invalidateReadyCardForCustomerIds = [],
  invalidateReadyCardCacheForCustomerImpl = null,
} = {}) {
  const id = String(grantId ?? "").trim();
  if (!supabase || !id) return { ok: false, reason: "missing_args" };
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const { error } = await supabase
    .from("entity_authority_consents")
    .update({
      status: "revoked",
      revoked_at: stamp,
      updated_at: stamp,
    })
    .eq("id", id)
    .eq("status", "active");
  if (error) return { ok: false, reason: error.message || "revoke_failed" };
  if (typeof invalidateReadyCardCacheForCustomerImpl === "function") {
    for (const cid of invalidateReadyCardForCustomerIds || []) {
      try {
        invalidateReadyCardCacheForCustomerImpl(cid);
      } catch {
        /* non-blocking */
      }
    }
  }
  return { ok: true, reason: null, revoked_at: stamp };
}

export async function grantAuthorityScopes({
  supabase = null,
  entityId = null,
  holderUserId = null,
  subjectUserId = null,
  grantedByUserId = null,
  authorityType = null,
  scopes = [],
  source = "corporate_consent_slice2",
  evidenceId = null,
  expiresAt = null,
  now = new Date(),
} = {}) {
  const eid = String(entityId ?? "").trim();
  const holder = String(holderUserId ?? "").trim();
  const grantor = String(grantedByUserId ?? "").trim();
  const type = String(authorityType ?? "").trim();
  if (!supabase || !eid || !holder || !grantor || !AUTHORITY_TYPES.includes(type)) {
    return { ok: false, reason: "missing_or_invalid_args", inserted: [] };
  }
  const scopeList = (Array.isArray(scopes) ? scopes : []).filter((s) =>
    CONSENT_SCOPES.includes(String(s)),
  );
  if (scopeList.length === 0) return { ok: false, reason: "no_scopes", inserted: [] };

  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const rows = scopeList.map((consent_scope) => ({
    entity_id: eid,
    holder_user_id: holder,
    subject_user_id: subjectUserId ? String(subjectUserId).trim() : null,
    granted_by_user_id: grantor,
    authority_type: type,
    consent_scope,
    status: "active",
    granted_at: stamp,
    revoked_at: null,
    expires_at: expiresAt,
    source,
    evidence_id: evidenceId,
    updated_at: stamp,
  }));

  const { data, error } = await supabase
    .from("entity_authority_consents")
    .insert(rows)
    .select("id, consent_scope");
  if (error) return { ok: false, reason: error.message || "insert_failed", inserted: [] };
  return { ok: true, reason: null, inserted: data ?? [] };
}
