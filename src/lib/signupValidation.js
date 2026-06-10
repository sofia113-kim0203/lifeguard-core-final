const VALID_GENDERS = new Set(["male", "female", "other"]);
const MIN_AGE_YEARS = 14;
const PHONE_PATTERN = /^01[0-9]-?\d{3,4}-?\d{4}$/;

export const SIGNUP_VALIDATION_MESSAGES = {
  displayNameRequired: "이름을 입력해 주세요.",
  phoneRequired: "휴대폰 번호를 입력해 주세요.",
  phoneInvalid: "올바른 휴대폰 번호를 입력해 주세요. (예: 010-1234-5678)",
  birthDateRequired: "생년월일을 선택해 주세요.",
  birthDateInvalid: "올바른 생년월일을 선택해 주세요.",
  birthDateFuture: "생년월일은 오늘 이전이어야 합니다.",
  birthDateTooYoung: "만 14세 이상만 이용할 수 있습니다.",
  genderRequired: "성별을 선택해 주세요.",
  genderInvalid: "성별을 선택해 주세요.",
};

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

export function normalizeSignupPhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(value).trim();
}

export function validateSignupProfile({
  displayName = "",
  phone = "",
  birthDate = "",
  gender = "",
} = {}) {
  const fieldErrors = {};

  if (!displayName?.trim()) {
    fieldErrors.displayName = SIGNUP_VALIDATION_MESSAGES.displayNameRequired;
  }

  const normalizedPhone = normalizeSignupPhone(phone);
  if (!normalizedPhone) {
    fieldErrors.phone = SIGNUP_VALIDATION_MESSAGES.phoneRequired;
  } else if (!PHONE_PATTERN.test(normalizedPhone)) {
    fieldErrors.phone = SIGNUP_VALIDATION_MESSAGES.phoneInvalid;
  }

  const birthDateValue = birthDate?.trim() ?? "";
  if (!birthDateValue) {
    fieldErrors.birthDate = SIGNUP_VALIDATION_MESSAGES.birthDateRequired;
  } else {
    const parsed = parseBirthDate(birthDateValue);
    if (!parsed) {
      fieldErrors.birthDate = SIGNUP_VALIDATION_MESSAGES.birthDateInvalid;
    } else if (parsed > startOfToday()) {
      fieldErrors.birthDate = SIGNUP_VALIDATION_MESSAGES.birthDateFuture;
    } else if (ageFromBirthDate(parsed) < MIN_AGE_YEARS) {
      fieldErrors.birthDate = SIGNUP_VALIDATION_MESSAGES.birthDateTooYoung;
    }
  }

  const genderValue = gender?.trim() ?? "";
  if (!genderValue) {
    fieldErrors.gender = SIGNUP_VALIDATION_MESSAGES.genderRequired;
  } else if (!VALID_GENDERS.has(genderValue)) {
    fieldErrors.gender = SIGNUP_VALIDATION_MESSAGES.genderInvalid;
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    normalizedPhone,
  };
}

export function formatGenderLabel(value) {
  if (value === "male") return "남성";
  if (value === "female") return "여성";
  if (value === "other") return "기타";
  return value || "—";
}
