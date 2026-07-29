/**
 * Signup birthdate UX — [YYYY]년 [MM]월 [DD]일
 * Emits form value as YYYY.MM.DD (submit path still converts to YYYY-MM-DD).
 */
import { useEffect, useRef, useState } from "react";
import {
  composeBirthDots,
  parseBirthParts,
  splitBirthDigits,
} from "../lib/signupBirthDate.js";

function digitsOnly(raw, max) {
  return String(raw ?? "").replace(/\D/g, "").slice(0, max);
}

export default function SignupBirthDateFields({
  value = "",
  onChange,
  onBlur,
  idPrefix = "signup-birth",
}) {
  const yearRef = useRef(null);
  const monthRef = useRef(null);
  const dayRef = useRef(null);
  const [parts, setParts] = useState(() => parseBirthParts(value));

  useEffect(() => {
    setParts(parseBirthParts(value));
  }, [value]);

  const emit = (next) => {
    setParts(next);
    onChange?.(composeBirthDots(next.year, next.month, next.day));
  };

  const applyPaste = (raw) => {
    const next = splitBirthDigits(raw);
    emit(next);
    if (next.day.length === 2) dayRef.current?.focus();
    else if (next.month.length === 2) dayRef.current?.focus();
    else if (next.year.length === 4) monthRef.current?.focus();
    else yearRef.current?.focus();
  };

  const onYearChange = (e) => {
    const year = digitsOnly(e.target.value, 4);
    const next = { ...parts, year };
    emit(next);
    if (year.length === 4) monthRef.current?.focus();
  };

  const onMonthChange = (e) => {
    const month = digitsOnly(e.target.value, 2);
    const next = { ...parts, month };
    emit(next);
    if (month.length === 2) dayRef.current?.focus();
  };

  const onDayChange = (e) => {
    const day = digitsOnly(e.target.value, 2);
    emit({ ...parts, day });
  };

  const onPartPaste = (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!text) return;
    // Multi-part paste (8 digits or delimited) → split across fields
    if (/\d{8}/.test(text.replace(/\D/g, "")) || /[.\-/]/.test(text)) {
      e.preventDefault();
      applyPaste(text);
    }
  };

  const onMonthKeyDown = (e) => {
    if (e.key === "Backspace" && !parts.month) {
      e.preventDefault();
      yearRef.current?.focus();
    }
  };

  const onDayKeyDown = (e) => {
    if (e.key === "Backspace" && !parts.day) {
      e.preventDefault();
      monthRef.current?.focus();
    }
  };

  const inputClass = "signup-control signup-birth-input";

  return (
    <div
      className="signup-birth-row"
      data-signup-birth-fields="yes"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onBlur?.();
      }}
    >
      <div className="signup-birth-part">
        <label className="signup-birth-sr" htmlFor={`${idPrefix}-year`}>
          연도
        </label>
        <input
          ref={yearRef}
          id={`${idPrefix}-year`}
          className={inputClass}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-year"
          aria-label="생년월일 연도"
          placeholder="YYYY"
          maxLength={4}
          value={parts.year}
          onChange={onYearChange}
          onPaste={onPartPaste}
        />
        <span className="signup-birth-unit" aria-hidden="true">
          년
        </span>
      </div>
      <div className="signup-birth-part">
        <label className="signup-birth-sr" htmlFor={`${idPrefix}-month`}>
          월
        </label>
        <input
          ref={monthRef}
          id={`${idPrefix}-month`}
          className={inputClass}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-month"
          aria-label="생년월일 월"
          placeholder="MM"
          maxLength={2}
          value={parts.month}
          onChange={onMonthChange}
          onPaste={onPartPaste}
          onKeyDown={onMonthKeyDown}
        />
        <span className="signup-birth-unit" aria-hidden="true">
          월
        </span>
      </div>
      <div className="signup-birth-part">
        <label className="signup-birth-sr" htmlFor={`${idPrefix}-day`}>
          일
        </label>
        <input
          ref={dayRef}
          id={`${idPrefix}-day`}
          className={inputClass}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-day"
          aria-label="생년월일 일"
          placeholder="DD"
          maxLength={2}
          value={parts.day}
          onChange={onDayChange}
          onPaste={onPartPaste}
          onKeyDown={onDayKeyDown}
        />
        <span className="signup-birth-unit" aria-hidden="true">
          일
        </span>
      </div>
    </div>
  );
}
