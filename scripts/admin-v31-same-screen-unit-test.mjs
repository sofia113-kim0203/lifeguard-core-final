/**
 * Admin Full-Shell V3.1 — same chrome gates as /agent. Source only; no Preview/DB mutate.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("admin-v31-same-screen-unit-test");

const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
const shell = readFileSync(join(ROOT, "src/components/AdminV31Shell.jsx"), "utf8");
const left = readFileSync(join(ROOT, "src/components/KeyAdminLeftRail.jsx"), "utf8");
const right = readFileSync(join(ROOT, "src/components/KeyAdminRightRail.jsx"), "utf8");
const panels = readFileSync(join(ROOT, "src/lib/adminV31Panels.jsx"), "utf8");
const assign = readFileSync(join(ROOT, "src/components/AdminAgentAssignmentPanel.jsx"), "utf8");
const agentChat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
const agentLeft = readFileSync(join(ROOT, "src/components/KeyAgentLeftRail.jsx"), "utf8");

test("ROUTE /admin uses Admin V3.1 shell before dark backoffice", () => {
  assert.match(app, /isAdminV31ShellPath/);
  assert.match(app, /userRole === APP_ROLES\.ADMIN && normalizeAppPath\(appPath\) === "\/admin"/);
  assert.match(app, /AdminV31Shell/);
  assert.match(app, /requiredRoles=\{\["admin"\]\}/);
  const adminIdx = app.search(/isAdminV31ShellPath/);
  const darkIdx = app.search(/linear-gradient\(145deg, #0b1220/);
  assert.ok(adminIdx >= 0 && darkIdx > adminIdx, "Admin V3.1 before dark shell");
});

test("AGENT and CUSTOMER routes unchanged by admin shell", () => {
  assert.match(app, /isAgentV31ShellPath/);
  assert.match(app, /audience="agent"/);
  assert.match(app, /userRole === APP_ROLES\.CUSTOMER/);
  assert.match(app, /CustomerLifeguardShell/);
  assert.doesNotMatch(agentChat, /AdminV31Shell|KeyAdminLeftRail/);
  assert.doesNotMatch(agentLeft, /관리자 메뉴/);
});

test("Admin shell reuses FINAL_UI chrome tokens — bright, single header", () => {
  assert.match(shell, /lg-final-shell/);
  assert.match(shell, /lg-v31-shell-header/);
  assert.match(shell, /lg-v31-center-brand-mark/);
  assert.match(shell, /LIFEGUARD/);
  assert.match(shell, /FINAL_UI\.leftColPx/);
  assert.match(shell, /FINAL_UI\.rightColPx/);
  assert.match(shell, /FINAL_UI\.headerPx/);
  assert.match(shell, /FINAL_UI\.gutterPx/);
  assert.match(shell, /FINAL_UI\.roomInlinePx/);
  assert.match(shell, /FINAL_UI\.bodyGapPx/);
  assert.match(shell, /FINAL_UI\.emptyActionPadTopPx/);
  assert.match(shell, /FINAL_UI\.cardPadX/);
  assert.match(shell, /FINAL_UI_ROOM_CSS/);
  assert.doesNotMatch(shell, /#0b1220|linear-gradient\(145deg, #0b1220/);
  assert.doesNotMatch(shell, /개인\+|selectPersonalScope|viewMode/);
  assert.doesNotMatch(shell, /padding:\s*"16px 18px"/);
  assert.doesNotMatch(shell, /maxWidth:\s*`\$\{FINAL_UI\.centerColPx\}px`/);
  // Single brand mark — no second LIFEGUARD title block outside header center.
  const brandHits = shell.match(/>\s*LIFEGUARD\s*</g) || [];
  assert.equal(brandHits.length, 1, "exactly one LIFEGUARD brand mark");
});

test("Header user chip is 관리자; left menu has required admin ops", () => {
  assert.match(shell, /관리자/);
  assert.match(shell, /lg-admin-key-badge/);
  assert.match(left, /관리자 메뉴/);
  assert.match(left, /heroGradient/);
  assert.match(left, /ADMIN_V31_PRIMARY_MENU/);
  assert.match(left, /ADMIN_V31_OPS_GROUPS/);
  assert.match(left, /lg-admin-ops-group/);
  assert.match(left, /aria-expanded/);
  assert.match(left, /railStackGapPx/);
  assert.match(left, /overflowY:\s*"auto"/);
  assert.match(panels, /label: "고객"/);
  assert.match(panels, /label: "설계사"/);
  assert.match(panels, /label: "배정 관리"/);
  assert.match(panels, /label: "동의·연결 상태"/);
  assert.match(panels, /ADMIN_V31_PRIMARY_MENU/);
  assert.match(panels, /ADMIN_V31_OPS_GROUPS/);
});

test("Right rail shows selection / assignment / consent / result slots", () => {
  assert.match(right, /현재 선택/);
  assert.match(right, /배정 상태/);
  assert.match(right, /동의·연결/);
  assert.match(right, /작업 결과/);
  assert.match(right, /borderRadius:\s*"18px"/);
  assert.match(right, /linear-gradient\(160deg, #EAF3FB/);
});

test("Existing admin panels + assignment API wired; light tone only for V3.1", () => {
  assert.match(panels, /AdminAgentAssignmentPanel/);
  assert.match(panels, /ADMIN_V31_DEFAULT_PANEL = "agent_assignment"/);
  assert.match(shell, /tone:\s*"light"/);
  assert.match(shell, /onWorkspaceMeta/);
  assert.match(assign, /tone === "light"/);
  assert.match(assign, /onWorkspaceMeta/);
  assert.match(assign, /postAdminAssignmentAction/);
  assert.match(assign, /loadAdminAssignmentOptions/);
  assert.match(assign, /loadAdminLiveAssignments/);
  assert.match(assign, /finally\s*\{/);
  assert.match(assign, /AUTH_REQUIRED|OPTIONS_EXCEPTION/);
  assert.match(assign, /data-admin-assignment-load-reason/);
});

test("No stray adminV31Panels.js JSX file", () => {
  assert.equal(existsSync(join(ROOT, "src/lib/adminV31Panels.js")), false);
  assert.equal(existsSync(join(ROOT, "src/lib/adminV31Panels.jsx")), true);
});

console.log(`\n${passed} passed`);
