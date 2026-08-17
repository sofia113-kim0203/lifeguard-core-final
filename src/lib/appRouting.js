/** P4-A — App routes + role gates (customer = LIFEGUARD chat only). */

export const APP_ROLES = {
  CUSTOMER: "customer",
  AGENT: "agent",
  ADMIN: "admin",
};

export const LIFEGUARD_PATH = "/";

export const BACKOFFICE_ROUTE_TABLE = [
  { path: "/customer-analysis", menuId: "customer", roles: [APP_ROLES.AGENT, APP_ROLES.ADMIN] },
  { path: "/chat", menuId: "chat", roles: [APP_ROLES.AGENT, APP_ROLES.ADMIN] },
  { path: "/ai", menuId: "ai", roles: [APP_ROLES.AGENT, APP_ROLES.ADMIN] },
  { path: "/documents", menuId: "documents", roles: [APP_ROLES.AGENT, APP_ROLES.ADMIN] },
  { path: "/agent", menuId: "agent", roles: [APP_ROLES.AGENT] },
  { path: "/admin", menuId: "admin", roles: [APP_ROLES.ADMIN] },
];

const PATH_INDEX = new Map(BACKOFFICE_ROUTE_TABLE.map((row) => [row.path, row]));
const MENU_INDEX = new Map(BACKOFFICE_ROUTE_TABLE.map((row) => [row.menuId, row]));

export function normalizeAppPath(pathname = "/") {
  const trimmed = String(pathname ?? "/").replace(/\/+$/, "") || "/";
  return trimmed === "" ? "/" : trimmed;
}

export function isBackofficePath(pathname = "/") {
  const path = normalizeAppPath(pathname);
  return path !== LIFEGUARD_PATH && path !== "/reset-password";
}

export function resolveMenuIdFromPath(pathname = "/") {
  const path = normalizeAppPath(pathname);
  if (path === LIFEGUARD_PATH) return "home";
  return PATH_INDEX.get(path)?.menuId ?? null;
}

export function resolvePathFromMenuId(menuId = "home") {
  if (menuId === "home") return LIFEGUARD_PATH;
  return MENU_INDEX.get(menuId)?.path ?? LIFEGUARD_PATH;
}

export function canAccessPath(pathname = "/", role = APP_ROLES.CUSTOMER) {
  const path = normalizeAppPath(pathname);
  if (path === "/reset-password") return true;
  if (path === LIFEGUARD_PATH) return true;
  const row = PATH_INDEX.get(path);
  if (!row) return role !== APP_ROLES.CUSTOMER;
  return row.roles.includes(role);
}

export function getRedirectPathForRole(pathname = "/", role = APP_ROLES.CUSTOMER) {
  if (canAccessPath(pathname, role)) return normalizeAppPath(pathname);
  return LIFEGUARD_PATH;
}

export function isBackofficeRole(role = APP_ROLES.CUSTOMER) {
  return role === APP_ROLES.AGENT || role === APP_ROLES.ADMIN;
}
