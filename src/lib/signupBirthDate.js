/**
 * Signup birthdate helpers — UI parts ↔ form YYYY.MM.DD ↔ submit YYYY-MM-DD.
 * No auth / DB side effects.
 */

export function splitBirthDigits(raw = "") {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  return {
    year: digits.slice(0, 4),
    month: digits.slice(4, 6),
    day: digits.slice(6, 8),
  };
}

/** Accept pasted 19900101 / 1990.01.01 / 1990-01-01 / existing form dots. */
export function parseBirthParts(value = "") {
  const s = String(value ?? "").trim();
  if (!s) return { year: "", month: "", day: "" };

  const dotted = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotted) return { year: dotted[1], month: dotted[2], day: dotted[3] };

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { year: iso[1], month: iso[2], day: iso[3] };

  // Partial dotted while typing (legacy single-field recovery)
  const partial = s.match(/^(\d{0,4})\.(\d{0,2})\.(\d{0,2})$/);
  if (partial && s.includes(".")) {
    return { year: partial[1], month: partial[2], day: partial[3] };
  }

  return splitBirthDigits(s);
}

export function composeBirthDots(year = "", month = "", day = "") {
  const y = String(year || "").replace(/\D/g, "").slice(0, 4);
  const m = String(month || "").replace(/\D/g, "").slice(0, 2);
  const d = String(day || "").replace(/\D/g, "").slice(0, 2);
  if (y.length === 4 && m.length === 2 && d.length === 2) {
    return `${y}.${m}.${d}`;
  }
  // Incomplete — keep recoverable dotted partial for controlled value sync
  if (!y && !m && !d) return "";
  return `${y}.${m}.${d}`;
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

/**
 * Calendar-real + not-future. Incomplete → not ok with clear message when any part present.
 */
export function validateSignupBirthDate(value = "") {
  const s = String(value ?? "").trim();
  if (!s || s === ".." || /^\.+$/.test(s)) {
    return { ok: false, complete: false, error: null, iso: null };
  }

  const parts = parseBirthParts(s);
  const { year, month, day } = parts;
  const complete = year.length === 4 && month.length === 2 && day.length === 2;
  if (!complete) {
    return {
      ok: false,
      complete: false,
      error: "생년월일(연·월·일)을 모두 입력해 주세요.",
      iso: null,
    };
  }

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return { ok: false, complete: true, error: "올바른 생년월일을 입력해 주세요.", iso: null };
  }

  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return { ok: false, complete: true, error: "존재하지 않는 날짜입니다.", iso: null };
  }
  if (date > startOfToday()) {
    return { ok: false, complete: true, error: "생년월일은 오늘 이전이어야 합니다.", iso: null };
  }

  return {
    ok: true,
    complete: true,
    error: null,
    iso: `${year}-${month}-${day}`,
  };
}

export function isSignupBirthDateOk(value = "") {
  return validateSignupBirthDate(value).ok;
}
