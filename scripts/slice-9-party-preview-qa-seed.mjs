/**
 * Slice 9 — upsert non-identified Case A/B party policies onto Preview QA customer (staging).
 * Usage: node scripts/slice-9-party-preview-qa-seed.mjs
 * Forbidden on production (productionSafetyGuard).
 */
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSlice9PolicyRowFromCase,
  resolveServiceRoleClient,
  SLICE9_CASE_A_SEED_TAG,
  SLICE9_CASE_B_SEED_TAG,
} from "./lib/slice-9-party-qa-seed-payload.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KNOWN_QA_CUSTOMER_ID = "a247a66f-a597-4ccf-9530-761b82518002";

async function findExistingBySeedTag(admin, customerId, seedTag) {
  const { data, error } = await admin
    .from("profile_insurance_policies")
    .select("id, coverage_summary, is_active, product_name")
    .eq("customer_id", customerId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).find((row) => row.coverage_summary?.seed_tag === seedTag) ?? null;
}

async function upsertCase(admin, customerId, caseId, seedTag) {
  const row = buildSlice9PolicyRowFromCase(customerId, caseId);
  const existing = await findExistingBySeedTag(admin, customerId, seedTag);
  if (existing) {
    const { data, error } = await admin
      .from("profile_insurance_policies")
      .update({
        insurer_name: row.insurer_name,
        product_name: row.product_name,
        policy_type: row.policy_type,
        monthly_premium: row.monthly_premium,
        effective_from: row.effective_from,
        coverage_summary: row.coverage_summary,
        source: "manual",
        is_active: true,
        updated_at: row.updated_at,
      })
      .eq("id", existing.id)
      .select("id, product_name")
      .single();
    if (error) throw error;
    return { action: "update", id: data.id, product_name: data.product_name, seed_tag: seedTag };
  }
  const { data, error } = await admin
    .from("profile_insurance_policies")
    .insert(row)
    .select("id, product_name")
    .single();
  if (error) throw error;
  return { action: "insert", id: data.id, product_name: data.product_name, seed_tag: seedTag };
}

async function main() {
  const admin = resolveServiceRoleClient(createClient, { root: ROOT });
  const customerId =
    String(process.env.SLICE9_QA_CUSTOMER_ID ?? "").trim() || KNOWN_QA_CUSTOMER_ID;

  const a = await upsertCase(admin, customerId, "slice-9-case-a", SLICE9_CASE_A_SEED_TAG);
  const b = await upsertCase(admin, customerId, "slice-9-case-b", SLICE9_CASE_B_SEED_TAG);

  console.log(
    JSON.stringify(
      {
        ok: true,
        customer_id_suffix: customerId.slice(-8),
        results: [a, b],
        note: "staging QA seed only — no production",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
