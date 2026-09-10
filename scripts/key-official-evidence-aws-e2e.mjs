/**
 * KEY AWS E2E on an original already on AWS.
 * Does not wait for the overnight upload. Does not write AWS.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectCurrentContractFactStore } from "../server/keyCore/keyCurrentContractFactPath.js";
import {
  KEY_EXACT_FACT_TOOL_NAME,
  buildKeyExactFactToolResults,
} from "../server/keyCore/keyExactFactRetrieval.js";
import { OFFICIAL_EVIDENCE_SLOT } from "../server/keyCore/keyOfficialEvidenceAdapter.js";
import { TERMS_PROOF_SHA } from "../server/keyCore/keyTermsLibrary.js";

const ENV_LOCAL = "C:\\Users\\sofia\\lifeguard-data\\lifeguard-step0-candidate\\.env.local";
if (fs.existsSync(ENV_LOCAL)) {
  for (const line of fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]]) continue;
    if (!/^AWS_/.test(m[1])) continue;
    process.env[m[1]] = String(m[2] || "").trim().replace(/^["']|["']$/g, "");
  }
}

process.env.LIFEGUARD_OFFICIAL_SOURCE = "aws";
delete process.env.LIFEGUARD_LIBRARY_ROOT;

const CID = "local-aws-e2e";
const store = collectCurrentContractFactStore({
  customerId: CID,
  policyTruthContext: {
    confirmed_contracts: [
      {
        customer_id: CID,
        contract_id: "c-proof",
        insurer: "삼성화재",
        product_name: "무배당 삼성화재 건강보험 마이핏1640(2608.9)(납입면제,해약환급금 미지급형Ⅱ)",
        contract_date: "20260818",
        status: "active",
      },
    ],
  },
});

const toolResults = await buildKeyExactFactToolResults(
  [
    {
      type: "tool_use",
      id: "tu_aws",
      name: KEY_EXACT_FACT_TOOL_NAME,
      input: {
        slot: OFFICIAL_EVIDENCE_SLOT,
        contract_id: "c-proof",
        topic: "제15조",
      },
    },
  ],
  { customerId: CID, store, rows: [] },
);
const slice = JSON.parse(toolResults[0].content);
const report = {
  KEY_AWS_E2E: slice.status === "hit" ? "PASS" : "BLOCKER",
  status: slice.status,
  reason: slice.reason || null,
  sha: slice.provenance?.sha || null,
  original_source: slice.provenance?.original_source || null,
  proof_sha_expected: TERMS_PROOF_SHA,
  topic: "제15조",
  article_number_exact: slice.facts?.[0]?.article_number_exact || null,
  locator_count: slice.provenance?.locator_count || 0,
  page_count: slice.provenance?.page_count || 0,
  source_page_count: slice.provenance?.source_page_count || 0,
};
if (slice.status === "hit") {
  assert.equal(slice.provenance.original_source, "aws");
  assert.equal(slice.provenance.sha, TERMS_PROOF_SHA);
  assert.equal(slice.provenance.lookup_status, "EXACT");
  assert.equal(slice.facts[0].article_number_exact, "제15조");
  assert.equal(Number(slice.provenance.locator_count) >= 1, true);
  assert.equal(Number(slice.provenance.locator_count) <= 4, true);
  assert.equal(Number(slice.provenance.page_count) >= 1, true);
  assert.equal(Number(slice.provenance.page_count) < Number(slice.provenance.source_page_count || 9999), true);
  assert.equal(String(slice.facts[0].text || "").includes("제15조"), true);
  assert.equal(JSON.stringify(slice).includes("C:\\\\Users\\\\sofia"), false);
}
console.log(JSON.stringify(report, null, 2));
if (slice.status !== "hit") process.exitCode = 2;
