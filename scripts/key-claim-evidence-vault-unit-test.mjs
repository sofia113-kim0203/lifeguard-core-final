/**
 * Evidence Vault Slice 1 — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  buildClaimEvidenceUpdatesFromUtterance,
  buildContractPackageEvidenceFromDocs,
  buildEvidenceSupersedesChain,
  buildOriginalDocumentEvidenceFromDocs,
  buildClaimEvidenceHandBrief,
  classifyContractEvidenceType,
  contractPackageSubjectId,
  deriveContentHashHint,
  filterClaimEvidenceByScope,
  mergeClaimEvidenceItems,
  normalizeClaimEvidenceItems,
  parseStatedSubmissionTime,
} from "../server/keyCore/keyClaimEvidenceVault.js";

const CUSTOMER = "cust-ev-1";
const ENTITY_A = "ent-a";
const ENTITY_B = "ent-b";
const NOW = new Date("2026-07-22T03:00:00+09:00");
const surgery = {
  claim_case_key: "customer_statement:kind:surgery",
  claim_scope: "personal",
  entity_id: null,
  status: "preparing",
  available_documents: ["진단서"],
  missing_documents: ["입퇴원확인서"],
  source_document_ids: [],
  next_action: "서류 준비",
};

{
  const hint = deriveContentHashHint({
    documentId: "doc-1",
    byteSize: 1200,
    storagePath: `${CUSTOMER}/doc-1/a.pdf`,
  });
  assert.match(hint, /^doc:doc-1:/);
}

{
  const when = parseStatedSubmissionTime("오늘 보험사에 진단서를 제출했어.", { now: NOW });
  assert.equal(when.reason, "today_stated");
  assert.match(when.submitted_at, /^2026-07-22/);
  const none = parseStatedSubmissionTime("서류를 제출했어.", { now: NOW });
  assert.equal(none.submitted_at, null);
}

{
  const docs = [
    {
      id: "doc-diag-1",
      storage_path: `${CUSTOMER}/doc-diag-1/진단서.pdf`,
      original_filename: "진단서.pdf",
      customer_hint_type: "진단서",
      metadata_json: { byte_size: 4096 },
      created_at: "2026-07-20T01:00:00.000Z",
    },
  ];
  const created = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: docs,
    existingEvidence: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].evidence_type, "original_document");
  assert.equal(created[0].entity_id, null);
  assert.equal(created[0].document_id, "doc-diag-1");
  assert.equal(created[0].verification_status, "original");
  assert.equal(created[0].metadata_json.extract_separated, true);

  // Second upload same label → new evidence + supersedes
  const docs2 = [
    {
      id: "doc-diag-2",
      storage_path: `${CUSTOMER}/doc-diag-2/진단서2.pdf`,
      original_filename: "진단서2.pdf",
      customer_hint_type: "진단서",
      metadata_json: { byte_size: 5000 },
      created_at: "2026-07-21T01:00:00.000Z",
    },
  ];
  const v2 = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: docs2,
    existingEvidence: created,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(v2.length, 1);
  assert.equal(v2[0].document_id, "doc-diag-2");
  assert.equal(v2[0].supersedes_id, created[0].id);
  const merged = mergeClaimEvidenceItems(created, v2, { now: NOW });
  assert.equal(merged.length, 2);
  assert.ok(merged.some((e) => e.document_id === "doc-diag-1"));
  assert.ok(merged.some((e) => e.document_id === "doc-diag-2"));
}

{
  const sub = buildClaimEvidenceUpdatesFromUtterance({
    question: "오늘 보험사에 진단서를 제출했어.",
    existingCases: [surgery],
    existingEvidence: [],
    customerId: CUSTOMER,
    messageId: "msg-sub-1",
    now: NOW,
  });
  assert.equal(sub.ok, true);
  assert.equal(sub.updates[0].evidence_type, "claim_submission");
  assert.equal(sub.updates[0].source, "customer_statement");
  assert.equal(sub.updates[0].verification_status, "customer_reported");
  assert.ok(sub.updates[0].submitted_at);
  assert.equal(sub.updates[0].received_at, null);
  assert.equal(sub.updates[0].metadata_json.not_insurer_receipt, true);
}

{
  const pay = buildClaimEvidenceUpdatesFromUtterance({
    question: "보험금이 지급됐어. 120만원 받았어.",
    existingCases: [{ ...surgery, status: "under_review" }],
    existingEvidence: [],
    customerId: CUSTOMER,
    messageId: "msg-pay-1",
    now: NOW,
  });
  assert.equal(pay.ok, true);
  assert.equal(pay.updates[0].evidence_type, "payment_or_denial_outcome");
  assert.equal(pay.updates[0].verification_status, "customer_reported");
  assert.equal(pay.updates[0].metadata_json.insurer_verified, false);
  assert.ok(pay.updates[0].metadata_json.payout_amount_text);

  // Normalize must not promote customer payment to insurer_verified
  const forced = normalizeClaimEvidenceItems([
    {
      ...pay.updates[0],
      verification_status: "insurer_verified",
    },
  ]);
  assert.equal(forced[0].verification_status, "customer_reported");
}

{
  const insurerDoc = {
    id: "doc-ins-1",
    storage_path: `${CUSTOMER}/doc-ins-1/거절안내.pdf`,
    original_filename: "보험사_거절안내.pdf",
    customer_hint_type: "보험사답변",
    metadata_json: { byte_size: 800 },
    created_at: "2026-07-21T02:00:00.000Z",
  };
  const resp = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: [insurerDoc],
    existingEvidence: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(resp[0].evidence_type, "insurer_response");
  assert.equal(resp[0].verification_status, "insurer_verified");

  const noDoc = normalizeClaimEvidenceItems([
    {
      id: "ev-bad",
      claim_case_id: surgery.claim_case_key,
      evidence_type: "insurer_response",
      document_id: null,
      source: "customer_statement",
      verification_status: "insurer_verified",
    },
  ]);
  assert.equal(noDoc[0].verification_status, "customer_reported");
}

{
  const items = [
    {
      id: "p1",
      claim_case_id: surgery.claim_case_key,
      evidence_type: "original_document",
      entity_id: null,
      document_id: "d1",
      verification_status: "original",
      source: "uploaded_document",
      label: "진단서",
    },
    {
      id: "c1",
      claim_case_id: "corporate:ent-a:fire",
      evidence_type: "original_document",
      entity_id: ENTITY_A,
      document_id: "d2",
      verification_status: "original",
      source: "uploaded_document",
      label: "화재확인서",
    },
    {
      id: "c2",
      claim_case_id: "corporate:ent-b:fire",
      evidence_type: "original_document",
      entity_id: ENTITY_B,
      document_id: "d3",
      verification_status: "original",
      source: "uploaded_document",
      label: "B서류",
    },
  ];
  const personal = filterClaimEvidenceByScope(items, { mode: "personal" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].id, "p1");
  const corpA = filterClaimEvidenceByScope(items, { mode: "corporate", entityId: ENTITY_A });
  assert.equal(corpA.length, 1);
  assert.equal(corpA[0].entity_id, ENTITY_A);
  assert.ok(!corpA.some((e) => e.entity_id === ENTITY_B));
}

{
  const brief = buildClaimEvidenceHandBrief({
    cases: [surgery],
    evidenceItems: [
      {
        id: "h1",
        claim_case_id: surgery.claim_case_key,
        evidence_type: "original_document",
        label: "진단서",
        verification_status: "original",
        source: "uploaded_document",
        document_id: "d1",
      },
      {
        id: "s1",
        claim_case_id: surgery.claim_case_key,
        evidence_type: "claim_submission",
        label: "고객 제출 진술",
        verification_status: "customer_reported",
        source: "customer_statement",
      },
    ],
    now: NOW,
  });
  assert.equal(brief.packages.length, 1);
  assert.equal(brief.packages[0].held_evidence.length, 1);
  assert.equal(brief.packages[0].submitted_evidence.length, 1);
  assert.deepEqual(brief.packages[0].missing_evidence_labels, ["입퇴원확인서"]);
}

// --- Contract Package Slice ---
{
  assert.equal(
    classifyContractEvidenceType({ original_filename: "청약서_고지.pdf" }),
    "application_disclosure",
  );
  assert.equal(
    classifyContractEvidenceType({ customer_hint_type: "상품설명동의서" }),
    "explanation_consent",
  );
  assert.equal(classifyContractEvidenceType({ original_filename: "약관_v1.pdf" }), "terms_document");
  assert.equal(contractPackageSubjectId({}), "contract_package:personal");
  assert.equal(
    contractPackageSubjectId({ entityId: ENTITY_A }),
    `contract_package:corporate:${ENTITY_A}`,
  );

  const app = buildContractPackageEvidenceFromDocs({
    documents: [
      {
        id: "doc-app-1",
        original_filename: "청약서_고지.pdf",
        customer_hint_type: "청약서",
        storage_path: `${CUSTOMER}/doc-app-1/a.pdf`,
        metadata_json: { byte_size: 1111 },
      },
    ],
    existingEvidence: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(app.length, 1);
  assert.equal(app[0].evidence_type, "application_disclosure");
  assert.equal(app[0].verification_status, "original");
  assert.equal(app[0].document_version, "1");
  assert.equal(app[0].claim_case_id, "contract_package:personal");
  assert.equal(app[0].entity_id, null);
  assert.ok(app[0].content_hash);
  assert.equal(app[0].metadata_json.legal_force_not_judged, true);

  const expl = buildContractPackageEvidenceFromDocs({
    documents: [
      {
        id: "doc-exp-1",
        original_filename: "설명_동의_기록.pdf",
        customer_hint_type: "설명동의",
        storage_path: `${CUSTOMER}/doc-exp-1/e.pdf`,
        metadata_json: { byte_size: 222 },
      },
    ],
    existingEvidence: app,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(expl[0].evidence_type, "explanation_consent");
  assert.equal(expl[0].verification_status, "original");

  const terms1 = buildContractPackageEvidenceFromDocs({
    documents: [
      {
        id: "doc-terms-1",
        original_filename: "약관.pdf",
        customer_hint_type: "약관",
        storage_path: `${CUSTOMER}/doc-terms-1/t1.pdf`,
        metadata_json: { byte_size: 300 },
      },
    ],
    existingEvidence: [...app, ...expl],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(terms1[0].evidence_type, "terms_document");
  assert.equal(terms1[0].document_version, "1");
  assert.equal(terms1[0].supersedes_id, null);

  const terms2 = buildContractPackageEvidenceFromDocs({
    documents: [
      {
        id: "doc-terms-2",
        original_filename: "약관_개정.pdf",
        customer_hint_type: "약관",
        storage_path: `${CUSTOMER}/doc-terms-2/t2.pdf`,
        metadata_json: { byte_size: 400 },
      },
    ],
    existingEvidence: [...app, ...expl, ...terms1],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(terms2[0].document_id, "doc-terms-2");
  assert.equal(terms2[0].document_version, "2");
  assert.equal(terms2[0].supersedes_id, terms1[0].id);
  const termsMerged = mergeClaimEvidenceItems(
    [...app, ...expl, ...terms1],
    terms2,
    { now: NOW },
  );
  assert.ok(termsMerged.some((e) => e.document_id === "doc-terms-1"));
  assert.ok(termsMerged.some((e) => e.document_id === "doc-terms-2"));
  const chain = buildEvidenceSupersedesChain(termsMerged, terms2[0].id);
  assert.equal(chain.length, 2);
  assert.equal(chain[0].document_id, "doc-terms-1");
  assert.equal(chain[1].document_id, "doc-terms-2");

  // Customer statement + correction history (no open claim → contract package)
  const st1 = buildClaimEvidenceUpdatesFromUtterance({
    question: "고지받았다는 사실이야. 증거로 기록해줘.",
    existingCases: [],
    existingEvidence: [],
    customerId: CUSTOMER,
    messageId: "msg-st-1",
    now: NOW,
  });
  assert.equal(st1.ok, true);
  assert.equal(st1.updates[0].evidence_type, "customer_statement");
  assert.equal(st1.updates[0].verification_status, "customer_reported");
  assert.equal(st1.updates[0].document_version, "1");
  assert.equal(st1.updates[0].supersedes_id, null);

  const st2 = buildClaimEvidenceUpdatesFromUtterance({
    question: "정정하면, 고지받은 날이 아니라 설명 들은 날이야.",
    existingCases: [],
    existingEvidence: st1.updates,
    customerId: CUSTOMER,
    messageId: "msg-st-2",
    now: NOW,
  });
  assert.equal(st2.ok, true);
  assert.equal(st2.updates[0].evidence_type, "customer_statement");
  assert.equal(st2.updates[0].document_version, "2");
  assert.equal(st2.updates[0].supersedes_id, st1.updates[0].id);
  assert.equal(st2.updates[0].verification_status, "customer_reported");
  const stMerged = mergeClaimEvidenceItems(st1.updates, st2.updates, { now: NOW });
  assert.equal(stMerged.length, 2);

  // Never promote customer statement to insurer_verified
  const forcedSt = normalizeClaimEvidenceItems([
    { ...st1.updates[0], verification_status: "insurer_verified" },
  ]);
  assert.equal(forcedSt[0].verification_status, "customer_reported");
  const forcedApp = normalizeClaimEvidenceItems([
    { ...app[0], verification_status: "insurer_verified", source: "customer_statement" },
  ]);
  assert.equal(forcedApp[0].verification_status, "customer_reported");

  // Isolation for contract package
  const corpApp = buildContractPackageEvidenceFromDocs({
    documents: [
      {
        id: "doc-app-corp",
        original_filename: "법인_청약서.pdf",
        customer_hint_type: "청약서",
        metadata_json: { byte_size: 9 },
      },
    ],
    existingEvidence: [],
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    now: NOW,
  });
  assert.equal(corpApp[0].entity_id, ENTITY_A);
  const mixed = [...app, ...corpApp, ...st1.updates];
  assert.equal(filterClaimEvidenceByScope(mixed, { mode: "personal" }).length, 2);
  assert.equal(
    filterClaimEvidenceByScope(mixed, { mode: "corporate", entityId: ENTITY_A }).length,
    1,
  );

  const contractBrief = buildClaimEvidenceHandBrief({
    cases: [],
    evidenceItems: [...app, ...expl, ...terms1, ...terms2, ...stMerged],
    now: NOW,
  });
  assert.ok(contractBrief.packages.some((p) => p.claim_case_id === "contract_package:personal"));
  const cp = contractBrief.packages.find((p) => p.claim_case_id === "contract_package:personal");
  assert.ok(cp.application_disclosure_evidence.length >= 1);
  assert.ok(cp.explanation_consent_evidence.length >= 1);
  assert.ok(cp.terms_document_evidence.length >= 1);
  assert.ok(cp.statement_evidence.length >= 1);
}

console.log("key-claim-evidence-vault-unit-test: PASS");
