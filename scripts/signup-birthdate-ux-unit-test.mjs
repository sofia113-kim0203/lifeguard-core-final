/**
 * Signup birthdate UX helpers — pure unit lock.
 */
import assert from "node:assert/strict";
import {
  composeBirthDots,
  isSignupBirthDateOk,
  parseBirthParts,
  splitBirthDigits,
  validateSignupBirthDate,
} from "../src/lib/signupBirthDate.js";
import { birthDotsToIso } from "../src/lib/signupOnboardingMap.js";

assert.deepEqual(splitBirthDigits("19900101"), {
  year: "1990",
  month: "01",
  day: "01",
});
assert.deepEqual(parseBirthParts("1990.01.01"), {
  year: "1990",
  month: "01",
  day: "01",
});
assert.deepEqual(parseBirthParts("1990-01-01"), {
  year: "1990",
  month: "01",
  day: "01",
});
assert.deepEqual(parseBirthParts("19900101"), {
  year: "1990",
  month: "01",
  day: "01",
});

assert.equal(composeBirthDots("1990", "01", "01"), "1990.01.01");
assert.equal(birthDotsToIso("1990.01.01"), "1990-01-01");
assert.equal(isSignupBirthDateOk("1990.01.01"), true);
assert.equal(validateSignupBirthDate("1990.01.01").iso, "1990-01-01");

assert.equal(isSignupBirthDateOk("2025.02.30"), false);
assert.match(validateSignupBirthDate("2025.02.30").error, /존재하/);

assert.equal(isSignupBirthDateOk("1990.13.01"), false);
assert.match(validateSignupBirthDate("1990.13.01").error, /존재하/);

const futureY = new Date().getFullYear() + 1;
assert.equal(isSignupBirthDateOk(`${futureY}.01.01`), false);
assert.match(validateSignupBirthDate(`${futureY}.01.01`).error, /오늘 이전/);

assert.equal(isSignupBirthDateOk("1990.01"), false);
assert.equal(isSignupBirthDateOk("1990.."), false);
assert.match(validateSignupBirthDate("1990.01.").error, /모두 입력/);

console.log("signup-birthdate-ux-unit-test: PASS");
