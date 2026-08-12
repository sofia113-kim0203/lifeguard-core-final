import { createRequire } from "node:module";
import { bypassEntryUrl } from "./env.mjs";

const KEY_WAIT_ACK_RE =
  /^말씀 주신 내용 잘 받았어요\.?\s*함께 확인해 볼게요\.?$/;
const PROGRESS_RE = /KEY가 확인하고 있어요/;
const MONOPOLY_FAIL_RE =
  /지금은\s*여기까지\s*확인했어요[\s\S]*잠시\s*후\s*다시\s*말씀해\s*주시면/;

export const EXTRACT_LAST_KEY_ASSISTANT_JS = `(() => {
  const out = [];
  for (const span of document.querySelectorAll("span")) {
    if ((span.textContent || "").trim() !== "KEY") continue;
    const header = span.parentElement;
    const column = header && header.parentElement;
    if (!column) continue;
    const contentEl = header.nextElementSibling || column.lastElementChild;
    if (!contentEl || contentEl === header) continue;
    const text = (contentEl.innerText || "").trim();
    if (text) out.push(text);
  }
  return out.length ? out[out.length - 1] : "";
})()`;

const SIDEBAR_RAIL_MARKERS = [
  "돈의 흐름",
  "심사 중 청구",
  "다가오는 날짜",
  "KEY가 기억한 목표",
  "내 자료 금고",
  "올해 받은 보험금",
];

const POLL_MS = 2000;
const STABLE_EQUAL_POLLS_REQUIRED = 2;
const TURN_TIMEOUT_MS = 180_000;

export function normalizeAssistantText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function isAckOnly(text) {
  const n = normalizeAssistantText(text).replace(/\s+/g, " ").trim();
  return n.length > 0 && KEY_WAIT_ACK_RE.test(n);
}

function hasSidebarLeak(text) {
  const s = String(text ?? "");
  return SIDEBAR_RAIL_MARKERS.some((m) => s.includes(m));
}

function isProgressOrWaitAckOnly(text) {
  const t = normalizeAssistantText(text).replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (PROGRESS_RE.test(t)) return true;
  if (isAckOnly(t)) return true;
  return false;
}

async function extractLast(page) {
  return String((await page.evaluate(EXTRACT_LAST_KEY_ASSISTANT_JS)) || "");
}

/** Count KEY assistant bubbles currently painted (isolation UI signal). */
async function countKeyBubbles(page) {
  return Number(
    await page.evaluate(`(() => {
      let n = 0;
      for (const span of document.querySelectorAll("span")) {
        if ((span.textContent || "").trim() !== "KEY") continue;
        const header = span.parentElement;
        const column = header && header.parentElement;
        if (!column) continue;
        const contentEl = header.nextElementSibling || column.lastElementChild;
        if (!contentEl || contentEl === header) continue;
        if ((contentEl.innerText || "").trim()) n += 1;
      }
      return n;
    })()`),
  );
}

/**
 * After 새 대화: wait for UI clear. Does NOT send a product question.
 * Returns ui_clear YES/NO — never silently retries the product test to hide contamination.
 */
async function waitForUiIsolationClear(page, { timeoutMs = 15_000 } = {}) {
  const start = Date.now();
  let lastCount = -1;
  while (Date.now() - start < timeoutMs) {
    lastCount = await countKeyBubbles(page);
    if (lastCount === 0) {
      return { UI_CLEAR: "YES", key_bubble_count: 0, waited_ms: Date.now() - start };
    }
    await page.waitForTimeout(250);
  }
  return {
    UI_CLEAR: "NO",
    key_bubble_count: lastCount,
    waited_ms: Date.now() - start,
  };
}

function summarizeHistoryLen(history) {
  return Array.isArray(history) ? history.length : -1;
}

/**
 * Turn-complete gate for the seat runner.
 * Text-stable alone is insufficient: short A1 ("안녕하세요.") can look stable while
 * SSE is still streaming — then the next Enter is swallowed (loading) and the
 * harness misreads the late A1 paint as A2 greeting-reset.
 *
 * Send-button disabled is also insufficient: after submit the composer is empty,
 * so 보내기 stays disabled even when idle. Use brain-fact inflight + thinking UI.
 */
async function readThinkingVisible(page) {
  return Boolean(
    await page.evaluate(`(() => {
      for (const span of document.querySelectorAll("span")) {
        if ((span.textContent || "").trim() !== "KEY") continue;
        const header = span.parentElement;
        const column = header && header.parentElement;
        if (!column) continue;
        const contentEl = header.nextElementSibling || column.lastElementChild;
        if (!contentEl || contentEl === header) continue;
        const t = (contentEl.innerText || "").trim();
        if (/KEY가 확인하고 있어요/.test(t)) return true;
      }
      return false;
    })()`),
  );
}

async function waitForAnswer(page, baselineText = "", { isBrainInflight } = {}) {
  const start = Date.now();
  let previous = null;
  let equalStreak = 0;
  let lastText = "";
  const baseline = normalizeAssistantText(baselineText);
  const brainBusy =
    typeof isBrainInflight === "function" ? isBrainInflight : () => false;
  while (Date.now() - start < TURN_TIMEOUT_MS) {
    const current = await extractLast(page);
    lastText = current;
    const norm = normalizeAssistantText(current);
    if (!norm || norm === baseline || isProgressOrWaitAckOnly(norm)) {
      previous = null;
      equalStreak = 0;
      await page.waitForTimeout(POLL_MS);
      continue;
    }
    if (
      previous != null &&
      normalizeAssistantText(current) === normalizeAssistantText(previous)
    ) {
      equalStreak += 1;
    } else equalStreak = 0;
    if (
      !hasSidebarLeak(norm) &&
      previous != null &&
      equalStreak >= STABLE_EQUAL_POLLS_REQUIRED &&
      norm.length <= normalizeAssistantText(previous).length
    ) {
      const thinking = await readThinkingVisible(page);
      if (thinking || brainBusy()) {
        // Still in flight — keep waiting; do not hand off to the next turn.
        equalStreak = 0;
        previous = current;
        await page.waitForTimeout(POLL_MS);
        continue;
      }
      return { answer: normalizeAssistantText(current), ok: true };
    }
    previous = current;
    await page.waitForTimeout(POLL_MS);
  }
  return {
    answer: isProgressOrWaitAckOnly(lastText)
      ? ""
      : normalizeAssistantText(lastText),
    ok: false,
  };
}

/**
 * Live seat: login → composer → turns → transcript rows.
 * Stops before first question if LOGIN/COMPOSER fail (HARNESS).
 */
export async function runSeatEngine({
  repoRoot,
  url,
  bypass,
  email,
  password,
  turns,
  sourceSha,
  deploymentId,
  target,
}) {
  const require = createRequire(import.meta.url);
  const playwrightPath = require.resolve("playwright", {
    paths: [repoRoot, process.cwd()],
  });
  const { chromium } = require(playwrightPath);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "x-vercel-protection-bypass": bypass },
  });
  const page = await context.newPage();
  const result = {
    SOURCE_SHA: sourceSha,
    DEPLOYMENT_ID: deploymentId,
    TARGET: target,
    URL: url,
    LOGIN: "NOT_RUN",
    COMPOSER: "NOT_RUN",
    turns: [],
    TEST_COMPLETE: "NO",
    FIRST_BREAK: null,
    FAIL_DOMAIN: null,
  };

  try {
    await page.goto(bypassEntryUrl(url, bypass), {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForTimeout(1000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });

    const loginBtn = page.getByRole("button", { name: "로그인", exact: true });
    if (await loginBtn.isVisible({ timeout: 12_000 }).catch(() => false)) {
      await page.getByRole("textbox", { name: "이메일" }).fill(email);
      await page.getByRole("textbox", { name: "비밀번호" }).fill(password);
      await loginBtn.click();
      await page.waitForTimeout(2000);
      const body = await page.evaluate(() =>
        String(document.body?.innerText || "").slice(0, 400),
      );
      if (/이메일 또는 비밀번호가 맞지 않습니다/.test(body)) {
        result.LOGIN = "FAIL";
        result.FIRST_BREAK = "LOGIN_CREDENTIAL_REJECTED";
        result.FAIL_DOMAIN = "HARNESS";
        result.PRODUCT_TEST = "NOT_STARTED";
        return result;
      }
    }
    result.LOGIN = "PASS";

    const composer = page.getByLabel("질문 입력");
    try {
      await composer.waitFor({ state: "visible", timeout: 90_000 });
      result.COMPOSER = "PASS";
    } catch {
      result.COMPOSER = "FAIL";
      result.FIRST_BREAK = "COMPOSER_NOT_FOUND";
      result.FAIL_DOMAIN = "HARNESS";
      result.PRODUCT_TEST = "NOT_STARTED";
      return result;
    }

    const newChatBtn = page.getByRole("button", { name: "새 대화", exact: true });
    const menuOpenBtn = page.getByRole("button", { name: "메뉴 열기" });
    async function clickNewChat(reason) {
      // Sidebar may be closed in default viewport — open menu first when present.
      if (await menuOpenBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await menuOpenBtn.click().catch(() => {});
        await page.waitForTimeout(400);
      }
      if (await newChatBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await newChatBtn.click();
        await page.waitForTimeout(1000);
        await composer.waitFor({ state: "visible", timeout: 30_000 });
        return { ok: true, reason, path: "NEW_CHAT_BUTTON" };
      }
      // Proven fallback from prior Production 9-seat harness: reload home entry.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(800);
      await composer.waitFor({ state: "visible", timeout: 90_000 });
      return { ok: true, reason, path: "RELOAD_HOME_FALLBACK" };
    }

    // Fresh chat before first question when button exists; empty landing is OK.
    const firstIso = await clickNewChat("SUITE_START");
    result.isolation_events = [
      {
        when: "before_first_turn",
        NEW_CHAT_CLICKED: firstIso.ok ? "YES" : "NO",
        isolation_path: firstIso.path || null,
        reason: firstIso.reason,
        error: firstIso.error || null,
        note: firstIso.ok
          ? "clicked"
          : "button_absent_ok_if_composer_ready_empty_session",
      },
    ];

    // Isolation gate: UI clear + first request history must be 0. Never mask contamination.
    const uiGate = await waitForUiIsolationClear(page);
    result.isolation_events.push({
      when: "ui_clear_gate_before_first_question",
      ...uiGate,
    });
    if (uiGate.UI_CLEAR !== "YES") {
      result.FIRST_BREAK = "ISOLATION_UI_NOT_CLEARED";
      result.FAIL_DOMAIN = "HOLD";
      result.ROOT_CLASS = "NEW_CHAT_UI_STILL_HAS_BUBBLES";
      result.PRODUCT_TEST = "NOT_STARTED";
      return result;
    }

    let pendingHistoryProbe = null;
    const onBrainRequest = (req) => {
      try {
        if (req.method() !== "POST") return;
        if (!/customer-home-brain-fact/.test(req.url())) return;
        if (pendingHistoryProbe == null) return;
        const raw = req.postData() || "";
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
        pendingHistoryProbe = {
          question: String(body?.question || "").slice(0, 80),
          history_length: summarizeHistoryLen(body?.history),
          captured: true,
        };
      } catch {
        /* ignore */
      }
    };
    page.on("request", onBrainRequest);

    // Last SSE done meta (failure_reason) — for stub locate only; no secrets.
    let lastBrainDoneMeta = null;
    const onBrainResponse = async (res) => {
      try {
        const req = res.request();
        if (!isBrainReq(req)) return;
        const text = await res.text();
        const blocks = String(text || "").split(/\n\n/);
        for (const block of blocks) {
          if (!/event:\s*done/i.test(block)) continue;
          const dataLine = block
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim() || "{}");
          lastBrainDoneMeta = {
            key_monopoly_failure: payload?.key_monopoly_failure === true,
            failure_reason:
              payload?.failure_reason != null
                ? String(payload.failure_reason).slice(0, 200)
                : null,
            compose_mode:
              payload?.salesDirectorTrace?.compose_mode ??
              payload?.compose_mode ??
              null,
          };
        }
      } catch {
        /* ignore parse / body races */
      }
    };

    // Track in-flight home-brain POSTs so waitForAnswer does not end mid-stream.
    let brainInflight = 0;
    const isBrainReq = (req) =>
      req.method() === "POST" && /customer-home-brain-fact/.test(req.url());
    const onBrainStart = (req) => {
      if (isBrainReq(req)) brainInflight += 1;
    };
    const onBrainEnd = (req) => {
      if (isBrainReq(req)) brainInflight = Math.max(0, brainInflight - 1);
    };
    page.on("request", onBrainStart);
    page.on("requestfinished", onBrainEnd);
    page.on("requestfailed", onBrainEnd);
    page.on("response", onBrainResponse);
    const isBrainInflight = () => brainInflight > 0;
    const detachBrainLifecycle = () => {
      page.off("request", onBrainStart);
      page.off("requestfinished", onBrainEnd);
      page.off("requestfailed", onBrainEnd);
      page.off("response", onBrainResponse);
    };

    result.PRODUCT_TEST = "STARTED";
    let prevSetId = turns[0]?.set_id || null;
    for (let ti = 0; ti < turns.length; ti += 1) {
      const turn = turns[ti];
      const setId = turn.set_id || null;
      let isolation = {
        SET_ID: setId,
        NEW_CHAT_BEFORE_TURN: "NO",
        NEW_CHAT_OK: null,
      };
      // DAILY / HEART / S9A: new chat when set_id changes (Tom isolation evidence).
      if (ti > 0 && setId && prevSetId && setId !== prevSetId) {
        const iso = await clickNewChat(`SET_BOUNDARY_${prevSetId}_TO_${setId}`);
        isolation.NEW_CHAT_BEFORE_TURN = "YES";
        isolation.NEW_CHAT_OK = iso.ok ? "YES" : "NO";
        isolation.from_set = prevSetId;
        isolation.to_set = setId;
        const boundaryUi = await waitForUiIsolationClear(page);
        result.isolation_events.push({
          when: `before_${turn.label}`,
          NEW_CHAT_CLICKED: iso.path === "NEW_CHAT_BUTTON" ? "YES" : "NO",
          isolation_path: iso.path || null,
          reason: iso.reason,
          error: iso.error || null,
          ...boundaryUi,
        });
        isolation.isolation_path = iso.path || null;
        isolation.UI_CLEAR = boundaryUi.UI_CLEAR;
        if (!iso.ok) {
          result.FIRST_BREAK = `${turn.label}_NEW_CHAT_ISOLATION_FAILED`;
          result.FAIL_DOMAIN = "HARNESS";
          page.off("request", onBrainRequest);
          detachBrainLifecycle();
          return result;
        }
        if (boundaryUi.UI_CLEAR !== "YES") {
          result.FIRST_BREAK = `${turn.label}_ISOLATION_UI_NOT_CLEARED`;
          result.FAIL_DOMAIN = "HOLD";
          result.PRODUCT_TEST = "NOT_STARTED";
          page.off("request", onBrainRequest);
          detachBrainLifecycle();
          return result;
        }
      }
      prevSetId = setId || prevSetId;

      const baseline = await extractLast(page);
      pendingHistoryProbe = { captured: false, history_length: null, question: turn.question };
      await composer.fill(turn.question);
      await page.keyboard.press("Enter");
      // Wait briefly for request capture on first turn / set boundaries.
      const probeDeadline = Date.now() + 8_000;
      while (
        Date.now() < probeDeadline &&
        pendingHistoryProbe &&
        pendingHistoryProbe.captured !== true
      ) {
        await page.waitForTimeout(100);
      }
      const histProbe = pendingHistoryProbe;
      pendingHistoryProbe = null;
      if (ti === 0 || isolation.NEW_CHAT_BEFORE_TURN === "YES") {
        const hLen = histProbe?.history_length;
        result.isolation_events.push({
          when: `request_history_gate_${turn.label}`,
          history_length: hLen,
          ui_clear_before_send: "YES",
        });
        if (typeof hLen === "number" && hLen > 0) {
          // UI clear + non-empty history → PRODUCT candidate (Tom lock path).
          result.FIRST_BREAK = `${turn.label}_ISOLATION_HISTORY_NOT_CLEARED`;
          result.FAIL_DOMAIN = "PRODUCT";
          result.ROOT_CLASS =
            "UI_CLEAR_BUT_CLIENT_REQUEST_HISTORY_NONEMPTY";
          result.PRODUCT_TEST = "NOT_STARTED";
          result.turns.push({
            TURN: turn.label,
            QUESTION: turn.question,
            FINAL_CUSTOMER_VISIBLE_ANSWER: "",
            FINAL_ANSWER_OBSERVED: "NO",
            ISOLATION: {
              ...isolation,
              history_length: hLen,
              GATE: "BLOCKED_CONTAMINATED_HISTORY",
            },
          });
          page.off("request", onBrainRequest);
          detachBrainLifecycle();
          return result;
        }
        if (hLen !== 0) {
          result.FIRST_BREAK = `${turn.label}_ISOLATION_HISTORY_PROBE_MISSING`;
          result.FAIL_DOMAIN = "HOLD";
          result.PRODUCT_TEST = "NOT_STARTED";
          page.off("request", onBrainRequest);
          detachBrainLifecycle();
          return result;
        }
      }

      const waited = await waitForAnswer(page, baseline, { isBrainInflight });
      const answer = waited.answer;
      const row = {
        TURN: turn.label,
        SET_ID: setId,
        QUESTION: turn.question,
        FINAL_CUSTOMER_VISIBLE_ANSWER: answer,
        FINAL_ANSWER_OBSERVED: waited.ok && answer.trim() ? "YES" : "NO",
        TURN_ID: turn.label,
        SOURCE_SHA: sourceSha,
        DEPLOYMENT_ID: deploymentId,
        TARGET: target,
        MONOPOLY_FAILURE: MONOPOLY_FAIL_RE.test(answer) ? "YES" : "NO",
        ISOLATION: isolation,
      };
      result.turns.push(row);
      if (!waited.ok || !answer.trim()) {
        result.FIRST_BREAK = `${turn.label}_NOT_OBSERVED`;
        result.FAIL_DOMAIN = "HARNESS";
        page.off("request", onBrainRequest);
        detachBrainLifecycle();
        return result;
      }
      if (row.MONOPOLY_FAILURE === "YES") {
        result.FIRST_BREAK = `${turn.label}_MONOPOLY_FAILURE_STUB`;
        result.FAIL_DOMAIN = "PRODUCT";
        row.BRAIN_DONE_META = lastBrainDoneMeta;
        result.STUB_FAILURE_REASON =
          lastBrainDoneMeta?.failure_reason ?? null;
        result.STUB_COMPOSE_MODE =
          lastBrainDoneMeta?.compose_mode ?? null;
        page.off("request", onBrainRequest);
        detachBrainLifecycle();
        return result;
      }
      // Extra idle beat before the next turn — A1 must not still own the stream.
      const idleDeadline = Date.now() + 15_000;
      while (Date.now() < idleDeadline) {
        if (!isBrainInflight() && !(await readThinkingVisible(page))) break;
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(400);
    }

    const expected = turns.length;
    const got = result.turns.filter((t) => t.FINAL_ANSWER_OBSERVED === "YES").length;
    result.TEST_COMPLETE = got === expected ? "YES" : "NO";
    if (result.TEST_COMPLETE !== "YES") {
      result.FIRST_BREAK = `INCOMPLETE_${got}_OF_${expected}`;
      result.FAIL_DOMAIN = "HARNESS";
    } else {
      result.FIRST_BREAK = "NONE";
      result.FAIL_DOMAIN = null;
    }
    page.off("request", onBrainRequest);
    detachBrainLifecycle();
    return result;
  } catch (e) {
    result.FIRST_BREAK = String(e?.message || e);
    result.FAIL_DOMAIN = "HARNESS";
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}
