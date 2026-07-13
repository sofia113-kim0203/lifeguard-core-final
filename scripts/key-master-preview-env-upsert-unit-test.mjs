/**
 * Unit tests — Preview env upsert race / existence detection (no Vercel calls).
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
assert.equal(previewEnvNameExistsInLsOutput("note about ONE_KEY_CORE_RETURN_JUDGMENT_EXTRA", "ONE_KEY_CORE_RETURN_JUDGMENT"), false);

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
    runVercelImpl(args) {
      calls.push(args.slice());
      const key = args.join(" ");
      const next = plan.shift();
      if (!next) {
        return { ok: false, exit_code: 99, stdout: "", stderr: `unexpected:${key}` };
      }
      return next;
    },
  };
}

// env 존재 → update
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: true, exit_code: 0, stdout: "Updated", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("ONE_KEY_CORE_RETURN_JUDGMENT", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "update");
  assert.equal(mock.calls[1][0], "env");
  assert.equal(mock.calls[1][1], "update");
  assert.equal(mock.calls.length, 2);
}

// env 없음 → add
{
  const mock = mockRunner([
    { ok: true, exit_code: 0, stdout: LS_SAMPLE, stderr: "" },
    { ok: true, exit_code: 0, stdout: "Added", stderr: "" },
  ]);
  const result = upsertPreviewEnvVar("BRAND_NEW_PREVIEW_FLAG", "1", {
    runVercelImpl: mock.runVercelImpl,
  });
  assert.equal(result.action, "add");
  assert.equal(mock.calls[1][1], "add");
}

// env ls 실패 → add하지 않고 hard fail
{
  const mock = mockRunner([
    { ok: false, exit_code: 1, stdout: "", stderr: "ls exploded" },
  ]);
  assert.throws(
    () =>
      upsertPreviewEnvVar("ONE_KEY_CORE_RETURN_JUDGMENT", "1", {
        runVercelImpl: mock.runVercelImpl,
      }),
    /env_ls_preview_failed/,
  );
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0][1], "ls");
}

// add 중 ENV_ALREADY_EXISTS → update 1회
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
  assert.equal(mock.calls[1][1], "add");
  assert.equal(mock.calls[2][1], "update");
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
    /env_add_NEW_KEY_failed/,
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
    /env_update_ONE_KEY_CORE_S1_failed/,
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

// 로그에 env 값·secret 미노출
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
    assert.match(msg, /env_ls_preview_failed/);
    assert.match(msg, /\[redacted\]/);
  }
}

console.log("key-master-preview-env-upsert-unit-test: PASS");
