const SENTINELS = new Set([
  "unknown",
  "없음",
  "모름",
  "n/a",
  "-",
  "",
]);

export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  return !SENTINELS.has(trimmed.toLowerCase());
}

export function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function computeAgeBand(birthDate: string): string | null {
  const parsed = new Date(birthDate);
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const monthDelta = now.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsed.getDate())) {
    age -= 1;
  }

  if (age < 0 || age > 120) return null;

  const lower = Math.floor(age / 5) * 5;
  const upper = lower + 4;
  return `${lower}-${upper}`;
}

export function normalizeFlag(value: unknown): string | null {
  if (!isPresent(value)) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1", "예", "있음"].includes(normalized)) return "yes";
  if (["no", "n", "false", "0", "아니오", "없음"].includes(normalized)) return "no";
  return normalized;
}

export function isIndemnityPolicyType(policyType: string | null | undefined): boolean {
  if (!isPresent(policyType)) return false;
  const normalized = String(policyType).trim().toLowerCase();
  return (
    normalized === "indemnity" ||
    normalized === "indemnity_medical" ||
    normalized.includes("실손")
  );
}
