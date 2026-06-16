/**
 * Central Brain — analysis_jobs helpers (read-only lookups).
 */

export async function findInFlightAnalysisJob(supabase, customerId) {
  if (!supabase || !customerId) return null;

  const { data, error } = await supabase
    .from("analysis_jobs")
    .select("id, status, created_at, updated_at")
    .eq("customer_id", customerId)
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0];
}
