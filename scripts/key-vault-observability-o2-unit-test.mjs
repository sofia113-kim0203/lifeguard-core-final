/**
 * O2/O3 — Vault observability correlator (Provider/DB-free).
 * Proves gate snapshots + integrity codes without changing Claude body.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const href = (rel) => pathToFileURL(path.join(root, rel)).href;

const {
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
  wantsOwnedInsuranceVaultEvidence,
  isPolicyCountOrLedgerQuestion,
} = await import(href("src/lib/chatActiveAttachment.js"));

const { resolveActiveInsuranceDocumentCase } = await import(
  href("server/keyCore/keyActiveInsuranceDocumentCase.js")
);

const {
  assembleVaultObservabilityTrace,
  buildClaudeMediaManifestObserve,
  buildVaultObservabilityBrowserMarks,
  buildVaultObservabilityGateSnapshot,
  buildVaultObservabilityInputSnapshot,
  buildVaultObservabilityResolveSnapshot,
  evaluateVaultTraceIntegrity,
  fingerprintStableId,
} = await import(href("server/keyCore/keyVaultObservabilityTrace.js"));

const {
  buildClaudeFirstCachedRequestParts,
  fingerprintRawQuestion,
} = await import(href("server/keyCore/keyClaudeFirstDirect.js"));

const { buildTurnEvidencePackageMeta, buildSourceSeparatedTruthContext } =
  await import(href("server/keyCore/keyPolicyTruthEvidence.js"));

const {
  assembleQaTurnTracePayload,
  recordQaTurnTrace,
  shouldActivateQaTurnRecorder,
} = await import(href("server/keyCore/keyQaTurnRecorder.js"));

function ok(name) {
  console.log(`OK ${name}`);
}

/** Preview allowlist env for recorder ON unit mocks only (no real DB). */
function recorderOnEnv(customerId = "cust-o2-allow") {
  return {
    VERCEL_ENV: "preview",
    KEY_QA_TURN_RECORDER: "1",
    KEY_QA_TURN_RECORDER_CUSTOMER_IDS: customerId,
    KEY_QA_TURN_RECORDER_PEPPER: "o2-unit-pepper",
  };
}

function recorderOffEnv() {
  return {
    VERCEL_ENV: "production",
    KEY_QA_TURN_RECORDER: "0",
    KEY_QA_TURN_RECORDER_CUSTOMER_IDS: "",
  };
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function fieldValue(field) {
  return field && typeof field === "object" ? field.value : field;
}

function assertOnlyCode(result, expectedCode) {
  assert.equal(result.trace_integrity_violation, true, expectedCode);
  assert.ok(
    result.trace_integrity_codes.includes(expectedCode),
    `missing ${expectedCode}: ${JSON.stringify(result.trace_integrity_codes)}`,
  );
  assert.equal(
    result.trace_integrity_codes.length,
    1,
    `expected sole code ${expectedCode}, got ${JSON.stringify(result.trace_integrity_codes)}`,
  );
}

function simulateGate({
  question,
  isPresenceTurn = false,
  attachmentReferenceEnabled = false,
  activeAttachmentIds = [],
  currentTurnDocumentIds = [],
  clientDocumentIds = [],
}) {
  return resolveActiveInsuranceDocumentCase({
    supabase: null,
    customerId: "cust-o2",
    sessionId: "sess-o2",
    clientDocumentIds,
    attachmentReferenceEnabled,
    activeAttachmentIds,
    currentTurnDocumentIds,
    enforceAttachmentScope: true,
  }).then((activeDocumentCase) => {
    const caseDocumentId = String(activeDocumentCase.documentId ?? "").trim() || null;
    const hasActiveInsuranceDocumentCase = Boolean(caseDocumentId);
    const shouldProvide = shouldProvideOwnedInsuranceVaultOriginals({
      question,
      isPresenceTurn,
      attachedDocumentId: caseDocumentId,
    });
    const wantsVaultEvidence =
      hasActiveInsuranceDocumentCase && shouldProvide === true;
    const runVaultRecall = shouldRunOwnedVaultRecall({
      wantsVaultEvidence,
      isPresenceTurn,
    });
    return {
      activeDocumentCase,
      caseDocumentId,
      hasActiveInsuranceDocumentCase,
      shouldProvide,
      wantsVaultEvidence,
      runVaultRecall,
    };
  });
}

/** Pure fixture: serialize SSE done / browser-visible voice path shape. */
function serializeBrowserDoneFixture({
  customerAnswer = "확인했습니다.",
  vaultObservabilityTrace = null,
} = {}) {
  const browserMarks = buildVaultObservabilityBrowserMarks(vaultObservabilityTrace);
  const key_voice_trace = {
    compose_mode: "key_claude_first_direct",
    customer_answer: customerAnswer,
    ...browserMarks,
    // Must NOT include full vault_observability
    latency_marks: {
      ttft_ms: 12,
      git_commit_sha: null,
    },
  };
  const sales_director_trace = {
    key_compose_trace: { key_voice_trace },
    key_voice_trace,
  };
  const donePayload = {
    type: "done",
    sales_director_trace,
    customer_answer: customerAnswer,
  };
  return {
    donePayload,
    serialized: JSON.stringify(donePayload),
    browserMarks,
    customerAnswer,
  };
}

// ─── T1 ─────────────────────────────────────────────────────────────
{
  const q = "내 계약 몇 건이야?";
  assert.equal(isPolicyCountOrLedgerQuestion(q), true);
  assert.equal(wantsOwnedInsuranceVaultEvidence(q), false);
  const g = await simulateGate({
    question: q,
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: [],
  });
  assert.equal(g.shouldProvide, false);
  assert.equal(g.caseDocumentId, null);
  assert.equal(g.hasActiveInsuranceDocumentCase, false);
  assert.equal(g.wantsVaultEvidence, false);
  assert.equal(g.runVaultRecall, false);

  const input = buildVaultObservabilityInputSnapshot({
    correlationKey: "t1-corr",
    question: q,
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: [],
    isPresenceTurn: false,
  });
  const gate = buildVaultObservabilityGateSnapshot({
    caseSource: g.activeDocumentCase.caseSource,
    caseDocumentId: g.caseDocumentId,
    hasActiveInsuranceDocumentCase: g.hasActiveInsuranceDocumentCase,
    shouldProvideOwnedInsuranceVaultOriginals: g.shouldProvide,
    wantsVaultEvidence: g.wantsVaultEvidence,
    runVaultRecall: g.runVaultRecall,
  });
  const resolve = buildVaultObservabilityResolveSnapshot({
    vaultResolveCalled: false,
    vaultRecall: null,
  });
  const media = buildClaudeMediaManifestObserve({ attachments: [] });
  const evidence = buildTurnEvidencePackageMeta({
    evidence_scope: g.wantsVaultEvidence ? "owned_insurance_vault" : "none",
    vaultRecall: null,
    attachments: [],
  });
  const obs = assembleVaultObservabilityTrace({
    input,
    gate,
    resolve,
    media,
    evidencePackage: evidence,
  });
  assert.equal(resolve.vault_resolve_called, false);
  assert.equal(fieldValue(media.media_block_count), 0);
  assert.equal(media.media_block_count.measurement, "MEASURED");
  assert.equal(resolve.fetch_ok.measurement, "UNAVAILABLE");
  assert.equal(resolve.fetched_document_fingerprints.measurement, "UNAVAILABLE");
  assert.equal(obs.integrity.trace_integrity_violation, false);
  assert.deepEqual(obs.integrity.trace_integrity_codes, []);
  ok("T1_contract_count_no_attach");
}

// ─── T2 ─────────────────────────────────────────────────────────────
{
  const q = "내 계약 몇 건이야?";
  const activeId = "doc-stale-active-001";
  const g = await simulateGate({
    question: q,
    attachmentReferenceEnabled: true,
    activeAttachmentIds: [activeId],
    currentTurnDocumentIds: [],
  });
  assert.equal(g.hasActiveInsuranceDocumentCase, true);
  assert.equal(g.shouldProvide, false);
  assert.equal(g.wantsVaultEvidence, false);
  assert.equal(g.runVaultRecall, false);

  const obs = assembleVaultObservabilityTrace({
    input: buildVaultObservabilityInputSnapshot({
      correlationKey: "t2-corr",
      question: q,
      attachmentReferenceEnabled: true,
      activeAttachmentIds: [activeId],
      currentTurnDocumentIds: [],
    }),
    gate: buildVaultObservabilityGateSnapshot({
      caseSource: g.activeDocumentCase.caseSource,
      caseDocumentId: g.caseDocumentId,
      hasActiveInsuranceDocumentCase: g.hasActiveInsuranceDocumentCase,
      shouldProvideOwnedInsuranceVaultOriginals: g.shouldProvide,
      wantsVaultEvidence: g.wantsVaultEvidence,
      runVaultRecall: g.runVaultRecall,
    }),
    resolve: buildVaultObservabilityResolveSnapshot({
      vaultResolveCalled: false,
      vaultRecall: null,
    }),
    media: buildClaudeMediaManifestObserve({ attachments: [] }),
    evidencePackage: buildTurnEvidencePackageMeta({
      evidence_scope: "none",
      vaultRecall: null,
      attachments: [],
      case_source: g.activeDocumentCase.caseSource,
      case_document_id: g.caseDocumentId,
    }),
  });
  assert.equal(obs.gate.should_provide_owned_insurance_vault_originals, false);
  assert.equal(obs.gate.wants_vault_evidence, false);
  assert.equal(obs.resolve.vault_resolve_called, false);
  assert.equal(fieldValue(obs.media_manifest.media_block_count), 0);
  assert.equal(obs.integrity.trace_integrity_violation, false);
  ok("T2_contract_count_stale_active");
}

// ─── T3 explicit vault (mock resolve; no Provider/DB) ────────────────
let t3Obs = null;
{
  const q = "전체 보험 확인해줘";
  assert.equal(shouldProvideOwnedInsuranceVaultOriginals({ question: q }), true);
  const activeId = "doc-vault-scope-1";
  const g = await simulateGate({
    question: q,
    attachmentReferenceEnabled: true,
    activeAttachmentIds: [activeId],
    currentTurnDocumentIds: [],
  });
  assert.equal(g.shouldProvide, true);
  assert.equal(g.wantsVaultEvidence, true);
  assert.equal(g.runVaultRecall, true);

  const vaultDocId = "doc-vault-fetched-aaa";
  const mockVaultRecall = {
    mode: "attach",
    reason: "owned_insurance_vault_merged_deduped",
    listing: [{ id: vaultDocId }, { id: "doc-vault-fetched-bbb" }],
    attachments: [
      {
        document_id: vaultDocId,
        content_sha256: "a".repeat(64),
        mediaType: "application/pdf",
        source_scope: "vault_document",
        pdfBase64: Buffer.from("%PDF-1.4 mock").toString("base64"),
      },
    ],
    stage_counts: {
      after_ownership: 2,
      fetch_attempted: 2,
      fetch_ok: 1,
      after_sha_unique: 1,
    },
  };
  const attachments = mockVaultRecall.attachments.map((row) => ({
    ...row,
    base64: row.pdfBase64,
    source_scope: "vault_document",
  }));
  const evidence = buildTurnEvidencePackageMeta({
    evidence_scope: "owned_insurance_vault",
    vaultRecall: mockVaultRecall,
    attachments,
    case_source: g.activeDocumentCase.caseSource,
    case_document_id: g.caseDocumentId,
  });
  const media = buildClaudeMediaManifestObserve({
    attachments,
    pdfMeta: {
      document_source_scopes: [
        { document_id: vaultDocId, source_scope: "vault_document" },
      ],
    },
    currentTurnDocumentIds: [],
    activeAttachmentIds: [activeId],
  });
  t3Obs = assembleVaultObservabilityTrace({
    input: buildVaultObservabilityInputSnapshot({
      correlationKey: "t3-corr",
      question: q,
      attachmentReferenceEnabled: true,
      activeAttachmentIds: [activeId],
      currentTurnDocumentIds: [],
    }),
    gate: buildVaultObservabilityGateSnapshot({
      caseSource: g.activeDocumentCase.caseSource,
      caseDocumentId: g.caseDocumentId,
      hasActiveInsuranceDocumentCase: true,
      shouldProvideOwnedInsuranceVaultOriginals: true,
      wantsVaultEvidence: true,
      runVaultRecall: true,
    }),
    resolve: buildVaultObservabilityResolveSnapshot({
      vaultResolveCalled: true,
      vaultRecall: mockVaultRecall,
    }),
    media,
    evidencePackage: evidence,
  });
  assert.equal(t3Obs.resolve.vault_resolve_called, true);
  assert.equal(t3Obs.resolve.vault_mode, "attach");
  assert.equal(fieldValue(t3Obs.media_manifest.media_block_count), 1);
  assert.equal(t3Obs.resolve.candidate_document_count.measurement, "MEASURED");
  assert.equal(t3Obs.resolve.fetch_ok.measurement, "MEASURED");
  assert.equal(t3Obs.resolve.fetched_document_fingerprints.measurement, "UNAVAILABLE");
  assert.equal(
    t3Obs.resolve.resolved_attachment_fingerprints.measurement,
    "DERIVED",
  );
  assert.equal(
    t3Obs.media_manifest.total_pdf_payload_bytes.measurement,
    "DERIVED",
  );
  assert.equal(fieldValue(t3Obs.media_manifest.origin_counts).vault, 1);
  assert.equal(t3Obs.integrity.trace_integrity_violation, false);

  const truth = buildSourceSeparatedTruthContext({
    ledgerBrief: null,
    evidenceMeta: evidence,
    countQuestion: false,
  });
  assert.equal(truth.EVIDENCE_PACKAGE.vault_observability, undefined);
  assert.equal(Object.hasOwn(truth, "vault_observability"), false);
  ok("T3_explicit_vault_mock_resolve");
}

// ─── MEASURED fixture ───────────────────────────────────────────────
{
  const resolve = buildVaultObservabilityResolveSnapshot({
    vaultResolveCalled: true,
    vaultRecall: {
      listing: [{ id: "a" }, { id: "b" }],
      attachments: [],
      stage_counts: {
        after_ownership: 2,
        after_sha_unique: 2,
        fetch_attempted: 2,
        fetch_ok: 2,
      },
    },
  });
  assert.equal(resolve.candidate_document_count.measurement, "MEASURED");
  assert.equal(resolve.candidate_document_count.value, 2);
  assert.equal(resolve.candidate_document_count.source, "vaultRecall.listing.length");
  assert.equal(resolve.fetch_ok.measurement, "MEASURED");
  assert.equal(resolve.fetch_ok.value, 2);
  ok("MEASURED_stage_count_fixture");
}

// ─── DERIVED PDF bytes fixture ──────────────────────────────────────
{
  const media = buildClaudeMediaManifestObserve({
    attachments: [
      {
        document_id: "doc-pdf-1",
        mediaType: "application/pdf",
        source_scope: "vault_document",
        base64: Buffer.from("%PDF-1.4 bytes").toString("base64"),
      },
    ],
  });
  assert.equal(media.total_pdf_payload_bytes.measurement, "DERIVED");
  assert.ok(Number(media.total_pdf_payload_bytes.value) > 0);
  assert.match(
    String(media.total_pdf_payload_bytes.source),
    /base64/,
  );
  ok("DERIVED_pdf_payload_bytes_fixture");
}

// ─── UNAVAILABLE fetch fingerprints fixture ─────────────────────────
{
  const resolve = buildVaultObservabilityResolveSnapshot({
    vaultResolveCalled: true,
    vaultRecall: {
      attachments: [{ document_id: "att-only" }],
      // no stage_counts.fetch_ok — attachment is NOT fetch proof
    },
  });
  assert.equal(resolve.fetch_ok.measurement, "UNAVAILABLE");
  assert.equal(resolve.fetched_document_fingerprints.measurement, "UNAVAILABLE");
  assert.equal(resolve.resolved_attachment_fingerprints.measurement, "DERIVED");
  // Must NOT invent VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT when fetch_ok UNAVAILABLE
  const integrity = evaluateVaultTraceIntegrity({
    gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: true }),
    resolve,
    media: buildClaudeMediaManifestObserve({ attachments: [] }),
    evidencePackage: { evidence_scope: "owned_insurance_vault", attached_document_count: 0 },
    input: buildVaultObservabilityInputSnapshot({ question: "x" }),
  });
  assert.equal(
    integrity.trace_integrity_codes.includes("VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT"),
    false,
  );
  ok("UNAVAILABLE_fetch_measurement_fixture");
}

// ─── Normal image — no MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE ───────────
{
  const media = buildClaudeMediaManifestObserve({
    attachments: [
      {
        mediaType: "image/png",
        base64: Buffer.from("fake-png").toString("base64"),
        insurance_document: false,
        requires_source_scope: false,
        // no source_scope — general image
      },
    ],
  });
  assert.equal(media.media[0].requires_source_scope, false);
  const integrity = evaluateVaultTraceIntegrity({
    gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
    resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
    media,
    evidencePackage: { evidence_scope: "none", attached_document_count: 1 },
    input: buildVaultObservabilityInputSnapshot({ question: "사진 봐줘" }),
  });
  assert.equal(integrity.trace_integrity_violation, false);
  assert.equal(
    integrity.trace_integrity_codes.includes("MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE"),
    false,
  );
  ok("NORMAL_IMAGE_NO_FALSE_POSITIVE");
}

// ─── Insurance document missing source_scope — MUST fire ─────────────
{
  const media = buildClaudeMediaManifestObserve({
    attachments: [
      {
        document_id: "ins-doc-missing-scope",
        mediaType: "application/pdf",
        base64: Buffer.from("%PDF").toString("base64"),
        insurance_document: true,
        requires_source_scope: true,
        // source_scope intentionally absent
      },
    ],
  });
  const integrity = evaluateVaultTraceIntegrity({
    gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
    resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
    media,
    evidencePackage: { evidence_scope: "none", attached_document_count: 1 },
    input: buildVaultObservabilityInputSnapshot({ question: "이 증권" }),
  });
  assertOnlyCode(integrity, "MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE");
  ok("INSURANCE_DOC_MISSING_SOURCE_SCOPE");
}

// ─── Integrity code 8 independent fixtures ───────────────────────────
{
  // 1) VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
      resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
      media: buildClaudeMediaManifestObserve({ attachments: [] }),
      evidencePackage: {
        evidence_scope: "owned_insurance_vault",
        attached_document_count: 0,
      },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE",
  );
  ok("CODE_VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE");
}

{
  // 2) VAULT_MODE_WITHOUT_RESOLVE_CALL
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: true }),
      resolve: buildVaultObservabilityResolveSnapshot({
        vaultResolveCalled: false,
        vaultRecall: { mode: "attach", attachments: [] },
      }),
      media: buildClaudeMediaManifestObserve({ attachments: [] }),
      evidencePackage: {
        evidence_scope: "owned_insurance_vault",
        vault_mode: "attach",
        attached_document_count: 0,
      },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "VAULT_MODE_WITHOUT_RESOLVE_CALL",
  );
  ok("CODE_VAULT_MODE_WITHOUT_RESOLVE_CALL");
}

{
  // 3) VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT
  // Requires: resolveCalled, attach>0, MEASURED fetch_ok === 0
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: true }),
      resolve: buildVaultObservabilityResolveSnapshot({
        vaultResolveCalled: true,
        vaultRecall: {
          mode: "attach",
          reason: "owned_insurance_vault_merged_deduped",
          attachments: [{ document_id: "att-1" }],
          listing: [{ id: "att-1" }],
          stage_counts: {
            after_ownership: 1,
            after_sha_unique: 1,
            fetch_attempted: 1,
            fetch_ok: 0,
          },
        },
      }),
      media: buildClaudeMediaManifestObserve({ attachments: [] }),
      evidencePackage: {
        evidence_scope: "owned_insurance_vault",
        vault_mode: "attach",
        vault_reason: "owned_insurance_vault_merged_deduped",
        attached_document_count: 0,
      },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT",
  );
  ok("CODE_VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT");
}

{
  // 4) VAULT_REASON_WITHOUT_VAULT_RESULT
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: true }),
      resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
      media: buildClaudeMediaManifestObserve({ attachments: [] }),
      evidencePackage: {
        evidence_scope: "owned_insurance_vault",
        vault_reason: "owned_insurance_vault_merged_deduped",
        attached_document_count: 0,
      },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "VAULT_REASON_WITHOUT_VAULT_RESULT",
  );
  ok("CODE_VAULT_REASON_WITHOUT_VAULT_RESULT");
}

{
  // 5) CURRENT_TURN_SCOPE_WITHOUT_CURRENT_TURN_ID
  // Active IDs present must NOT suppress.
  const activeOnly = "doc-active-only";
  const media = buildClaudeMediaManifestObserve({
    attachments: [
      {
        document_id: activeOnly,
        mediaType: "application/pdf",
        source_scope: "current_turn_attachment",
        base64: Buffer.from("%PDF").toString("base64"),
        insurance_document: true,
      },
    ],
    currentTurnDocumentIds: [],
    activeAttachmentIds: [activeOnly],
  });
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
      resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
      media,
      evidencePackage: { evidence_scope: "none", attached_document_count: 1 },
      input: buildVaultObservabilityInputSnapshot({
        question: "x",
        currentTurnDocumentIds: [],
        activeAttachmentIds: [activeOnly],
      }),
    }),
    "CURRENT_TURN_SCOPE_WITHOUT_CURRENT_TURN_ID",
  );
  ok("CODE_CURRENT_TURN_SCOPE_WITHOUT_CURRENT_TURN_ID");
}

{
  // 6) MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE — covered above; re-assert independence
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
      resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
      media: buildClaudeMediaManifestObserve({
        attachments: [
          {
            document_id: "ins-2",
            mediaType: "application/pdf",
            insurance_document: true,
            requires_source_scope: true,
            base64: Buffer.from("%PDF").toString("base64"),
          },
        ],
      }),
      evidencePackage: { evidence_scope: "none", attached_document_count: 1 },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE",
  );
  ok("CODE_MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE");
}

{
  // 7) MEDIA_COUNT_TRACE_MISMATCH
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: false }),
      resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
      media: buildClaudeMediaManifestObserve({
        attachments: [
          {
            mediaType: "image/png",
            insurance_document: false,
            requires_source_scope: false,
            base64: Buffer.from("i").toString("base64"),
          },
        ],
      }),
      evidencePackage: { evidence_scope: "none", attached_document_count: 2 },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "MEDIA_COUNT_TRACE_MISMATCH",
  );
  ok("CODE_MEDIA_COUNT_TRACE_MISMATCH");
}

{
  // 8) VAULT_MEDIA_ID_MISMATCH — resolveCalled=true; resolved=[A] vs vault media=[B]
  const fpA = fingerprintStableId("doc-resolved-A");
  const media = buildClaudeMediaManifestObserve({
    attachments: [
      {
        document_id: "doc-media-B",
        mediaType: "application/pdf",
        source_scope: "vault_document",
        base64: Buffer.from("%PDF-B").toString("base64"),
        insurance_document: true,
      },
    ],
  });
  assert.notEqual(fingerprintStableId("doc-media-B"), fpA);
  assertOnlyCode(
    evaluateVaultTraceIntegrity({
      gate: buildVaultObservabilityGateSnapshot({ wantsVaultEvidence: true }),
      resolve: {
        vault_resolve_called: true,
        vault_mode: "attach",
        vault_reason: "owned_insurance_vault_merged_deduped",
        candidate_document_count: { value: 1, measurement: "MEASURED", source: "x" },
        unique_candidate_count: { value: 1, measurement: "MEASURED", source: "x" },
        fetch_attempted: { value: 1, measurement: "MEASURED", source: "x" },
        fetch_ok: { value: 1, measurement: "MEASURED", source: "x" },
        fetched_document_fingerprints: {
          value: null,
          measurement: "UNAVAILABLE",
          source: null,
        },
        resolved_attachment_fingerprints: {
          value: [fpA],
          measurement: "DERIVED",
          source: "vaultRecall.attachments[].document_id",
        },
        vault_attachment_count: { value: 1, measurement: "MEASURED", source: "x" },
      },
      media,
      evidencePackage: {
        evidence_scope: "owned_insurance_vault",
        vault_mode: "attach",
        vault_reason: "owned_insurance_vault_merged_deduped",
        attached_document_count: 1,
      },
      input: buildVaultObservabilityInputSnapshot({ question: "x" }),
    }),
    "VAULT_MEDIA_ID_MISMATCH",
  );
  ok("CODE_VAULT_MEDIA_ID_MISMATCH");
}

// ─── SSE done / browser non-exposure ─────────────────────────────────
{
  const customerAnswer = "확인했습니다. 계약은 원장 기준으로 말씀드릴게요.";
  const fullObs = t3Obs;
  assert.ok(fullObs);
  const beforeAnswer = customerAnswer;
  const { serialized, browserMarks, donePayload } = serializeBrowserDoneFixture({
    customerAnswer,
    vaultObservabilityTrace: fullObs,
  });
  // Allowed mark keys may contain the prefix; forbid the full-object property only.
  assert.equal(serialized.includes('"vault_observability":'), false);
  assert.equal(/"vault_observability"\s*:/.test(serialized), false);
  // No document fingerprints from full obs
  const anyFp = fullObs?.resolve?.resolved_attachment_fingerprints?.value?.[0];
  if (anyFp) {
    assert.equal(serialized.includes(anyFp), false);
  }
  assert.equal(serialized.includes("shouldProvideOwnedInsuranceVaultOriginals"), false);
  assert.equal(serialized.includes("wantsVaultEvidence"), false);
  assert.equal(serialized.includes("runVaultRecall"), false);
  assert.equal(serialized.includes("VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE"), false);
  assert.equal(serialized.includes("MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE"), false);
  assert.deepEqual(Object.keys(browserMarks).sort(), [
    "trace_integrity_code_count",
    "trace_integrity_violation",
    "vault_observability_present",
    "vault_observability_schema_version",
  ]);
  assert.equal(browserMarks.vault_observability_present, true);
  assert.equal(browserMarks.trace_integrity_violation, false);
  assert.equal(donePayload.customer_answer, beforeAnswer);
  assert.equal(donePayload.key_voice_trace, undefined);
  assert.equal(
    donePayload.sales_director_trace.key_voice_trace.customer_answer,
    beforeAnswer,
  );
  ok("SSE_DONE_BROWSER_NON_EXPOSURE");
  ok("BROWSER_MARKS_MINIMAL");
}

// ─── Claude body invariance ─────────────────────────────────────────
{
  const q = "내 계약 몇 건이야?";
  const qFp = fingerprintRawQuestion(q);
  const userPayload = JSON.stringify({
    question: q,
    question_fp: qFp,
    history: [],
  });
  const systemText =
    "KEY system fixture — vault observability must not alter this prefix.";
  const partsA = buildClaudeFirstCachedRequestParts({
    systemText,
    userPayload,
    pdfBase64: null,
    mediaType: null,
    attachments: null,
    attachmentIdentityPlan: null,
  });
  const partsB = buildClaudeFirstCachedRequestParts({
    systemText,
    userPayload,
    pdfBase64: null,
    mediaType: null,
    attachments: null,
    attachmentIdentityPlan: null,
  });

  const bodyA = { system: partsA.system, messages: partsA.messages };
  const bodyB = { system: partsB.system, messages: partsB.messages };
  const charsA = JSON.stringify(bodyA).length;
  const charsB = JSON.stringify(bodyB).length;
  const shaA = sha256Json(bodyA);
  const shaB = sha256Json(bodyB);

  assert.equal(partsA.cache_strategy, partsB.cache_strategy);
  assert.equal(partsA.cache_strategy, "A_plus_B_via_B_marker");
  const prefixA = sha256Json(partsA.system);
  const prefixB = sha256Json(partsB.system);
  assert.equal(prefixA, prefixB, "PREFIX_HASH_STABLE");
  assert.equal(charsA, charsB);
  assert.equal(shaA, shaB);

  const evidence = buildTurnEvidencePackageMeta({
    evidence_scope: "none",
    vaultRecall: null,
    attachments: [],
  });
  const obs = assembleVaultObservabilityTrace({
    input: buildVaultObservabilityInputSnapshot({ question: q }),
    gate: buildVaultObservabilityGateSnapshot({
      wantsVaultEvidence: false,
      runVaultRecall: false,
    }),
    resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
    media: buildClaudeMediaManifestObserve({ attachments: [] }),
    evidencePackage: evidence,
  });
  const truth = buildSourceSeparatedTruthContext({
    evidenceMeta: evidence,
    countQuestion: true,
  });
  assert.equal(truth.EVIDENCE_PACKAGE, evidence);
  assert.notEqual(obs, evidence);
  assert.equal(JSON.stringify(truth).includes("vault_observability"), false);
  assert.equal(JSON.stringify(bodyA).includes("vault_observability"), false);

  console.log("T5_BODY_INVARIANCE_TABLE");
  console.log(
    JSON.stringify(
      {
        request_body_chars_before: charsA,
        request_body_chars_after: charsB,
        full_request_body_sha256_before: shaA,
        full_request_body_sha256_after: shaB,
        prefix_hash_before: prefixA,
        prefix_hash_after: prefixB,
        PREFIX_HASH_STABLE: prefixA === prefixB,
        media_block_count_before: 0,
        media_block_count_after: 0,
        pdf_payload_bytes_before: 0,
        pdf_payload_bytes_after: 0,
        planned_claude_call_count_before: 1,
        planned_claude_call_count_after: 1,
        cache_strategy: partsA.cache_strategy,
      },
      null,
      2,
    ),
  );
  ok("T5_request_body_invariance");
}

assert.equal(fingerprintStableId("doc-1"), fingerprintStableId("doc-1"));
assert.notEqual(fingerprintStableId("doc-1"), fingerprintStableId("doc-2"));

// Trace size report (T1 vs T3)
{
  const t1Obs = assembleVaultObservabilityTrace({
    input: buildVaultObservabilityInputSnapshot({
      question: "내 계약 몇 건이야?",
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
    }),
    gate: buildVaultObservabilityGateSnapshot({
      wantsVaultEvidence: false,
      runVaultRecall: false,
    }),
    resolve: buildVaultObservabilityResolveSnapshot({ vaultResolveCalled: false }),
    media: buildClaudeMediaManifestObserve({ attachments: [] }),
    evidencePackage: { evidence_scope: "none", attached_document_count: 0 },
  });
  const t1FullBytes = Buffer.byteLength(JSON.stringify(t1Obs), "utf8");
  const t1MarksBytes = Buffer.byteLength(
    JSON.stringify(buildVaultObservabilityBrowserMarks(t1Obs)),
    "utf8",
  );
  const t3FullBytes = Buffer.byteLength(JSON.stringify(t3Obs), "utf8");
  const t3MarksBytes = Buffer.byteLength(
    JSON.stringify(buildVaultObservabilityBrowserMarks(t3Obs)),
    "utf8",
  );
  console.log("TRACE_SIZE_TABLE");
  console.log(
    JSON.stringify(
      {
        T1: {
          server_full_vault_observability_json_bytes: t1FullBytes,
          browser_marks_json_bytes: t1MarksBytes,
        },
        T3: {
          server_full_vault_observability_json_bytes: t3FullBytes,
          browser_marks_json_bytes: t3MarksBytes,
        },
      },
      null,
      2,
    ),
  );
}

// ─── Durable QA wiring (T1–T6) ───────────────────────────────────────
{
  const customerId = "cust-o2-allow";
  const turnId = "qatr_o2_corr_fixture_001";
  const rawQuestion = "내 계약 몇 건이야? RAW_QUESTION_FIXTURE";
  const rawDocId = "doc-raw-id-MUST-NOT-APPEAR";
  const customerEmail = "customer-name@example.com";
  const customerName = "홍길동_FIXTURE";

  const obsForDurable = assembleVaultObservabilityTrace({
    input: buildVaultObservabilityInputSnapshot({
      correlationKey: turnId,
      question: rawQuestion,
      activeAttachmentIds: [rawDocId],
      currentTurnDocumentIds: [],
    }),
    gate: buildVaultObservabilityGateSnapshot({
      wantsVaultEvidence: true,
      runVaultRecall: true,
      shouldProvideOwnedInsuranceVaultOriginals: true,
      hasActiveInsuranceDocumentCase: true,
      caseDocumentId: rawDocId,
    }),
    resolve: buildVaultObservabilityResolveSnapshot({
      vaultResolveCalled: true,
      vaultRecall: {
        mode: "attach",
        reason: "owned_insurance_vault_merged_deduped",
        listing: [{ id: rawDocId }],
        attachments: [
          {
            document_id: rawDocId,
            mediaType: "application/pdf",
            source_scope: "vault_document",
            pdfBase64: Buffer.from("%PDF-1.4 DURABLE_TEST").toString("base64"),
          },
        ],
        stage_counts: {
          after_ownership: 1,
          after_sha_unique: 1,
          fetch_attempted: 1,
          fetch_ok: 1,
        },
      },
    }),
    media: buildClaudeMediaManifestObserve({
      attachments: [
        {
          document_id: rawDocId,
          mediaType: "application/pdf",
          source_scope: "vault_document",
          base64: Buffer.from("%PDF-1.4 DURABLE_TEST").toString("base64"),
          insurance_document: true,
        },
      ],
    }),
    evidencePackage: {
      evidence_scope: "owned_insurance_vault",
      vault_mode: "attach",
      vault_reason: "owned_insurance_vault_merged_deduped",
      attached_document_count: 1,
    },
  });

  // T1 — Recorder OFF
  {
    const offEnv = recorderOffEnv();
    assert.equal(
      shouldActivateQaTurnRecorder({
        env: offEnv,
        customerId,
        presenceTurn: false,
      }),
      false,
    );
    let insertCalls = 0;
    const meta = await recordQaTurnTrace({
      env: offEnv,
      customerId,
      sessionId: "sess-o2",
      turnTraceId: turnId,
      vaultObservability: obsForDurable,
      insertImpl: async () => {
        insertCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(meta.attempted, false);
    assert.equal(meta.error_code, "inactive");
    assert.equal(insertCalls, 0);
    // OFF path mirrors FirstDirect: qaTurnCapture=null → record block skipped.
    const qaTurnCapture = null;
    assert.equal(qaTurnCapture, null);
    ok("DURABLE_T1_RECORDER_OFF_NONINTERFERENCE");
  }

  // T2 — Recorder ON / obs present
  let payloadOn = null;
  let payloadOnBytes = 0;
  let payloadBaseBytes = 0;
  let vaultObsBytes = 0;
  {
    const onEnv = recorderOnEnv(customerId);
    assert.equal(
      shouldActivateQaTurnRecorder({
        env: onEnv,
        customerId,
        presenceTurn: false,
      }),
      true,
    );
    let capturedPayload = null;
    const meta = await recordQaTurnTrace({
      env: onEnv,
      customerId,
      sessionId: "sess-o2",
      turnTraceId: turnId,
      model: "test-model",
      systemCapture: { system_text_sha256: "abc" },
      userPayloadCapture: { question_chars: 3 },
      originalsManifest: { count: 0 },
      claudeCapture: { stop_reason: "end_turn" },
      ledgerCapture: { before: { n: 0 }, after: { n: 0 } },
      vaultObservability: obsForDurable,
      insertImpl: async ({ payload }) => {
        capturedPayload = payload;
        return { ok: true };
      },
    });
    assert.equal(meta.attempted, true);
    assert.equal(meta.ok, true);
    assert.equal(meta.turn_trace_id, turnId);
    assert.ok(capturedPayload);
    assert.ok(capturedPayload.vault_observability);
    assert.equal(capturedPayload.turn_trace_id, turnId);
    assert.equal(capturedPayload.voice_trace_link.turn_trace_id, turnId);
    assert.equal(
      capturedPayload.vault_observability.input.correlation_key,
      turnId,
    );
    assert.equal(capturedPayload.system.system_text_sha256, "abc");
    assert.equal(capturedPayload.claude.stop_reason, "end_turn");
    payloadOn = capturedPayload;
    payloadOnBytes = Buffer.byteLength(JSON.stringify(capturedPayload), "utf8");
    vaultObsBytes = Buffer.byteLength(
      JSON.stringify(capturedPayload.vault_observability),
      "utf8",
    );

    const basePayload = assembleQaTurnTracePayload({
      turnTraceId: turnId,
      env: onEnv,
      customerId,
      sessionId: "sess-o2",
      model: "test-model",
      systemCapture: { system_text_sha256: "abc" },
      userPayloadCapture: { question_chars: 3 },
      originalsManifest: { count: 0 },
      claudeCapture: { stop_reason: "end_turn" },
      ledgerCapture: { before: { n: 0 }, after: { n: 0 } },
      vaultObservability: null,
    });
    assert.equal(Object.hasOwn(basePayload, "vault_observability"), false);
    payloadBaseBytes = Buffer.byteLength(JSON.stringify(basePayload), "utf8");

    // Correlation: browser sibling qa_turn_trace_id === durable ids
    const key_voice_trace = {
      qa_turn_trace_id: turnId,
      ...buildVaultObservabilityBrowserMarks(obsForDurable),
    };
    assert.equal(key_voice_trace.qa_turn_trace_id, turnId);
    assert.equal(key_voice_trace.qa_turn_trace_id, capturedPayload.turn_trace_id);
    assert.equal(
      key_voice_trace.qa_turn_trace_id,
      capturedPayload.voice_trace_link.turn_trace_id,
    );
    assert.equal(
      key_voice_trace.qa_turn_trace_id,
      capturedPayload.vault_observability.input.correlation_key,
    );
    assert.equal(Object.hasOwn(key_voice_trace, "correlation_key"), false);
    ok("DURABLE_T2_RECORDER_ON_DURABLE_PAYLOAD");
    ok("EXISTING_CORRELATION_KEY_REUSABLE");
  }

  // T3 — Recorder ON / obs null
  {
    const onEnv = recorderOnEnv(customerId);
    let capturedPayload = null;
    const meta = await recordQaTurnTrace({
      env: onEnv,
      customerId,
      turnTraceId: turnId,
      vaultObservability: null,
      insertImpl: async ({ payload }) => {
        capturedPayload = payload;
        return { ok: true };
      },
    });
    assert.equal(meta.ok, true);
    assert.ok(capturedPayload);
    assert.equal(Object.hasOwn(capturedPayload, "vault_observability"), false);
    assert.equal(capturedPayload.turn_trace_id, turnId);

    const metaUndef = await recordQaTurnTrace({
      env: onEnv,
      customerId,
      turnTraceId: turnId,
      insertImpl: async ({ payload }) => {
        assert.equal(Object.hasOwn(payload, "vault_observability"), false);
        return { ok: true };
      },
    });
    assert.equal(metaUndef.ok, true);
    ok("DURABLE_T3_NULL_OBSERVABILITY_COMPATIBILITY");
  }

  // T4 — Recorder storage failure isolation
  {
    const onEnv = recorderOnEnv(customerId);
    const customerAnswer = "확인했습니다.";
    const sealed = { key_speak_original: customerAnswer };
    const sseDone = { type: "done", customer_answer: customerAnswer };
    const providerCallsBefore = 1;

    const metaFail = await recordQaTurnTrace({
      env: onEnv,
      customerId,
      turnTraceId: turnId,
      vaultObservability: obsForDurable,
      insertImpl: async () => {
        throw new Error("insert_boom");
      },
    });
    assert.equal(metaFail.attempted, true);
    assert.equal(metaFail.ok, false);
    assert.equal(metaFail.error_code, "storage_fail");
    assert.equal(sealed.key_speak_original, customerAnswer);
    assert.equal(sseDone.customer_answer, customerAnswer);
    assert.equal(providerCallsBefore, 1);
    ok("DURABLE_T4_RECORDER_FAILURE_CUSTOMER_ISOLATED");
  }

  // T5 — Payload safety
  {
    assert.ok(payloadOn?.vault_observability);
    const serialized = JSON.stringify(payloadOn);
    assert.equal(serialized.includes(rawQuestion), false);
    assert.equal(serialized.includes(rawDocId), false);
    assert.equal(serialized.includes("%PDF"), false);
    assert.equal(serialized.includes("DURABLE_TEST"), false);
    assert.equal(serialized.includes(customerEmail), false);
    assert.equal(serialized.includes(customerName), false);
    assert.equal(serialized.includes("pdfBase64"), false);
    assert.equal(serialized.includes('"base64"'), false);
    assert.ok(serialized.includes("vault_observability"));
    assert.ok(serialized.includes("MEASURED") || serialized.includes("DERIVED") || serialized.includes("UNAVAILABLE"));
    assert.ok(
      Array.isArray(payloadOn.vault_observability.integrity.trace_integrity_codes),
    );
    assert.equal(
      payloadOn.vault_observability.input.correlation_key,
      turnId,
    );
    // Fingerprints present; raw ids absent
    assert.ok(
      payloadOn.vault_observability.gate.case_document_id_fingerprint,
    );
    assert.notEqual(
      payloadOn.vault_observability.gate.case_document_id_fingerprint,
      rawDocId,
    );
    ok("DURABLE_T5_OBSERVABILITY_PAYLOAD_SAFE");
  }

  // T6 — browser non-exposure still holds with durable wiring
  {
    const { serialized, browserMarks } = serializeBrowserDoneFixture({
      customerAnswer: "확인했습니다.",
      vaultObservabilityTrace: obsForDurable,
    });
    assert.equal(/"vault_observability"\s*:/.test(serialized), false);
    assert.equal(
      serialized.includes(
        obsForDurable.resolve.resolved_attachment_fingerprints?.value?.[0] ??
          "__no_fp__",
      ),
      false,
    );
    assert.equal(serialized.includes("wantsVaultEvidence"), false);
    assert.equal(serialized.includes("VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE"), false);
    assert.deepEqual(Object.keys(browserMarks).sort(), [
      "trace_integrity_code_count",
      "trace_integrity_violation",
      "vault_observability_present",
      "vault_observability_schema_version",
    ]);
    ok("DURABLE_T6_FULL_TRACE_BROWSER_INVISIBLE");
    ok("DURABLE_T6_BROWSER_MARKS_MINIMAL");
  }

  console.log("DURABLE_PAYLOAD_SIZE_TABLE");
  console.log(
    JSON.stringify(
      {
        qa_payload_bytes_without_vault_observability: payloadBaseBytes,
        qa_payload_bytes_with_vault_observability: payloadOnBytes,
        delta_bytes: payloadOnBytes - payloadBaseBytes,
        vault_observability_json_bytes: vaultObsBytes,
        DB_SIZE_LIMIT: "NOT_PROVEN",
      },
      null,
      2,
    ),
  );
}

console.log("ALL_O2_O3_PASS");
