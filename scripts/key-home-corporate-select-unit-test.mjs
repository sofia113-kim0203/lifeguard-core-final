/**
 * Slice 2 — corporate select / pass / restore Hand unit tests (local only).
 * Usage: node scripts/key-home-corporate-select-unit-test.mjs
 */
import assert from "node:assert/strict";
import {
  CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
  CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
  buildHomeBrainEntityRequestFields,
  extractActiveEntityFromSessionMessages,
  isCorporateAuthFailClosedResult,
  normalizeActiveEntity,
  resolveRestoredActiveEntity,
} from "../src/lib/chatActiveEntity.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import {
  mapCorporateEntitiesPayload,
  normalizeCorporateEntityListItem,
} from "../src/lib/corporateEntitiesMap.js";
import {
  buildSessionMetadata,
  readLifeguardChatSnapshot,
  writeLifeguardChatSnapshot,
  clearLifeguardChatSnapshot,
} from "../src/lib/lifeguardChatSessionCore.js";
import {
  mapMyCorporateEntityRows,
  membershipRoleDisplay,
  listMyCorporateEntities,
} from "../server/entity/listMyCorporateEntities.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    failed += 1;
  }
}

function makeQueryFake({ memberships, entities, membershipError, entityError }) {
  return {
    from(table) {
      const state = { table, filters: [] };
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          state.filters.push(["eq", col, val]);
          return api;
        },
        in(col, val) {
          state.filters.push(["in", col, val]);
          return api;
        },
        then(resolve, reject) {
          if (table === "entity_memberships") {
            if (membershipError) return resolve({ data: null, error: membershipError });
            const userFilter = state.filters.find((f) => f[0] === "eq" && f[1] === "user_id");
            const uid = userFilter?.[2];
            const rows = (memberships ?? []).filter((m) => !uid || m.user_id === uid);
            return resolve({ data: rows, error: null });
          }
          if (table === "entities") {
            if (entityError) return resolve({ data: null, error: entityError });
            return resolve({ data: entities ?? [], error: null });
          }
          return reject(new Error(`unexpected_table:${table}`));
        },
      };
      return api;
    },
  };
}

await runCase("membership role display — server-derived only", () => {
  assert.equal(membershipRoleDisplay("owner"), "소유자");
  assert.equal(membershipRoleDisplay("member"), "구성원");
  assert.equal(membershipRoleDisplay("agent"), "대리");
  assert.equal(membershipRoleDisplay("admin"), "관리자");
  assert.equal(membershipRoleDisplay("hacker"), null);
  assert.equal(membershipRoleDisplay(""), null);
});

await runCase("list map — only auth user memberships + corporate active", () => {
  const rows = mapMyCorporateEntityRows({
    authUserId: "u1",
    memberships: [
      { entity_id: "e1", user_id: "u1", member_role: "owner", status: "active" },
      { entity_id: "e2", user_id: "u1", member_role: "member", status: "active" },
      { entity_id: "e3", user_id: "u2", member_role: "owner", status: "active" },
      { entity_id: "e4", user_id: "u1", member_role: "owner", status: "revoked" },
      { entity_id: "e1", user_id: "u1", member_role: "owner", status: "active" },
    ],
    entities: [
      { id: "e1", entity_type: "corporate", entity_status: "active", display_name: "A법인" },
      { id: "e2", entity_type: "corporate", entity_status: "demo", display_name: "B법인" },
      { id: "e3", entity_type: "corporate", entity_status: "active", display_name: "다른사람법인" },
      { id: "e5", entity_type: "individual", entity_status: "active", display_name: "개인엔티티" },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.entity_id).sort(),
    ["e1", "e2"],
  );
  assert.equal(rows.find((r) => r.entity_id === "e1").display_name, "A법인");
  assert.equal(rows.find((r) => r.entity_id === "e1").membership_role_display, "소유자");
  assert.ok(!rows.some((r) => r.entity_id === "e3"));
});

await runCase("listMyCorporateEntities — filters by authUserId only", async () => {
  const supabase = makeQueryFake({
    memberships: [
      { entity_id: "e1", user_id: "user-a", member_role: "owner", status: "active" },
      { entity_id: "e2", user_id: "user-b", member_role: "owner", status: "active" },
    ],
    entities: [
      { id: "e1", entity_type: "corporate", entity_status: "active", display_name: "내법인" },
      { id: "e2", entity_type: "corporate", entity_status: "active", display_name: "남의법인" },
    ],
  });
  const listed = await listMyCorporateEntities(supabase, { authUserId: "user-a" });
  assert.equal(listed.ok, true);
  assert.equal(listed.entities.length, 1);
  assert.equal(listed.entities[0].entity_id, "e1");
  assert.equal(listed.entities[0].display_name, "내법인");
});

await runCase("list error ≠ empty — membership query fail", async () => {
  const supabase = makeQueryFake({
    memberships: [],
    entities: [],
    membershipError: { message: "db_down" },
  });
  const listed = await listMyCorporateEntities(supabase, { authUserId: "user-a" });
  assert.equal(listed.ok, false);
  assert.equal(listed.entities.length, 0);
  assert.equal(listed.customer_message, CORPORATE_LIST_FAILED_CUSTOMER_TEXT);
  assert.notEqual(listed.list_status, "empty");
});

await runCase("list empty is ok with empty status", async () => {
  const supabase = makeQueryFake({ memberships: [], entities: [] });
  const listed = await listMyCorporateEntities(supabase, { authUserId: "user-a" });
  assert.equal(listed.ok, true);
  assert.equal(listed.list_status, "empty");
  assert.deepEqual(listed.entities, []);
});

await runCase("client payload map — error vs empty", () => {
  const err = mapCorporateEntitiesPayload({
    ok: false,
    customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
    entities: [],
  });
  assert.equal(err.ok, false);
  assert.equal(err.listStatus, "error");
  assert.equal(err.customerMessage, CORPORATE_LIST_FAILED_CUSTOMER_TEXT);

  const empty = mapCorporateEntitiesPayload({ ok: true, entities: [], list_status: "empty" });
  assert.equal(empty.ok, true);
  assert.equal(empty.listStatus, "empty");

  const ok = mapCorporateEntitiesPayload({
    ok: true,
    entities: [{ entity_id: "e1", display_name: "법인", membership_role_display: "소유자" }],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.listStatus, "ok");
  assert.equal(ok.entities[0].entity_id, "e1");
});

await runCase("normalize ignores client authorization / role trust fields", () => {
  const normalized = normalizeActiveEntity({
    active_entity_type: "corporate",
    active_entity_id: "e1",
    authorization_verified: true,
    membership_role: "owner",
    trusted_role: "admin",
  });
  assert.deepEqual(normalized, {
    active_entity_type: "corporate",
    active_entity_id: "e1",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "authorization_verified"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "membership_role"), false);

  const item = normalizeCorporateEntityListItem({
    entity_id: "e1",
    display_name: "법인",
    membership_role_display: "소유자",
    authorization_verified: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(item, "authorization_verified"), false);
});

await runCase("personal default request body — no entity fields", () => {
  const body = buildHomeBrainFactRequestBody("보험 어때?", [], {});
  assert.equal(body.question, "보험 어때?");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "entity_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "member_role"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "authorization_verified"), false);
});

await runCase("corporate select → entity_type + entity_id only", () => {
  const body = buildHomeBrainFactRequestBody("법인 보험 현황", [], {
    entityType: "corporate",
    entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  assert.equal(body.entity_type, "corporate");
  assert.equal(body.entity_id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "member_role"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "authorization_verified"), false);

  const fields = buildHomeBrainEntityRequestFields(null);
  assert.deepEqual(fields, {});
});

await runCase("session metadata stores only active_entity_type/id", () => {
  const meta = buildSessionMetadata("sess-1", {
    activeEntity: {
      active_entity_type: "corporate",
      active_entity_id: "e1",
      authorization_verified: true,
      membership_role: "owner",
    },
  });
  assert.equal(meta.active_entity_type, "corporate");
  assert.equal(meta.active_entity_id, "e1");
  assert.equal(Object.prototype.hasOwnProperty.call(meta, "authorization_verified"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(meta, "membership_role"), false);
});

await runCase("extract active entity from session messages", () => {
  const found = extractActiveEntityFromSessionMessages([
    { role: "user", content: "hi", metadata: {} },
    {
      role: "assistant",
      content: "ok",
      metadata: { active_entity_type: "corporate", active_entity_id: "e9" },
    },
  ]);
  assert.deepEqual(found, { active_entity_type: "corporate", active_entity_id: "e9" });
});

await runCase("restore — same conversation candidate validated against list", () => {
  const restored = resolveRestoredActiveEntity({
    candidate: { active_entity_type: "corporate", active_entity_id: "e1" },
    membershipEntities: [{ entity_id: "e1", display_name: "내법인" }],
    listOk: true,
  });
  assert.equal(restored.activeEntity.active_entity_id, "e1");
  assert.equal(restored.clearStale, false);
});

await runCase("restore — new conversation has no auto-propagate (null candidate)", () => {
  const restored = resolveRestoredActiveEntity({
    candidate: null,
    membershipEntities: [{ entity_id: "e1", display_name: "내법인" }],
    listOk: true,
  });
  assert.equal(restored.activeEntity, null);
});

await runCase("restore — lost access clears stale, no corporate activate", () => {
  const restored = resolveRestoredActiveEntity({
    candidate: { active_entity_type: "corporate", active_entity_id: "gone" },
    membershipEntities: [{ entity_id: "e1", display_name: "내법인" }],
    listOk: true,
  });
  assert.equal(restored.activeEntity, null);
  assert.equal(restored.clearStale, true);
});

await runCase("restore — list error does not treat as empty / does not activate", () => {
  const restored = resolveRestoredActiveEntity({
    candidate: { active_entity_type: "corporate", active_entity_id: "e1" },
    membershipEntities: [],
    listOk: false,
  });
  assert.equal(restored.activeEntity, null);
  assert.equal(restored.listUnavailable, true);
  assert.equal(restored.clearStale, false);
});

await runCase("auth fail closed detection → clear stale selection signal", () => {
  assert.equal(
    isCorporateAuthFailClosedResult({
      answerText: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      failureReason: "corporate_access_denied",
    }),
    true,
  );
  assert.equal(
    isCorporateAuthFailClosedResult({
      answerText: "일반 답변",
      failureReason: null,
    }),
    false,
  );
});

await runCase("snapshot round-trip — activeEntity per conversation only", () => {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  };

  const customerId = "cust-1";
  writeLifeguardChatSnapshot(customerId, {
    sessionId: "sess-a",
    messages: [{ role: "user", content: "q1" }],
    activeEntity: { active_entity_type: "corporate", active_entity_id: "e1" },
  });
  const snap = readLifeguardChatSnapshot(customerId);
  assert.equal(snap.sessionId, "sess-a");
  assert.deepEqual(snap.activeEntity, {
    active_entity_type: "corporate",
    active_entity_id: "e1",
  });

  // New conversation clears snapshot — no auto-propagate.
  clearLifeguardChatSnapshot(customerId);
  assert.equal(readLifeguardChatSnapshot(customerId), null);

  delete globalThis.window;
});

await runCase("home chat Hand — no CorporatePanel / no corporate compose speech loop", () => {
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /selectChatEntity/);
  assert.match(homeChat, /fetchMyCorporateEntities/);
  assert.match(homeChat, /entityType:\s*"corporate"/);
  assert.match(homeChat, /isCorporateAuthFailClosedResult/);
  assert.doesNotMatch(homeChat, /CorporatePanel/);
  assert.doesNotMatch(homeChat, /corporateCompose|corporateSpeech|corporateLoop/);

  const listApi = readFileSync(join(ROOT, "api/customer-corporate-entities.js"), "utf8");
  assert.match(listApi, /listMyCorporateEntities/);
  assert.doesNotMatch(listApi, /create table|alter table|schema/i);
});

await runCase("Slice 1 corporate path still present — no personal fallback on auth fail text", () => {
  const slice1 = readFileSync(join(ROOT, "server/keyCore/keyClaudeCorporateContext.js"), "utf8");
  assert.match(slice1, /CORPORATE_AUTH_FAILED_CUSTOMER_TEXT/);
  assert.match(slice1, /이 법인의 정보를 확인할 권한이 확인되지 않았습니다/);
  assert.doesNotMatch(slice1, /verified_customer_chart/);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
