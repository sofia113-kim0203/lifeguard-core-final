/**
 * Entity Registry — gateway for registering entity types on LIFEGUARD CORE.
 * Registry answers: "What kind of Entity is this?"
 * Context Layer answers: "How do we interpret that Entity?"
 */
import { ENTITY_TYPES } from "./entityTypes.js";

export const ENTITY_REGISTRY = {
  [ENTITY_TYPES.INDIVIDUAL]: {
    registered: true,
    label: "Individual",
    memory_namespace: "customer_memory_facts",
    memory_loader: "loadCustomerMemorySnapshot",
    context_layer: "individual",
    tenant_root: "customer_profiles.id",
  },
  [ENTITY_TYPES.CORPORATE]: {
    registered: true,
    label: "Corporate",
    memory_namespace: "entity_memory_facts",
    memory_loader: "loadCorporateMemorySnapshot",
    context_layer: "corporate",
    tenant_root: "entities.id",
  },
  [ENTITY_TYPES.GA]: {
    registered: false,
    label: "GA",
    memory_namespace: "entity_memory_facts",
    memory_loader: null,
    context_layer: "ga",
    future: true,
  },
};

export const FUTURE_REGISTRY_SLOTS = ["family", "hospital", "partner", "broker"];

export function listRegisteredEntityTypes() {
  return Object.entries(ENTITY_REGISTRY)
    .filter(([, entry]) => entry.registered === true)
    .map(([type]) => type);
}

export function resolveEntityRegistryEntry(entityType) {
  const key = String(entityType ?? "").trim().toLowerCase();
  return ENTITY_REGISTRY[key] ?? null;
}

export function isRegisteredEntityType(entityType) {
  return resolveEntityRegistryEntry(entityType)?.registered === true;
}

export function resolveMemoryNamespace(entityType) {
  return resolveEntityRegistryEntry(entityType)?.memory_namespace ?? null;
}
