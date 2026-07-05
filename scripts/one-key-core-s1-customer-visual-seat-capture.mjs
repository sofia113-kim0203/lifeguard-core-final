/**
 * ONE KEY Core S1 — customer visual seat (3 questions · Tom observation · no PASS).
 *
 * Usage:
 *   node scripts/one-key-core-s1-customer-visual-seat-capture.mjs [preview-url|http://localhost:3000]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT_DIR = join(FIX, "one-key-core-s1-customer-visual-seat");
const OUT_JSON = join(FIX, "one-key-core-s1-customer-visual-seat-evidence.json");

const QUESTIONS = [
  { id: "q1", text: "내 보험 괜찮아?", waitPattern: "보험|괜찮|확인|등록|말씀" },
  { id: "q2", text: "암보험 부족해?", waitPattern: "암|부족|보장|확인|말씀" },
  { id: "q3", text: "그냥 추천해줘", waitPattern: "추천|보장|구조|함께|말씀" },
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveEnv(previewBaseArg = "") {
  return {
    previewBase: String(previewBaseArg || process.env.PREVIEW_BASE || "").replace(/\/$/, ""),
    bypass: resolveBypassSecret(),
    email: process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "",
    password: process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "",
  };
}

function bypassEntryUrl(base, bypass) {
  const u = new URL(base);
  u.searchParams.set("x-vercel-set-bypass-cookie", "true");
  u.searchParams.set("x-vercel-protection-bypass", bypass);
  return u.toString();
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("BLOCKED — install playwright: npm i -D playwright && npx playwright install chromium");
    process.exit(1);
  }
}

const KEY_WAIT_ACK_RE = /^말씀 주신 내용 잘 받았어요\.?\s*함께 확인해 볼게요\.?$/;

async function waitForFullAssistantAnswer(page, question, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const answerText = await page.evaluate(() => {
      const candidates = [];
      for (const node of document.querySelectorAll("div")) {
        const text = (node.textContent ?? "").trim().replace(/\s+/g, " ");
        if (text.length < 24 || text.length > 2200) continue;
        if (/로그인|질문 입력|보내기|내 문서|업로드/.test(text) && text.length < 100) continue;
        candidates.push(text);
      }
      return candidates.length ? candidates[candidates.length - 1] : "";
    });
    const normalized = String(answerText).replace(/\s+/g, " ").trim();
    if (normalized.length >= 40 && !KEY_WAIT_ACK_RE.test(normalized)) {
      return normalized;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`full_answer_timeout for question: ${question}`);
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim().replace(/\/$/, "") : "";
  const env = resolveEnv(previewBaseArg);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(env.previewBase);

  if (!env.previewBase || !env.email || !env.password || (!isLocal && !env.bypass)) {
    console.error("BLOCKED — base URL, bypass (non-local), QA_EMAIL, QA_PASSWORD required");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();

  const evidence = {
    schema_version: "one-key-core-s1-customer-visual-seat-v1",
    pass_declaration: "none — Tom observation only",
    observed_at: new Date().toISOString(),
    preview_base: env.previewBase,
    is_local_dev: isLocal,
    tom_checks: {
      one_key_answers_on_screen: false,
      key_meets_customer_first_feel: null,
      answer_not_too_weak_feel: null,
    },
    questions: [],
    error: null,
  };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    if (isLocal) {
      await page.goto(env.previewBase, { waitUntil: "networkidle", timeout: 90_000 });
    } else {
      await page.goto(bypassEntryUrl(env.previewBase, env.bypass), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.goto(env.previewBase, { waitUntil: "networkidle", timeout: 90_000 });
    }

    const loginBtn = page.getByRole("button", { name: "로그인", exact: true });
    if (await loginBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await page.locator('input[type="email"]').first().fill(env.email);
      await page.locator('input[type="password"]').first().fill(env.password);
      await loginBtn.click();
    }

    await page.getByLabel("질문 입력").waitFor({ state: "visible", timeout: 90_000 });

    for (const q of QUESTIONS) {
      const shotPath = join(OUT_DIR, `${q.id}-${q.text.replace(/[^\w가-힣]+/g, "-").slice(0, 24)}.png`);
      await page.getByLabel("질문 입력").fill("");
      await page.getByLabel("질문 입력").fill(q.text);
      await page.getByRole("button", { name: "보내기" }).click();
      const answerText = await waitForFullAssistantAnswer(page, q.text);
      await page.screenshot({ path: shotPath, fullPage: true });
      evidence.questions.push({
        question: q.text,
        answer_preview: String(answerText).replace(/\s+/g, " ").trim().slice(0, 280),
        answer_visible_on_screen: Boolean(answerText),
        screenshot: shotPath.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, ""),
      });
      evidence.tom_checks.one_key_answers_on_screen = evidence.questions.every((row) => row.answer_visible_on_screen);
      await page.waitForTimeout(1500);
    }

    const combined = evidence.questions.map((r) => r.answer_preview).join(" ");
    evidence.tom_checks.key_meets_customer_first_feel = /말씀|함께|확인|우선|걱정|맥락/.test(combined);
    evidence.tom_checks.answer_not_too_weak_feel = combined.length >= 120 && !/죄송합니다\.?$/.test(combined);
  } catch (err) {
    evidence.error = String(err?.message ?? err);
    const failShot = join(OUT_DIR, "99-failure-state.png");
    await page.screenshot({ path: failShot, fullPage: true }).catch(() => {});
    evidence.failure_screenshot = failShot.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "");
  } finally {
    await browser.close();
  }

  writeFileSync(OUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: !evidence.error, out: OUT_JSON, checks: evidence.tom_checks }, null, 2));
  process.exit(evidence.error ? 1 : 0);
}

main();
