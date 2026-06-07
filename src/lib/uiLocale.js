/** Customer-facing display labels and Korean error mapping. */

export const UI_LABELS = {
  customerId: "고객 ID",
  email: "이메일",
  role: "역할",
  currentRole: "현재 역할",
  requiredRole: "필요 역할",
  loginStatus: "로그인 상태",
  customerInfo: "고객 정보",
  profileStatus: "프로필 상태",
  userRole: "사용자 역할",
  healthProfile: "건강 프로필",
  requiredConsents: "필수 동의",
  intakeCompleteness: "입력 완료도",
  emptyValue: "—",
};

const USER_ROLE_LABELS = {
  customer: "고객",
  admin: "관리자",
  agent: "설계사",
};

const PROFILE_STATUS_LABELS = {
  draft: "작성 중",
  active: "활성",
  suspended: "이용 정지",
};

const HEALTH_SOURCE_LABELS = {
  signup: "가입",
  update: "정보 수정",
  import: "데이터 가져오기",
};

const SUPABASE_ERROR_PATTERNS = [
  {
    test: /invalid login credentials/i,
    message: "이메일 또는 비밀번호가 올바르지 않습니다.",
  },
  {
    test: /user already registered|already been registered/i,
    message: "이미 가입된 이메일입니다.",
  },
  {
    test: /email not confirmed/i,
    message: "이메일 인증이 완료되지 않았습니다. 메일함을 확인해 주세요.",
  },
  {
    test: /jwt expired|session expired/i,
    message: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
  },
  {
    test: /does not exist|relation .* does not exist/i,
    message: "서비스 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
  },
  {
    test: /row-level security|permission denied|not authorized/i,
    message: "접근 권한이 없습니다. 로그인 상태를 확인해 주세요.",
  },
  {
    test: /network|fetch failed|failed to fetch/i,
    message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  },
];

export function formatUserRole(role) {
  if (!role) return UI_LABELS.emptyValue;
  return USER_ROLE_LABELS[role] ?? role;
}

export function formatProfileStatus(status) {
  if (!status) return UI_LABELS.emptyValue;
  return PROFILE_STATUS_LABELS[status] ?? status;
}

export function formatHealthSource(source) {
  if (!source) return "출처 없음";
  return HEALTH_SOURCE_LABELS[source] ?? source;
}

export function formatRequiredRoles(roles) {
  if (!roles?.length) return UI_LABELS.emptyValue;
  return roles.map((role) => formatUserRole(role)).join(", ");
}

export function toCustomerErrorMessage(error, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.") {
  const raw = typeof error === "string" ? error : error?.message;
  if (!raw) return fallback;

  const trimmed = raw.trim();
  const matched = SUPABASE_ERROR_PATTERNS.find(({ test }) => test.test(trimmed));
  if (matched) return matched.message;

  if (/[가-힣]/.test(trimmed)) return trimmed;

  return fallback;
}
