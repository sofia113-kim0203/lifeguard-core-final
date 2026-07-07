# readonly-audit-v1 — Archive

**Authority:** Tom  
**Purpose:** 역사 보존 전용. 청소 완료 후 퇴역한 readonly 감사 script 보관.

## 금지 (헌법)

- **실행 경로 아님** — 고객 Runtime · KEY Runtime · Factory Runtime에 연결 금지
- `package.json` npm 등록 금지
- `server/` · `api/` · `src/` import 금지
- deploy · probe · cron 연결 금지
- Archive에서 script 재실행 금지 (import 경로 의도적 비활성)

## 포함

| 폴더 | 내용 |
|------|------|
| `utilization/` | utilization-gap readonly audit (j07, j10) |
| `gi-1/` | KEY-GI-1 readonly audit (7 scripts) |

## 유지 (이동 안 함)

- `fixtures/key-judgment-validation-v1/` — bank, rubric, scorecard, evidence JSON 전체
- GI-1 exec / unit-test, RC trace, Factory live, KEY Master Gate

## 복원

Tom GO 없이 복원·재배선 금지.
