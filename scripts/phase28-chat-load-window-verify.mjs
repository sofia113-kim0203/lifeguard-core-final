/**
 * Verify latest-100 conversation window includes newest messages (173+ account).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = process.env.PHASE28_TEST_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
const LIMIT = 100;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
}

function normalizeConversationMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    role: row.role,
    message: row.message,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

function dedupeMessagesById(rows) {
  const byId = new Map();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: newestThree, error: newestError } = await admin
  .from("customer_conversations")
  .select("id, customer_id, role, message, metadata_json, created_at")
  .eq("customer_id", CUSTOMER_ID)
  .order("created_at", { ascending: false })
  .limit(3);

if (newestError) throw newestError;

const { data: windowRows, error: windowError } = await admin
  .from("customer_conversations")
  .select("id, customer_id, role, message, metadata_json, created_at")
  .eq("customer_id", CUSTOMER_ID)
  .order("created_at", { ascending: false })
  .limit(LIMIT);

if (windowError) throw windowError;

const window = dedupeMessagesById((windowRows ?? []).map(normalizeConversationMessage));
const windowIds = new Set(window.map((row) => row.id));
const missing = (newestThree ?? []).filter((row) => !windowIds.has(row.id));

assert.equal(missing.length, 0, `newest 3 messages must be in latest-${LIMIT} window`);

console.log(
  JSON.stringify(
    {
      phase: "28-chat-load-window-verify",
      pass: true,
      customer_id: CUSTOMER_ID,
      total_in_window: window.length,
      newest_three_in_window: (newestThree ?? []).map((row) => ({
        id: row.id,
        role: row.role,
        phase: row.metadata_json?.phase ?? null,
      })),
    },
    null,
    2,
  ),
);
