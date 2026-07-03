/** Entity Registry — canonical entity type / status / scope constants (CORP-B1). */

export const ENTITY_TYPES = {
  INDIVIDUAL: "individual",
  CORPORATE: "corporate",
  GA: "ga",
};

export const ENTITY_STATUSES = ["active", "archived", "deleted", "demo"];

export const ENTITY_SCOPES = ["owner", "member", "agent", "admin", "tenant", "platform"];

export const MEMBER_ROLES = ["owner", "member", "agent", "admin"];

export const MEMBER_ACCESS_SCOPES = ["read", "write", "admin"];

export const FUTURE_ENTITY_TYPES = ["family", "hospital", "partner", "broker"];

export function isKnownEntityType(value) {
  return Object.values(ENTITY_TYPES).includes(String(value ?? ""));
}

export function normalizeEntityType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isKnownEntityType(normalized) ? normalized : null;
}
