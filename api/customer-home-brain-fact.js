/**
 * P3 — POST /api/customer-home-brain-fact
 * JWT/RLS read-only home Tom brain. Gap Tom + casual chat may call Claude; no writes.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  initHomeBrainFactSseResponse,
  writeHomeBrainFactSseError,
  writeHomeBrainFactSseEvent,
} from "../server/homeBrainFactStream.js";
import { resolveShadowVisualBlocksOverride } from "../server/keyCore/shadowVisualBlocksOverride.js";

function wantsStream(body, req) {
  if (body?.stream === true) return true;
  const accept = String(req.headers?.accept ?? "");
  return accept.includes("text/event-stream");
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  let memoryFailedSent = false;
  try {
    const rawBody = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    // Phase 8 diagnostic probes — strip before any product path; never reach Provider.
    const { stripPhase8DiagnosticFieldsFromBody, createPhase8TraceBag } = await import(
      "../server/keyCore/keyPhase8GoldenParallelTrace.js"
    );
    const stripped = stripPhase8DiagnosticFieldsFromBody(rawBody);
    const body = stripped.body;
    const presenceTurn = body?.presence === true || body?.presence_turn === true;
    const question = String(body?.question ?? "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];
    const threadPublicCitations = Array.isArray(body?.thread_public_citations)
      ? body.thread_public_citations
      : [];
    const threadVerifiedFactRefs = Array.isArray(body?.thread_verified_fact_refs)
      ? body.thread_verified_fact_refs
      : [];
    const threadHandoffMemo =
      body?.thread_handoff_memo && typeof body.thread_handoff_memo === "object"
        ? body.thread_handoff_memo
        : null;
    const { listAttachedDocumentIds, resolveAttachDocumentIdContract } = await import(
      "../src/lib/homeBrainAttachDocumentIds.js"
    );
    const attachContract = resolveAttachDocumentIdContract({
      documentId: body?.document_id ?? body?.documentId ?? body?.attached_document_id,
      documentIds: body?.document_ids ?? body?.documentIds,
    });
    const attachedDocumentId = attachContract.documentId;
    const attachedDocumentIds =
      attachContract.documentIds.length > 1
        ? attachContract.documentIds
        : listAttachedDocumentIds(attachedDocumentId);
    const { requestHasForbiddenClientImageBytes } = await import(
      "../server/keyCore/keyClaudeFullDocumentDirect.js"
    );
    if (requestHasForbiddenClientImageBytes(body)) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: "INVALID_BODY",
          error_message: "클라이언트 이미지 bytes는 사용할 수 없습니다.",
        }),
      );
      return;
    }
    const priorAttachFollowUp = Boolean(
      body?.prior_attach_follow_up ?? body?.priorAttachFollowUp ?? false,
    );
    const attachmentReferenceEnabled = Boolean(
      body?.attachment_reference_enabled ?? body?.attachmentReferenceEnabled ?? false,
    );
    const activeAttachmentIds = listAttachedDocumentIds(
      body?.active_attachment_ids ?? body?.activeAttachmentIds,
    );
    const currentTurnDocumentIds = listAttachedDocumentIds(
      body?.current_turn_document_ids ?? body?.currentTurnDocumentIds,
    );
    const explicitReopenDocumentIds = listAttachedDocumentIds(
      body?.explicit_reopen_document_ids ?? body?.explicitReopenDocumentIds,
    );
    // GO3: session_id scopes server SSOT goal load. Ignore any client prior_session_goal.
    const sessionId = String(body?.session_id ?? body?.sessionId ?? "").trim() || null;
    // T2.1 — opaque handoff token only (never accept client plaintext card JSON).
    const readyCardHandoffToken =
      String(body?.ready_card_handoff_token ?? body?.readyCardHandoffToken ?? "").trim() ||
      null;
    void body?.prior_session_goal;
    void body?.priorSessionGoal;
    void body?.ready_card;
    void body?.readyCard;
    const { parseEntityContextFromRequestBody } = await import(
      "../server/entity/entityApiContextPassthrough.js"
    );
    const entityContext = parseEntityContextFromRequestBody(body);
    // Shadow-only: accepted only when KEY_BORROWED_SENSES=shadow (never customer UI blocks).
    const shadowVisualBlocksOverride = resolveShadowVisualBlocksOverride(
      body?.shadow_visual_blocks ?? body?.shadowVisualBlocksOverride ?? null,
      process.env,
    );
    const clientTurnId =
      String(body?.client_turn_id ?? body?.clientTurnId ?? "").trim() || null;
    // C1 Pointer Hand — hint only; Core re-authorizes ownership via chart/ledger.
    const pointedContractIds = Array.isArray(body?.pointed_contract_ids)
      ? body.pointed_contract_ids
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
          .slice(0, 1)
      : Array.isArray(body?.pointedContractIds)
        ? body.pointedContractIds
            .map((id) => String(id ?? "").trim())
            .filter(Boolean)
            .slice(0, 1)
        : [];
    const stream = wantsStream(body, req);

    const authHeader = readCustomerAuthHeader(req);
    const userSupabase = createUserSupabaseClient(authHeader);
    const resolved = await requireCustomerAuth(userSupabase);
    const phase8TraceBag =
      resolved?.ok === true
        ? createPhase8TraceBag({
            env: process.env,
            customerId: resolved.customerId,
            probes: stripped.probes,
            uploadedFixtureSha256: stripped.uploadedFixtureSha256,
          })
        : { active: false, probes: [], uploadedFixtureSha256: null, result: null };

    if (!resolved.ok && resolved.reason === "SUPABASE_NOT_CONFIGURED") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }
    if (!resolved.ok) {
      res.statusCode = resolved.reason === "UNAUTHORIZED" ? 401 : 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }

    if (stream) {
      initHomeBrainFactSseResponse(res);
      const requestStartedAt = Date.now();
      let earlyDoneSent = false;
      const streamHandlers = {
        _emitted: false,
        _earlyCustomerDone: false,
        onKeyWaitAck(text) {
          writeHomeBrainFactSseEvent(res, "ack", { text: String(text ?? "") });
        },
        onDelta(text) {
          streamHandlers._emitted = true;
          writeHomeBrainFactSseEvent(res, "delta", { text: String(text ?? "") });
        },
        onFirstToken(ttftMs) {
          writeHomeBrainFactSseEvent(res, "ttft", { ttft_ms: ttftMs });
        },
        onReplace(_text) {
          // KEY monopoly — post-KEY replace forbidden on customer stream
        },
        // T4 — customer screen completes before persist/probe (request stays open).
        onEarlyCustomerDone(payload) {
          if (earlyDoneSent || !payload) return;
          earlyDoneSent = true;
          streamHandlers._earlyCustomerDone = true;
          writeHomeBrainFactSseEvent(res, "done", payload);
        },
        onDocumentMemoryPersistFailed(payload) {
          if (memoryFailedSent || !payload) return;
          memoryFailedSent = true;
          writeHomeBrainFactSseEvent(res, "error", payload);
        },
      };

      const result = await handleHomeBrainFactRequest({
        userSupabase,
        customerId: resolved.customerId,
        authUserId: resolved.user?.id ?? null,
        entityContext,
        question: presenceTurn ? "" : question,
        history: presenceTurn ? [] : history,
        attachedDocumentId: presenceTurn ? null : attachedDocumentId,
        attachedDocumentIds: presenceTurn ? [] : attachedDocumentIds,
        priorAttachFollowUp: presenceTurn ? false : priorAttachFollowUp,
        attachmentReferenceEnabled: presenceTurn ? false : attachmentReferenceEnabled,
        activeAttachmentIds: presenceTurn ? [] : activeAttachmentIds,
        currentTurnDocumentIds: presenceTurn ? [] : currentTurnDocumentIds,
        explicitReopenDocumentIds: presenceTurn ? [] : explicitReopenDocumentIds,
        sessionId,
        readyCardHandoffToken,
        presenceTurn,
        shadowVisualBlocksOverride: presenceTurn ? null : shadowVisualBlocksOverride,
        accessToken: authHeader,
        clientTurnId,
        pointedContractIds: presenceTurn ? [] : pointedContractIds,
        phase8TraceBag,
        streamHandlers,
        requestStartedAt,
        threadPublicCitations: presenceTurn ? [] : threadPublicCitations,
        threadVerifiedFactRefs: presenceTurn ? [] : threadVerifiedFactRefs,
        threadHandoffMemo,
      });

      if (!result.ok) {
        if (!earlyDoneSent && !memoryFailedSent) writeHomeBrainFactSseError(res, result);
        res.end();
        return;
      }

      if (memoryFailedSent) {
        res.end();
        return;
      }

      // Early done already closed the customer UI; do not emit a second done.
      if (!earlyDoneSent) {
        writeHomeBrainFactSseEvent(res, "done", result);
      } else {
        // Trailing marks only — client ignores; seat evidence for persist timing.
        const lm =
          result?.sales_director_trace?.key_compose_trace?.key_voice_trace?.latency_marks ??
          null;
        const t0 = lm?.triangle_t0 ?? null;
        writeHomeBrainFactSseEvent(res, "marks", {
          triangle_t0: t0,
          streamed_equals_sealed:
            t0?.streamed_equals_sealed ??
            result?.sales_director_trace?.key_compose_trace?.streamed_equals_sealed ??
            null,
          ttft_ms: lm?.ttft_ms ?? null,
          git_commit_sha: lm?.git_commit_sha ?? null,
        });
      }
      res.end();
      return;
    }

    const result = await handleHomeBrainFactRequest({
      userSupabase,
      customerId: resolved.customerId,
      authUserId: resolved.user?.id ?? null,
      entityContext,
      question: presenceTurn ? "" : question,
      history: presenceTurn ? [] : history,
      attachedDocumentId: presenceTurn ? null : attachedDocumentId,
      attachedDocumentIds: presenceTurn ? [] : attachedDocumentIds,
      priorAttachFollowUp: presenceTurn ? false : priorAttachFollowUp,
      attachmentReferenceEnabled: presenceTurn ? false : attachmentReferenceEnabled,
      activeAttachmentIds: presenceTurn ? [] : activeAttachmentIds,
      currentTurnDocumentIds: presenceTurn ? [] : currentTurnDocumentIds,
      explicitReopenDocumentIds: presenceTurn ? [] : explicitReopenDocumentIds,
      sessionId,
      readyCardHandoffToken,
      presenceTurn,
      shadowVisualBlocksOverride: presenceTurn ? null : shadowVisualBlocksOverride,
      accessToken: authHeader,
      clientTurnId,
      pointedContractIds: presenceTurn ? [] : pointedContractIds,
      phase8TraceBag,
      threadPublicCitations: presenceTurn ? [] : threadPublicCitations,
      threadVerifiedFactRefs: presenceTurn ? [] : threadVerifiedFactRefs,
      threadHandoffMemo,
    });

    if (!result.ok) {
      res.statusCode = result.reason === "INVALID_BODY" ? 400 : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    if (res.getHeader("Content-Type") === "text/event-stream; charset=utf-8") {
      if (!memoryFailedSent) {
        writeHomeBrainFactSseError(res, {
          ok: false,
          reason: "SERVER_ERROR",
          error_message: error instanceof Error ? error.message : "Home brain fact lookup failed.",
        });
      }
      res.end();
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Home brain fact lookup failed.",
      }),
    );
  }
}
