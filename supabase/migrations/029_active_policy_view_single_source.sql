-- 029_active_policy_view_single_source.sql
-- 활성 보험 정책의 단일 진실원. 필터(미삭제·미은퇴)를 한 곳에 못박는다.
-- security_invoker=true → 기준 테이블 RLS가 호출자에 그대로 적용(고객은 본인 것만, service role은 우회).
-- 읽기 전용 view. 모든 writer는 base 테이블 profile_insurance_policies를 계속 사용.

CREATE OR REPLACE VIEW public.active_profile_insurance_policies
WITH (security_invoker = true) AS
SELECT *
FROM public.profile_insurance_policies
WHERE deleted_at IS NULL
  AND is_active IS DISTINCT FROM FALSE;

COMMENT ON VIEW public.active_profile_insurance_policies IS
  'Single source of truth for active (not deleted, not retired) insurance policies. RLS-respecting (security_invoker). Read-only; writers use profile_insurance_policies.';

GRANT SELECT ON public.active_profile_insurance_policies TO authenticated, service_role;
