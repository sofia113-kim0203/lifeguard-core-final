/**
 * Train P — Preview/Production KEY intelligence path parity (minimal).
 * VERCEL_ENV must not alone disable Borrowed Senses promotion / Claude-Full gate.
 */
import assert from "node:assert/strict";
import {
  isStage2PromotionEnvAllowed,
  isStage3PromotionEnvAllowed,
  isKeyBorrowedSensesProbeEnabled,
  isKeyBorrowedSensesStage2Partial,
  isVercelProductionEnv,
} from "../server/keyCore/oneKeyCoreFlags.js";
import { decideStage2Promotion } from "../server/keyCore/keyBorrowedSensesStage2.js";
import { decideStage3Promotion } from "../server/keyCore/keyBorrowedSensesStage3.js";

function envPair(mode) {
  const base = { KEY_BORROWED_SENSES: mode };
  return {
    preview: { ...base, VERCEL_ENV: "preview" },
    production: { ...base, VERCEL_ENV: "production" },
  };
}

function assertParity(label, previewVal, productionVal) {
  assert.deepEqual(
    productionVal,
    previewVal,
    `${label}: production must equal preview (got preview=${JSON.stringify(previewVal)} production=${JSON.stringify(productionVal)})`,
  );
}

// --- Flag helpers ---
{
  const { preview, production } = envPair("active_partial");
  assert.equal(isVercelProductionEnv(production), true);
  assert.equal(isVercelProductionEnv(preview), false);
  assert.equal(isKeyBorrowedSensesStage2Partial(preview), true);
  assert.equal(isStage2PromotionEnvAllowed(preview), true);
  assert.equal(isStage2PromotionEnvAllowed(production), true);
  assertParity("isStage2PromotionEnvAllowed(active_partial)", true, true);
}

{
  const { preview, production } = envPair("active");
  assert.equal(isStage3PromotionEnvAllowed(preview), true);
  assert.equal(isStage3PromotionEnvAllowed(production), true);
  assertParity("isStage3PromotionEnvAllowed(active)", true, true);
}

{
  const { preview, production } = envPair("shadow");
  assert.equal(isStage2PromotionEnvAllowed(preview), false);
  assert.equal(isStage2PromotionEnvAllowed(production), false);
  assert.equal(isStage3PromotionEnvAllowed(preview), false);
  assert.equal(isStage3PromotionEnvAllowed(production), false);
  assert.equal(isKeyBorrowedSensesProbeEnabled(preview), true);
  assert.equal(isKeyBorrowedSensesProbeEnabled(production), true);
}

{
  const { preview, production } = envPair("off");
  assert.equal(isStage2PromotionEnvAllowed(preview), false);
  assert.equal(isStage2PromotionEnvAllowed(production), false);
}

// --- Stage2 decide: production must not early-fail as production_blocked ---
{
  const { preview, production } = envPair("active_partial");
  const q = "보험 추천해줘";
  const dPreview = decideStage2Promotion({ question: q, s6FinalAnswer: "s6", env: preview });
  const dProd = decideStage2Promotion({ question: q, s6FinalAnswer: "s6", env: production });
  assert.notEqual(dPreview.fallback_reason, "production_blocked");
  assert.notEqual(dProd.fallback_reason, "production_blocked");
  assert.equal(dProd.production_blocked, false);
  assertParity(
    "decideStage2Promotion.fallback_reason",
    dPreview.fallback_reason,
    dProd.fallback_reason,
  );
  assertParity(
    "decideStage2Promotion.promotion_pass",
    dPreview.promotion_pass,
    dProd.promotion_pass,
  );
}

// --- Stage3 decide: same ---
{
  const { preview, production } = envPair("active");
  const q = "오늘 날씨 어때";
  const dPreview = decideStage3Promotion({ question: q, s6FinalAnswer: "s6", env: preview });
  const dProd = decideStage3Promotion({ question: q, s6FinalAnswer: "s6", env: production });
  assert.notEqual(dPreview.fallback_reason, "production_blocked");
  assert.notEqual(dProd.fallback_reason, "production_blocked");
  assert.equal(dProd.production_blocked, false);
  assertParity(
    "decideStage3Promotion.fallback_reason",
    dPreview.fallback_reason,
    dProd.fallback_reason,
  );
  assertParity(
    "decideStage3Promotion.promotion_pass",
    dPreview.promotion_pass,
    dProd.promotion_pass,
  );
}

// --- Claude-Full gate formula parity (mirrors keyVoiceCompose) ---
{
  for (const mode of ["shadow", "active", "active_partial", "off"]) {
    const { preview, production } = envPair(mode);
    const formula = (e) =>
      isKeyBorrowedSensesProbeEnabled(e) && !isKeyBorrowedSensesStage2Partial(e);
    assertParity(`claudeFullSinglePass(${mode})`, formula(preview), formula(production));
  }
}

console.log("PASS key-preview-production-parity-unit-test");
