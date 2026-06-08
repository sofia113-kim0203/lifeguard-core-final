export function resolveServiceRoleKey(): string | undefined {
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (supabaseServiceRoleKey) return supabaseServiceRoleKey;

  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey) return serviceRoleKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (!secretKeys) return undefined;

  if (secretKeys.startsWith("[")) {
    try {
      const parsed = JSON.parse(secretKeys) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const preferred = parsed.find(
          (entry) => typeof entry === "string" && entry.startsWith("sb_secret_"),
        );
        return (preferred ?? parsed[0]) as string;
      }
    } catch {
      // fall through to raw value
    }
  }

  return secretKeys;
}

export function isServiceRoleBearer(
  authHeader: string | null,
  serviceRoleKey: string,
): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 && token === serviceRoleKey;
}
