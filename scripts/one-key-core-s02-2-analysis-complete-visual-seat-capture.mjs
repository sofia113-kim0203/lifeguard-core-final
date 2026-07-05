/**
 * ONE KEY Core S02-2 — analysis_complete initiative bubble visual (no PASS).
 *
 * Usage:
 *   node scripts/one-key-core-s02-2-analysis-complete-visual-seat-capture.mjs [preview-url]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import { filterLeafChatBubbles } from "./lib/p5-b-bridge-seat-extract.mjs";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT_DIR = join(FIX, "one-key-core-s02-2-analysis-complete-visual-seat");
const OUT_JSON = join(FIX, "one-key-core-s02-2-analysis-complete-visual-seat-evidence.json");
const FIXTURE_PDF = join(ROOT, "scripts/samples/korean-insurance/ko-policy-certificate-rich.png");

const P3_UPLOAD_PATTERN = /올려\s*주신\s*자료를\s*받았|받았습니다/;
const P4_INITIATIVE_PATTERN = /살펴봤|찾아왔|같이\s*짚|같이\s*보면/;

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
  return import("playwright");
}

async function extractChatBubbleTexts(page) {
  return page.evaluate(() => {
    const texts = [];
    for (const node of document.querySelectorAll("div")) {
      const text = (node.textContent ?? "").trim().replace(/\s+/g, " ");
      if (text.length >= 24 && text.length <= 2200) texts.push(text);
    }
    return texts;
  });
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim().replace(/\/$/, "") : "";
  const env = resolveEnv(previewBaseArg);

  if (!env.previewBase || !env.bypass || !env.email || !env.password) {
    console.error("BLOCKED — preview URL, bypass, QA creds required");
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const evidence = {
    schema_version: "one-key-core-s02-2-analysis-complete-visual-seat-v1",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    preview_base: env.previewBase,
    document_beat_sentence: null,
    analysis_complete_initiative_sentence: null,
    screenshot: null,
  };

  try {
    await page.goto(bypassEntryUrl(env.previewBase, env.bypass), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.goto(env.previewBase, { waitUntil: "networkidle", timeout: 90_000 });
    const loginBtn = page.getByRole("button", { name: "로그인", exact: true });
    if (await loginBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await page.locator('input[type="email"]').first().fill(env.email);
      await page.locator('input[type="password"]').first().fill(env.password);
      await loginBtn.click();
    }
    await page.getByLabel("질문 입력").waitFor({ state: "visible", timeout: 90_000 });

    const newChatBtn = page.getByRole("button", { name: "새 대화" });
    if (await newChatBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newChatBtn.click();
      await page.waitForTimeout(1500);
    }

    const baseline = new Set(await extractChatBubbleTexts(page));
    await page.getByRole("button", { name: "내 문서" }).click();
    await page.getByRole("heading", { name: "문서 업로드" }).waitFor({ state: "visible", timeout: 30_000 });
    for (const label of [/동의/, /분석/]) {
      const btn = page.getByRole("button", { name: label });
      if (await btn.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
        await btn.first().click();
        await page.waitForTimeout(1500);
      }
    }
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await page.getByRole("button", { name: "업로드" }).click();
    await page.waitForTimeout(3000);

    const questionInput = page.getByLabel("질문 입력");
    if (await questionInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await questionInput.waitFor({ state: "visible", timeout: 180_000 });
    }

    const started = Date.now();
    let documentBubble = null;
    let initiativeBubble = null;
    while (Date.now() - started < 300_000) {
      const current = await extractChatBubbleTexts(page);
      const novel = filterLeafChatBubbles(current.filter((t) => !baseline.has(t)));
      if (!documentBubble) {
        documentBubble = novel.find((t) => P3_UPLOAD_PATTERN.test(t));
      }
      const initiativeCandidates = novel.filter((t) => P4_INITIATIVE_PATTERN.test(t) && !P3_UPLOAD_PATTERN.test(t.slice(0, 40)));
      if (initiativeCandidates.length > 0) {
        initiativeBubble = initiativeCandidates[initiativeCandidates.length - 1];
        break;
      }
      if (documentBubble && Date.now() - started > 120_000) {
        const lateNovel = filterLeafChatBubbles(current.filter((t) => !baseline.has(t) && t !== documentBubble));
        initiativeBubble = lateNovel.find((t) => P4_INITIATIVE_PATTERN.test(t)) ?? null;
        if (initiativeBubble) break;
      }
      await page.waitForTimeout(3000);
    }

    evidence.document_beat_sentence = documentBubble;
    evidence.analysis_complete_initiative_sentence = initiativeBubble;

    const shotPath = join(OUT_DIR, "01-document-and-analysis-complete-bubbles.png");
    await page.screenshot({ path: shotPath, fullPage: false });
    evidence.screenshot = shotPath.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "");

    writeFileSync(OUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("analysis_complete_initiative_sentence:", initiativeBubble?.slice(0, 240) ?? "NOT_FOUND");
    console.log(`Wrote ${OUT_JSON}`);
  } finally {
    await browser.close();
  }
}

await main();
