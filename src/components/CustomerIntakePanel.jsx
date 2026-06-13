import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HEALTH_DISCLOSURE_FIELD_DEFS,
  INSURANCE_DISCLOSURE_STATUS_OPTIONS,
} from "../lib/healthDisclosure.js";
import {
  computeIntakeCompleteness,
  getHealthDisclosureHints,
  validateIntakeForm,
} from "../lib/intakeCompleteness.js";
import {
  emptyIntakeForm,
  loadCustomerIntake,
  saveCustomerIntake,
} from "../lib/customerIntake.js";
import { REQUIRED_CONSENT_TYPES } from "../lib/customerDashboard.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";
import { memoryStatusLabel } from "../lib/memoryStatus.js";
import IntakeCompletenessBar from "./IntakeCompletenessBar.jsx";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const CONSENT_LABELS = {
  privacy_collection: "개인정보 수집 및 이용",
  sensitive_health_processing: "민감정보/건강정보 처리",
  ai_consultation: "보험분석 및 AI 상담",
};

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: "17px",
    fontWeight: 700,
    color: "#f1f5f9",
  },
  sectionDesc: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  label: {
    fontSize: "13px",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
  },
  inputError: {
    border: "1px solid rgba(248, 113, 113, 0.55)",
  },
  fieldError: {
    fontSize: "12px",
    color: "#fca5a5",
    lineHeight: 1.4,
  },
  fieldHint: {
    fontSize: "12px",
    color: "#fbbf24",
    lineHeight: 1.4,
  },
  textarea: {
    minHeight: "72px",
    resize: "vertical",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "16px",
  },
  btn: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  btnSecondary: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(30, 41, 59, 0.8)",
    color: "#e2e8f0",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    border: "1px solid rgba(248, 113, 113, 0.25)",
  },
  success: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(20, 83, 45, 0.35)",
    color: "#86efac",
    fontSize: "13px",
    border: "1px solid rgba(74, 222, 128, 0.25)",
  },
  consentRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(15, 23, 42, 0.4)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
  },
  disclosureBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.35)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  requiredMark: {
    color: "#f87171",
    marginLeft: "4px",
  },
};

function FieldLabel({ label, required = false, error, hint, children }) {
  return (
    <label style={S.label}>
      <span>
        {label}
        {required ? <span style={S.requiredMark}>*</span> : null}
      </span>
      {children}
      {error ? <span style={S.fieldError}>{error}</span> : null}
      {!error && hint ? <span style={S.fieldHint}>{hint}</span> : null}
    </label>
  );
}

function updateFormField(setForm, key, value) {
  setForm((prev) => ({ ...prev, [key]: value }));
}

function updateDisclosureField(setForm, key, value) {
  setForm((prev) => ({
    ...prev,
    healthDisclosure: { ...prev.healthDisclosure, [key]: value },
  }));
}

export default function CustomerIntakePanel({ user, onSaved }) {
  const [form, setForm] = useState(emptyIntakeForm());
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const completeness = useMemo(() => computeIntakeCompleteness(form), [form]);
  const disclosureHints = useMemo(() => getHealthDisclosureHints(form), [form]);

  const loadData = useCallback(async () => {
    if (!user) {
      setForm(emptyIntakeForm());
      setConsents([]);
      setFieldErrors({});
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const result = await loadCustomerIntake(user);
      setForm(result.form);
      setConsents(result.consents ?? []);
    } catch (err) {
      setForm(emptyIntakeForm());
      setConsents([]);
      setError(toCustomerErrorMessage(err, "고객 정보를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user) return;

    const validation = validateIntakeForm(form);
    setFieldErrors(validation.fieldErrors);
    if (!validation.valid) {
      setError("필수 항목을 확인해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await saveCustomerIntake(user, form);
      setForm(result.form);
      setConsents(result.consents ?? []);
      setFieldErrors({});
      setSuccess(
        result.memoryStatus === "degraded"
          ? `고객 정보가 저장되었습니다. (${memoryStatusLabel("degraded")})`
          : "고객 정보가 저장되었습니다.",
      );
      onSaved?.(result);
    } catch (err) {
      setError(toCustomerErrorMessage(err, "저장에 실패했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const activeConsents = REQUIRED_CONSENT_TYPES.map((type) => {
    const row = consents.find((item) => item.consent_type === type);
    const granted = Boolean(row?.granted && !row?.revoked_at);
    return { type, label: CONSENT_LABELS[type] ?? type, granted };
  });

  if (loading) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        고객 정보를 불러오는 중…
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#f8fafc" }}>
          고객 정보 입력
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: "14px", color: "#94a3b8", lineHeight: 1.55 }}>
          기본 프로필, 주소, 보험 요약, 상담 목적, 간소화된 건강 고지를 입력합니다. 건강 고지는
          선택 사항이며, 상세 메모는 향후 AI 분석에 활용됩니다.
        </p>
      </div>

      <IntakeCompletenessBar completeness={completeness} />

      {error ? <div style={S.error}>{error}</div> : null}
      {success ? <div style={S.success}>{success}</div> : null}

      <section style={S.card}>
        <h3 style={S.sectionTitle}>기본 프로필</h3>
        <div style={S.grid}>
          <FieldLabel label="이름" required error={fieldErrors.displayName}>
            <input
              style={{ ...S.input, ...(fieldErrors.displayName ? S.inputError : {}) }}
              value={form.displayName}
              onChange={(e) => updateFormField(setForm, "displayName", e.target.value)}
              placeholder="홍길동"
            />
          </FieldLabel>
          <FieldLabel label="생년월일" required error={fieldErrors.birthDate}>
            <input
              style={{ ...S.input, ...(fieldErrors.birthDate ? S.inputError : {}) }}
              type="date"
              value={form.birthDate}
              onChange={(e) => updateFormField(setForm, "birthDate", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="성별" required error={fieldErrors.gender}>
            <select
              style={{ ...S.input, ...(fieldErrors.gender ? S.inputError : {}) }}
              value={form.gender}
              onChange={(e) => updateFormField(setForm, "gender", e.target.value)}
            >
              <option value="">선택</option>
              <option value="male">남성</option>
              <option value="female">여성</option>
              <option value="other">기타</option>
            </select>
          </FieldLabel>
          <FieldLabel label="직업군">
            <input
              style={S.input}
              value={form.jobCategory}
              onChange={(e) => updateFormField(setForm, "jobCategory", e.target.value)}
              placeholder="예: 사무직"
            />
          </FieldLabel>
        </div>
      </section>

      <section style={S.card}>
        <h3 style={S.sectionTitle}>주소</h3>
        <FieldLabel label="거주지 주소">
          <input
            style={S.input}
            value={form.address}
            onChange={(e) => updateFormField(setForm, "address", e.target.value)}
            placeholder="시/구 단위까지 입력해 주세요"
          />
        </FieldLabel>
      </section>

      <section style={S.card}>
        <h3 style={S.sectionTitle}>보험 요약</h3>
        <p style={S.sectionDesc}>
          가입 중인 보험의 보험사·상품명·보장 요약을 간단히 입력합니다.
        </p>
        <div style={{ ...S.grid, marginBottom: "16px" }}>
          <FieldLabel label="보험사">
            <input
              style={S.input}
              value={form.insurerName}
              onChange={(e) => updateFormField(setForm, "insurerName", e.target.value)}
              placeholder="예: 삼성생명"
            />
          </FieldLabel>
          <FieldLabel label="상품명">
            <input
              style={S.input}
              value={form.productName}
              onChange={(e) => updateFormField(setForm, "productName", e.target.value)}
              placeholder="예: 종신보험"
            />
          </FieldLabel>
        </div>
        <FieldLabel label="보장 요약">
          <textarea
            style={{ ...S.input, ...S.textarea }}
            value={form.insuranceSummary}
            onChange={(e) => updateFormField(setForm, "insuranceSummary", e.target.value)}
            placeholder="가입 보험의 보장 내용을 간단히 입력해 주세요."
          />
        </FieldLabel>
      </section>

      <section style={S.card}>
        <h3 style={S.sectionTitle}>상담 목적</h3>
        <FieldLabel label="상담 목적 / 관심 사항" required error={fieldErrors.consultationPurpose}>
          <textarea
            style={{
              ...S.input,
              ...S.textarea,
              ...(fieldErrors.consultationPurpose ? S.inputError : {}),
            }}
            value={form.consultationPurpose}
            onChange={(e) => updateFormField(setForm, "consultationPurpose", e.target.value)}
            placeholder="예: 보장 공백 점검, 보험료 절감, 청구 가능성 확인"
          />
        </FieldLabel>
      </section>

      <section style={S.card}>
        <h3 style={S.sectionTitle}>건강 고지 (간소화)</h3>
        <p style={S.sectionDesc}>
          질병별 세부 항목 없이 보험 고지에 필요한 핵심 질문만 입력합니다. 입력하지 않아도
          저장할 수 있으며, 추가 설명은 메모 필드에 자유롭게 작성해 주세요.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {HEALTH_DISCLOSURE_FIELD_DEFS.map(
            ({ statusKey, notesKey, label, notesLabel, notesPlaceholder }) => (
              <div key={statusKey} style={S.disclosureBlock}>
                <FieldLabel label={label}>
                  <select
                    style={S.input}
                    value={form.healthDisclosure[statusKey]}
                    onChange={(e) =>
                      updateDisclosureField(setForm, statusKey, e.target.value)
                    }
                  >
                    <option value="">선택</option>
                    {INSURANCE_DISCLOSURE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
                <FieldLabel
                  label={notesLabel}
                  hint={disclosureHints[notesKey]}
                >
                  <textarea
                    style={{ ...S.input, ...S.textarea }}
                    value={form.healthDisclosure[notesKey]}
                    onChange={(e) =>
                      updateDisclosureField(setForm, notesKey, e.target.value)
                    }
                    placeholder={notesPlaceholder}
                  />
                </FieldLabel>
              </div>
            ),
          )}
        </div>
      </section>

      <section style={S.card}>
        <h3 style={S.sectionTitle}>필수 동의</h3>
        <p style={S.sectionDesc}>
          회원가입 시 제공한 동의 상태입니다. 동의는 가입 단계에서 처리되며 여기서는 확인만
          합니다.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {activeConsents.map(({ type, label, granted }) => (
            <div key={type} style={S.consentRow}>
              <span style={{ fontSize: "14px", color: "#e2e8f0" }}>{label}</span>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: granted ? "#4ade80" : "#f87171",
                }}
              >
                {granted ? "동의 완료" : "미동의"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button type="submit" style={S.btn} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
        <button type="button" style={S.btnSecondary} onClick={loadData} disabled={saving}>
          새로고침
        </button>
      </div>
    </form>
  );
}
