/** Supabase URL ref extraction — probe/audit fingerprint only. */

export function refFromSupabaseUrl(url = "") {
  const match = String(url).match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : null;
}
