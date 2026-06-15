/**
 * Regression: persistExtractedPolicies() update path — TDZ order + riders merge.
 * No Supabase. Exercises exported persistExtractedPolicies from documentPolicyExtractionPipeline.js.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractPoliciesFromOcrText } from "../server/documentPolicyExtractor.js";
import { assertRidersStringArray } from "../server/coverageRiderPopulation.js";
import {
  buildUploadExtractKey,
} from "../server/documentPolicyUploadPersist.js";
import { persistExtractedPolicies } from "../server/documentPolicyExtractionPipeline.js";

const PIPELINE_PATH = fileURLToPath(new URL("../server/documentPolicyExtractionPipeline.js", import.meta.url));

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
  const fnStart = source.indexOf("export async function persistExtractedPolicies");
  assert(fnStart >= 0, "persistExtractedPolicies export not found");
  const loopStart = source.indexOf("for (const candidate of candidates) {", fnStart);
  assert(loopStart >= 0, "persistExtractedPolicies candidate loop not found");
  const loopBodyStart = loopStart + "for (const candidate of candidates) {".length;
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
  const existingDecl = loopBody.indexOf("resolveExistingPolicyForCandidate");
  const rowDecl = loopBody.indexOf("buildPolicyRowFromCandidate");
  assert(existingDecl >= 0, "resolveExistingPolicyForCandidate missing from persist loop");
  assert(rowDecl >= 0, "buildPolicyRowFromCandidate missing from persist loop");
  assert(
    existingDecl < rowDecl,
    "TDZ regression: resolveExistingPolicyForCandidate must appear before buildPolicyRowFromCandidate",
  );

  const rowDeclarations = [...loopBody.matchAll(/\bconst row\b/g)];
  assert(rowDeclarations.length === 1, `expected exactly one const row declaration, found ${rowDeclarations.length}`);
}

function createMockAdmin({ existingRows, onUpdate }) {
  const ctx = { existingRows, onUpdate };

  function terminalSelectResult() {
    return Promise.resolve({ data: ctx.existingRows, error: null });
  }

  function buildChain(state) {
    const chain = {
      select() {
        if (state.op === "update") {
          return {
            single: () => {
              ctx.onUpdate?.(state.updateRow);
              const idFilter = state.filters.find(([column]) => column === "id");
              return Promise.resolve({
                data: { id: idFilter?.[1] ?? ctx.existingRows[0]?.id ?? "policy-existing-tdz-1" },
                error: null,
              });
            },
          };
        }
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
        return terminalSelectResult();
      },
      order() {
        return terminalSelectResult();
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

async function testUpdatePathPreservesRidersAndDetails() {
  const customerId = "cust-tdz-regression";
  const documentId = "doc-tdz-regression-0001-0002";

  const ocrSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
월 보험료: 45,000원
특약: 암진단비 3,000만원
`;

  const multiExtraction = extractPoliciesFromOcrText(ocrSample);
  assert(multiExtraction.policy_count === 1, `expected 1 policy candidate, got ${multiExtraction.policy_count}`);
  const candidate = multiExtraction.policies[0];

  const uploadExtractKey = buildUploadExtractKey(documentId, candidate.fields);
  const existingSummary = {
    source_document_id: documentId,
    upload_extract_key: uploadExtractKey,
    policy_number: "LEGACY-001",
    riders: ["기존특약진단비"],
    rider_details: [
      {
        rider_name: "기존특약진단비",
        coverage_amount: 15000000,
        source_kind: "ocr_field",
        source_line: null,
      },
    ],
  };

  const existingRows = [
    {
      id: "policy-existing-tdz-1",
      is_active: true,
      coverage_summary: existingSummary,
    },
  ];

  let updatedRow = null;
  const admin = createMockAdmin({
    existingRows,
    onUpdate: (row) => {
      updatedRow = row;
    },
  });

  const result = await persistExtractedPolicies(admin, customerId, documentId, multiExtraction);

  assert(result.policy_count === 1, `expected 1 persist action, got ${result.policy_count}`);
  assert(result.policy_actions[0]?.action === "updated", "existing policy must take update path");
  assert(updatedRow, "update row must be captured");

  const summary = updatedRow.coverage_summary;
  assert(assertRidersStringArray(summary.riders), "riders must remain string[]");
  assert(Array.isArray(summary.rider_details), "rider_details sidecar must remain array");
  assert(summary.riders.includes("기존특약진단비"), "existing rider label must be preserved");
  assert(summary.riders.includes("암진단비"), "new OCR rider label must be merged");
  assert(
    summary.rider_details.some((entry) => entry.rider_name === "기존특약진단비"),
    "existing rider_details sidecar entry must be preserved",
  );
  assert(
    summary.rider_details.some((entry) => entry.rider_name === "암진단비"),
    "new rider_details sidecar entry must be merged",
  );
}

console.log("document-policy-persist-tdz-regression-test");

const source = readFileSync(PIPELINE_PATH, "utf8");
let passed = 0;
let failed = 0;

for (const [name, fn] of [
  ["persist loop declares existing before row (TDZ guard)", () => assertPersistLoopDeclarationOrder(source)],
  ["update path merges riders string[] and rider_details sidecar", () => testUpdatePathPreservesRidersAndDetails()],
]) {
  const ok = await runCase(name, fn);
  if (ok) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
