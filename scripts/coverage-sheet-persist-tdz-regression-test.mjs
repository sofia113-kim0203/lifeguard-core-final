/**
 * Regression: persistCoverageSheetRows() — TDZ order + insert path with passingRows >= 1.
 * No Supabase.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSheetUploadExtractKey,
  persistCoverageSheetRows,
} from "../server/coverageSheetPersist.js";

const PERSIST_PATH = fileURLToPath(new URL("../server/coverageSheetPersist.js", import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log(`PASS ${name}`);
          return true;
        })
        .catch((error) => {
          console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        });
    }
    console.log(`PASS ${name}`);
    return Promise.resolve(true);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return Promise.resolve(false);
  }
}

function extractPersistLoopBody(source) {
  const fnStart = source.indexOf("export async function persistCoverageSheetRows");
  assert(fnStart >= 0, "persistCoverageSheetRows export not found");
  const loopStart = source.indexOf("for (const row of passingRows) {", fnStart);
  assert(loopStart >= 0, "persistCoverageSheetRows row loop not found");
  const loopBodyStart = loopStart + "for (const row of passingRows) {".length;
  let depth = 1;
  let index = loopBodyStart;
  while (index < source.length && depth > 0) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    index += 1;
  }
  return source.slice(loopBodyStart, index - 1);
}

function assertPersistLoopDeclarationOrder(source) {
  const loopBody = extractPersistLoopBody(source);
  const existingDecl = loopBody.indexOf("resolveExistingSheetPolicyForRow");
  const rowDecl = loopBody.indexOf("buildPolicyRowFromSheetRow");
  assert(existingDecl >= 0, "resolveExistingSheetPolicyForRow missing from persist loop");
  assert(rowDecl >= 0, "buildPolicyRowFromSheetRow missing from persist loop");
  assert(
    existingDecl < rowDecl,
    "TDZ regression: resolveExistingSheetPolicyForRow must appear before buildPolicyRowFromSheetRow",
  );

  const policyRowDeclarations = [...loopBody.matchAll(/\bconst policyRow\b/g)];
  assert(
    policyRowDeclarations.length === 1,
    `expected exactly one const policyRow declaration, found ${policyRowDeclarations.length}`,
  );
}

function createMockAdmin({ existingRows = [], onInsert, onUpdate }) {
  function terminalSelectResult() {
    return Promise.resolve({ data: existingRows, error: null });
  }

  function buildChain(state) {
    const chain = {
      select() {
        if (state.op === "update" || state.op === "insert") {
          return chain;
        }
        return chain;
      },
      insert(row) {
        state.op = "insert";
        state.insertRow = row;
        return chain;
      },
      update(row) {
        state.op = "update";
        state.updateRow = row;
        return chain;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return chain;
      },
      is(column, value) {
        state.filters.push([column, value]);
        if (state.op === "select") {
          return terminalSelectResult();
        }
        return chain;
      },
      single() {
        if (state.op === "insert") {
          onInsert?.(state.insertRow);
          return Promise.resolve({ data: { id: "policy-sheet-insert-1" }, error: null });
        }
        if (state.op === "update") {
          onUpdate?.(state.updateRow);
          const idFilter = state.filters.find(([column]) => column === "id");
          return Promise.resolve({
            data: { id: idFilter?.[1] ?? existingRows[0]?.id ?? "policy-sheet-update-1" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return {
    from(table) {
      assert(table === "profile_insurance_policies", `unexpected table ${table}`);
      return buildChain({ op: "select", filters: [] });
    },
  };
}

async function testInsertPathWithPassingRows() {
  const customerId = "cust-sheet-tdz-regression";
  const documentId = "doc-sheet-tdz-regression-0001";
  const passingRow = {
    row_index: 0,
    insurer_name: "KB손해보험",
    product_name: "건강보험",
    coverage_name: "암진단비",
    amount_value: 30000000,
    amount_unit: "KRW",
    amount_text: "3,000만원",
    pass_l1_v1: true,
  };

  let insertedRow = null;
  const admin = createMockAdmin({
    existingRows: [],
    onInsert: (row) => {
      insertedRow = row;
    },
  });

  const result = await persistCoverageSheetRows(admin, customerId, documentId, [passingRow]);

  assert(result.policy_count === 1, `expected 1 persist action, got ${result.policy_count}`);
  assert(result.policy_actions[0]?.action === "inserted", "new sheet row must take insert path");
  assert(insertedRow, "insert row must be captured");
  assert(insertedRow.insurer_name === "KB손해보험", "insurer_name must persist");
  assert(
    insertedRow.coverage_summary?.upload_extract_key === buildSheetUploadExtractKey(documentId, passingRow),
    "upload_extract_key must be set on coverage_summary",
  );
}

async function testUpdatePathWithExistingRow() {
  const customerId = "cust-sheet-tdz-regression";
  const documentId = "doc-sheet-tdz-regression-0002";
  const passingRow = {
    row_index: 1,
    insurer_name: "KB손해보험",
    product_name: "건강보험",
    coverage_name: "암진단비",
    amount_value: 30000000,
    amount_unit: "KRW",
    amount_text: "3,000만원",
    pass_l1_v1: true,
  };
  const uploadExtractKey = buildSheetUploadExtractKey(documentId, passingRow);
  const existingRows = [
    {
      id: "policy-sheet-existing-1",
      is_active: true,
      coverage_summary: {
        source_document_id: documentId,
        upload_extract_key: uploadExtractKey,
        insurer_name: "KB손해보험",
      },
    },
  ];

  let updatedRow = null;
  const admin = createMockAdmin({
    existingRows,
    onUpdate: (row) => {
      updatedRow = row;
    },
  });

  const result = await persistCoverageSheetRows(admin, customerId, documentId, [passingRow]);

  assert(result.policy_count === 1, `expected 1 persist action, got ${result.policy_count}`);
  assert(result.policy_actions[0]?.action === "updated", "existing sheet row must take update path");
  assert(updatedRow, "update row must be captured");
  assert(updatedRow.coverage_summary?.upload_extract_key === uploadExtractKey, "upload_extract_key preserved");
}

console.log("coverage-sheet-persist-tdz-regression-test");

const source = readFileSync(PERSIST_PATH, "utf8");
let passed = 0;
let failed = 0;

for (const [name, fn] of [
  ["persist loop declares existing before policyRow (TDZ guard)", () => assertPersistLoopDeclarationOrder(source)],
  ["insert path enters persist with passingRows >= 1 (no TDZ)", () => testInsertPathWithPassingRows()],
  ["update path merges existing coverage_summary (no TDZ)", () => testUpdatePathWithExistingRow()],
]) {
  const ok = await runCase(name, fn);
  if (ok) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
