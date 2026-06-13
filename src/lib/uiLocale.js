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
  documents: "문서 관리",
  documentCategory: "문서 분류",
  documentFilename: "파일명",
  documentUploadDate: "업로드 일시",
  documentStatus: "상태",
  documentFileSize: "파일 크기",
  emptyValue: "—",
};

const DOC_CLASS_LABELS = {
  policy_certificate: "보험증권",
  terms: "약관",
  claim: "청구서류",
  medical: "의료서류",
  other: "기타문서",
};

const INGEST_STATUS_LABELS = {
  uploaded: "업로드 완료",
  pending: "업로드 완료",
  queued: "대기 중",
  processing: "처리 중",
  ready: "분석 완료",
  failed: "실패",
  analysis_blocked_by_consent: "분석 동의 필요",
  deleted: "삭제됨",
};

export const DOCUMENT_UI_MESSAGES = {
  consentTitle: "문서 보관 동의",
  consentBody:
    "보험·청구·의료 서류를 안전하게 보관하기 위해 문서 보관 동의가 필요합니다. 동의 후 업로드할 수 있습니다.",
  consentAction: "동의하고 계속",
  uploadSuccess: "문서가 업로드되었습니다.",
  deleteSuccess: "문서가 삭제되었습니다.",
  deleteConfirm: "이 문서를 삭제하시겠습니까?",
  emptyList: "아직 업로드된 문서가 없습니다.",
  selectFile: "파일을 선택해 주세요.",
  uploadAction: "업로드",
  downloadAction: "다운로드",
  deleteAction: "삭제",
  refreshAction: "새로고침",
  allCategories: "전체",
  loginRequired: "로그인이 필요합니다.",
  analysisNotice:
    "업로드 후 문서 분석 동의가 있으면 OCR 분석이 자동으로 시작됩니다. 동의가 없으면 상태가 '분석 동의 필요'로 표시됩니다.",
  analysisConsentTitle: "문서 분석 동의",
  analysisConsentBody:
    "업로드한 보험·청구·의료 서류에서 보험 정보를 추출하고 맞춤 분석에 활용하려면 문서 분석 동의가 필요합니다.",
  analysisConsentAction: "분석 동의하고 시작",
  analysisConsentSuccess: "문서 분석 동의가 완료되었습니다. 대기 중인 문서 분석을 시작합니다.",
  analysisBlockedNotice: "문서 분석 동의가 필요합니다. 아래에서 동의 후 분석을 시작해 주세요.",
  ingestQueuedNotice: "문서 분석이 대기열에 등록되었습니다.",
  ingestFailedNotice: "문서 분석 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  policyExtractSuccessNotice: "보험정보 추출이 완료되었습니다.",
  policyExtractPartialNotice: "문서 OCR은 완료되었으나 보험정보 추출에 필요한 항목이 부족합니다.",
  pipelineRefreshSuccessNotice: "보장·인수·추천·설계 분석이 자동 갱신되었습니다.",
  pipelineAnalysisFailedNotice: "문서 OCR·보험정보 추출은 완료되었으나 분석 갱신에 실패했습니다.",
  pipelineMemoryFailedNotice: "보험정보는 추출되었으나 메모리 동기화에 실패했습니다.",
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

export const LOGIN_INVALID_CREDENTIALS_MESSAGE =
  '이메일 또는 비밀번호가 맞지 않습니다.\n비밀번호를 잊으셨다면 아래의 "비밀번호 찾기"를 이용해 주세요.';

const SUPABASE_ERROR_PATTERNS = [
  {
    test: /invalid login credentials/i,
    message: LOGIN_INVALID_CREDENTIALS_MESSAGE,
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

export function formatDocClass(docClass) {
  if (!docClass) return UI_LABELS.emptyValue;
  return DOC_CLASS_LABELS[docClass] ?? docClass;
}

export function formatIngestStatus(status) {
  if (!status) return UI_LABELS.emptyValue;
  return INGEST_STATUS_LABELS[status] ?? status;
}

export function formatDocumentPipelineStatus(document) {
  if (!document) return UI_LABELS.emptyValue;
  const ingestStatus = document.ingest_status;
  const extractionStatus = document.metadata_json?.policy_extraction_status;

  if (ingestStatus === "ready" && extractionStatus === "completed") {
    return "분석·보험정보 추출 완료";
  }
  if (ingestStatus === "ready" && extractionStatus === "pending_manual_review") {
    return "OCR 완료 · 관리자 검토 대기";
  }
  if (ingestStatus === "ready" && extractionStatus === "extraction_failed") {
    return "OCR 완료 · 보험정보 추출 필요";
  }
  if (ingestStatus === "ready" && !extractionStatus) {
    return "OCR 완료 · 보험정보 추출 대기";
  }
  return formatIngestStatus(ingestStatus);
}

export function formatFileSize(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes <= 0) {
    return UI_LABELS.emptyValue;
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUploadDate(value) {
  if (!value) return UI_LABELS.emptyValue;
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return UI_LABELS.emptyValue;
  }
}

export function formatLoginErrorMessage(error, fallback = "로그인에 실패했습니다.") {
  const raw = typeof error === "string" ? error : error?.message;
  if (raw && /invalid login credentials/i.test(raw.trim())) {
    return LOGIN_INVALID_CREDENTIALS_MESSAGE;
  }
  return toCustomerErrorMessage(error, fallback);
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
