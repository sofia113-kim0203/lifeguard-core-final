/**
 * Unified customer view — personal / corporate / both context contract.
 */
import assert from "node:assert/strict";
import {
  applyCustomerViewModeToUserPayload,
  isExplicitDualContextQuestion,
  isCorporateViewUtterance,
  resolveCustomerViewMode,
} from "../server/keyCore/keyCustomerViewContext.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTITY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTITY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

assert.equal(isExplicitDualContextQuestion("내 개인보험과 회사보험을 비교해줘"), true);
assert.equal(isExplicitDualContextQuestion("내 보험은?"), false);
assert.equal(isCorporateViewUtterance("우리 회사 보험 상태"), true);
assert.equal(isCorporateViewUtterance("내 개인보험 알려줘"), false);

{
  const personal = resolveCustomerViewMode({ question: "내 보험은?" });
  assert.equal(personal.mode, "personal");
  assert.equal(personal.entity_id, null);
}

{
  // Single membership must never force corporate without selection/utterance.
  const personal = resolveCustomerViewMode({
    question: "내 보험은?",
    selectedEntityIdHint: null,
    viewModeHint: null,
  });
  assert.equal(personal.mode, "personal");
}

{
  const corp = resolveCustomerViewMode({
    question: "우리 회사 보험",
    selectedEntityIdHint: ENTITY_A,
    viewModeHint: "corporate",
  });
  assert.equal(corp.mode, "corporate");
  assert.equal(corp.entity_id, ENTITY_A);
}

{
  const dual = resolveCustomerViewMode({
    question: "내 개인보험과 회사보험을 비교해줘",
    selectedEntityIdHint: ENTITY_A,
  });
  assert.equal(dual.mode, "both");
  assert.equal(dual.entity_id, ENTITY_A);
}

{
  // Explicit personal clears stale entity hint.
  const personal = resolveCustomerViewMode({
    question: "내 보험",
    selectedEntityIdHint: ENTITY_A,
    viewModeHint: "personal",
  });
  assert.equal(personal.mode, "personal");
  assert.equal(personal.entity_id, null);
}

{
  const payload = {
    available_verified_evidence: {
      personal: {
        subject_type: "individual",
        chart: { insurer: "개인보험사" },
        active_claim_cases: [{ id: "p1" }],
      },
      corporate: [
        { entity_id: ENTITY_A, chart: { industry: "제조" } },
        { entity_id: ENTITY_B, chart: { industry: "유통" } },
      ],
      documents: [
        { id: "d1", entity_id: null },
        { id: "d2", entity_id: ENTITY_A },
        { id: "d3", entity_id: ENTITY_B },
      ],
    },
  };

  const personalOnly = applyCustomerViewModeToUserPayload(payload, {
    mode: "personal",
    reason: "default_personal",
    entity_id: null,
  });
  assert.equal(personalOnly.available_verified_evidence.corporate.length, 0);
  assert.equal(personalOnly.available_verified_evidence.personal.chart.insurer, "개인보험사");
  assert.equal(personalOnly.available_verified_evidence.documents.length, 1);
  assert.equal(personalOnly.available_verified_evidence.documents[0].id, "d1");

  const corpOnly = applyCustomerViewModeToUserPayload(payload, {
    mode: "corporate",
    reason: "client_view_mode",
    entity_id: ENTITY_A,
  });
  assert.equal(corpOnly.available_verified_evidence.corporate.length, 1);
  assert.equal(corpOnly.available_verified_evidence.corporate[0].entity_id, ENTITY_A);
  assert.equal(corpOnly.available_verified_evidence.personal.chart, null);
  assert.equal(corpOnly.available_verified_evidence.personal.active_claim_cases.length, 0);
  assert.equal(corpOnly.available_verified_evidence.documents.length, 1);
  assert.equal(corpOnly.available_verified_evidence.documents[0].id, "d2");

  const both = applyCustomerViewModeToUserPayload(payload, {
    mode: "both",
    reason: "explicit_dual_utterance",
    entity_id: ENTITY_A,
  });
  assert.equal(both.available_verified_evidence.personal.chart.insurer, "개인보험사");
  assert.equal(both.available_verified_evidence.corporate.length, 1);
  assert.equal(both.current_context.dual_context.merged, false);
}

{
  const plain = buildHomeBrainFactRequestBody("내 보험은?", []);
  assert.equal(Object.prototype.hasOwnProperty.call(plain, "entity_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plain, "view_mode"), false);

  const withView = buildHomeBrainFactRequestBody("우리 회사", [], {
    viewMode: "corporate",
    entityId: ENTITY_A,
    entityType: "corporate",
  });
  assert.equal(withView.view_mode, "corporate");
  assert.equal(withView.entity_id, ENTITY_A);
  assert.equal(withView.entity_type, "corporate");
}

{
  const homeChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  assert.match(homeChat, /fetchMyCorporateEntities/);
  assert.match(homeChat, /viewMode/);
  assert.match(homeChat, /selectedEntityId/);
  assert.match(homeChat, /개인\+법인 비교/);
  // No separate corporate dashboard / route / panel product surface.
  assert.equal(/CorporatePanel|법인 대시보드|\/corporate\b/.test(homeChat), false);
  const sessionCore = readFileSync(join(ROOT, "src/lib/lifeguardChatSessionCore.js"), "utf8");
  assert.equal(/active_entity_type|active_entity_id|activeEntity/.test(sessionCore), false);
  const api = readFileSync(join(ROOT, "api/key-my-corporate-entities.js"), "utf8");
  assert.match(api, /listMyCorporateEntities/);
}

console.log("key-customer-view-context-unit-test: PASS");
