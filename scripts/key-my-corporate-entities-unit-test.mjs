/**
 * Unit: corporate picker list mapping + client fetch never-throw contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapMyCorporateEntityRows } from "../server/entity/listMyCorporateEntities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const USER = "user-qa-a";
const ENTITY = "ent-corp-1";

{
  const mapped = mapMyCorporateEntityRows({
    authUserId: USER,
    memberships: [
      { entity_id: ENTITY, user_id: USER, member_role: "owner", status: "active" },
      { entity_id: "other", user_id: "stranger", member_role: "owner", status: "active" },
      { entity_id: ENTITY, user_id: USER, member_role: "owner", status: "revoked" },
    ],
    entities: [
      {
        id: ENTITY,
        entity_type: "corporate",
        entity_status: "demo",
        display_name: "QA Corp Chart Hand Fixture",
      },
      {
        id: "other",
        entity_type: "corporate",
        entity_status: "active",
        display_name: "Stranger Corp",
      },
    ],
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].entity_id, ENTITY);
  assert.equal(mapped[0].display_name, "QA Corp Chart Hand Fixture");
  assert.equal(mapped[0].membership_role_display, "소유자");
}

{
  const empty = mapMyCorporateEntityRows({
    authUserId: USER,
    memberships: [],
    entities: [],
  });
  assert.deepEqual(empty, []);
}

{
  const client = readFileSync(join(ROOT, "src/lib/keyMyCorporateEntities.js"), "utf8");
  assert.match(client, /catch\s*\(/);
  assert.match(client, /corporate_list_fetch_failed|err\?\.reason/);
  assert.match(client, /entities:\s*\[\]/);
}

{
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /loadingSession/);
  assert.match(
    homeChat,
    /fetchMyCorporateEntities\(\)[\s\S]*?\.catch\(/,
  );
  assert.match(homeChat, /\[authUser,\s*loadingSession\]/);
  // Gate: chips only when corporateEntities.length > 0
  assert.match(homeChat, /corporateEntities\.length\s*>\s*0/);
}

console.log("key-my-corporate-entities-unit-test: PASS");
