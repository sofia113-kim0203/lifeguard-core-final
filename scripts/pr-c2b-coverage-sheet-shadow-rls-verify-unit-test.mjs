/**
 * Static safety checks for PR-C2b RLS-only shadow QA script.
 */
import { readFileSync } from "node:fs";

const TARGET = "scripts/pr-c2b-coverage-sheet-shadow-rls-verify.mjs";
const DEPRECATED_DIR = "scripts/deprecated/pr-c2-unsafe";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const source = readFileSync(TARGET, "utf8");

let passed = 0;
let failed = 0;

const tests = [
  ["script forbids service role env", () => {
    assert(source.includes("SERVICE_ROLE_KEY must not be set"), "service role guard missing");
    assert(!source.includes("createClient(url, serviceRoleKey"), "service role client missing");
  }],
  ["script requires DOCUMENT_ID", () => {
    assert(source.includes("DOCUMENT_ID is required"), "DOCUMENT_ID guard missing");
  }],
  ["script does not query customer_document_chunks", () => {
    assert(!source.includes('.from("customer_document_chunks")'), "chunks table must not be queried");
    assert(!source.includes(".from('customer_document_chunks')"), "chunks table must not be queried");
  }],
  ["script does not list recent documents", () => {
    assert(!source.includes(".limit("), "no bulk list queries");
    assert(source.includes('.eq("id", DOCUMENT_ID)'), "single document filter required");
  }],
  ["script does not output OCR fields", () => {
    const banned = ["sample_lines", "anchor_line", "ocr_preview", "chunk content", "rows:"];
    for (const token of banned) {
      assert(!source.includes(token), `banned output token: ${token}`);
    }
    assert(!source.includes("coverage_sheet_shadow.rows"), "full rows output banned");
  }],
  ["deprecated unsafe scripts are isolated", () => {
    for (const name of [
      "pr-c2-production-shadow-verify.mjs",
      "pr-c2-production-shadow-readonly-verify.mjs",
      "pr-c2-shadow-distribution-audit.mjs",
      "kimjinwoo-document-extraction-audit.mjs",
    ]) {
      const text = readFileSync(`${DEPRECATED_DIR}/${name}`, "utf8");
      assert(text.includes("SERVICE_ROLE") || text.includes("serviceRole"), `${name} should be service-role script`);
    }
  }],
];

console.log("pr-c2b-coverage-sheet-shadow-rls-verify-unit-test");
for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
