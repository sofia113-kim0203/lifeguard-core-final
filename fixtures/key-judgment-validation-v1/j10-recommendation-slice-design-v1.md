# J10 Recommendation Utilization Gap — Slice Design v1

**Status:** Jerry design — awaiting Tom Audit (HOLD, no implementation GO)  
**Target:** J10 — "지금 뭐부터 추가하면 좋을까?"  
**Axis:** recommendation · current: `available_not_loaded`  
**Authority:** Jerry proposes · Tom audits · Jinwoo decides

---

## Why Tom HOLD is correct

Recommendation is the highest **sales-misread** risk in KEY. Customers hear:

- 뭘 **추가**할지
- 뭘 **보완**할지
- 뭘 **추천**할지

A wrong limb makes KEY look like a seller, not a careful partner. This slice must connect **stored priority signals only** — never a new recommender.

---

## Observed baseline (hop trace)

| Hop | J10 today |
|-----|-----------|
| Factory | ✅ `recommendation` in job (`customer_visible_top2`, 13 ranked items) |
| Resolver | ❌ no preload |
| Manifest | ❌ no KEY tool; plan = `snapshot, memory` |
| Compose | ❌ generic filler |
| Final | ❌ `recommendation loaded=false used=false` |

**Sibling split (critical):**

| ID | intent | KEY path | Today |
|----|--------|----------|-------|
| **J10** | `general_consultation` | KEY ON | `sales_director_key` |
| J11 | `recommendation_request` | KEY **blocked** | `sales_director_guarded_hold` |
| J12 | `recommendation_request` | KEY **blocked** | `sales_director_guarded_hold` |

**Jerry proposal:** fix **J10 KEY path only**. Do **not** unguard J11/J12 in this slice.

---

## 1. Resolver — read-only preload of stored `recommendation`

**Proposal:** New `server/salesDirectorRecommendationContext.js` (mirror gap/UW resolvers).

| Step | Action |
|------|--------|
| Source | `analysis_jobs.result_json.recommendation` (latest `completed` job) |
| Loop | `salesDirectorLoop.js` — parallel preload → `customerContextBundle.recommendationContext` |
| Read scope | **`customer_visible_top2` only** for KEY-facing normalize |
| Internal count | `record_count = customer_visible_top2.length` (0–2), not full `recommendations.length` |

**Normalized context shape (KEY-facing):**

```text
loaded, available, record_count, source: "analysis_jobs", job_id
priority_labels[]     — coverage_label from top2 (max 2)
priority_signals[]    — e.g. "암:우선검토", "실손:서류준비"
priority_types[]      — compact recommendation_type (add_coverage | prepare_documents | review_existing)
has_stored_priorities — boolean(top2.length > 0)
```

**Explicitly NOT loaded into KEY compose:**

- Full `recommendations[]` ranking
- `recommendation_score`, carrier/product fields (none in top2 today — keep absent)
- Re-run `buildCoverageCategoryRecommendations` on KEY path

**Factory touch:** none — read-only from existing job payload.

---

## 2. Manifest — add recommendation limb?

**Proposal:** **Yes** — Resolver preload **and** stored-read KEY tool (same rhythm as J07 UW).

| Option | Verdict |
|--------|---------|
| Context-only | ❌ `factoryAudit.used=true` unreliable pre-finalize (J04/J07 lesson) |
| Preload + `KEY_TOOLS.RECOMMENDATION` | ✅ `runStoredRecommendationTool` → `factBundle.recommendation_used=true` |

**Tool name:** `recommendation` (not `recommendation_engine`, not `RECOMMENDATION_RISK`).

**Tool behavior:** Read preloaded context; if missing, load from `analysis_jobs`; **no Factory recompute**.

**Plan gate:** `shouldAddRecommendationTool(classification, question)` — **only** when intent is `recommendation_priority_check` (see §3). Never when `recommendation_request`.

**Optional co-tools for J10:** Do **not** auto-add `coverage_gap` in v1 — priority already fused in Factory top2. Adding gap risks double-speaking gap + rec. Tom to confirm.

---

## 3. Scope — J10 only; J11/J12 guarded_hold unchanged

**Proposal:**

| Question | Slice v1 |
|----------|----------|
| J10 | ✅ In scope |
| J11 | ❌ Out of scope — keep `DEFAULT_BLOCKED_INTENTS.recommendation_request` |
| J12 | ❌ Out of scope — same |

**Rationale:** J11/J12 are explicitly `recommendation_request` → `guarded_hold`. That may be intentional product guard. Opening them when fixing J10 would change KEY surface area for all customers, not just utilization.

**Future:** Separate Tom decision + design if J11/J12 should move to KEY with stricter guards — not bundled with J10.

**New intent (J10 only):** `recommendation_priority_check`

**Trigger patterns (narrow):**

- `지금.{0,12}뭐부터.{0,12}추가`
- `뭐부터.{0,12}(추가|손)` + insurance topic present
- `무엇부터.{0,12}추가`

**Must NOT match:**

- `추천`, `보완`, `뭐가 부족`, `가입해야`, `들어야` → stay `recommendation_request`
- `청구`, `보험금` → claim paths
- `뭐부터 해야 할지 모르겠어` (30Q Q25) → companion/relational, not rec priority

**Judgment intent (formatter):** new `recommendation_priority_judgment` — **not** `recommendation_reason` (that implies explain-stored-rec for blocked path).

---

## 4. `customer_visible_top2` only

**Proposal:** Hard ceiling for spoken + factBundle fields.

**Allowed fields from each top2 item:**

- `coverage_label`
- `recommendation_type` (mapped to customer-safe compact: 우선검토 / 서류준비 / 구조점검)
- `reason` (already Factory-generated from gap+UW — trim to one line, no product names)

**Forbidden to surface:**

- Items beyond rank 2
- `recommendation_rank`, `recommendation_score` in customer text
- Insurer/product names (not in top2 schema today — guard anyway)
- Full `recommendations[]` dump

**Empty top2:** honest absence — "저장된 우선순위 분석이 아직 없어, 보장 구조부터 같이 보면 됩니다." Not invented priorities.

---

## 5. Guards — avoid sales / product push

**Forbidden output (compose + `FALSE_ASSERTION_PATTERNS`):**

- `~가입하세요`, `~들으세요`, `이 상품`, `추천드립니다`, `제가 추천`
- Insurer superiority, guaranteed enrollment
- Binding "먼저 ○○보험에 가입"

**Required framing:**

- "저장된 분석 기준으로"
- "우선 **볼 여지** / **같이 짚을 축**" (not "가입할 보험")
- "특정 상품 가입을 단정·권유하기는 어렵습니다"
- Align with `advisorRecommendationReasonResponder`: **예비 검토**, not guaranteed advice

**Guard layers:**

1. Compose templates — priority-axis language only
2. `FALSE_ASSERTION_PATTERNS` extension — `requires: "rec_product_evidence"` (never set true on KEY path)
3. Unit test — J10 forbidden-regex negative + priority-limitation positive
4. Judgment Bank misuse — factory rec available + product-push language = misuse

**Constitution:** Reuse Factory rule — no new recommendation algorithm on KEY path.

---

## 6. Answer tone — J10 "추가하면 좋을까?"

**Target tone (example — Tom to refine):**

> 저장된 분석 기준으로, 지금 우선 같이 볼 여지가 있는 축은 ○○과 △△입니다. 어느 쪽부터 짚을지는 같이 정하면 됩니다. 특정 상품 가입을 단정하거나 권유드리기는 어렵습니다.

**Not:**

> ○○보험부터 추가하세요.  
> 1순위는 △△입니다, 가입하시면 됩니다.

**If top2 empty:**

> 저장된 우선순위 분석이 아직 없어, 지금은 보장 구조부터 같이 보면 됩니다.

---

## 7. `answer_evidence` — how recommendation appears

| Flag | True when |
|------|-----------|
| **available** | Stored probe finds non-empty `recommendation` with top2 or payload |
| **loaded** | `recommendationContext.loaded === true` OR tool executed |
| **used** | `factBundle.recommendation_used === true` AND compose referenced top2 labels with limitation |

**Mechanism:**

1. `runStoredRecommendationTool` → `factBundle.recommendation_used`
2. Extend `engineLoaded` / `engineUsed` for `factoryKey === "recommendation"`
3. `buildAnswerEvidence()` → includes `"recommendation"` when `used`
4. HUL merges `recommendationContext` into factBundle (mirror UW block)

**Expected J10:** `["snapshot", "memory", "recommendation"]` (gap optional off in v1)

---

## 8. Misuse criteria (Judgment Bank)

| Condition | Classification |
|-----------|----------------|
| Factory rec available + product-push / binding enroll language | **misuse** |
| Factory rec available + spoken rank > top2 | **misuse** |
| Factory rec available + used=false + generic filler (no priority, no honest absence) | disconnect (`available_not_loaded` / `loaded_not_used`) — not misuse if limitation present |
| Factory rec absent + honest "분석 없음" | **honest_absence** |
| J11/J12 on guarded_hold unchanged | out of slice misuse scope |

**Sacred gate:** misuse=0/12 maintained on Preview.

---

## 9. 30Q Customer Validation regression risk

| Risk | Mitigation |
|------|------------|
| Q25 "뭐부터 해야 할지 모르겠어" false positive | Intent requires **추가/보장/보험** axis — exclude bare confusion |
| Q07 "보험금 청구…뭐부터" | Exclude `청구|보험금` from priority intent |
| Generic "추천" questions in 30Q | Bank has no direct J10 clone — low overlap |
| Friction from sales tone | Compose guards + Preview 30Q gate Friction 0 |

**Required gates (post-implementation):** full WIP deploy · J10 → J04–J06 → J07–J09 → 12Q · 30Q Friction 0.

---

## Tom Audit checklist (Jerry asks)

1. Is top2-only tight enough, or should we also allow `keep_existing` as spoken "유지 축"?
2. Is `recommendation_priority_check` narrow enough vs Q25?
3. Confirm J11/J12 stay blocked for v1.
4. Confirm no `coverage_gap` co-tool on J10 v1 (avoid double factory voice).
5. Is example tone "partner" not "seller"?

---

## Forbidden (Tom stated)

- New recommendation engine
- Factory recompute
- Exposure beyond top2
- Product enrollment push
- Unguard `guarded_hold` for J11/J12

---

## Proposed file touch (when Tom Slice GO — not now)

**New:** `server/salesDirectorRecommendationContext.js`  
**Modify:** `salesDirectorLoop.js`, `salesDirectorKeyToolRegistry.js`, `salesDirectorKeyOrchestrator.js`, `salesDirectorFactoryAudit.js`, `intentGateLayer.js`, `salesDirectorFormatter.js`, `humanUnderstandingLoop.js`, `keyJudgmentRules.js`, unit tests

**Out of scope v1:** `DEFAULT_BLOCKED_INTENTS`, J11/J12 paths, Advisor Brain responder rewrite

---

## Success criteria (Preview — for Tom after implementation)

- [ ] J10 `recommendation_priority_check` + `recommendation` tool
- [ ] `factoryAudit.recommendation.used = true`
- [ ] `answer_evidence` includes `recommendation`
- [ ] No product-push / binding enroll phrases
- [ ] misuse 0/12 · J04–J06 · J07–J09 unchanged · 30Q Friction 0
- [ ] J11/J12 still `guarded_hold` / KEY blocked

---

*Jerry — design proposal only. Awaiting Tom Audit GO/HOLD on slice.*
