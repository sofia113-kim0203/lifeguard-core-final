/**
 * O2 observe-only Vault correlator.
 * Never mutates Claude request body / media / prompts.
 * Fingerprints only — no raw document IDs in new fields.
 */
import { createHash } from "node:crypto";

export const VAULT_OBSERVABILITY_SCHEMA = "key-vault-observability-o2-v1";

export const VAULT_TRACE_INTEGRITY_CODES = Object.freeze([
  "VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE",
  "VAULT_MODE_WITHOUT_RESOLVE_CALL",
  "VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT",
  "VAULT_REASON_WITHOUT_VAULT_RESULT",
  "CURRENT_TURN_SCOPE_WITHOUT_CURRENT_TURN_ID",
  "MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE",
  "MEDIA_COUNT_TRACE_MISMATCH",
  "VAULT_MEDIA_ID_MISMATCH",
]);

function fingerprintQuestionObserve(question = "") {
  const q = String(question ?? "");
  return {
    question_chars: q.length,
    question_sha256: createHash("sha256").update(q, "utf8").digest("hex"),
  };
}

export function measuredField(value, source) {
  if (value === undefined || value === null) {
    return { value: null, measurement: "UNAVAILABLE", source: source ?? null };
  }
  return { value, measurement: "MEASURED", source: source ?? null };
}

export function derivedField(value, source) {
  if (value === undefined || value === null) {
    return { value: null, measurement: "UNAVAILABLE", source: source ?? null };
  }
  return { value, measurement: "DERIVED", source: source ?? null };
}

export function unavailableField(source = null) {
  return { value: null, measurement: "UNAVAILABLE", source };
}

function readStageNumber(stage, key) {
  const source = `vaultRecall.stage_counts.${key}`;
  if (!stage || typeof stage !== "object") return unavailableField(source);
  if (!Object.prototype.hasOwnProperty.call(stage, key)) {
    return unavailableField(source);
  }
  const n = Number(stage[key]);
  if (!Number.isFinite(n)) return unavailableField(source);
  return measuredField(n, source);
}

export function fingerprintStableId(raw = "") {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function fingerprintIdList(ids = []) {
  const list = Array.isArray(ids) ? ids : [];
  const fingerprints = [];
  const seen = new Set();
  for (const raw of list) {
    const fp = fingerprintStableId(raw);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    fingerprints.push(fp);
  }
  return {
    count: fingerprints.length,
    fingerprints: fingerprints.slice(0, 24),
  };
}

function base64PayloadBytes(b64) {
  const s = String(b64 ?? "").trim();
  if (!s) return null;
  try {
    return Buffer.byteLength(s, "base64");
  } catch {
    return null;
  }
}

/**
 * Input snapshot from the live request (counts + fingerprints only).
 * Server-internal only — never browser-visible in full.
 */
export function buildVaultObservabilityInputSnapshot({
  correlationKey = null,
  question = "",
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  requestDocumentId = null,
  requestDocumentIds = null,
  isPresenceTurn = false,
} = {}) {
  const qFp = fingerprintQuestionObserve(question);
  const active = fingerprintIdList(activeAttachmentIds);
  const currentTurn = fingerprintIdList(currentTurnDocumentIds);
  const requestIds = fingerprintIdList([
    ...(Array.isArray(requestDocumentIds) ? requestDocumentIds : []),
    requestDocumentId,
  ]);
  return {
    correlation_key: correlationKey ? String(correlationKey).slice(0, 80) : null,
    normalized_question_sha256: qFp.question_sha256,
    question_chars: qFp.question_chars,
    attachment_reference_enabled: attachmentReferenceEnabled === true,
    active_attachment_ids_count: active.count,
    active_attachment_id_fingerprints: active.fingerprints,
    current_turn_document_ids_count: currentTurn.count,
    current_turn_document_id_fingerprints: currentTurn.fingerprints,
    request_document_ids_count: requestIds.count,
    request_document_id_fingerprints: requestIds.fingerprints,
    is_presence_turn: isPresenceTurn === true,
  };
}

/**
 * Gate snapshot — pass runtime-computed booleans only (never recompute here).
 */
export function buildVaultObservabilityGateSnapshot({
  caseSource = null,
  caseDocumentId = null,
  hasActiveInsuranceDocumentCase = false,
  shouldProvideOwnedInsuranceVaultOriginals = false,
  wantsVaultEvidence = false,
  runVaultRecall = false,
} = {}) {
  return {
    case_source: caseSource ? String(caseSource).slice(0, 64) : null,
    case_document_id_fingerprint: fingerprintStableId(caseDocumentId),
    has_active_insurance_document_case: hasActiveInsuranceDocumentCase === true,
    should_provide_owned_insurance_vault_originals:
      shouldProvideOwnedInsuranceVaultOriginals === true,
    wants_vault_evidence: wantsVaultEvidence === true,
    run_vault_recall: runVaultRecall === true,
  };
}

/**
 * Vault resolve snapshot — grades every count; never invents fetch logs.
 */
export function buildVaultObservabilityResolveSnapshot({
  vaultResolveCalled = false,
  vaultRecall = null,
} = {}) {
  const stage =
    vaultRecall?.stage_counts && typeof vaultRecall.stage_counts === "object"
      ? vaultRecall.stage_counts
      : null;
  const listing = Array.isArray(vaultRecall?.listing) ? vaultRecall.listing : null;
  const attachments = Array.isArray(vaultRecall?.attachments)
    ? vaultRecall.attachments
    : null;

  let candidate_document_count;
  if (listing) {
    candidate_document_count = measuredField(
      listing.length,
      "vaultRecall.listing.length",
    );
  } else {
    const fromStage = readStageNumber(stage, "after_ownership");
    candidate_document_count =
      fromStage.measurement === "MEASURED"
        ? fromStage
        : unavailableField("vaultRecall.listing|stage_counts.after_ownership");
  }

  const unique_candidate_count = readStageNumber(stage, "after_sha_unique");
  const fetch_attempted = readStageNumber(stage, "fetch_attempted");
  const fetch_ok = readStageNumber(stage, "fetch_ok");

  // No separate fetch-success ID log exists in resolve return — do not invent.
  const fetched_document_fingerprints = unavailableField(
    "vaultRecall.fetch_success_document_ids",
  );

  let resolved_attachment_fingerprints;
  let vault_attachment_count;
  if (attachments) {
    const fps = fingerprintIdList(
      attachments.map((row) => row?.document_id ?? row?.id),
    );
    resolved_attachment_fingerprints = derivedField(
      fps.fingerprints,
      "vaultRecall.attachments[].document_id",
    );
    vault_attachment_count = measuredField(
      attachments.length,
      "vaultRecall.attachments.length",
    );
  } else {
    resolved_attachment_fingerprints = unavailableField(
      "vaultRecall.attachments",
    );
    vault_attachment_count = unavailableField("vaultRecall.attachments");
  }

  return {
    vault_resolve_called: vaultResolveCalled === true,
    candidate_document_count,
    unique_candidate_count,
    fetch_attempted,
    fetch_ok,
    fetched_document_fingerprints,
    resolved_attachment_fingerprints,
    vault_mode: vaultRecall?.mode ?? null,
    vault_reason: vaultRecall?.reason
      ? String(vaultRecall.reason).slice(0, 80)
      : null,
    vault_attachment_count,
  };
}

/**
 * Classify whether a media row is an insurance-document block that must carry source_scope.
 * General images / non-insurance media must pass requires_source_scope=false.
 */
export function classifyInsuranceDocumentMediaRole({
  sourceScope = null,
  documentId = null,
  mediaKind = null,
  insuranceDocument = null,
  requiresSourceScope = null,
} = {}) {
  if (requiresSourceScope === true || insuranceDocument === true) {
    const scope = String(sourceScope ?? "").trim();
    if (scope === "vault_document") return "vault";
    if (scope === "current_turn_attachment") return "current_turn_or_reactivation";
    return "insurance_unscoped";
  }
  if (requiresSourceScope === false || insuranceDocument === false) {
    return null;
  }
  const scope = String(sourceScope ?? "").trim();
  if (scope === "vault_document") return "vault";
  if (scope === "current_turn_attachment") return "current_turn_or_reactivation";
  // Infer insurance only when a document id is present on a PDF attach row.
  const did = String(documentId ?? "").trim();
  const kind = String(mediaKind ?? "").trim();
  if (did && (kind === "pdf" || kind === "image")) {
    return "insurance_unscoped";
  }
  return null;
}

/**
 * Read-only media manifest from final attachment rows about to enter Claude.
 */
export function buildClaudeMediaManifestObserve({
  attachments = null,
  identityPlan = null,
  pdfMeta = null,
  currentTurnDocumentIds = null,
  activeAttachmentIds = null,
} = {}) {
  const rows = Array.isArray(attachments) ? attachments : [];
  const currentFp = new Set(fingerprintIdList(currentTurnDocumentIds).fingerprints);
  const activeFp = new Set(fingerprintIdList(activeAttachmentIds).fingerprints);
  const scopeFromMeta = new Map();
  if (Array.isArray(pdfMeta?.document_source_scopes)) {
    for (const row of pdfMeta.document_source_scopes) {
      const id = String(row?.document_id ?? "").trim();
      const scope = String(row?.source_scope ?? "").trim();
      if (id && scope) scopeFromMeta.set(id, scope);
    }
  }
  const identityScopes = new Map();
  const identities = Array.isArray(identityPlan?.attachment_identities)
    ? identityPlan.attachment_identities
    : [];
  for (const row of identities) {
    const id = String(row?.document_id ?? "").trim();
    const scope = String(row?.source_scope ?? "").trim();
    if (id && scope) identityScopes.set(id, scope);
  }

  let pdfBlockCount = 0;
  let totalPdfPayloadBytes = 0;
  let pdfByteSamples = 0;
  const byOrigin = {
    current_turn: 0,
    explicit_reactivation: 0,
    vault: 0,
    other: 0,
  };
  const media = [];

  for (const row of rows) {
    const documentId = String(row?.document_id ?? row?.id ?? "").trim();
    const mediaType = String(
      row?.mediaType ?? row?.media_type ?? row?.mime_type ?? "",
    )
      .trim()
      .toLowerCase();
    const isPdf =
      mediaType.includes("pdf") ||
      mediaType === "application/pdf" ||
      (!mediaType && Boolean(row?.base64 || row?.pdfBase64));
    const mediaKind = isPdf
      ? "pdf"
      : mediaType.startsWith("image/")
        ? "image"
        : "other";
    if (isPdf) {
      pdfBlockCount += 1;
      const nbytes = base64PayloadBytes(row?.base64 ?? row?.pdfBase64);
      if (nbytes != null) {
        totalPdfPayloadBytes += nbytes;
        pdfByteSamples += 1;
      }
    }
    const sourceScope =
      String(row?.source_scope ?? "").trim() ||
      (documentId ? scopeFromMeta.get(documentId) : null) ||
      (documentId ? identityScopes.get(documentId) : null) ||
      null;
    const fp = fingerprintStableId(documentId);
    const explicitInsurance =
      row?.insurance_document === true || row?.requires_source_scope === true;
    const explicitNonInsurance =
      row?.insurance_document === false || row?.requires_source_scope === false;
    const insuranceRole = classifyInsuranceDocumentMediaRole({
      sourceScope,
      documentId,
      mediaKind,
      insuranceDocument: explicitInsurance
        ? true
        : explicitNonInsurance
          ? false
          : null,
      requiresSourceScope: explicitInsurance
        ? true
        : explicitNonInsurance
          ? false
          : null,
    });
    const requiresSourceScope = insuranceRole != null;

    let origin = "other";
    if (sourceScope === "vault_document") origin = "vault";
    else if (sourceScope === "current_turn_attachment") {
      if (fp && currentFp.has(fp)) origin = "current_turn";
      else if (fp && activeFp.has(fp)) origin = "explicit_reactivation";
      else origin = "current_turn";
    }
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;
    media.push({
      document_fingerprint: fp,
      source_scope: sourceScope,
      media_kind: mediaKind,
      insurance_document: requiresSourceScope,
      requires_source_scope: requiresSourceScope,
      origin_class: origin,
    });
  }

  return {
    media_block_count: measuredField(rows.length, "pdfAttachmentsForClaude.length"),
    pdf_block_count: derivedField(pdfBlockCount, "media_rows.media_kind===pdf"),
    media,
    total_pdf_payload_bytes:
      pdfByteSamples > 0
        ? derivedField(
            totalPdfPayloadBytes,
            "Buffer.byteLength(attachment.base64,'base64')",
          )
        : unavailableField("attachment.base64"),
    origin_counts: derivedField(byOrigin, "media_rows.origin_class"),
    identity_count: measuredField(
      identities.length || rows.length,
      identities.length
        ? "attachmentIdentityPlan.attachment_identities.length"
        : "pdfAttachmentsForClaude.length",
    ),
  };
}

/**
 * Observe-only integrity checks. Never throws; returns codes only.
 */
export function evaluateVaultTraceIntegrity({
  gate = null,
  resolve = null,
  media = null,
  evidencePackage = null,
  input = null,
} = {}) {
  const codes = [];
  const evidenceScope = String(evidencePackage?.evidence_scope ?? "").trim();
  const wants = gate?.wants_vault_evidence === true;
  const resolveCalled = resolve?.vault_resolve_called === true;
  const vaultMode = resolve?.vault_mode ?? evidencePackage?.vault_mode ?? null;
  const vaultReason =
    resolve?.vault_reason ?? evidencePackage?.vault_reason ?? null;

  const vaultAttachField = resolve?.vault_attachment_count;
  const vaultAttachCount =
    vaultAttachField?.measurement === "MEASURED"
      ? Number(vaultAttachField.value) || 0
      : null;

  const fetchOkField = resolve?.fetch_ok;
  const mediaCountField = media?.media_block_count;
  const mediaCount =
    mediaCountField?.measurement === "MEASURED"
      ? Number(mediaCountField.value) || 0
      : Array.isArray(media?.media)
        ? media.media.length
        : 0;
  const attachedCount = Number(evidencePackage?.attached_document_count) || 0;
  const mediaRows = Array.isArray(media?.media) ? media.media : [];
  const currentTurnFps = new Set(
    Array.isArray(input?.current_turn_document_id_fingerprints)
      ? input.current_turn_document_id_fingerprints
      : [],
  );

  if (evidenceScope === "owned_insurance_vault" && !wants) {
    codes.push("VAULT_SCOPE_WITHOUT_WANTS_VAULT_EVIDENCE");
  }
  if (vaultMode != null && String(vaultMode).trim() !== "" && !resolveCalled) {
    codes.push("VAULT_MODE_WITHOUT_RESOLVE_CALL");
  }

  // Only when MEASURED fetch_ok is explicitly 0 — never when UNAVAILABLE.
  if (
    resolveCalled &&
    vaultAttachCount != null &&
    vaultAttachCount > 0 &&
    fetchOkField?.measurement === "MEASURED" &&
    Number(fetchOkField.value) === 0
  ) {
    codes.push("VAULT_ATTACH_WITHOUT_FETCHED_DOCUMENT");
  }

  if (vaultReason != null && String(vaultReason).trim() !== "" && !resolveCalled) {
    codes.push("VAULT_REASON_WITHOUT_VAULT_RESULT");
  }

  // Insurance-document media that must carry source_scope only.
  for (const row of mediaRows) {
    if (row?.requires_source_scope === true && !row?.source_scope) {
      codes.push("MEDIA_DOCUMENT_WITHOUT_SOURCE_SCOPE");
      break;
    }
  }

  // current_turn_attachment scope must map to current-turn fingerprint set.
  // Active IDs alone do not suppress this check.
  for (const row of mediaRows) {
    if (row?.source_scope !== "current_turn_attachment") continue;
    if (row?.requires_source_scope !== true) continue;
    const fp = row?.document_fingerprint;
    if (!fp || !currentTurnFps.has(fp)) {
      codes.push("CURRENT_TURN_SCOPE_WITHOUT_CURRENT_TURN_ID");
      break;
    }
  }

  if (mediaCount > 0 && attachedCount > 0 && mediaCount !== attachedCount) {
    codes.push("MEDIA_COUNT_TRACE_MISMATCH");
  }

  if (resolveCalled) {
    const resolvedField = resolve?.resolved_attachment_fingerprints;
    if (
      resolvedField?.measurement === "DERIVED" ||
      resolvedField?.measurement === "MEASURED"
    ) {
      const resolved = new Set(
        Array.isArray(resolvedField.value) ? resolvedField.value : [],
      );
      const vaultMedia = mediaRows.filter(
        (row) =>
          row?.source_scope === "vault_document" && row?.document_fingerprint,
      );
      if (resolved.size > 0 && vaultMedia.length > 0) {
        for (const row of vaultMedia) {
          if (!resolved.has(row.document_fingerprint)) {
            codes.push("VAULT_MEDIA_ID_MISMATCH");
            break;
          }
        }
      }
    }
  }

  return {
    trace_integrity_violation: codes.length > 0,
    trace_integrity_codes: [...new Set(codes)],
  };
}

export function assembleVaultObservabilityTrace({
  input = null,
  gate = null,
  resolve = null,
  media = null,
  evidencePackage = null,
} = {}) {
  const integrity = evaluateVaultTraceIntegrity({
    gate,
    resolve,
    media,
    evidencePackage,
    input,
  });
  return {
    schema_version: VAULT_OBSERVABILITY_SCHEMA,
    input,
    gate,
    resolve,
    media_manifest: media,
    integrity,
  };
}

/**
 * Browser-visible marks only — never the full vault_observability object.
 */
export function buildVaultObservabilityBrowserMarks(vaultObservabilityTrace = null) {
  if (!vaultObservabilityTrace || typeof vaultObservabilityTrace !== "object") {
    return {
      vault_observability_present: false,
      trace_integrity_violation: false,
      trace_integrity_code_count: 0,
      vault_observability_schema_version: null,
    };
  }
  const codes = Array.isArray(vaultObservabilityTrace?.integrity?.trace_integrity_codes)
    ? vaultObservabilityTrace.integrity.trace_integrity_codes
    : [];
  return {
    vault_observability_present: true,
    trace_integrity_violation:
      vaultObservabilityTrace?.integrity?.trace_integrity_violation === true,
    trace_integrity_code_count: codes.length,
    vault_observability_schema_version:
      String(vaultObservabilityTrace?.schema_version ?? "").slice(0, 64) || null,
  };
}
