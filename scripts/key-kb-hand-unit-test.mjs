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

const timelessFile = {
  insurer: "IBK연금보험",
  candidates: [
    {
      relation_id: "ibk-no-sale",
      sha: "1826ed29afa8f3860ef716177a121e5af71b7110d491acb8d136a8502df1c4fc",
      product_exact: "IBK확정급여형",
      product_code: "HP_PBANO_PDT_SP|1",
      sale_start: "",
      sale_end: "",
      version: "",
      document_kind: "약관",
      official_filename: "IBK확정급여형_약관.pdf",
      spec_status: "CONFIRMED",
      identity_status: "PRESENT",
      usable: true,
      conflict: false,
    },
  ],
};
const noSaleHits = filterProductCandidates(timelessFile, {
  date: "20200115",
  document_kind: "약관",
});
assert.equal(noSaleHits.length, 1);
assert.equal(decideTermsMatch(noSaleHits).status, "exact");
const byFile = filterProductCandidates(timelessFile, {
  document_kind: "약관",
  official_filename: "IBK확정급여형_약관.pdf",
});
assert.equal(byFile.length, 1);

const sameNameTwoCells = {
  insurer: "하나생명",
  candidates: [
    {
      relation_id: "hana-610859",
      sha: "68687e6182dc66878335ef4df495e35db9ebbf3a228b4fece71863c5cc36d95a",
      product_exact: "(무)하나원큐연금저축보험",
      sale_start: "",
      sale_end: "",
      document_kind: "약관",
      official_filename: "(무)하나원큐연금저축보험 보험약관",
      official_path_id: "/anm/product/download.do?code=610859&seq=1",
      spec_status: "CONFIRMED",
      identity_status: "PRESENT",
      usable: true,
      conflict: false,
    },
    {
      relation_id: "hana-610804",
      sha: "b8ff16db2bee9113f184cc07f75af9dad0849e031faf6649859f29f8ca5ae8f3",
      product_exact: "(무)하나원큐연금저축보험",
      sale_start: "",
      sale_end: "",
      document_kind: "약관",
      official_filename: "(무)하나원큐연금저축보험 보험약관",
      official_path_id: "/anm/product/download.do?code=610804&seq=1",
      spec_status: "CONFIRMED",
      identity_status: "PRESENT",
      usable: true,
      conflict: false,
    },
  ],
};
const byNameOnly = filterProductCandidates(sameNameTwoCells, {
  document_kind: "약관",
  official_filename: "(무)하나원큐연금저축보험 보험약관",
});
assert.equal(byNameOnly.length, 2);
assert.equal(decideTermsMatch(byNameOnly).status, "ambiguous");
const byCell = filterProductCandidates(sameNameTwoCells, {
  document_kind: "약관",
  official_filename: "(무)하나원큐연금저축보험 보험약관",
  official_path_id: "code=610859&seq=1",
});
assert.equal(byCell.length, 1);
assert.equal(decideTermsMatch(byCell).status, "exact");
assert.equal(byCell[0].sha, "68687e6182dc66878335ef4df495e35db9ebbf3a228b4fece71863c5cc36d95a");

console.log(JSON.stringify({ KEY_KB_HAND_UNIT: "PASS" }));
