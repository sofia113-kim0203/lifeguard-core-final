-- =============================================================================
-- LIFEGUARD Core — 003_seed_rule_packs.sql
-- Seed default rule_packs / rule_pack_versions for consultation orchestration.
-- Requires 001_initial_schema.sql applied first.
-- NOT for INSUX / INSUX2 / insux-pro-ai databases.
-- =============================================================================
-- Adds structured columns to rule_pack_versions (001 file unchanged; applied here).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extend rule_pack_versions for structured seed (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rule_pack_versions
  ADD COLUMN IF NOT EXISTS title               TEXT,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS rule_body           JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS prompt_guidelines   TEXT,
  ADD COLUMN IF NOT EXISTS safety_guidelines   TEXT,
  ADD COLUMN IF NOT EXISTS output_schema       JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'retired'));

COMMENT ON COLUMN public.rule_pack_versions.rule_body IS
  'Machine-readable rules; used with customer memory + document RAG.';
COMMENT ON COLUMN public.rule_pack_versions.output_schema IS
  'Expected response shape labels for guard + UI (future).';

-- Keep status ↔ is_active aligned on seed rows
UPDATE public.rule_pack_versions SET is_active = (status = 'active') WHERE status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helper: upsert pack + version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_seed_rule_pack_version(
  p_slug              TEXT,
  p_pack_title        TEXT,
  p_version           TEXT,
  p_version_title     TEXT,
  p_description       TEXT,
  p_body_markdown     TEXT,
  p_rule_body         JSONB,
  p_prompt_guidelines TEXT,
  p_safety_guidelines TEXT,
  p_output_schema     JSONB,
  p_tags              TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_pack_id UUID;
BEGIN
  INSERT INTO public.rule_packs (slug, title)
  VALUES (p_slug, p_pack_title)
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
  RETURNING id INTO v_pack_id;

  IF v_pack_id IS NULL THEN
    SELECT id INTO v_pack_id FROM public.rule_packs WHERE slug = p_slug;
  END IF;

  INSERT INTO public.rule_pack_versions (
    rule_pack_id,
    version,
    title,
    body_markdown,
    topic_tags,
    is_active,
    status,
    description,
    rule_body,
    prompt_guidelines,
    safety_guidelines,
    output_schema
  )
  VALUES (
    v_pack_id,
    p_version,
    p_version_title,
    p_body_markdown,
    p_tags,
    TRUE,
    'active',
    p_description,
    p_rule_body,
    p_prompt_guidelines,
    p_safety_guidelines,
    p_output_schema
  )
  ON CONFLICT (rule_pack_id, version) DO UPDATE SET
    title             = EXCLUDED.title,
    body_markdown     = EXCLUDED.body_markdown,
    topic_tags        = EXCLUDED.topic_tags,
    is_active         = TRUE,
    status            = 'active',
    description       = EXCLUDED.description,
    rule_body         = EXCLUDED.rule_body,
    prompt_guidelines = EXCLUDED.prompt_guidelines,
    safety_guidelines = EXCLUDED.safety_guidelines,
    output_schema     = EXCLUDED.output_schema,
    updated_at        = NOW();
END;
$$;

-- =============================================================================
-- 1. disclosure_check_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'disclosure_check_basic',
  '고지 의무·병력 이력 검토 (기본)',
  '1.0.0',
  '고지 가능성 분류 — 기본',
  '고객 건강정보(profile_health, memory)와 업로드 문서를 함께 참고하여 병력·복용약·수술·입원·검사·치료 고지 필요성을 **가능성** 수준으로 분류합니다.',
  E'## 요약\n병력·복용·수술·입원·검사·치료 이력의 **고지 가능성**을 판단합니다. 법적 확정·인수 거절 단정 금지.\n\n## 입력 우선순위\n1. customer_memory_facts (건강)\n2. profile_health\n3. customer_document_chunks (진단서·처방·입원기록 등)\n\n## 출력 라벨\n- 고지 가능성 있음 (추가 확인 필요)\n- 고지 가능성 낮음 (자료상 근거 부족)\n- 전문가(담당 설계사) 확인 필요',
  jsonb_build_object(
    'pack_slug', 'disclosure_check_basic',
    'inputs_required', jsonb_build_array('profile_health', 'customer_memory_facts', 'customer_document_chunks'),
    'checklist', jsonb_build_array(
      jsonb_build_object('key', 'medication_history', 'label', '복용약·처방'),
      jsonb_build_object('key', 'surgery_history', 'label', '수술 이력'),
      jsonb_build_object('key', 'hospitalization', 'label', '입원·응급'),
      jsonb_build_object('key', 'diagnosis_exam', 'label', '진단·검사'),
      jsonb_build_object('key', 'ongoing_treatment', 'label', '현재 치료')
    ),
    'decision_labels', jsonb_build_array(
      'disclosure_likely_needs_review',
      'disclosure_unlikely_insufficient_data',
      'requires_agent_review'
    ),
    'forbidden_phrases', jsonb_build_array('반드시 고지해야 합니다', '인수 거절 확정', '보험금 지급 확정')
  ),
  E'- 고객 기억·건강 프로필·업로드 문서에 **명시된 사실만** 인용한다.\n- 문서와 기억이 충돌하면 “추가 확인 필요”로 통일한다.\n- 답변 말미: 참고한 기억 키, 문서명(D#), 본 규칙 팩 버전.\n- 라벨은 반드시: 고지 가능성/추가 확인 필요/전문가 확인 필요 중 하나를 대표값으로 제시.',
  E'- 법적 확정·행정처분 단정 금지.\n- “가입 불가”“해지 필요” 권유 금지.\n- 주민등록번호 등 민감정보 반복·저장 요구 금지.\n- 자료 없으면: “등록된 자료에서 확인할 수 없습니다.”',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'rationale', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '고지 가능성 있음 (추가 확인 필요)',
          '고지 가능성 낮음 (자료 부족)',
          '전문가(담당 설계사) 확인 필요'
        )
      ),
      'checklist_findings', jsonb_build_object('type', 'array'),
      'rationale', jsonb_build_object('type', 'string'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['disclosure', 'health', 'underwriting', 'memory', 'documents']
);

-- =============================================================================
-- 2. claim_possibility_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'claim_possibility_basic',
  '보험금 청구 가능성 (기본)',
  '1.0.0',
  '청구 가능성 분류 — 기본',
  '진단서·영수증·세부내역서·약관(문서 RAG)과 고객 기억을 바탕으로 실손/진단비/수술비/입원비/통원비 **청구 가능성**을 분류합니다. 지급 확정 금지.',
  E'## 요약\n청구 **가능성**만 평가합니다. 지급액·지급 확정 표현 금지.\n\n## 담보 구분\n- 실손의료비\n- 진단비\n- 수술비\n- 입원비\n- 통원·외래\n\n## 출력 라벨\n- 청구 가능성 높음 / 중간 / 낮음 / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'claim_possibility_basic',
    'inputs_required', jsonb_build_array('customer_document_chunks', 'customer_memory_facts', 'profile_insurance_policies'),
    'document_types', jsonb_build_array('diagnosis', 'receipt', 'detail_statement', 'policy_terms'),
    'coverage_lines', jsonb_build_array('indemnity_medical', 'diagnosis_lump_sum', 'surgery', 'hospitalization', 'outpatient'),
    'decision_labels', jsonb_build_array(
      'claim_possibility_high',
      'claim_possibility_medium',
      'claim_possibility_low',
      'insufficient_documents'
    ),
    'forbidden_phrases', jsonb_build_array('지급 확정', '반드시 지급', '청구 불가 확정')
  ),
  E'- 약관·진단서·영수증·세부내역서 청크를 우선 인용.\n- 보종별로 가능성을 **분리** 서술 후 대표 라벨 1개 제시.\n- 자료 부족 시 필요 서류 목록만 제안 (법적 강제 표현 없음).',
  E'- 보험금 지급액·지급일 단정 금지.\n- 보험사 최종 심사 대체 표현 금지.\n- 분쟁·소송 조언 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'by_coverage_line', 'missing_documents', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array('청구 가능성 높음', '청구 가능성 중간', '청구 가능성 낮음', '자료 부족')
      ),
      'by_coverage_line', jsonb_build_object('type', 'array'),
      'missing_documents', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['claim', 'documents', 'terms', 'indemnity', 'diagnosis']
);

-- =============================================================================
-- 3. coverage_gap_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'coverage_gap_basic',
  '보장 공백 분석 (기본)',
  '1.0.0',
  '보장 공백 — 기본',
  '암/뇌/심장/실손/수술/입원/사망/후유/운전자/배상 등 **공백 가능성**을 portfolio·나이·가족·직업·기억과 함께 검토합니다.',
  E'## 요약\n보장 **부족 가능성**을 제시합니다. 상품 가입·해지 권유 금지.\n\n## 보장 축\n암, 뇌혈관, 심장, 실손, 수술, 입원, 사망, 후유장해, 운전자, 배상책임\n\n## 출력\n- 공백 가능성 있음 / 검토 필요 / 현 자료상 양호 / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'coverage_gap_basic',
    'inputs_required', jsonb_build_array(
      'profile_insurance_policies', 'customer_memory_facts', 'customer_profiles',
      'customer_document_chunks'
    ),
    'coverage_axes', jsonb_build_array(
      'cancer', 'brain', 'heart', 'indemnity', 'surgery', 'hospitalization',
      'death', 'disability', 'driver', 'liability'
    ),
    'decision_labels', jsonb_build_array(
      'gap_likely',
      'gap_review_needed',
      'adequate_on_available_data',
      'insufficient_data'
    ),
    'forbidden_phrases', jsonb_build_array('반드시 가입', '즉시 해지', '부족 확정')
  ),
  E'- 기존 가입 내역은 policy·memory·문서에서 확인된 범위만 사용.\n- 나이·직업·가족은 profile·memory에서 인용.\n- 축별 “가능한 공백”과 “검토 필요”를 구분.\n- 개선은 방향만 (예: “실손 한도 검토 필요”).',
  E'- 특정 상품명·보험사 가입 권유 금지.\n- 공백을 확정적으로 단정하지 말 것 (“가능성”“검토 필요”).',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'gaps_by_axis', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '보장 공백 가능성 있음',
          '검토 필요',
          '현 자료상 양호',
          '자료 부족'
        )
      ),
      'gaps_by_axis', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['coverage', 'gap', 'portfolio', 'family', 'memory']
);

-- =============================================================================
-- 4. duplicate_coverage_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'duplicate_coverage_basic',
  '중복 보장·과다 보험료 검토 (기본)',
  '1.0.0',
  '중복 보장 — 기본',
  '중복 보장·과다 보험료·갱신형 부담 **가능성**만 판단. 해지·축소 **권유 금지**, “검토 필요” 표현만 사용.',
  E'## 요약\n중복·과다 **가능성** 진단. 해지/감액 지시 금지.\n\n## 검토 항목\n- 동일 담보 중복 (진단/수술/실손 등)\n- 보험료 부담 대비 겹침\n- 갱신형 보험료 상승 부담 가능성\n\n## 출력\n- 중복 가능성 높음 / 검토 필요 / 특이사항 없음(자료 범위) / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'duplicate_coverage_basic',
    'inputs_required', jsonb_build_array('profile_insurance_policies', 'customer_document_chunks', 'customer_memory_facts'),
    'review_topics', jsonb_build_array('duplicate_rider', 'premium_burden', 'renewal_premium_risk'),
    'decision_labels', jsonb_build_array(
      'duplicate_likely',
      'review_needed',
      'no_signal_in_data',
      'insufficient_data'
    ),
    'forbidden_actions', jsonb_build_array('cancel_policy', 'reduce_coverage', 'switch_insurer'),
    'allowed_phrases', jsonb_build_array('검토 필요', '담당 설계사와 정리 권장', '가능성')
  ),
  E'- 계약별 겹침 후보만 나열.\n- “해지하세요”“줄이세요” 대신 “중복 여부 **검토 필요**”.\n- 보험료 수치는 자료에 있을 때만 인용.',
  E'- 해지·가입·전환 강권 절대 금지.\n- 특정 회사 비방·비교 우위 단정 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'overlap_candidates', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '중복 가능성 높음 (검토 필요)',
          '검토 필요',
          '현 자료 범위 내 특이사항 없음',
          '자료 부족'
        )
      ),
      'overlap_candidates', jsonb_build_object('type', 'array'),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['duplicate', 'premium', 'renewal', 'portfolio']
);

-- =============================================================================
-- 5. rebalancing_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'rebalancing_basic',
  '리밸런싱 필요성 (기본)',
  '1.0.0',
  '리밸런싱 방향 — 기본',
  '보험료 부담·갱신 예정·보장 부족·가족 변화를 바탕으로 **리밸런싱 필요성**만 제시. 상품 추천·가입 권유 금지.',
  E'## 요약\n개선 **방향**만 제시 (우선순위·검토 축). 특정 상품 추천 금지.\n\n## 신호\n- 보험료 부담 (memory/프로필)\n- 갱신 예정\n- coverage_gap 신호와 연계 가능\n- 가족 구성 변화\n\n## 출력\n- 리밸런싱 검토 권장 / 선택적 검토 / 현 상태 유지(자료상) / 자료 부족',
  jsonb_build_object(
    'pack_slug', 'rebalancing_basic',
    'inputs_required', jsonb_build_array(
      'customer_memory_facts', 'profile_insurance_policies', 'customer_profiles', 'customer_document_chunks'
    ),
    'signals', jsonb_build_array('premium_stress', 'renewal_upcoming', 'coverage_gap', 'family_change'),
    'decision_labels', jsonb_build_array(
      'rebalancing_recommended',
      'optional_review',
      'maintain_on_data',
      'insufficient_data'
    ),
    'output_style', 'direction_only',
    'forbidden_phrases', jsonb_build_array('이 상품에 가입', '지금 해지', '최고의 상품')
  ),
  E'- 3개 이내 개선 방향 bullet (예: “실손 한도 점검”, “진단비 중복 정리 검토”).\n- outbox `rebalancing.review.suggested` 이벤트는 서버가 선택 발행 (규칙은 제안만).\n- 상품명·보험사명 나열은 “검토 대상” 수준만.',
  E'- 가입·해지·전환 유도 금지.\n- 수익률·세무 확정 금지.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'directions', 'sources'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '리밸런싱 검토 권장',
          '선택적 검토',
          '현 자료상 유지',
          '자료 부족'
        )
      ),
      'directions', jsonb_build_object('type', 'array', 'maxItems', 3),
      'sources', jsonb_build_object('type', 'array')
    )
  ),
  ARRAY['rebalancing', 'renewal', 'premium', 'family', 'coverage']
);

-- =============================================================================
-- 6. agent_escalation_basic
-- =============================================================================
SELECT public.lifeguard_seed_rule_pack_version(
  'agent_escalation_basic',
  '설계사 연계·AI 한계 (기본)',
  '1.0.0',
  'AI 단독 답변 금지 트리거 — 기본',
  '계약 해지·고지 확정·지급 확정·세무/법률 단정·고액 변경 등 **AI 단독 답변 금지** 조건을 정의하고, 충족 시 `agent.escalation.requested` outbox 이벤트 발행을 **서버**에 권고합니다.',
  E'## 요약\n아래 트리거 시 AI는 요약만 제공하고 **담당 설계사 연결**을 안내.\n\n## AI 단독 답변 금지 예시\n- 계약 해지/해지환급 확정 요청\n- 고지 의무 위반 여부 확정\n- 보험금 지급 확정\n- 세무·법률 결론\n- 고액 계약 변경·구조 변경\n\n## outbox (서버)\n`event_type`: agent.escalation.requested',
  jsonb_build_object(
    'pack_slug', 'agent_escalation_basic',
    'triggers', jsonb_build_array(
      jsonb_build_object('code', 'cancellation_decision', 'label', '해지·해지환급 확정'),
      jsonb_build_object('code', 'disclosure_final', 'label', '고지 위반 확정'),
      jsonb_build_object('code', 'claim_payment_final', 'label', '보험금 지급 확정'),
      jsonb_build_object('code', 'tax_legal_certainty', 'label', '세무·법률 단정'),
      jsonb_build_object('code', 'high_value_contract_change', 'label', '고액·구조 변경')
    ),
    'ai_allowed', jsonb_build_array('summarize_documents', 'list_review_points', 'explain_process'),
    'outbox_event', jsonb_build_object(
      'event_type', 'agent.escalation.requested',
      'payload_keys', jsonb_build_array('customer_id', 'consultation_id', 'trigger_codes', 'summary')
    ),
    'decision_labels', jsonb_build_array('escalate_required', 'escalate_recommended', 'ai_can_continue')
  ),
  E'- 트리거 충족 시: “AI 단독 확정 불가 → 담당 설계사 확인” 문구 필수.\n- trigger_codes 배열로 이유 명시.\n- 서버가 outbox_events INSERT (클라이언트 직접 INSERT 불필요).\n- agent_assignments.status 가 unassigned 이면 “배정 대기” 안내.',
  E'- AI가 확정·법률자문·지급 약속 금지.\n- 설계사 비방·회사 내부정보 노출 금지.\n- 고객 불안 조성 표현 자제.',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('primary_label', 'trigger_codes', 'customer_message', 'emit_outbox'),
    'properties', jsonb_build_object(
      'primary_label', jsonb_build_object(
        'enum', jsonb_build_array(
          '설계사 연결 필요',
          '설계사 연결 권장',
          'AI 계속 가능 (트리거 없음)'
        )
      ),
      'trigger_codes', jsonb_build_object('type', 'array'),
      'emit_outbox', jsonb_build_object('type', 'boolean'),
      'outbox_event_type', jsonb_build_object('const', 'agent.escalation.requested')
    )
  ),
  ARRAY['agent', 'escalation', 'safety', 'outbox', 'compliance']
);

-- Drop seed helper (optional — keep for re-run migrations in dev)
-- DROP FUNCTION public.lifeguard_seed_rule_pack_version;

COMMIT;
