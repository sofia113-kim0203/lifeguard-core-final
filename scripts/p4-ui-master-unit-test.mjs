/**
 * P4-UI MASTER — customer experience unit tests (source/fixture only, no live DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildLifeguardHomeGreeting } from "../src/lib/lifeguardGreeting.js";
import { LG } from "../src/lib/lifeguardCustomerTheme.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("p4-ui-master-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 login — centered brand, no platform marketing", () => {
      const auth = readFileSync(join(ROOT, "src/components/AuthPanel.jsx"), "utf8");
      assert.match(auth, /당신의 보험 파트너/);
      assert.match(auth, /편하게 이야기하세요/);
      assert.match(auth, /import \{ LG \} from/);
      assert.match(readFileSync(join(ROOT, "src/components/CustomerLifeguardShell.jsx"), "utf8"), /LG\.bg/);
      assert.doesNotMatch(auth, /보장 분석|AI 추천|보험 설계|SERVICE_FEATURES/);
      assert.doesNotMatch(auth, /#0d9488|#3b82f6|teal/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 signup — minimal fields only", () => {
      const auth = readFileSync(join(ROOT, "src/components/AuthPanel.jsx"), "utf8");
      assert.match(auth, /LIFEGUARD 시작하기/);
      assert.match(auth, /validateSignupBasicProfile/);
      assert.doesNotMatch(auth, /birthDate|생년월일|gender|성별|jobCategory|직업/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 chat — warm light theme + ChatGPT input", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chat, /LG\.bg/);
      assert.match(chat, /LG\.button|LG\.text/);
      assert.match(chat, /📎|첨부/);
      assert.match(chat, /무엇이든 편하게 물어보세요/);
      assert.doesNotMatch(chat, /#0d9488|0d9488|teal/i);
      assert.doesNotMatch(chat, /linear-gradient\(145deg, #0b1220/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 greeting — memory hook for colonoscopy", () => {
      const withMemory = buildLifeguardHomeGreeting("진우", {
        facts: [{ fact_key: "health.colonoscopy", fact_value: "대장내시경 검사" }],
      });
      assert.equal(withMemory.hasMemoryHook, true);
      assert.match(withMemory.lines.join(" "), /대장내시경/);

      const fresh = buildLifeguardHomeGreeting("진우", null);
      assert.equal(fresh.hasMemoryHook, false);
      assert.match(fresh.lines.join(" "), /오늘은 무엇을 도와드릴까요/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T5 App — logged-out uses customer shell not backoffice", () => {
      const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
      assert.match(app, /!user \|\| userRole === APP_ROLES\.CUSTOMER/);
      assert.match(app, /CustomerLifeguardShell/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T6 theme tokens — forbidden accent colors absent from chat", () => {
      assert.equal(LG.bg, "#FAFAF8");
      assert.equal(LG.text, "#111111");
      assert.equal(LG.button, "#1F2937");
    })
  ) {
    passed += 1;
  } else failed += 1;

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
