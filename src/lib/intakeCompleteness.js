import { HEALTH_DISCLOSURE_FIELD_DEFS } from "./healthDisclosure.js";

const VALID_GENDERS = new Set(["male", "female", "other"]);
const DISCLOSURE_STATUSES = new Set(["yes", "no", "unknown"]);
const MIN_AGE_YEARS = 14;

export const INTAKE_VALIDATION_MESSAGES = {
  displayNameRequired: "이름을 입력해 주세요.",
  birthDateRequired: "생년월일을 선택해 주세요.",
  birthDateInvalid: "올바른 생년월일을 선택해 주세요.",
  birthDateFuture: "생년월일은 오늘 이전이어야 합니다.",
  birthDateTooYoung: "만 14세 이상만 이용할 수 있습니다.",
  genderRequired: "성별을 선택해 주세요.",
  genderInvalid: "성별을 선택해 주세요.",
  consultationPurposeRequired: "상담 목적을 입력해 주세요.",
};

export const HEALTH_DISCLOSURE_HINT =
  "예를 선택하셨다면 메모를 입력해 주시면 분석에 도움이 됩니다.";

function parseBirthDate(value) {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function ageFromBirthDate(birthDate) {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export function validateIntakeForm(form) {
  const fieldErrors = {};

  if (!form.displayName?.trim()) {
    fieldErrors.displayName = INTAKE_VALIDATION_MESSAGES.displayNameRequired;
  }

  const birthDateValue = form.birthDate?.trim() ?? "";
  if (!birthDateValue) {
    fieldErrors.birthDate = INTAKE_VALIDATION_MESSAGES.birthDateRequired;
  } else {
    const parsed = parseBirthDate(birthDateValue);
    if (!parsed) {
      fieldErrors.birthDate = INTAKE_VALIDATION_MESSAGES.birthDateInvalid;
    } else if (parsed > startOfToday()) {
      fieldErrors.birthDate = INTAKE_VALIDATION_MESSAGES.birthDateFuture;
    } else if (ageFromBirthDate(parsed) < MIN_AGE_YEARS) {
      fieldErrors.birthDate = INTAKE_VALIDATION_MESSAGES.birthDateTooYoung;
    }
  }

  const gender = form.gender?.trim() ?? "";
  if (!gender) {
    fieldErrors.gender = INTAKE_VALIDATION_MESSAGES.genderRequired;
  } else if (!VALID_GENDERS.has(gender)) {
    fieldErrors.gender = INTAKE_VALIDATION_MESSAGES.genderInvalid;
  }

  if (!form.consultationPurpose?.trim()) {
    fieldErrors.consultationPurpose = INTAKE_VALIDATION_MESSAGES.consultationPurposeRequired;
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function getHealthDisclosureHints(form) {
  const hints = {};
  for (const { statusKey, notesKey } of HEALTH_DISCLOSURE_FIELD_DEFS) {
    const status = form.healthDisclosure?.[statusKey]?.trim() ?? "";
    const notes = form.healthDisclosure?.[notesKey]?.trim() ?? "";
    if (status === "yes" && !notes) {
      hints[notesKey] = HEALTH_DISCLOSURE_HINT;
    }
  }
  return hints;
}

export function computeIntakeCompleteness(form) {
  const sections = {
    basicProfile: { label: "기본 프로필", score: 0, max: 30 },
    consultationPurpose: { label: "상담 목적", score: 0, max: 15 },
    address: { label: "주소", score: 0, max: 10 },
    healthDisclosure: { label: "건강 고지", score: 0, max: 35 },
    insuranceSummary: { label: "보험 요약", score: 0, max: 10 },
  };

  if (form.displayName?.trim()) sections.basicProfile.score += 10;

  const birthDate = parseBirthDate(form.birthDate?.trim() ?? "");
  if (
    birthDate &&
    birthDate <= startOfToday() &&
    ageFromBirthDate(birthDate) >= MIN_AGE_YEARS
  ) {
    sections.basicProfile.score += 10;
  }

  if (VALID_GENDERS.has(form.gender?.trim() ?? "")) {
    sections.basicProfile.score += 10;
  }

  if (form.consultationPurpose?.trim()) {
    sections.consultationPurpose.score = 15;
  }

  if (form.address?.trim()) {
    sections.address.score = 10;
  }

  let healthScore = 0;
  for (const { statusKey } of HEALTH_DISCLOSURE_FIELD_DEFS) {
    const status = form.healthDisclosure?.[statusKey]?.trim() ?? "";
    if (DISCLOSURE_STATUSES.has(status)) {
      healthScore += 7;
    }
  }
  sections.healthDisclosure.score = Math.min(35, healthScore);

  if (
    form.insurerName?.trim() ||
    form.productName?.trim() ||
    form.insuranceSummary?.trim()
  ) {
    sections.insuranceSummary.score = 10;
  }

  const score = Object.values(sections).reduce((sum, section) => sum + section.score, 0);

  return { score, sections };
}

export function formatCompletenessLabel(score) {
  if (score >= 100) return "완료";
  if (score >= 80) return "거의 완료";
  if (score >= 50) return "작성 중";
  return "입력 시작";
}
