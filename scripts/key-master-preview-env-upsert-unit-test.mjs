/**
 * Unit tests — Preview env upsert race / existence detection (no Vercel calls).
 * Values must travel via stdin only — never --value / argv.
 */
import assert from "node:assert/strict";
import {
  previewEnvNameExistsInLsOutput,
  isVercelEnvAlreadyExistsError,
  sanitizeEnvCommandLog,
  upsertPreviewEnvVar,
} from "./key-master-preview-deploy-exec.mjs";

const LS_SAMPLE = `
Vercel CLI 55.0.0
> Environment Variables found for 70sofia113-1918s-projects/lifeguard-core-final

 name                                       value               environments
 ONE_KEY_CORE_S1                            Encrypted           Preview
 ONE_KEY_CORE_RETURN_JUDGMENT               Encrypted           Preview
 KEY_BORROWED_SENSES                        Encrypted           Preview

Common next commands:
- vercel env add
`;

assert.equal(previewEnvNameExistsInLsOutput(LS_SAMPLE, "ONE_KEY_CORE_RETURN_JUDGMENT"), true);
assert.equal(previewEnvNameExistsInLsOutput(LS_SAMPLE, "ONE_KEY_CORE_S1"), true);
assert.equal(previewEnvNameExistsInLsOutput(LS_SAMPLE, "MISSING_KEY"), false);
// loose substring must not count as existence
assert.equal(
  previewEnvNameExistsInLsOutput(
    "note about ONE_KEY_CORE_RETURN_JUDGMENT_EXTRA",
    "ONE_KEY_CORE_RETURN_JUDGMENT",
  ),
  false,
);

assert.equal(
  isVercelEnvAlreadyExistsError(
    "Error: Another Environment Variable with the same Name and Environment exists in your project.",
  ),
  true,
);
assert.equal(isVercelEnvAlreadyExistsError('{"error":{"code":"ENV_ALREADY_EXISTS"}}'), true);
assert.equal(isVercelEnvAlreadyExistsError("network timeout"), false);

const secret = "super-secret-token-value";
const sanitized = sanitizeEnvCommandLog(
  `Saving...\n--value ${secret}\nError: boom`,
  [secret],
);
assert.equal(sanitized.includes(secret), false);
assert.match(sanitized, /\[redacted\]/);

function mockRunner(plan) {
  const calls = [];
  return {
    calls,
    runVercelImpl(args, options = {}) {
      calls.push({
        args: args.slice(),
        options: { ...options },
      });
      const key = args.join(" ");
      const next = plan.shift();
      if (!next) {
        return { ok: false, exit_code: 99, stdout: "", stderr: `unexpected:${key}` };
      }
      return next;
    },
  };
}

function assertNoValueInArgs(call) {
  assert.ok(call && Array.isArray(call.args));
  assert.equal(call.args.includes("--value"), false);
  for (const a of call.args) {
    assert.equal(String(a).includes("--value"), false);
  }
}

function assertStdinOnce(call, expectedValue) {
  assert.equal(call.options?.stdinText, expectedValue);
  // Exactly one delivery on this call — raw value (newline added inside real runVercel).
  assert.equal(Object.prototype.hasOwnProperty.call(call.options ?? {}, "stdinText"), true);
}

// env 존재 → update (no --value; stdin once)
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: true, exit_code: 0, stdout: "Updated", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("ONE_KEY_CORE_RETURN_JUDGMENT", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "update");
  assert.equal(mock.calls[1].args[0], "env");
  assert.equal(mock.calls[1].args[1], "update");
  assertNoValueInArgs(mock.calls[1]);
  assertStdinOnce(mock.calls[1], "1");
  assert.equal(mock.calls.length, 2);
  // ls has no stdin secret
  assert.equal(mock.calls[0].options?.stdinText, undefined);
}

// env 없음 → add (stdin, no argv value)
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: true, exit_code: 0, stdout: "Added", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("BRAND_NEW_PREVIEW_FLAG", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "add");
  assert.equal(mock.calls[1].args[1], "add");
  assertNoValueInArgs(mock.calls[1]);
  assertStdinOnce(mock.calls[1], "1");
}

// 특수문자 값 → args·로그에 없음
{
  const weird = `a b"c&|<>^%!`;
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: true, exit_code: 0, stdout: "Updated", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("ONE_KEY_CORE_S1", weird, {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "update");
  assertNoValueInArgs(mock.calls[1]);
  assertStdinOnce(mock.calls[1], weird);
  const dumped = JSON.stringify(mock.calls.map((c) => c.args));
  assert.equal(dumped.includes(weird), false);
  assert.equal(dumped.includes("--value"), false);
}

// env ls 실패 → add하지 않고 hard fail (name + exit only)
{
  const mock = mockRunner([
    { ok: false, exit_code: 1, stdout: "", stderr: "ls exploded" },
  ]);
  assert.throws(
    () =>
      upsertPreviewEnvVar("ONE_KEY_CORE_RETURN_JUDGMENT", "1", {
        runVercelImpl: mock.runVercelImpl,
      }),
    (err) => {
      const msg = String(err?.message ?? err);
      assert.match(msg, /env_ls_preview_failed:exit=1$/);
      assert.equal(msg.includes("ls exploded"), false);
      return true;
    },
  );
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].args[1], "ls");
}

// add 중 ENV_ALREADY_EXISTS → update 1회 (both via stdin)
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: "name\n OTHER_KEY Encrypted Preview\n", stderr: "" },
    {
      ok: false,
      exit_code: 1,
      stdout: "Error: Another Environment Variable with the same Name and Environment exists",
      stderr: "",
    },
    { ok: true, exit_code: 0, stdout: "Updated after race", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("RACE_KEY", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "update_after_add_conflict");
  assert.equal(mock.calls[1].args[1], "add");
  assert.equal(mock.calls[2].args[1], "update");
  assertNoValueInArgs(mock.calls[1]);
  assertNoValueInArgs(mock.calls[2]);
  assertStdinOnce(mock.calls[1], "1");
  assertStdinOnce(mock.calls[2], "1");
  assert.equal(mock.calls.length, 3);
}

// add의 다른 오류 → hard fail (no update retry)
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: "name\n", stderr: "" },
    { ok: false, exit_code: 1, stdout: "", stderr: "permission denied" },
  ]);
  assert.throws(
    () =>
      upsertPreviewEnvVar("NEW_KEY", "1", {
        runVercelImpl: mock.runVercelImpl,
      }),
    /env_add_NEW_KEY_failed:exit=1$/,
  );
  assert.equal(mock.calls.length, 2);
}

// update 실패 → hard fail
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: false, exit_code: 1, stdout: "update blew up", stderr: "" },
  ]);
  assert.throws(
    () =>
      upsertPreviewEnvVar("ONE_KEY_CORE_S1", "1", {
        runVercelImpl: mock.runVercelImpl,
      }),
    /env_update_ONE_KEY_CORE_S1_failed:exit=1$/,
  );
}

// stdout에만 오류 문구가 있어도 원인 판별 가능 (conflict)
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: "name\n", stderr: "" },
    {
      ok: false,
      exit_code: 1,
      stdout: '{"error":{"code":"ENV_ALREADY_EXISTS","message":"exists"}}',
      stderr: "",
    },
    { ok: true, exit_code: 0, stdout: "ok", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("ONLY_STDOUT_CONFLICT", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "update_after_add_conflict");
}

// 실패 보고: 값·stdout·stderr 미노출 (이름 + exit만)
{
  const secretVal = "do-not-leak-this-secret-xyz";
  const mock = mockRunner([
    { ok: false, exit_code: 2, stdout: `leak:${secretVal}`, stderr: `--value ${secretVal}` },
  ]);
  try {
    upsertPreviewEnvVar("ANY", secretVal, { runVercelImpl: mock.runVercelImpl });
    assert.fail("expected throw");
  } catch (err) {
    const msg = String(err?.message ?? err);
    assert.equal(msg.includes(secretVal), false);
    assert.match(msg, /^env_ls_preview_failed:exit=2$/);
    assert.equal(msg.includes("leak:"), false);
    assert.equal(msg.includes("--value"), false);
  }
}

console.log("key-master-preview-env-upsert-unit-test: PASS");
