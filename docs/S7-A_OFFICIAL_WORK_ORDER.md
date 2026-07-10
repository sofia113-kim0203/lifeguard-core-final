# S7-a 공식 작업서
## Claude Integrated Talent · Public Research · Speed

문서 상태: ACTIVE  
문서 역할: S7-a의 상태, 작업순서, PASS/HOLD, NEXT, OPEN LOOPS를 관리하는 단일 실행 작업서  
우선순위: LIFEGUARD 헌법 및 상위 설계 원칙 > 본 작업서 > 구현 세부사항

---

## 1. 공식 기준선

- Active Slice:
  S7-a
- Official HEAD:
  aa28b831a3ec8a33a231d61ed6524cb6472e4095
- Preview runtime:
  f6427880da2c77656296fc028801b38fbd29221a
- Preview deploy:
  PASS
- Survival probe:
  PASS
- Same-session observe:
  HOLD
- Production:
  untouched
- 원격 서비스 피해:
  없음
- commit / push / env / 신규 deploy:
  없음

### 현재 로컬 상태

격리된 구현 후보 7파일:

1. server/keyCore/keyBorrowedSensesSpeak.js
2. server/keyCore/keyBorrowedSensesStage2.js
3. server/keyCore/keyBorrowedSensesStage3.js
4. server/keyCore/keyVoiceCompose.js
5. server/keyCore/keyVoiceDirective.js
6. scripts/key-voice-unit-test.mjs
7. scripts/key-borrowed-senses-stage3-unit-test.mjs

기존 evidence dirty 2파일:

1. fixtures/key-judgment-validation-v1/key-master-preview-deploy-evidence.json
2. fixtures/key-judgment-validation-v1/key-master-survival-preview-evidence.json

위 7파일은 폐기 대상이 아니다.
정확한 과거 checkpoint가 없으므로 줄 단위 추측 복원도 하지 않는다.
현재 전체 diff를 QUARANTINED CANDIDATE로 취급하고,
two-phase 계약 기준으로 다시 감사한 뒤 보존·수정 여부를 판정한다.

---

## 2. Claude Integrated Talent 원칙

KEY는 Claude의 재능을 찔끔 빌리지 않는다.
그 턴에 필요한 연결 가능한 재능인
이해, 맥락 인식, 읽기, 검색, 도구 사용,
대화 추론, 계획, 표현을 한 호흡으로
KEY 자신의 이름 아래 사용한다.

단, 다음 네 가지는 어떤 경우에도 Claude에게 위임하지 않는다.

1. 사실의 확정
2. 최종 판단과 권고의 소유
3. 기억의 채택·수정·보관
4. 최종 승인과 책임

Claude는 가설, 검색, 비교, 판단 재료, 대안,
답변 후보를 만들 수 있다.
KEY는 무엇을 사실로 채택하고,
어떤 방향을 고객에게 권하며,
무엇을 최종 출력할지 결정하고 책임진다.

다음은 영구 금지한다.

- Claude의 전체 능력 백지 위임
- Claude 백지 판단
- ⑤ 판단 위임
- 검증되지 않은 사실의 확정
- 고객별 계약 판단의 위임

고객이 만나는 이름과 책임지는 이름은 항상 KEY다.

---

## 3. 현재 Human Gate 실패와 해결 목표

동일 세션 관찰:

T1.
분당 맛집 추천해줘
T2.
부모님 모시고 가는데 아버지가 최근 수술하셨어
T3.
수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야

확인된 PASS:

- 동일 세션 history [0, 2, 4]
- 턴당 고객 출력 1개
- KEY Master 단일 출구
- T2 식사와 부모님 편의 우선
- T3 지급 단정 없음
- T3 서류와 해당 담보 확인으로 연결
- 22개 계약 나열로 이탈하지 않음

확인된 HOLD:

- T1이 실제 맛집 후보를 제공하지 못함
- 검색 책임을 고객에게 전가함
- T1 끝에 무관한 보험 초대가 들어감
- 세 턴 모두 regeneration 1회 발생
- 최신 공개 정보를 찾는 검색 능력이 KEY runtime에 연결되지 않음

S7-a의 실질 목표:
맛집을 물으면 Claude가 최신 공개 정보를 직접 찾고 비교한다.
KEY가 출처와 사실을 채택한다.
Claude가 그 근거를 사용해 자연스러운 답변 후보를 만든다.
KEY가 최종 승인하고 KEY 이름으로 고객에게 출력한다.

---

## 4. 속도 5단 원칙

### 4.1 신호등 라우팅

GREEN:
Claude가 필요 없는 인사, 버튼, 검증 조회,
결정적 계산 결과는 KEY가 즉답한다.

YELLOW:
이해, 맥락, 공감, 설명, 대화 추론이 필요한 턴은
Claude 통합 재능을 사용한다.

BLUE:
최신 공개 사실이나 외부 자료가 필요한 턴은
검색과 KEY evidence 채택 후 답변을 만든다.

측정 전 전체 턴 중 각 경로의 비율을 사실처럼 단정하지 않는다.

### 4.2 Sentence-Commit Streaming

- 진행 상태는 즉시 표시할 수 있다.
- 고객 답변은 완성된 문장 또는 의미 블록을
  Gate 통과 후 append-only로 순차 출력한다.
- 미검증 Claude 원문 토큰 스트리밍은 금지한다.
- SSE replace와 이미 출력한 문장 삭제·교체는 금지한다.
- 숫자, 장소, 계약 사실은 evidence 확인 전 출력하지 않는다.
- 불완전한 문장 상태로 스트림을 종료하지 않는다.

### 4.3 선반 준비

로그인, 페이지 진입, 고객 타이핑 시간에 다음 재료를 준비할 수 있다.

- 계약 요약
- 관련 기억
- Session Goal
- Claim Scanner 후보
- Insurance Blackbox 기록
- KEY Lifeline 시한
- 관련 evidence와 Chart 조각

고객 질문 전에 최종 판단이나 답변을 확정하지 않는다.

### 4.4 모델 다이얼

필요한 재능의 깊이에 따라 모델을 결정할 수 있다.
모델과 관계없이 동일한 Chart, evidence, Gate,
KEY 책임 계약을 유지한다.
속도를 이유로 최종 판단을 Claude에게 넘기지 않는다.

### 4.5 캐싱

캐시 가능:

- 헌법
- 격
- 금지선
- 출력 형식
- 도구 규칙
- 변하지 않은 공통 지시

격리 또는 캐시 금지:

- 다른 고객의 사실
- 민감 기억
- 오래된 계약 상태
- 현재성이 필요한 검색 결과
- 채택되지 않은 판단 가설

캐시는 속도 수단이며 사실의 출처가 아니다.

---

## 5. 공식 작업순서

### Phase 0 — 작업서 및 현재 구현 후보 통제

1. 본 공식 작업서를 생성하고 잠근다.
2. 현재 7파일을 QUARANTINED CANDIDATE로 유지한다.
3. 과거 checkpoint 추측 복원을 중단한다.
4. 현재 7파일 전체를 two-phase 계약 기준으로 재감사한다.
5. 승인 범위와 맞지 않는 부분만 근거를 갖고 수정한다.

### Phase 1 — 정확성 및 Public Research 계약

6. Anthropic web search와 emit_borrowed_senses를
   같은 provider request에 혼합하지 않는다.
7. 검색 필요 턴은 다음 순서를 강제한다.
   web search
   → KEY public research evidence 구성
   → Claude emit
   → 첫 final-answer Gate
   → KEY Master 출력
8. 검색 불필요 턴은 기존 emit 단일 호출 경로를 유지한다.
9. pause_turn을 공식 provider 계약대로 처리한다.
10. empty result, tool error, max uses, timeout,
    rate limit, refusal, max_tokens를 구분한다.
11. encrypted_content와 encrypted_index 원문을
    내부 evidence에 손실 없이 보존한다.
    고객 로그에는 원문을 노출하지 않는다.
12. 첫 답변 승인 전에 research evidence가 존재해야 한다.
13. 답변에 언급된 장소명과 구체적 사실을
    채택된 evidence와 대조한다.
14. 근거 없는 장소명, 평점, 영업시간,
    가격, 주소, 주차 단정을 차단한다.
15. 비보험 요청에 무관한 보험 초대와 전환을 차단한다.
16. 안전한 답변은 mid-field warning만으로 재생성하지 않는다.
17. 실제 answer-facing 위험에만 regeneration을
    최대 1회 허용한다.
18. regeneration은 동일 evidence를 사용하고 재검색하지 않는다.

Phase 1 완료 조건:

- mixed tools 0
- evidence before emit
- evidence before first Gate
- T1 실제 맛집 후보 최소 3곳과 근거
- T1 보험 언급 0
- T2 부모님 식사와 이동 편의 우선
- T3 지급 단정 없이 서류·담보 확인
- 안전 답변 regeneration 0
- 위험 답변 regeneration 최대 1

### Phase 2 — 회귀와 구현 감사

19. 관련 unit, Stage2, Stage3, Gate, Voice,
    F3, F5, F6, premium, cancer 회귀를 통과한다.
20. 현재 7파일의 focused diff를 감사한다.
21. 새 Factory, classifier, detector, Guard,
    speaker가 불필요하게 추가되지 않았음을 확인한다.
22. 코드와 evidence 변경을 분리한다.
23. PASS 후에만 commit한다.

### Phase 3 — Preview 정확성 검증

24. 공식 Preview deploy를 수행한다.
25. Survival probe를 수행한다.
26. 동일 세션 T1/T2/T3 observe를 수행한다.
27. 정확성과 고객 가치를 판정한다.

### Phase 4 — 속도 계측

28. 다음 값을 runtime에서 측정한다.

- route_selected
- time_to_status
- time_to_first_committed_sentence
- time_to_complete
- provider 호출 수
- tool 호출 수
- Gate 소요 시간
- regeneration 수
- cache hit
- evidence 준비 완료 시각
- 중단 또는 실패 사유

29. p50과 p95를 함께 측정한다.

### Phase 5 — 체감 속도 구현

30. GREEN / YELLOW / BLUE 라우팅
31. 검색·처리 상태 이벤트
32. Gate와 공존하는 sentence-commit streaming
33. 선반 준비
34. 모델 다이얼
35. 안전한 프롬프트 캐싱

각 항목은 기존 자산을 먼저 확인하고
연결 또는 최소 수정으로 구현한다.

### Phase 6 — 최종 검증 및 Closeout

36. 정확성과 속도를 함께 Preview에서 재검증한다.
37. 진우 Human Gate를 수행한다.
38. 고객 가치와 실제 체감 속도를 진우가 판정한다.
39. evidence, env, worktree, dirty 상태를 정리한다.
40. S7-a OPEN LOOPS 0을 확인한다.
41. S7-a closeout 후에만 S7-b를 시작한다.

---

## 6. 성능 목표

| 경로 | 첫 상태 또는 첫 승인 문장 | 전체 완료 |
|---|---:|---:|
| GREEN 인사·버튼·검증 조회 | 0.5초 이내 | 1초 이내 |
| 결정적 Factory 결과 | 1초 이내 | 2초 이내 |
| YELLOW 외부 검색 없는 상담 | 목표 1초, p95 2초 | p50 3초, p95 6초 |
| BLUE 검색·외부 도구 | 상태 1초 이내 | 첫 검증 답변 p50 8초, 전체 p95 20초 |
| 장애·재시도 | 상태 지속 | 30초 전에 정직한 실패 |

성능 목표를 위해 다음을 희생하지 않는다.

- Gate
- 출처와 evidence
- 문장 완결성
- KEY 단일 출구
- KEY의 최종 판단과 책임

---

## 7. 간판 3능력과의 관계

Claim Scanner, Insurance Blackbox, KEY Lifeline은
각각의 계산, 매칭, 기록, 기한 판단을
검증된 Factory와 KEY가 소유한다.
Claude는 결과를 이해하고 설명하며
고객 맥락에 맞게 대화를 이어갈 수 있다.

이번 S7-a에서는 간판 3능력 자체를 구현하지 않는다.

- S9: Claim Scanner
- S10: Insurance Blackbox
- S11: KEY Lifeline

세 기능은 S7-a에서 완성한
통합 재능, 검색, Gate, 속도, 책임 계약 위에 올라간다.

---

## 8. 현재 Ledger

ACTIVE:

- S7-a 공식 작업서 생성 및 잠금

NEXT:

- 현재 7파일 QUARANTINED CANDIDATE 전체 감사
- two-phase public research 계약 완성

BLOCKED:

- T1 실제 맛집 후보 부재
- T1 보험 오염
- 안전한 답변의 과잉 regeneration
- provider mixed-tool 계약 미완성

OPEN LOOPS:

- 현재 7파일 전체 무결성 감사
- two-phase provider 계약
- provider smoke
- Preview 동일 세션 재관찰
- 속도 계측
- sentence-commit streaming
- Human Gate
- evidence와 dirty 상태 정리
- S7-a closeout

FUTURE:

- S7-b 평생 기억
- S9 Claim Scanner
- S10 Insurance Blackbox
- S11 KEY Lifeline

Production:

- untouched

---

## 9. 작업 통제 규칙

- GO 하나는 실행 하나다.
- 이전 GO 결과를 판정한 뒤 다음 GO를 내린다.
- READ ONLY는 파일 생성과 수정 모두 금지다.
- 구현 전 기존 자산을 확인한다.
- commit 전 focused diff 감사를 통과한다.
- Production은 별도 GO 없이는 절대 변경하지 않는다.
- 진우가 최종 Human Gate 판정자다.
- S7-a closeout 전 S7-b를 시작하지 않는다.
