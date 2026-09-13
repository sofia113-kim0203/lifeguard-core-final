/**
 * KB Hand unit: document_kind + official distinguisher pick one CONFIRMED SHA.
 * No AWS. No leftover GET.
 */
import assert from "node:assert/strict";
import {
  decideTermsMatch,
  filterProductCandidates,
  lookupTermsProduct,
} from "../server/keyCore/keyTermsLibrary.js";

const productFile = {
  insurer: "KB손해보험",
  candidates: [
    {
      relation_id: "kb-일반",
      sha: "ef7e8140af7e3c2a0116cb6b5832c3d25794184d4c46cd84c66898fa9db34487",
      product_exact: "무배당 KB 슬기로운 간편건강보험(21.06)",
      product_code: "23326",
      sale_start: "20210801",
      sale_end: "20210816",
      version: "20210801",
      document_kind: "보험약관",
      official_distinguisher: "일반심사형",
      spec_status: "CONFIRMED",
      identity_status: "PRESENT",
      usable: true,
      conflict: false,
    },
    {
      relation_id: "kb-경증",
      sha: "464ae344357ec2b0a28c72418bb1a1e8fb8960fa1ede3f4544742d89eb007690",
      product_exact: "무배당 KB 슬기로운 간편건강보험(21.06)",
      product_code: "23326",
      sale_start: "20210801",
      sale_end: "20210816",
      version: "20210801",
      document_kind: "보험약관",
      official_distinguisher: "경증간편심사형",
      spec_status: "CONFIRMED",
      identity_status: "PRESENT",
      usable: true,
      conflict: false,
    },
  ],
};

const both = filterProductCandidates(productFile, {
  date: "20210810",
  product_code: "23326",
  document_kind: "보험약관",
});
assert.equal(both.length, 2);
assert.equal(decideTermsMatch(both).status, "ambiguous");

const exactRows = filterProductCandidates(productFile, {
  date: "20210810",
  product_code: "23326",
  document_kind: "보험약관",
  official_distinguisher: "일반심사형",
});
const exact = decideTermsMatch(exactRows);
assert.equal(exact.status, "exact");
assert.equal(exact.reason, "ONE_CONFIRMED_RELATION");
assert.equal(exact.relation.sha, "ef7e8140af7e3c2a0116cb6b5832c3d25794184d4c46cd84c66898fa9db34487");

const files = new Map([
  [
    "master/v1/products/KB손해보험/2d/2df872659eb4b842d76885a9308344a913ff33ab50eb8d7c15c9cccda63eeec6.json",
    Buffer.from(JSON.stringify(productFile)),
  ],
]);
const got = await lookupTermsProduct(
  {
    insurer: "KB손해보험",
    product_name: "무배당 KB 슬기로운 간편건강보험(21.06)",
    date: "20210810",
    product_code: "23326",
    document_kind: "보험약관",
    official_distinguisher: "일반심사형",
  },
  {
    getObject: async (key) =>
      files.has(key) ? { found: true, key, bytes: files.get(key) } : { found: false, reason: "NO_SUCH_KEY", key },
  },
);
assert.equal(got.status, "exact");
assert.equal(got.reason, "ONE_CONFIRMED_RELATION");
assert.equal(got.relation.sha, "ef7e8140af7e3c2a0116cb6b5832c3d25794184d4c46cd84c66898fa9db34487");

console.log(JSON.stringify({ KEY_KB_HAND_UNIT: "PASS" }));
