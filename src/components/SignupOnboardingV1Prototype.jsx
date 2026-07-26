/**
 * SignupOnboardingV1Prototype — local demo only.
 * Final polish + all-insurer identity section. No AuthPanel / auth / DB / upload.
 */
import { useMemo, useState } from "react";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { FINAL_UI } from "../lib/customerUiFinalTokens.js";
import {
  LIFE_INSURERS,
  NON_LIFE_INSURERS,
  countPendingLogos,
} from "../lib/signupOnboardingInsurersV1.js";
import { submitSignupOnboarding } from "../lib/signupOnboardingIntegrate.js";

/** Meeting layout tokens. Step3 uses wider financial chart surface (1120~1180). */
const CONTENT_MAX_PX = 1040;
const FORM_BOX_MAX_PX = 1040;
const STEP3_CONTENT_MAX_PX = 1160;
const GRID_GAP_PX = FINAL_UI.actionCtaPadX; /* 16 */
const STACK_GAP_PX = FINAL_UI.actionCtaPadX; /* 16 */
const HEADER_GAP_PX = FINAL_UI.cardHeadGapPx; /* 8 */
const ROW_PAD_Y = FINAL_UI.cardPadY; /* 10 */
const LABEL_MB = FINAL_UI.cardHeadGapPx; /* 8 */
const FORM_PAD_PX = FINAL_UI.contentRailInsetPx; /* 44 */
const FOOTER_MAX_PX = 600;
const BREAKPOINT_PX = 768;
const BTN_MIN_H = 44;
const PAGE_BG = "#F2F0EB";
const SECTION_SURFACE = "#F7F8FB";
const TITLE_BAND_BG = "#EEF2F8";
const FORM_RADIUS_PX = FINAL_UI.cardRadius; /* 16 */
const BTN_W_PX = 140;

/** Exact three-section unification tokens (GO). */
const GEO = {
  sectionH: 216,
  sectionMetaW: 180,
  sectionPadY: 20,
  sectionPadX: 24,
  sectionGap: 16,
  metaContentGap: 24,
  sectionRadius: 12,
  sectionBorder: LG.border,
  sectionBg: SECTION_SURFACE,
  colGap: 16,
  rowGap: 12,
  descAreaH: 36,
  titleBandH: 88,
  titleBandPad: 16,
  titleBandRadius: 12,
  footerProgressW: 180,
  footerProgressH: 4,
  helperMinH: 18,
  metaBadgeGap: 10,
  metaTitleGap: 8,
};

const TYPE = {
  badgeSize: 12,
  badgeWeight: 700,
  sectionTitleSize: 16,
  sectionTitleLh: "24px",
  sectionTitleWeight: 700,
  sectionDescSize: 12,
  sectionDescLh: "18px",
  labelSize: 13,
  labelLh: "20px",
  labelWeight: 600,
  labelGap: 8,
  helperSize: 12,
  helperLh: "18px",
  inputSize: 14,
  chipSize: 13,
  consentSize: 12,
  badgeKindSize: 11,
  viewLinkSize: 12,
  titleBandTitleSize: 20,
  titleBandDescSize: 13,
  titleBandNoticeSize: 12,
};

const CTRL = {
  inputH: 44,
  inputRadius: 10,
  inputPadX: 14,
  chipH: 40,
  chipRadius: 8,
  chipPadX: 14,
  chipGap: 8,
  checkboxSize: 18,
  consentRowH: 38,
  consentPadX: 8,
  badgeW: 30,
  badgeH: 22,
  accentW: 4,
  accentH: 24,
};

/** Single visible LIFEGUARD accent gradient */
const GRAD = {
  css: "linear-gradient(135deg, #14244A 0%, #315EF6 100%)",
  titleBandAccentH: 4,
  connectorH: 3,
};

const HEALTH_OPTIONS = ["없음", "있음", "잘 모르겠어요"];

const STEPS = [
  { id: 1, short: "계정·기본정보", title: "계정과 기본 신원" },
  { id: 2, short: "생활·가족·건강", title: "생활·가족·직업·건강 정보" },
  { id: 3, short: "보험 현황", title: "현재 보험 현황" },
  { id: 4, short: "약관·동의", title: "약관 및 정보 이용 동의" },
  { id: 5, short: "완료", title: "회원가입이 완료되었습니다!" },
];

const OCCUPATIONS = [
  "사무직",
  "전문직",
  "판매·서비스",
  "생산·기술",
  "운전·운송",
  "교육",
  "의료·간호",
  "IT·개발",
  "자영업·사업",
  "주부",
  "학생",
  "기타",
];

const EMPLOYMENT_TYPES = [
  "직장인",
  "자영업",
  "프리랜서",
  "공무원",
  "주부",
  "학생",
  "무직",
  "기타",
];

const FAMILY_MEMBERS = ["본인", "배우자", "자녀", "부모", "기타"];

const WORRY_OPTIONS = [
  "암",
  "뇌·심장",
  "실손",
  "간병",
  "사망·가족",
  "노후",
  "자녀",
  "법인",
  "모름",
  "기타",
];

const REQUIRED_CONSENTS = [
  { key: "terms", name: "서비스 이용약관 동의", short: "서비스 이용약관", kind: "필수" },
  { key: "privacy", name: "개인정보 수집 및 이용 동의", short: "개인정보 수집·이용", kind: "필수" },
  { key: "sensitive", name: "민감정보 처리 동의", short: "민감정보 처리", kind: "필수" },
  { key: "insurance_store", name: "보험정보 저장 및 분석 동의", short: "보험정보 저장·분석", kind: "필수" },
  { key: "doc_store", name: "보험자료·문서 저장 및 분석 동의", short: "보험자료·문서 저장·분석", kind: "필수" },
  { key: "ai", name: "AI 상담 이용 동의", short: "AI 상담 이용", kind: "필수" },
  { key: "key_memory", name: "KEY 기억 유지 동의", short: "KEY 기억 유지", kind: "필수" },
];

const OPTIONAL_CONSENTS = [
  { key: "marketing", name: "마케팅 정보 수신 동의", short: "마케팅 정보 수신", kind: "선택" },
  {
    key: "third_party",
    name: "보험사 제출을 위한 개인정보 제3자 제공 동의",
    short: "보험사 제출 제3자 제공",
    kind: "선택",
  },
];

const CONSENT_BODY =
  "시현용 안내입니다. 실제 약관 본문은 제품 승인 후 연결됩니다. 이번 화면에서는 저장·제출되지 않습니다.";

const COMPLETE_CARDS = [
  { key: "upload", title: "보험증권 업로드하고 분석 시작하기" },
  { key: "talk", title: "KEY와 먼저 이야기하기" },
  { key: "later", title: "나중에 이어서 작성하기" },
];

const LAYOUT_CSS = `
[data-signup-onboarding-v1] {
  --lg-accent-gradient: ${GRAD.css};
  width: 100%;
  max-width: ${CONTENT_MAX_PX}px;
  margin: 0 auto;
  box-sizing: border-box;
  overflow-x: hidden;
}
[data-signup-onboarding-v1][data-premium-form="yes"] {
  max-width: ${STEP3_CONTENT_MAX_PX}px;
}
[data-signup-onboarding-v1][data-premium-form="yes"] .signup-form-box {
  max-width: ${STEP3_CONTENT_MAX_PX}px;
}
[data-signup-onboarding-v1] .signup-chip-premium {
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  min-height: ${CTRL.chipH}px;
  height: ${CTRL.chipH}px;
  max-height: ${CTRL.chipH}px;
  padding: 0 ${CTRL.chipPadX}px;
  border-radius: ${CTRL.chipRadius}px;
  font-size: ${TYPE.chipSize}px;
  line-height: ${CTRL.chipH}px;
  font-family: ${LG.sans};
}
[data-signup-onboarding-v1] .signup-chip-premium:hover:not([data-selected="yes"]) {
  background: ${TITLE_BAND_BG};
  border-color: ${LG.navy};
}
[data-signup-onboarding-v1] .signup-chip-premium:focus-visible {
  outline: 2px solid ${LG.navy};
  outline-offset: 2px;
}
[data-signup-onboarding-v1] .signup-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: ${CTRL.chipGap}px;
  width: 100%;
  min-width: 0;
  align-items: center;
}
[data-signup-onboarding-v1] .signup-section-frame {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  height: ${GEO.sectionH}px;
  min-height: ${GEO.sectionH}px;
  max-height: ${GEO.sectionH}px;
  box-sizing: border-box;
  padding: ${GEO.sectionPadY}px ${GEO.sectionPadX}px;
  margin: 0 0 ${GEO.sectionGap}px;
  gap: ${GEO.metaContentGap}px;
  background: ${GEO.sectionBg};
  border: 1px solid ${GEO.sectionBorder};
  border-radius: ${GEO.sectionRadius}px;
}
[data-signup-onboarding-v1] .signup-section-meta {
  flex: 0 0 ${GEO.sectionMetaW}px;
  width: ${GEO.sectionMetaW}px;
  min-width: ${GEO.sectionMetaW}px;
  max-width: ${GEO.sectionMetaW}px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 0;
}
[data-signup-onboarding-v1] .signup-section-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${CTRL.badgeW}px;
  min-width: ${CTRL.badgeW}px;
  height: ${CTRL.badgeH}px;
  padding: 0;
  border-radius: 6px;
  background-color: transparent;
  background-image: var(--lg-accent-gradient);
  color: #fff;
  font-size: ${TYPE.badgeSize}px;
  font-weight: ${TYPE.badgeWeight};
  letter-spacing: 0.04em;
  opacity: 1;
  margin: 0 0 ${GEO.metaBadgeGap}px;
}
[data-signup-onboarding-v1] .signup-section-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0 0 ${GEO.metaTitleGap}px;
  min-height: ${CTRL.accentH}px;
}
[data-signup-onboarding-v1] .signup-section-accent {
  display: block;
  width: ${CTRL.accentW}px;
  min-width: ${CTRL.accentW}px;
  height: ${CTRL.accentH}px;
  border-radius: 2px;
  background-color: transparent;
  background-image: var(--lg-accent-gradient);
  opacity: 1;
  flex-shrink: 0;
}
[data-signup-onboarding-v1] .signup-section-meta > .signup-section-title,
[data-signup-onboarding-v1] .signup-section-title-row .signup-section-title {
  margin: 0;
  font-size: ${TYPE.sectionTitleSize}px;
  font-weight: ${TYPE.sectionTitleWeight};
  color: ${LG.text};
  line-height: ${TYPE.sectionTitleLh};
}
[data-signup-onboarding-v1] .signup-section-description {
  margin: 0;
  width: 100%;
  min-height: ${GEO.descAreaH}px;
  max-height: ${GEO.descAreaH}px;
  font-size: ${TYPE.sectionDescSize}px;
  line-height: ${TYPE.sectionDescLh};
  color: ${LG.textMuted};
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
[data-signup-onboarding-v1] .signup-section-content {
  flex: 1 1 auto;
  width: calc(100% - ${GEO.sectionMetaW + GEO.metaContentGap}px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${GEO.rowGap}px;
  justify-content: flex-start;
}
[data-signup-onboarding-v1] .signup-grid-2-fixed {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: ${GEO.colGap}px;
  row-gap: ${GEO.rowGap}px;
  width: 100%;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-grid-2-fixed > * {
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-helper-slot {
  min-height: ${GEO.helperMinH}px;
  max-height: ${TYPE.helperLh === "18px" ? 36 : 36}px;
  margin: 0;
  font-size: ${TYPE.helperSize}px;
  color: ${LG.textMuted};
  line-height: ${TYPE.helperLh};
  overflow: hidden;
}
[data-signup-onboarding-v1] .signup-field-label {
  display: flex;
  flex-direction: column;
  gap: ${TYPE.labelGap}px;
  font-size: ${TYPE.labelSize}px;
  font-weight: ${TYPE.labelWeight};
  line-height: ${TYPE.labelLh};
  color: ${LG.text};
  width: 100%;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-field-label > span:first-child {
  line-height: ${TYPE.labelLh};
  min-height: ${TYPE.labelLh};
}
[data-signup-onboarding-v1] .signup-control {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  min-height: ${CTRL.inputH}px;
  height: ${CTRL.inputH}px;
  max-height: ${CTRL.inputH}px;
  padding: 0 ${CTRL.inputPadX}px;
  border-radius: ${CTRL.inputRadius}px;
  border: 1px solid ${LG.border};
  background: ${LG.inputBg};
  color: ${LG.text};
  font-size: ${TYPE.inputSize}px;
  font-family: ${LG.sans};
  outline: none;
}
[data-signup-onboarding-v1] .signup-control:focus-visible {
  outline: 2px solid ${LG.navy};
  outline-offset: 1px;
}
[data-signup-onboarding-v1] .signup-dup-btn {
  min-width: 96px;
  height: ${CTRL.inputH}px;
  min-height: ${CTRL.inputH}px;
  max-height: ${CTRL.inputH}px;
  padding: 0 12px;
  font-size: 14px;
  flex-shrink: 0;
}
[data-signup-onboarding-v1] .signup-consent-row {
  display: grid;
  grid-template-columns: ${CTRL.checkboxSize}px minmax(0, 1fr) auto auto;
  align-items: center;
  column-gap: 8px;
  min-height: ${CTRL.consentRowH}px;
  height: ${CTRL.consentRowH}px;
  max-height: ${CTRL.consentRowH}px;
  padding: 0 ${CTRL.consentPadX}px;
  border-bottom: 1px solid ${LG.border};
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
[data-signup-onboarding-v1] .signup-consent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(4, ${CTRL.consentRowH}px);
  grid-auto-flow: column;
  column-gap: ${GEO.colGap}px;
  row-gap: 0;
  width: 100%;
  min-width: 0;
  align-content: start;
}
[data-signup-onboarding-v1] .signup-consent-link {
  border: none;
  background: none;
  color: ${LG.textMuted};
  font-size: ${TYPE.viewLinkSize}px;
  line-height: 18px;
  font-family: ${LG.sans};
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  white-space: nowrap;
}
[data-signup-onboarding-v1] .signup-consent-link:hover {
  color: ${LG.navy};
}
[data-signup-onboarding-v1] .signup-vcenter-stack {
  justify-content: center;
  gap: 12px;
}
[data-signup-onboarding-v1] .signup-helper-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 100%;
}
[data-signup-onboarding-v1] .signup-helper-block .signup-helper-slot {
  max-height: none;
  margin: 0;
}
[data-signup-onboarding-v1] .signup-info-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
[data-signup-onboarding-v1] .signup-info-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid ${LG.border};
  background: ${LG.surface};
  font-size: 12px;
  line-height: 18px;
  color: ${LG.textMuted};
}
[data-signup-onboarding-v1] .signup-health-q {
  display: flex;
  flex-direction: column;
  gap: ${TYPE.labelGap}px;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-health-q-label {
  margin: 0;
  font-size: ${TYPE.labelSize}px;
  font-weight: ${TYPE.labelWeight};
  line-height: ${TYPE.labelLh};
  color: ${LG.text};
  min-height: ${TYPE.labelLh};
  max-height: 40px;
  overflow: hidden;
}
[data-signup-onboarding-v1] .signup-grad-fill {
  background-color: transparent !important;
  background-image: var(--lg-accent-gradient) !important;
  opacity: 1 !important;
  filter: none !important;
}
[data-signup-onboarding-v1] .signup-title-band {
  position: relative;
  overflow: hidden;
  height: ${GEO.titleBandH}px;
  min-height: ${GEO.titleBandH}px;
  max-height: ${GEO.titleBandH}px;
  box-sizing: border-box;
}
[data-signup-onboarding-v1] .signup-title-band::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: ${GRAD.titleBandAccentH}px;
  background-color: transparent;
  background-image: var(--lg-accent-gradient);
  opacity: 1;
}
[data-signup-onboarding-v1] .signup-cta-active {
  background-color: transparent !important;
  background-image: var(--lg-accent-gradient) !important;
  border: none !important;
  color: #fff !important;
  opacity: 1 !important;
  box-shadow: 0 2px 8px rgba(20, 36, 74, 0.18) !important;
}
[data-signup-onboarding-v1] *,
[data-signup-onboarding-v1] *::before,
[data-signup-onboarding-v1] *::after {
  box-sizing: border-box;
}
[data-signup-onboarding-v1] .signup-form-box {
  width: 100%;
  max-width: ${FORM_BOX_MAX_PX}px;
  margin: 0 auto;
  padding: ${FORM_PAD_PX}px;
  background: ${LG.surface};
  border: 1px solid ${LG.border};
  border-radius: ${FINAL_UI.cardRadius}px;
  box-shadow: none;
}
[data-signup-onboarding-v1] .signup-stack {
  display: flex;
  flex-direction: column;
  gap: ${STACK_GAP_PX}px;
  width: 100%;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: ${GRID_GAP_PX}px;
  row-gap: ${STACK_GAP_PX}px;
  width: 100%;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-grid-2 > * {
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-span-full {
  grid-column: 1 / -1;
}
[data-signup-onboarding-v1] .signup-complete-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: ${GRID_GAP_PX}px;
  width: 100%;
}
[data-signup-onboarding-v1] .signup-consent-group {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  border: 1px solid ${LG.border};
  border-radius: 12px;
  background: ${FINAL_UI.bg};
  overflow: hidden;
}
[data-signup-onboarding-v1] .signup-section {
  display: flex;
  flex-direction: column;
  gap: ${STACK_GAP_PX}px;
  width: 100%;
  min-width: 0;
}
[data-signup-onboarding-v1] .signup-group-title {
  margin: 0;
  padding-bottom: ${FINAL_UI.sectionKMbPx}px;
  border-bottom: 1px solid ${LG.border};
  font-size: ${FINAL_UI.sectionTitleSize}px;
  font-weight: 600;
  color: ${LG.textMuted};
  letter-spacing: 0.01em;
}
[data-signup-onboarding-v1] .signup-footer-actions {
  display: flex;
  gap: ${GRID_GAP_PX}px;
  margin-top: ${GRID_GAP_PX}px;
  padding-top: ${GRID_GAP_PX}px;
  border-top: 1px solid ${LG.border};
  max-width: ${FOOTER_MAX_PX}px;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}
[data-signup-onboarding-v1] .signup-footer-actions > button {
  flex: 1;
  min-height: ${BTN_MIN_H}px;
}
[data-signup-onboarding-v1] .signup-insurer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${FINAL_UI.gutterPx}px;
  width: 100%;
}
[data-signup-onboarding-v1] .signup-insurer-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: ${FINAL_UI.cardPadY}px ${FINAL_UI.cardPadX}px;
  border: 1px solid ${LG.border};
  border-radius: 10px;
  background: ${LG.surface};
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: ${LG.text};
  line-height: 1.35;
  pointer-events: none;
  user-select: none;
}
@media (min-width: ${BREAKPOINT_PX + 1}px) {
  [data-signup-onboarding-v1] .signup-complete-grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
  [data-signup-onboarding-v1] .signup-insurer-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
`;

function emptyForm() {
  return {
    email: "",
    password: "",
    passwordConfirm: "",
    name: "",
    birthDate: "",
    gender: "",
    phone: "",
    customerType: "",
    occupation: "",
    employmentType: "",
    married: "",
    hasChildren: "",
    dependents: "",
    familyMembers: [],
    /** customer_reported — prototype state only; not verified medical history */
    healthTreatment: "",
    healthHospitalSurgery: "",
    healthMedication: "",
    healthCheckupFollowup: "",
    healthDataKind: "customer_reported",
    hasInsurance: "",
    policyCount: "",
    monthlyPremium: "",
    recentChange: "",
    activeClaim: "",
    worry: "",
    policyUploadTiming: "",
    consents: Object.fromEntries(
      [...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS].map((c) => [c.key, false]),
    ),
    completeChoice: "",
  };
}

function isBirthOk(v) {
  return /^\d{4}\.\d{2}\.\d{2}$/.test(String(v || "").trim());
}

function isEmailOk(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function FieldLabel({ label, required = false, children }) {
  return (
    <label className="signup-field-label">
      <span>
        {label}
        {required ? <span style={{ color: "#B42318", marginLeft: 4 }}>*</span> : null}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children, required = false }) {
  return (
    <div className="signup-field-label" style={{ marginBottom: 0 }}>
      <span>
        {children}
        {required ? <span style={{ color: "#B42318", marginLeft: 4 }}>*</span> : null}
      </span>
    </div>
  );
}

function TextInput({ style, className, ...props }) {
  return (
    <input
      {...props}
      className={["signup-control", className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}

function SelectInput({ children, style, className, ...props }) {
  return (
    <select
      {...props}
      className={["signup-control", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </select>
  );
}

function Hint({ children }) {
  return <p className="signup-helper-slot">{children}</p>;
}

function FieldError({ children }) {
  if (!children) return null;
  return <p style={{ margin: "6px 0 0", fontSize: 12, color: "#B91C1C", lineHeight: 1.4 }}>{children}</p>;
}

function ChoiceRow({ options, value, onChange, multi = false, premium = false, wrap = true }) {
  return (
    <div
      className="signup-chip-row"
      style={{ flexWrap: wrap ? "wrap" : "nowrap" }}
    >
      {options.map((opt) => {
        const selected = multi ? value.includes(opt) : value === opt;
        return (
          <button
            key={opt}
            type="button"
            className={premium ? "signup-chip-premium" : "signup-chip-premium"}
            data-selected={selected ? "yes" : "no"}
            onClick={() => {
              if (!multi) {
                onChange(opt);
                return;
              }
              if (selected) onChange(value.filter((v) => v !== opt));
              else onChange([...value, opt]);
            }}
            style={{
              border: `1px solid ${selected ? LG.navy : LG.border}`,
              background: selected ? (premium ? LG.navy : LG.accentSoft) : LG.surface,
              color: selected ? (premium ? "#fff" : LG.navy) : LG.text,
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              flex: premium && !wrap ? "0 0 auto" : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SectionFrame — sole numbered section component for Steps 1–4.
 * Fixed geometry: 216× full-width, shared tokens only.
 */
function SectionFrame({ number, title, subtitle, contentClassName = "", children }) {
  return (
    <section
      className="signup-section-frame"
      data-section-frame="yes"
      data-fin-section={title}
      data-section-number={number}
      data-section-title-text={title}
    >
      <aside className="signup-section-meta" data-section-meta="yes">
        <span className="signup-section-number" data-number-badge="yes">
          {number}
        </span>
        <div className="signup-section-title-row">
          <span className="signup-section-accent" data-accent-line="yes" aria-hidden />
          <h3 className="signup-section-title" data-section-title="yes">
            {title}
          </h3>
        </div>
        <p className="signup-section-description" data-section-desc="yes">
          {subtitle}
        </p>
      </aside>
      <div
        className={["signup-section-content", contentClassName].filter(Boolean).join(" ")}
        data-section-content="yes"
      >
        {children}
      </div>
    </section>
  );
}

function HealthQuestionBlock({ label, value, onChange }) {
  return (
    <div className="signup-health-q" data-health-question="yes">
      <p className="signup-health-q-label">{label}</p>
      <ChoiceRow premium wrap={false} options={HEALTH_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

/** Alias — all Steps use SectionFrame only. */
const FinancialSection = SectionFrame;

function PremiumCompactHeader({ step }) {
  return (
    <header
      data-signup-header
      data-compact-header="yes"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: GRID_GAP_PX,
        marginBottom: HEADER_GAP_PX,
        paddingTop: FINAL_UI.gutterPx,
        paddingBottom: FINAL_UI.sectionKMbPx,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: LG.serif,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: LG.navy,
            lineHeight: 1.1,
          }}
        >
          LIFEGUARD
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: "#8B93A1" }}>평생 보험차트의 첫 작성</div>
      </div>
      <div style={{ flex: 1, maxWidth: 560 }}>
        <StepRail step={step} />
      </div>
    </header>
  );
}

function PremiumTitleBand({ title, description, notice }) {
  return (
    <div
      className="signup-title-band"
      data-title-band="yes"
      data-title-accent="yes"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: GEO.sectionGap,
        marginBottom: GEO.sectionGap,
        padding: `${GEO.titleBandPad}px`,
        paddingTop: GEO.titleBandPad + GRAD.titleBandAccentH,
        background: TITLE_BAND_BG,
        borderRadius: GEO.titleBandRadius,
        border: "1px solid #E0E6F0",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2
          data-signup-title
          style={{
            margin: 0,
            fontSize: TYPE.titleBandTitleSize,
            fontWeight: 700,
            color: LG.text,
            lineHeight: 1.3,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: `${HEADER_GAP_PX}px 0 0`,
            fontSize: TYPE.titleBandDescSize,
            color: LG.textMuted,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: HEADER_GAP_PX,
          maxWidth: 320,
          fontSize: TYPE.titleBandNoticeSize,
          color: LG.textMuted,
          lineHeight: 1.5,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            marginTop: 1,
            borderRadius: "50%",
            border: `1.5px solid ${LG.navy}`,
            color: LG.navy,
            fontSize: 11,
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
          }}
        >
          i
        </span>
        <span>{notice}</span>
      </div>
    </div>
  );
}

function PremiumMainSurface({ children, step }) {
  /* No .signup-form-box class — flat CSS path must not touch premium shell. */
  return (
    <div
      className="signup-premium-main-surface"
      data-main-form-box
      data-premium-surface="yes"
      data-step3-surface={step === 3 ? "yes" : undefined}
      style={{
        maxWidth: STEP3_CONTENT_MAX_PX,
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
        padding: FORM_PAD_PX,
        background: LG.surface,
        border: "1px solid #E6EAF1",
        borderRadius: FORM_RADIUS_PX,
        boxShadow: "0 8px 28px rgba(20, 36, 74, 0.08)",
      }}
    >
      {children}
    </div>
  );
}

function PremiumActionFooter({
  step,
  progressLabel,
  canNext,
  onNext,
  nextLabel = "다음 단계",
  showPrev = true,
  onPrev,
}) {
  const progressPct = `${(step / 5) * 100}%`;
  return (
    <div
      data-premium-action-footer="yes"
      data-signup-footer
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: GRID_GAP_PX,
        marginTop: HEADER_GAP_PX,
        paddingTop: GRID_GAP_PX,
        borderTop: `1px solid ${LG.border}`,
      }}
    >
      <div style={{ minWidth: GEO.footerProgressW }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: HEADER_GAP_PX, marginBottom: HEADER_GAP_PX }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: LG.navy }}>
            {step} / 5
          </span>
          <span style={{ fontSize: TYPE.helperSize, color: LG.textMuted }}>{progressLabel}</span>
        </div>
        <div
          style={{
            width: GEO.footerProgressW,
            height: GEO.footerProgressH,
            borderRadius: 999,
            background: FINAL_UI.barTrack,
            overflow: "hidden",
          }}
        >
          <div
            className="signup-grad-fill"
            style={{ width: progressPct, height: "100%", borderRadius: 999 }}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: CTRL.chipGap }}>
        {showPrev ? (
          <GhostButton onClick={onPrev} style={{ width: BTN_W_PX, flex: "0 0 auto", color: LG.text }}>
            이전
          </GhostButton>
        ) : null}
        <PrimaryButton
          disabled={!canNext}
          onClick={onNext}
          data-signup-next={step}
          className={canNext ? "signup-cta-active" : undefined}
          style={{
            width: BTN_W_PX,
            flex: "0 0 auto",
            background: canNext ? undefined : "#9AA6B8",
            border: "none",
            color: "#fff",
          }}
        >
          {nextLabel}
        </PrimaryButton>
      </div>
    </div>
  );
}

function FieldBlock({ label, required = false, children }) {
  return (
    <div className="signup-field-label">
      <div>
        {label}
        {required ? <span style={{ color: "#B42318", marginLeft: 4 }}>*</span> : null}
      </div>
      {children}
    </div>
  );
}

function PrimaryButton({ children, disabled, style, className, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      {...props}
      style={{
        minHeight: BTN_MIN_H,
        padding: `${FINAL_UI.cardPadY}px ${FINAL_UI.actionCtaPadX}px`,
        border: disabled ? `1px solid ${LG.border}` : "none",
        borderRadius: 10,
        background: disabled ? "#9AA6B8" : LG.button,
        color: "#fff",
        fontSize: 15,
        fontWeight: 600,
        fontFamily: LG.sans,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: 1,
        boxShadow: "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, className, style, ...props }) {
  return (
    <button
      type="button"
      className={className}
      {...props}
      style={{
        minHeight: BTN_MIN_H,
        padding: `${FINAL_UI.cardPadY}px ${FINAL_UI.actionCtaPadX}px`,
        borderRadius: 10,
        border: `1px solid ${LG.border}`,
        background: LG.surface,
        color: LG.textMuted,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: LG.sans,
        cursor: "pointer",
        ...(style || {}),
      }}
    >
      {children}
    </button>
  );
}

function GroupTitle({ children }) {
  return <h3 className="signup-group-title">{children}</h3>;
}

function StepRail({ step }) {
  return (
    <div
      data-signup-step-rail
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: CTRL.chipGap,
        marginBottom: 0,
        width: "100%",
      }}
    >
      {STEPS.map((s, idx) => {
        const done = step > s.id;
        const current = step === s.id;
        const active = done || current;
        return (
          <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: LABEL_MB }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              {idx > 0 ? (
                <div
                  data-step-connector={step >= s.id ? "done" : "todo"}
                  className={step >= s.id ? "signup-grad-fill" : undefined}
                  style={{
                    flex: 1,
                    height: GRAD.connectorH,
                    background: step >= s.id ? undefined : LG.border,
                    marginRight: CTRL.chipGap,
                    opacity: 1,
                  }}
                />
              ) : (
                <div style={{ flex: 1 }} />
              )}
              <div
                data-step-dot={s.id}
                data-step-state={done ? "done" : current ? "current" : "todo"}
                className={active ? "signup-grad-fill" : undefined}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  background: active ? undefined : LG.surface,
                  color: active ? "#fff" : "#A0A8B5",
                  border: `1.5px solid ${active ? "transparent" : "#D5DBE5"}`,
                  flexShrink: 0,
                  boxShadow: current ? "0 0 0 3px rgba(49, 94, 246, 0.22)" : "none",
                  opacity: 1,
                }}
              >
                {done ? "✓" : s.id}
              </div>
              {idx < STEPS.length - 1 ? (
                <div
                  data-step-connector={step > s.id ? "done" : "todo"}
                  className={step > s.id ? "signup-grad-fill" : undefined}
                  style={{
                    flex: 1,
                    height: GRAD.connectorH,
                    background: step > s.id ? undefined : "#E2E6EE",
                    marginLeft: CTRL.chipGap,
                    opacity: 1,
                  }}
                />
              ) : (
                <div style={{ flex: 1 }} />
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.3,
                textAlign: "center",
                color: current ? LG.navy : done ? LG.textMuted : "#A8B0BD",
                fontWeight: current ? 700 : 500,
                maxWidth: 88,
              }}
            >
              {s.short}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConsentRow({ item, checked, onToggle, onView }) {
  const display = item.short || item.name;
  const fullLabel = `${item.name} (${item.kind})`;
  return (
    <div className="signup-consent-row" data-consent-row="yes">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={fullLabel}
        style={{ width: CTRL.checkboxSize, height: CTRL.checkboxSize, margin: 0 }}
      />
      <span
        style={{
          fontSize: TYPE.consentSize,
          color: LG.text,
          lineHeight: "18px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {display}
      </span>
      <span
        style={{
          fontSize: TYPE.badgeKindSize,
          fontWeight: 700,
          color: item.kind === "필수" ? LG.navy : LG.textMuted,
          border: `1px solid ${item.kind === "필수" ? "rgba(20, 36, 74, 0.28)" : LG.border}`,
          borderRadius: 6,
          padding: "1px 6px",
          background: item.kind === "필수" ? TITLE_BAND_BG : LG.surface,
          whiteSpace: "nowrap",
        }}
      >
        {item.kind}
      </span>
      <button type="button" className="signup-consent-link" onClick={onView}>
        내용 보기
      </button>
    </div>
  );
}

function PasswordField({ label, value, onChange, show, onToggleShow, error }) {
  return (
    <div>
      <FieldLabel label={label} required>
        <div style={{ position: "relative" }}>
          <TextInput
            type={show ? "text" : "password"}
            value={value}
            onChange={onChange}
            autoComplete="new-password"
            style={{ paddingRight: 72 }}
          />
          <button
            type="button"
            onClick={onToggleShow}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              border: "none",
              background: "none",
              color: LG.textMuted,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: LG.sans,
            }}
          >
            {show ? "숨기기" : "보기"}
          </button>
        </div>
      </FieldLabel>
      <FieldError>{error}</FieldError>
    </div>
  );
}

/**
 * @param {object} props
 * @param {number} [props.initialStep]
 * @param {boolean} [props.integrationEnabled] — when true, Step4 join uses real AuthPanel signup path
 * @param {(result: object) => void} [props.onAuthSuccess]
 * @param {(choice: string) => void} [props.onCompleteAction]
 * @param {() => void} [props.onRequestLogin]
 */
export default function SignupOnboardingV1Prototype({
  initialStep = 1,
  integrationEnabled = false,
  onAuthSuccess,
  onCompleteAction,
  onRequestLogin,
} = {}) {
  const [step, setStep] = useState(() => {
    const n = Number(initialStep);
    return n >= 1 && n <= 5 ? n : 1;
  });
  const [form, setForm] = useState(emptyForm);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [viewConsent, setViewConsent] = useState(null);
  const [touched, setTouched] = useState({});
  const [insurersExpanded, setInsurersExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const missingLogoCount = countPendingLogos([...LIFE_INSURERS, ...NON_LIFE_INSURERS]);

  const handleJoin = async () => {
    if (!integrationEnabled) {
      setStep(5);
      return;
    }
    if (submitting) return;
    setSubmitError("");
    setSubmitMessage("");
    setSubmitting(true);
    try {
      const result = await submitSignupOnboarding(form);
      if (!result.ok) {
        setSubmitError(result.error || "회원가입에 실패했습니다.");
        return;
      }
      setNeedsEmailVerification(Boolean(result.needsEmailVerification));
      setSubmitMessage(result.message || "회원가입이 완료되었습니다.");
      onAuthSuccess?.(result);
      setStep(5);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteAction = (choice) => {
    setField("completeChoice", choice);
    if (!integrationEnabled) return;
    if (needsEmailVerification) {
      onRequestLogin?.();
      return;
    }
    onCompleteAction?.(choice);
  };

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const setConsent = (key, value) => {
    setForm((prev) => ({
      ...prev,
      consents: { ...prev.consents, [key]: value },
    }));
  };

  const allConsentKeys = [...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS].map((c) => c.key);
  const allChecked = allConsentKeys.every((k) => form.consents[k]);
  const requiredChecked = REQUIRED_CONSENTS.every((c) => form.consents[c.key]);

  const step1Errors = useMemo(() => {
    const e = {};
    if (form.email && !isEmailOk(form.email)) e.email = "올바른 이메일 형식으로 입력해 주세요.";
    if (form.password && form.password.length < 8) e.password = "8자 이상 입력해 주세요.";
    if (form.passwordConfirm && form.passwordConfirm !== form.password) {
      e.passwordConfirm = "비밀번호가 일치하지 않습니다.";
    }
    if (form.birthDate && !isBirthOk(form.birthDate)) e.birthDate = "YYYY.MM.DD 형식으로 입력해 주세요.";
    return e;
  }, [form]);

  const canNext1 =
    isEmailOk(form.email) &&
    form.password.length >= 8 &&
    form.passwordConfirm === form.password &&
    form.name.trim() &&
    isBirthOk(form.birthDate) &&
    form.gender &&
    form.phone.trim() &&
    form.customerType;

  const canNext2 = Boolean(
    form.occupation &&
      form.employmentType &&
      form.married &&
      form.hasChildren &&
      form.healthTreatment &&
      form.healthHospitalSurgery &&
      form.healthMedication &&
      form.healthCheckupFollowup,
  );
  const canNext3 = Boolean(form.hasInsurance);
  const canJoin = requiredChecked;

  const isPremiumForm = step >= 1 && step <= 4;

  return (
    <div
      data-signup-onboarding-v1
      data-signup-step={step}
      data-content-max={isPremiumForm ? STEP3_CONTENT_MAX_PX : CONTENT_MAX_PX}
      data-form-box-max={isPremiumForm ? STEP3_CONTENT_MAX_PX : FORM_BOX_MAX_PX}
      data-premium-form={isPremiumForm ? "yes" : "no"}
      data-step3-financial={step === 3 ? "yes" : "no"}
      style={{
        fontFamily: LG.sans,
        color: LG.text,
        maxWidth: isPremiumForm ? STEP3_CONTENT_MAX_PX : CONTENT_MAX_PX,
        width: "100%",
        margin: "0 auto",
      }}
    >
      <style>{LAYOUT_CSS}</style>

      {isPremiumForm ? <PremiumCompactHeader step={step} /> : null}

      {step === 1 ? (
        <PremiumMainSurface step={1}>
          <PremiumTitleBand
            title={STEPS[0].title}
            description="LIFEGUARD 이용을 위한 기본 정보를 입력해 주세요."
            notice="* 표시는 필수 입력 항목입니다."
          />

          <SectionFrame number="01" title="계정 정보" subtitle="안전하게 LIFEGUARD를 이용할 계정을 만듭니다.">
            <FieldLabel label="로그인 이메일" required>
              <TextInput
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
              />
            </FieldLabel>
            <Hint>로그인과 계정 인증에 사용됩니다.</Hint>
            <FieldError>{touched.email ? step1Errors.email : null}</FieldError>
            <div className="signup-grid-2-fixed" data-desktop-two-column="step1-password">
              <PasswordField
                label="비밀번호"
                value={form.password}
                onChange={(e) => setField("password", e.target.value)}
                show={showPw}
                onToggleShow={() => setShowPw((v) => !v)}
                error={touched.password ? step1Errors.password : null}
              />
              <PasswordField
                label="비밀번호 확인"
                value={form.passwordConfirm}
                onChange={(e) => setField("passwordConfirm", e.target.value)}
                show={showPw2}
                onToggleShow={() => setShowPw2((v) => !v)}
                error={touched.passwordConfirm ? step1Errors.passwordConfirm : null}
              />
            </div>
          </SectionFrame>

          <SectionFrame number="02" title="기본 신원" subtitle="고객 보험차트의 기본 기준이 되는 정보입니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step1-identity">
              <FieldLabel label="이름" required>
                <TextInput value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="생년월일" required>
                <TextInput
                  value={form.birthDate}
                  onChange={(e) => setField("birthDate", e.target.value)}
                  placeholder="YYYY.MM.DD"
                />
              </FieldLabel>
              <div>
                <SectionLabel required>성별</SectionLabel>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["남성", "여성"]}
                  value={form.gender}
                  onChange={(v) => setField("gender", v)}
                />
              </div>
              <div>
                <SectionLabel required>고객 구분</SectionLabel>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["개인", "법인", "개인 + 법인"]}
                  value={form.customerType}
                  onChange={(v) => setField("customerType", v)}
                />
              </div>
            </div>
          </SectionFrame>

          <SectionFrame number="03" title="연락처" subtitle="본인 확인과 계정 안내에 사용합니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step1-contact">
              <div>
                <FieldLabel label="휴대폰 번호" required>
                  <TextInput
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    placeholder="010-1234-5678"
                    autoComplete="tel"
                  />
                </FieldLabel>
                <Hint>휴대폰 본인인증은 추후 제공됩니다.</Hint>
              </div>
              <div data-account-guide="yes">
                <SectionLabel>계정 안내</SectionLabel>
                <p className="signup-helper-slot" style={{ marginTop: 0 }}>
                  인증 및 계정 복구 안내는 로그인 이메일로 발송됩니다.
                </p>
              </div>
            </div>
          </SectionFrame>

          <PremiumActionFooter
            step={1}
            progressLabel="계정·기본정보 작성 중"
            canNext={canNext1}
            onNext={() => setStep(2)}
            showPrev={false}
          />
        </PremiumMainSurface>
      ) : null}

      {step === 2 ? (
        <PremiumMainSurface step={2}>
          <PremiumTitleBand
            title={STEPS[1].title}
            description="현재 생활과 가족의 보장 필요성을 이해하기 위한 정보입니다."
            notice="입력한 내용은 KEY가 더 정확한 보험 대화를 이어가는 데 사용됩니다."
          />

          <SectionFrame number="01" title="직업 정보" subtitle="현재 직업과 업무 형태를 알려주세요.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step2-job">
              <FieldLabel label="직업" required>
                <SelectInput value={form.occupation} onChange={(e) => setField("occupation", e.target.value)}>
                  <option value="">선택해 주세요</option>
                  {OCCUPATIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </SelectInput>
              </FieldLabel>
              <div>
                <SectionLabel required>고용 형태</SectionLabel>
                <ChoiceRow
                  premium
                  wrap
                  options={EMPLOYMENT_TYPES}
                  value={form.employmentType}
                  onChange={(v) => setField("employmentType", v)}
                />
              </div>
            </div>
          </SectionFrame>

          <SectionFrame number="02" title="가족 정보" subtitle="함께 보호해야 할 가족 범위를 확인합니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step2-family">
              <div>
                <SectionLabel required>결혼 여부</SectionLabel>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["미혼", "기혼"]}
                  value={form.married}
                  onChange={(v) => setField("married", v)}
                />
              </div>
              <div>
                <SectionLabel required>자녀 여부</SectionLabel>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["자녀 없음", "자녀 있음"]}
                  value={form.hasChildren}
                  onChange={(v) => setField("hasChildren", v)}
                />
              </div>
              <div>
                <SectionLabel>부양가족 수</SectionLabel>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["0명", "1명", "2명", "3명 이상"]}
                  value={form.dependents}
                  onChange={(v) => setField("dependents", v)}
                />
              </div>
              <div>
                <SectionLabel>가족 구성</SectionLabel>
                <ChoiceRow
                  premium
                  multi
                  wrap
                  options={FAMILY_MEMBERS}
                  value={form.familyMembers}
                  onChange={(v) => setField("familyMembers", v)}
                />
              </div>
            </div>
          </SectionFrame>

          <SectionFrame
            number="03"
            title="건강·병력 정보"
            subtitle="고객 진술 기준 · 문서 확인 전 검증 병력 아님. 상세는 가입 후 KEY가 확인합니다."
          >
            <div
              className="signup-grid-2-fixed"
              data-desktop-two-column="step2-health"
              data-health-section="yes"
              data-health-kind="customer_reported"
              data-health-helper="yes"
            >
              <HealthQuestionBlock
                label="현재 치료 또는 추적관찰 중인 질환이 있나요?"
                value={form.healthTreatment}
                onChange={(v) => setField("healthTreatment", v)}
              />
              <HealthQuestionBlock
                label="최근 입원이나 수술을 받은 적이 있나요?"
                value={form.healthHospitalSurgery}
                onChange={(v) => setField("healthHospitalSurgery", v)}
              />
              <HealthQuestionBlock
                label="현재 정기적으로 복용하는 약이 있나요?"
                value={form.healthMedication}
                onChange={(v) => setField("healthMedication", v)}
              />
              <HealthQuestionBlock
                label="최근 건강검진에서 재검·추적관찰 안내를 받았나요?"
                value={form.healthCheckupFollowup}
                onChange={(v) => setField("healthCheckupFollowup", v)}
              />
            </div>
          </SectionFrame>

          <PremiumActionFooter
            step={2}
            progressLabel="생활·가족·건강 작성 중"
            canNext={canNext2}
            onNext={() => setStep(3)}
            onPrev={() => setStep(1)}
          />
        </PremiumMainSurface>
      ) : null}

      {step === 3 ? (
        <PremiumMainSurface step={3}>
          <PremiumTitleBand
            title={STEPS[2].title}
            description="첫 보험차트를 위한 현재 상태를 알려주세요."
            notice="고객이 알려주신 내용은 문서 확인 후 검증됩니다."
          />

          <SectionFrame number="01" title="가입 현황" subtitle="현재 가입 규모와 보험료를 고객 진술로 확인합니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step3-status">
              <FieldBlock label="현재 보험 가입 여부" required>
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["없음", "있음", "잘 모르겠어요"]}
                  value={form.hasInsurance}
                  onChange={(v) => setField("hasInsurance", v)}
                />
              </FieldBlock>
              <FieldBlock label="가입 보험 건수">
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["1~2건", "3~5건", "6건 이상", "잘 모르겠어요"]}
                  value={form.policyCount}
                  onChange={(v) => setField("policyCount", v)}
                />
              </FieldBlock>
              <FieldBlock label="월 보험료">
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["10만 원 미만", "10~30만 원", "30만 원 이상", "잘 모르겠어요"]}
                  value={form.monthlyPremium}
                  onChange={(v) => setField("monthlyPremium", v)}
                />
              </FieldBlock>
              <Hint>고객 진술 기준이며, 문서 확인 후 검증됩니다.</Hint>
            </div>
          </SectionFrame>

          <SectionFrame number="02" title="최근 보험 활동" subtitle="최근 변동과 청구 상태를 확인합니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step3-activity">
              <FieldBlock label="최근 3년 가입·해지">
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["없음", "가입함", "해지함", "잘 모르겠어요"]}
                  value={form.recentChange}
                  onChange={(v) => setField("recentChange", v)}
                />
              </FieldBlock>
              <FieldBlock label="현재 진행 중 보험금 청구">
                <ChoiceRow
                  premium
                  wrap={false}
                  options={["없음", "있음", "잘 모르겠어요"]}
                  value={form.activeClaim}
                  onChange={(v) => setField("activeClaim", v)}
                />
              </FieldBlock>
              <Hint>최근 3년 내 가입·해지 여부를 알려주세요.</Hint>
              <Hint>진행 중 청구가 있으면 KEY가 이어서 확인합니다.</Hint>
            </div>
          </SectionFrame>

          <SectionFrame number="03" title="보장과 자료" subtitle="걱정되는 보장과 증권 업로드 시점을 정합니다.">
            <div className="signup-grid-2-fixed" data-desktop-two-column="step3-cover">
              <FieldBlock label="가장 걱정되는 보장">
                <ChoiceRow
                  premium
                  wrap
                  options={WORRY_OPTIONS}
                  value={form.worry}
                  onChange={(v) => setField("worry", v)}
                />
              </FieldBlock>
              <div>
                <FieldBlock label="보험증권을 지금 올릴지">
                  <ChoiceRow
                    premium
                    wrap={false}
                    options={["지금 업로드", "가입 후 올릴게요"]}
                    value={form.policyUploadTiming}
                    onChange={(v) => setField("policyUploadTiming", v)}
                  />
                </FieldBlock>
                <Hint>시현용입니다. 실제 파일은 업로드되지 않습니다.</Hint>
              </div>
            </div>
          </SectionFrame>

          <PremiumActionFooter
            step={3}
            progressLabel="보험 현황 작성 중"
            canNext={canNext3}
            onNext={() => setStep(4)}
            onPrev={() => setStep(2)}
          />
        </PremiumMainSurface>
      ) : null}

      {step === 4 ? (
        <PremiumMainSurface step={4}>
          <PremiumTitleBand
            title={STEPS[3].title}
            description="LIFEGUARD 이용과 보험차트 관리에 필요한 동의를 확인해 주세요."
            notice="선택 동의를 하지 않아도 서비스 이용에는 제한이 없습니다."
          />

          <SectionFrame
            number="01"
            title="전체 동의"
            subtitle="필수·선택 동의를 한 번에 확인할 수 있습니다."
            contentClassName="signup-vcenter-stack"
          >
            <label
              data-step4-all-agree="yes"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 38,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                width: "100%",
              }}
            >
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => {
                  const next = e.target.checked;
                  setForm((prev) => ({
                    ...prev,
                    consents: Object.fromEntries(allConsentKeys.map((k) => [k, next])),
                  }));
                }}
                style={{ width: CTRL.checkboxSize, height: CTRL.checkboxSize }}
              />
              전체 동의
            </label>
            <div className="signup-info-row">
              <span className="signup-info-pill">필수 7개</span>
              <span className="signup-info-pill">선택 2개</span>
              <span className="signup-info-pill">선택 없이 이용 가능</span>
            </div>
            <p className="signup-helper-slot">
              전체 동의 시 필수 동의와 선택 동의가 모두 포함됩니다.
            </p>
          </SectionFrame>

          <SectionFrame number="02" title="필수 동의" subtitle="LIFEGUARD 이용에 반드시 필요한 항목입니다.">
            <div className="signup-consent-grid" data-consent-group="required">
              {REQUIRED_CONSENTS.map((item) => (
                <ConsentRow
                  key={item.key}
                  item={item}
                  checked={form.consents[item.key]}
                  onToggle={() => setConsent(item.key, !form.consents[item.key])}
                  onView={() => setViewConsent(item)}
                />
              ))}
            </div>
          </SectionFrame>

          <SectionFrame
            number="03"
            title="선택 동의"
            subtitle="원하는 경우에만 동의할 수 있습니다."
            contentClassName="signup-vcenter-stack"
          >
            <div className="signup-grid-2-fixed" data-consent-group="optional">
              {OPTIONAL_CONSENTS.map((item) => (
                <ConsentRow
                  key={item.key}
                  item={item}
                  checked={form.consents[item.key]}
                  onToggle={() => setConsent(item.key, !form.consents[item.key])}
                  onView={() => setViewConsent(item)}
                />
              ))}
            </div>
            <div className="signup-helper-block" data-optional-helper="yes">
              <p className="signup-helper-slot">
                선택 동의를 하지 않아도 서비스 이용에는 제한이 없습니다.
              </p>
              <p className="signup-helper-slot">
                실제 보험사 제출 시 보험사·목적·제공 정보·기간을 다시 확인합니다.
              </p>
              <p className="signup-helper-slot">
                설계사 정보 공유 동의는 회원가입에 포함하지 않습니다.
              </p>
            </div>
          </SectionFrame>

          {submitError ? (
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#B91C1C", lineHeight: 1.45 }} role="alert">
              {submitError}
            </p>
          ) : null}
          <PremiumActionFooter
            step={4}
            progressLabel="약관·동의 확인 중"
            canNext={canJoin && !submitting}
            onNext={handleJoin}
            onPrev={() => setStep(3)}
            nextLabel={submitting ? "처리 중…" : "가입하기"}
          />
        </PremiumMainSurface>
      ) : null}

      {step === 5 ? (
        <div className="signup-stack" data-signup-complete>
          <header style={{ textAlign: "center", paddingTop: FINAL_UI.gutterPx }}>
            <div
              aria-hidden
              style={{
                width: 48,
                height: 48,
                margin: `0 auto ${HEADER_GAP_PX}px`,
                borderRadius: "50%",
                background: LG.navy,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              ✓
            </div>
            <p style={{ margin: 0, fontFamily: LG.serif, fontSize: 22, fontWeight: 600, letterSpacing: "0.04em" }}>
              LIFEGUARD
            </p>
            <h2
              data-signup-title
              style={{ margin: `${HEADER_GAP_PX}px 0 0`, fontSize: 22, fontWeight: 700, color: LG.text, lineHeight: 1.35 }}
            >
              회원가입이 완료되었습니다!
            </h2>
            <p style={{ margin: `${HEADER_GAP_PX}px 0 0`, fontSize: 15, lineHeight: 1.65, color: LG.textMuted }}>
              LIFEGUARD가 든든한 보험 주치의가 되어드릴게요.
            </p>
          </header>

          <div className="signup-complete-grid" data-complete-grid>
            {COMPLETE_CARDS.map((card) => {
              const selected = form.completeChoice === card.key;
              const recommended = card.key === "talk";
              return (
                <button
                  key={card.key}
                  type="button"
                  data-complete-card={card.key}
                  data-recommended={recommended ? "yes" : "no"}
                  onClick={() => handleCompleteAction(card.key)}
                  style={{
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: LABEL_MB,
                    minHeight: 112,
                    padding: `${FINAL_UI.actionCtaPadX}px`,
                    borderRadius: 14,
                    border: `1.5px solid ${
                      selected ? LG.navy : recommended ? "rgba(20, 36, 74, 0.28)" : LG.border
                    }`,
                    background: selected ? LG.accentSoft : recommended ? FINAL_UI.soft : LG.surface,
                    color: LG.text,
                    fontSize: 15,
                    fontWeight: 600,
                    fontFamily: LG.sans,
                    cursor: "pointer",
                    lineHeight: 1.45,
                    minWidth: 0,
                    width: "100%",
                  }}
                >
                  <span>{card.title}</span>
                  {recommended ? (
                    <span style={{ fontSize: 12, fontWeight: 500, color: LG.textMuted }}>권장</span>
                  ) : (
                    <span style={{ fontSize: 12, opacity: 0 }}>.</span>
                  )}
                </button>
              );
            })}
          </div>
          <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: LG.textMuted }}>
            {integrationEnabled
              ? needsEmailVerification
                ? "이메일 인증 후 로그인해 주세요. 인증 전에는 완료로 표시되지 않습니다."
                : submitMessage || "선택 후 KEY 대화·업로드·나중에 이어가기를 진행할 수 있습니다."
              : "시현: 선택 상태만 표시하며 계정·업로드·KEY 진입은 실행하지 않습니다."}
          </p>
          {integrationEnabled && needsEmailVerification && onRequestLogin ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: HEADER_GAP_PX }}>
              <PrimaryButton onClick={() => onRequestLogin()}>로그인으로 이동</PrimaryButton>
            </div>
          ) : null}

          <section
            data-all-insurer-section
            data-missing-logo-count={missingLogoCount}
            style={{
              marginTop: HEADER_GAP_PX,
              paddingTop: GRID_GAP_PX,
              borderTop: `1px solid ${LG.border}`,
            }}
          >
            <h3
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: 17,
                fontWeight: 600,
                color: LG.text,
                lineHeight: 1.4,
              }}
            >
              어느 보험사든, 고객 편에서 살펴봅니다.
            </h3>
            <p
              style={{
                margin: `${HEADER_GAP_PX}px auto 0`,
                maxWidth: 560,
                textAlign: "center",
                fontSize: 13,
                lineHeight: 1.65,
                color: LG.textMuted,
              }}
            >
              LIFEGUARD는 특정 보험사에 치우치지 않고
              <br />
              고객이 가입한 보험 전체를 함께 확인합니다.
            </p>

            <div style={{ marginTop: GRID_GAP_PX }}>
              <GroupTitle>생명보험사</GroupTitle>
              <div className="signup-insurer-grid" data-insurer-group="life">
                {(insurersExpanded ? LIFE_INSURERS : LIFE_INSURERS.slice(0, 10)).map((ins) => (
                  <div key={ins.id} className="signup-insurer-tile" aria-label={ins.name} title={ins.name}>
                    {ins.name}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: GRID_GAP_PX }}>
              <GroupTitle>손해보험사</GroupTitle>
              <div className="signup-insurer-grid" data-insurer-group="nonlife">
                {(insurersExpanded ? NON_LIFE_INSURERS : NON_LIFE_INSURERS.slice(0, 10)).map((ins) => (
                  <div key={ins.id} className="signup-insurer-tile" aria-label={ins.name} title={ins.name}>
                    {ins.name}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: STACK_GAP_PX }}>
              <GhostButton
                data-insurer-toggle
                onClick={() => setInsurersExpanded((v) => !v)}
                style={{ minWidth: 160, color: LG.navy }}
              >
                {insurersExpanded ? "접기" : "보험사 전체 보기"}
              </GhostButton>
            </div>

            <p
              style={{
                margin: `${GRID_GAP_PX}px 0 0`,
                textAlign: "center",
                fontSize: 12,
                lineHeight: 1.55,
                color: LG.textMuted,
              }}
            >
              보험사 로고는 보험사 식별을 위한 것이며,
              <br />
              제휴 관계나 추천 순위를 의미하지 않습니다.
            </p>
            <p
              style={{
                margin: `${FINAL_UI.sectionKMbPx}px 0 0`,
                textAlign: "center",
                fontSize: 11,
                color: LG.textMuted,
              }}
            >
              공식 로고 자산 확보 전 — 보험사명 자리표시자 (OFFICIAL_LOGO_PENDING: {missingLogoCount})
            </p>
          </section>
        </div>
      ) : null}

      {viewConsent ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(23, 32, 51, 0.35)",
            display: "grid",
            placeItems: "center",
            padding: FINAL_UI.actionCtaPadX,
            zIndex: 50,
          }}
          onClick={() => setViewConsent(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: LG.surface,
              borderRadius: 14,
              padding: FINAL_UI.actionCtaPadX,
              border: `1px solid ${LG.border}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: `0 0 ${FINAL_UI.cardPadX}px`, fontSize: 17 }}>
              {viewConsent.name} ({viewConsent.kind})
            </h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: LG.textMuted }}>{CONSENT_BODY}</p>
            <PrimaryButton
              style={{ width: "100%", marginTop: FINAL_UI.actionCtaPadX }}
              onClick={() => setViewConsent(null)}
            >
              닫기
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
