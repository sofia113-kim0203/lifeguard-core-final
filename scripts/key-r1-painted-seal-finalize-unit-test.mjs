/**
 * Train R1 — painted vs seal finalize (fail-closed seal preferred only on monopoly failure).
 * No network / Claude / React mount.
 */
import assert from "node:assert/strict";
import {
  KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
  createAgentStreamPaintController,
  resolveCustomerStreamFinalizeInput,
  shouldPreferSealOverPainted,
} from "../src/lib/agentKeyChatStreamPaint.js";

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`PASS ${name}`))
        .catch((err) => {
          console.error(`FAIL ${name}`);
          console.error(err);
          process.exitCode = 1;
        });
    }
    console.log(`PASS ${name}`);
    return undefined;
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
    return undefined;
  }
}

function syncRaf() {
  const queue = [];
  return {
    raf: (cb) => {
      const id = queue.length + 1;
      queue.push(cb);
      queueMicrotask(() => {
        const i = queue.indexOf(cb);
        if (i >= 0) {
          queue.splice(i, 1);
          cb(Date.now());
        }
      });
      return id;
    },
    caf: (id) => {
      /* best-effort; microtask may still run */
      void id;
    },
    async flush(times = 40) {
      for (let i = 0; i < times; i += 1) {
        await Promise.resolve();
        if (queue.length === 0) break;
        const cb = queue.shift();
        cb?.(Date.now());
      }
    },
  };
}

const jobs = [];

jobs.push(
  test("R1-T1 failure + divergent → finalize input and paint = seal", async () => {
    const paintedNow = "월 납입보험료는 999만원입니다.";
    const sealedText = KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT;
    assert.equal(
      shouldPreferSealOverPainted({
        keyMonopolyFailure: true,
        sealedText,
      }),
      true,
    );
    const finalizeInput = resolveCustomerStreamFinalizeInput({
      paintedNow,
      sealedText,
      preferSeal: true,
    });
    assert.equal(finalizeInput, sealedText);

    const paints = [];
    const { raf, caf } = syncRaf();
    const paint = createAgentStreamPaintController({
      onPaint: (text) => paints.push(text),
      raf,
      caf,
    });
    paint.append(paintedNow);
    const seen = await paint.finalize(finalizeInput, { preferSeal: true });
    assert.equal(seen, sealedText);
    assert.equal(paint.getPainted(), sealedText);
    assert.equal(paints.at(-1), sealedText);
  }),
);

jobs.push(
  test("R1-T2 normal continuation → append-only (preferSeal false)", async () => {
    const paintedNow = "확인된 계약은 2건입니다.";
    const sealedText = "확인된 계약은 2건입니다. 이어서 볼게요.";
    assert.equal(
      shouldPreferSealOverPainted({
        keyMonopolyFailure: false,
        sealedText,
      }),
      false,
    );
    const finalizeInput = resolveCustomerStreamFinalizeInput({
      paintedNow,
      sealedText,
      preferSeal: false,
    });
    assert.equal(finalizeInput, sealedText);

    const { raf, caf, flush } = syncRaf();
    const paint = createAgentStreamPaintController({
      onPaint: () => {},
      raf,
      caf,
    });
    paint.append(paintedNow);
    const p = paint.finalize(finalizeInput, { preferSeal: false });
    await flush(80);
    const seen = await p;
    assert.equal(seen, sealedText);
    assert.ok(seen.startsWith(paintedNow));
  }),
);

jobs.push(
  test("R1-T3 normal divergent (non-failure) → painted kept", async () => {
    const paintedNow = "화면에 이미 나온 문장입니다.";
    const sealedText = "서버 seal은 다른 문장입니다.";
    assert.equal(
      shouldPreferSealOverPainted({
        keyMonopolyFailure: false,
        sealedText,
      }),
      false,
    );
    const finalizeInput = resolveCustomerStreamFinalizeInput({
      paintedNow,
      sealedText,
      preferSeal: false,
    });
    assert.equal(finalizeInput, paintedNow);

    const { raf, caf } = syncRaf();
    const paint = createAgentStreamPaintController({
      onPaint: () => {},
      raf,
      caf,
    });
    paint.append(paintedNow);
    const seen = await paint.finalize(finalizeInput, { preferSeal: false });
    assert.equal(seen, paintedNow);
    assert.equal(paint.getPainted(), paintedNow);
  }),
);

jobs.push(
  test("R1-T1b failure text alone (flag false) still preferSeal", () => {
    assert.equal(
      shouldPreferSealOverPainted({
        keyMonopolyFailure: false,
        sealedText: KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
      }),
      true,
    );
  }),
);

await Promise.all(jobs.filter(Boolean));

if (process.exitCode) {
  console.error("R1 painted-seal finalize unit tests FAILED");
  process.exit(1);
}
console.log("R1 painted-seal finalize unit tests PASSED");
