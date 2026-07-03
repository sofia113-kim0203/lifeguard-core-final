# GI-1 QA 채점표 (Tom)

**status:** rubric GO frozen · Live QA GO wait (Tom/진우 + ops API Key)  
**pass_declaration:** none

## QA vs Regression

| | 질문 |
|---|------|
| **QA** | 정말 좋아졌는가? |
| **Regression** | 안 망가졌는가? |

QA는 감이 아니라 **1~5 채점**입니다.

---

## 평가 항목 (문항마다 1~5)

| 항목 | ID | 질문 |
|------|-----|------|
| 자연스러움 | `naturalness` | 답변이 자연스러운가? |
| 사실 정확성 | `factual_accuracy` | 사실 오류는 없는가? |
| 설명력 | `explanatory_power` | GPT 수준으로 설명되는가? |
| KEY 말투 유지 | `key_voice` | KEY 말투가 유지되는가? |
| 보험 억지 연결 없음 | `no_insurance_push` | 보험을 억지로 끌어오지 않는가? |

### 공통 척도

| 점수 | 의미 |
|------|------|
| 1 | 실패 — 고객 좌석에서 쓸 수 없음 |
| 2 | 미흡 — GPT/KEY 기대 미달 |
| 3 | 보통 — GI-1 baseline으로는 부족 |
| 4 | 양호 — 쓸 만함 · 소폭 개선 여지 |
| 5 | 우수 — GPT에 가깝고 KEY로 읽힘 |

상세 anchor: `gi-1-qa-rubric-v1.json`

---

## 합격 기준

```
문항 점수 = 5개 항목 평균
QA 평균   = 20문항 평균

QA 평균 ≥ 4.5  →  QA 통과  →  Regression ~110 GO
QA 평균 < 4.5  →  L1(Prompt/Profile) 보완  →  Regression 보류
```

---

## 채점표 (Tom fill — Live QA 후)

| ID | Domain | Question | 자연 | 사실 | 설명 | KEY | 보험X | 문항평균 | Notes |
|----|--------|----------|------|------|------|-----|-------|----------|-------|
| QA-HIS-01 | 역사 | 세종대왕이 한글을 만든 이유가 뭐야 | | | | | | | |
| QA-HIS-02 | 역사 | 조선시대 과거제가 뭐야 | | | | | | | |
| QA-SCI-01 | 과학 | 양자컴퓨터가 뭐야 쉽게 | | | | | | | |
| QA-SCI-02 | 과학 | 광합성이 뭐야 | | | | | | | |
| QA-ECO-01 | 경제 | 인플레이션이 뭐야 | | | | | | | |
| QA-ECO-02 | 경제 | GDP가 뭐야 | | | | | | | |
| QA-IT-01 | IT | VPN이 뭐야 | | | | | | | |
| QA-IT-02 | IT | ChatGPT가 어떻게 답을 만들어 | | | | | | | |
| QA-TRV-01 | 여행 | 강원도 여행 추천해줘 | | | | | | | |
| QA-TRV-02 | 여행 | 일본 여행 준비물 | | | | | | | |
| QA-FD-01 | 맛집 | 분당 맛집 추천 | | | | | | | |
| QA-FD-02 | 맛집 | 김치찌개 맛있게 끓이는 법 | | | | | | | |
| QA-HLT-01 | 건강상식 | 하루 물 얼마나 마셔야 해 | | | | | | | |
| QA-HLT-02 | 건강상식 | 고혈압 줄이는 생활 | | | | | | | |
| QA-EDU-01 | 교육 | 영어 공부 처음 시작할 때 | | | | | | | |
| QA-EDU-02 | 교육 | 코딩 배우려면 뭐부터 | | | | | | | |
| QA-LIF-01 | 생활 | 이사할 때 체크리스트 | | | | | | | |
| QA-LIF-02 | 생활 | 전기요금 아끼는 방법 | | | | | | | |
| QA-PHI-01 | 철학 | 행복이란 뭐라고 생각해? | | | | | | | |
| QA-PHI-02 | 철학 | 자유의지가 있다고 볼 수 있을까? | | | | | | | |

**QA 평균:** _pending_  
**QA 통과 (≥4.5):** _pending_  
**Tom verdict:** _pending_

---

## 다음 순서 (Tom GO 후)

1. ~~Rubric GO~~ ✅ frozen  
2. Live QA GO (Tom/진우) + ops API Key  
3. Live QA 20문항 실행  
4. Tom 채점 (this table / `gi-1-qa-scorecard-template-v1.json`)  
5. QA 통과 → Regression ~110 → Close

SSOT: `fixtures/key-judgment-validation-v1/gi-1-qa-rubric-v1.json`
