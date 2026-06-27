# J07 Underwriting Utilization Gap — Slice Design v1

**Status:** Tom HOLD (design only — no implementation GO)  
**Target:** J07 — "고혈압 있는데 가입 가능해?"  
**Axis:** underwriting · current: `available_not_loaded`

---

## Goal (not binding enrollment)

When `underwriting_risk` exists in Factory, KEY must **reference** it honestly:

> 가입 가능 여부는 단정할 수 없고, 고혈압 관련 인수심사 확인이 필요합니다.

**Never:** 가입 가능합니다 · 가입 안 됩니다 · 이 상품 됩니다 · 인수 가능 확정

---

## Why this is harder than Coverage Gap

| Hop | J04/J06 (fixed) | J07 (today) |
|-----|-----------------|-------------|
| Factory | ✅ | ✅ (9 items in job) |
| Resolver | ✅ gap preload | ❌ **no UW preload** |
| Manifest | ❌ tool omitted → fixed | ❌ **no UW tool exists** |
| Compose | partial → fixed | ❌ no UW inputs |
| Final | used=false → fixed | ❌ generic safe only |

Coverage Gap needed **intent/plan alignment only**. Underwriting needs **new KEY limb** (Resolver + Manifest).

---

## 1. Resolver — how to preload `underwriting_risk`

**Decision:** New `server/salesDirectorUnderwritingRiskContext.js`, mirroring `salesDirectorCoverageGapContext.js`.

| Step | Action |
|------|--------|
| Source | `analysis_jobs.result_json.underwriting_risk` (latest `completed` job) |
| Loop | `salesDirectorLoop.js` — `Promise.all` with gap load → `customerContextBundle.underwritingRiskContext` |
| Normalize | Signals only — no binding verdicts |

**Normalized context shape (KEY-facing):**

- `loaded`, `available`, `record_count`, `source: "analysis_jobs"`, `job_id`
- `signals[]` — e.g. `고혈압:추가확인`, `likely_surcharge:암`
- `health_risk_labels[]` — from `health_risk_items`
- `review_needed: true` when panel has additional_review / surcharge / exclusion flags

**Not in scope:** Re-run `analyzeUnderwritingRisk` on KEY path. **Read stored panel only.** Factory engine untouched.

---

## 2. Manifest — UNDERWRITING tool vs read-only context?

**Decision:** **Both** — Resolver preload **and** `UNDERWRITING_RISK` KEY tool (same rhythm as `COVERAGE_GAP`).

| Option | Verdict |
|--------|---------|
| Context-only | ❌ Audit `used=true` breaks — factoryAudit runs on pre-finalize `agentTurn` (J04 pre-slice lesson) |
| Tool + Resolver | ✅ `runUnderwritingRiskTool` → `factBundle.underwriting_used=true` |

**Tool behavior:** Read preloaded context (or load if missing); **no engine recompute**.  
**Plan gate:** `shouldAddUnderwritingRiskTool()` — enrollment-bound + health/UW-shaped questions only.

---

## 3. Intent — where J07 is classified

**Decision:** New intent `underwriting_bound_check` in `intentGateLayer.js`.

**J07 triggers (minimal):**

- Disease/health lexicon + enrollment bound: `가입 가능`, `들 수`, `가입돼`
- Example: `고혈압…가입 가능`

**Judgment intent (formatter):** New `underwriting_bound_judgment` in `QUESTION_INTENT_RULES`.

**Guards unchanged:**

- `뭐가 부족해?` → `recommendation_request`
- J04/J06 gap patterns → `coverage_gap_check`

---

## 4. `factoryAudit` — loaded / used criteria

| Flag | True when |
|------|-----------|
| **available** | Stored probe finds non-empty `underwriting_risk` payload |
| **loaded** | `underwritingRiskContext.loaded === true` OR tool executed |
| **used** | `factBundle.underwriting_used === true` (from toolRun, pre-finalize) |

**Measurement fix (audit only):** `countStoredFactoryRecords('underwriting')` should count `payload.items[]` — today returns 0 despite 9 items (shape mismatch).

**Target utilization:** J07 `available_not_loaded` → **`used`**

---

## 5. `answer_evidence` — how underwriting appears

1. `engineUsed` → `audit.underwriting.used = true`
2. `buildAnswerEvidence()` → includes `"underwriting"`
3. HUL merges `customerState.underwritingRiskContext` into compose factBundle (mirror coverage gap block in `humanUnderstandingLoop.js`)

**Expected J07:** `["snapshot", "memory", "underwriting"]`

---

## 6. False-approval guard (sacred)

**Forbidden in final text:**

- 가입 가능합니다 / 가입 안 됩니다 / 가입 불가
- 인수 가능 / 인수 승인 / 거절됩니다 (확정)
- 이 상품 됩니다

**Guard layers:**

1. Compose: limitation-first templates only
2. Extend `FALSE_ASSERTION_PATTERNS` — binding enrollment without `uw_evidence`
3. Unit test: J07 forbidden-regex negative + review-language positive
4. Judgment Bank **misuse=0** gate — binding approval with factory present = misuse

**Allowed:** 단정할 수 없, 확인 필요, 인수심사, 고혈압…확인

Aligns with `customerUnderwritingRiskCore` — no final binding approval/decline.

---

## 7. J08 / J09 impact scope

| ID | Question | Expected after J07 slice |
|----|----------|--------------------------|
| **J08** | 건강 상태 때문에 거절될까? | Same intent family — likely inherits fix (observe, not separate slice) |
| **J09** | 암 보험 지금 들 수 있을까? | May run **coverage_gap + underwriting_risk** tools — verify dual used, no product push |

**Preview subset after GO:** `--only J07,J08,J09` + J04–J06 regression.

---

## 8. 30Q Customer Validation impact

- **Direct overlap:** None — 30Q bank has no 고혈압/가입 가능/거절 questions
- **Risk:** Low if patterns stay narrow (health + enrollment bound)
- **Gates:** Full WIP deploy · 30Q Friction 0 · misuse 0/12 · coverage_gap 3/3 regression

---

## Success criteria (Preview — for Tom GO after implementation)

- [ ] J07 `underwriting_bound_check` + `underwriting_risk` in tools
- [ ] `factoryAudit.underwriting.used = true`
- [ ] `answer_evidence` includes `underwriting`
- [ ] No forbidden binding phrases
- [ ] misuse 0/12 · 30Q Friction 0 · J04–J06 unchanged

---

## Files (when Tom Slice GO — not now)

**New:** `server/salesDirectorUnderwritingRiskContext.js`  
**Modify:** `salesDirectorLoop.js`, `salesDirectorKeyToolRegistry.js`, `salesDirectorKeyOrchestrator.js`, `salesDirectorFactoryAudit.js`, `intentGateLayer.js`, `salesDirectorFormatter.js`, `humanUnderstandingLoop.js`, unit tests

**Forbidden:** Factory recompute · Companion-only · answer string patch · new Brain/Persona

---

*Jerry — design only. Awaiting Tom Slice GO.*
