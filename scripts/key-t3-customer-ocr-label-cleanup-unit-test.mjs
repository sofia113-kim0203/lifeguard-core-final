/**
 * T3-CUSTOMER-OCR-LABEL-CLEANUP — customer-facing labels only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPolicySource } from "../src/lib/policyExplorer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("T3-T1 source label upload_extract → 업로드 문서", () => {
  assert.equal(formatPolicySource("upload_extract"), "업로드 문서");
  assert.notEqual(formatPolicySource("upload_extract"), "문서 추출(OCR)");
});

test("T3-T2 PolicyExplorerSection uses 문서 읽기 정확도 (not OCR 신뢰도)", () => {
  const src = readFileSync(
    join(root, "src/components/PolicyExplorerSection.jsx"),
    "utf8",
  );
  assert.match(src, /label="문서 읽기 정확도"/);
  assert.doesNotMatch(src, /OCR 신뢰도/);
});

test("T3-T3 policyExplorer source map has no OCR customer copy", () => {
  const src = readFileSync(join(root, "src/lib/policyExplorer.js"), "utf8");
  assert.match(src, /upload_extract:\s*"업로드 문서"/);
  assert.doesNotMatch(src, /문서 추출\(OCR\)/);
});

if (!process.exitCode) {
  console.log("T3-CUSTOMER-OCR-LABEL-CLEANUP unit PASS");
}
