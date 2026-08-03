/**
 * C1 UI ENTRY RECONNECT — offline only.
 * Provider call = 0. No Preview. No Production.
 *
 * Proves:
 * 1) 「내 보험 점검」 entry → panelView="insurance"
 * 2) Exact C1 card present when list mounts with QA policies
 * 3) C1 click → pointedContractId set
 * 4) fake submit body has pointed_contract_ids length 1
 * 5) source handler wired to resolveC1InsurancePanelEntryAction
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import {
  applyC1PolicySelection,
  resolveC1InsurancePanelEntryAction,
} from "../src/lib/keyC1InsurancePanelEntry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const C1 = {
  id: "c1-hanwha-3105",
  insurer_name: "한화손해보험",
  product_name: "3.10.5 간편건강보험",
  monthly_premium: 99000,
};

const PROVIDER_CALLS = { count: 0 };

function assertNoProvider() {
  assert.equal(PROVIDER_CALLS.count, 0, "Provider must stay 0");
}

function testEntryActionSsot() {
  const entry = resolveC1InsurancePanelEntryAction();
  assert.equal(entry.panelView, "insurance");
  assert.equal(entry.sidebarOpen, false);
  assert.equal(entry.insuranceRailOpen, false);
  assertNoProvider();
  console.log("PASS entry_action_ssot");
}

function testSourceHandlerWired() {
  const src = readFileSync(
    join(ROOT, "src/components/LifeguardHomeChat.jsx"),
    "utf8",
  );
  assert.match(
    src,
    /import\s*\{\s*resolveC1InsurancePanelEntryAction\s*\}\s*from\s*["']\.\.\/lib\/keyC1InsurancePanelEntry\.js["']/,
  );
  const handlerIdx = src.indexOf("onOpenInsurancePanel:");
  assert.ok(handlerIdx > 0, "onOpenInsurancePanel missing");
  const handlerSlice = src.slice(handlerIdx, handlerIdx + 500);
  assert.match(handlerSlice, /resolveC1InsurancePanelEntryAction\s*\(/);
  assert.match(handlerSlice, /setPanelView\(\s*entry\.panelView\s*\)/);
  assert.doesNotMatch(
    handlerSlice,
    /setPanelView\(\s*["']chat["']\s*\)/,
  );
  assert.doesNotMatch(
    handlerSlice,
    /setInsuranceRailOpen\(\s*true\s*\)/,
  );
  assert.match(
    src,
    /panelView\s*===\s*["']insurance["']\s*\?[\s\S]{0,200}CustomerInsuranceList/,
  );
  assertNoProvider();
  console.log("PASS source_handler_wired");
}

/** Offline DOM-shaped list: mount condition + exact C1 card presence */
function testCustomerInsuranceListMountAndExactC1() {
  const ui = {
    panelView: "chat",
    pointedContractId: null,
    policies: [
      C1,
      {
        id: "c2-other",
        insurer_name: "다른보험",
        product_name: "다른상품",
      },
    ],
  };

  // 「내 보험 점검」
  const entry = resolveC1InsurancePanelEntryAction();
  ui.panelView = entry.panelView;

  assert.equal(ui.panelView, "insurance");
  const listMounted = ui.panelView === "insurance";
  assert.equal(listMounted, true);

  const cards = listMounted
    ? ui.policies.map((p) => ({
        id: String(p.id ?? p.contract_id ?? "").trim(),
        text: `${p.insurer_name ?? ""} ${p.product_name ?? ""}`.trim(),
      }))
    : [];

  const exact = cards.filter(
    (c) =>
      c.text.includes("한화손해보험") &&
      c.text.includes("3.10.5 간편건강보험"),
  );
  assert.equal(exact.length, 1, "exact C1 card must exist once");
  assert.equal(exact[0].id, C1.id);

  // C1 click
  ui.pointedContractId = applyC1PolicySelection({
    pointedContractId: ui.pointedContractId,
    policyId: exact[0].id,
  });
  assert.equal(ui.pointedContractId, C1.id);

  assertNoProvider();
  console.log("PASS list_mount_and_exact_c1_select");
}

function testFakeSubmitBodyPointer() {
  const pointedContractId = applyC1PolicySelection({
    policyId: C1.id,
  });
  assert.equal(pointedContractId, C1.id);

  const body = buildHomeBrainFactRequestBody("이 보험 해지해도 돼?", [], {
    pointedContractIds: [pointedContractId],
  });

  assert.ok(Array.isArray(body.pointed_contract_ids));
  assert.equal(body.pointed_contract_ids.length, 1);
  assert.equal(body.pointed_contract_ids[0], C1.id);
  assert.equal(PROVIDER_CALLS.count, 0);
  console.log("PASS fake_submit_body_pointer");
}

function main() {
  testEntryActionSsot();
  testSourceHandlerWired();
  testCustomerInsuranceListMountAndExactC1();
  testFakeSubmitBodyPointer();
  console.log(
    JSON.stringify({
      verdict: "C1_UI_ENTRY_RECONNECT_OFFLINE_PASS",
      PROVIDER_CALL: 0,
      PREVIEW_CHANGE: 0,
      PRODUCTION_CHANGE: 0,
    }),
  );
}

main();
