import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';
const CONSENT_VERSION = "2026-01-01-ko";

const CONSENTS = [
  {
    key: "consent_personal",
    type: "privacy_collection",
    label: "개인정보 수집 및 이용 동의",
    desc: "이름, 이메일 등 기본 개인정보를 서비스 제공 목적으로 수집·이용합니다.",
    required: true,
  },
  {
    key: "consent_sensitive_health",
    type: "sensitive_health_processing",
    label: "민감정보/건강정보 수집 및 이용 동의",
    desc: "보험 분석을 위해 건강·의료 관련 민감정보를 처리합니다.",
    required: true,
  },
  {
    key: "consent_ai_analysis",
    type: "ai_consultation",
    label: "보험분석 및 AI 상담 목적 이용 동의",
    desc: "입력된 데이터를 AI 보험 상담 및 보장 분석 목적으로 활용합니다.",
    required: true,
  },
];

const FUTURE_FIELDS = [
  { label: "휴대폰", placeholder: "연결 예정" },
  { label: "생년월일", placeholder: "연결 예정" },
  { label: "성별", placeholder: "연결 예정" },
  { label: "직업", placeholder: "연결 예정" },
  { label: "기본 건강정보", placeholder: "연결 예정" },
];

const S = {
  shell: {
    width: "100%",
    maxWidth: "520px",
    fontFamily: FONT,
  },
  hero: {
    marginBottom: "28px",
    textAlign: "center",
  },
  title: {
    margin: 0,
    fontSize: "30px",
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: "12px 0 0",
    fontSize: "15px",
    color: "#94a3b8",
    lineHeight: 1.65,
  },
  card: {
    background: "rgba(30, 41, 59, 0.72)",
    border: "1px solid rgba(148, 163, 184, 0.14)",
    borderRadius: "20px",
    padding: "32px 34px",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
  },
  tabs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginBottom: "28px",
    padding: "4px",
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
  },
  tab: (active) => ({
    padding: "14px 12px",
    borderRadius: "10px",
    border: "none",
    background: active ? "linear-gradient(135deg, #2563eb, #4f46e5)" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    fontSize: "15px",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    fontFamily: FONT,
  }),
  input: {
    width: "100%",
    padding: "15px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "rgba(15, 23, 42, 0.65)",
    color: "#e2e8f0",
    fontSize: "16px",
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
  },
  inputDisabled: {
    width: "100%",
    padding: "15px 16px",
    borderRadius: "12px",
    border: "1px dashed rgba(148, 163, 184, 0.18)",
    background: "rgba(15, 23, 42, 0.35)",
    color: "#64748b",
    fontSize: "15px",
    fontFamily: FONT,
    boxSizing: "border-box",
  },
  label: {
    fontSize: "14px",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    fontWeight: 600,
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.45)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    cursor: "pointer",
  },
  checkLabel: {
    fontSize: "14px",
    color: "#cbd5e1",
    lineHeight: 1.55,
    cursor: "pointer",
    userSelect: "none",
  },
  btn: {
    width: "100%",
    padding: "16px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "16px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: FONT,
    marginTop: "8px",
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
  },
  success: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(20, 83, 45, 0.35)",
    color: "#86efac",
    fontSize: "13px",
  },
  sectionNote: {
    fontSize: "12px",
    color: "#64748b",
    marginTop: "4px",
    lineHeight: 1.5,
  },
};

function buildSignupMetadata(displayName) {
  const metadata = {
    signup_complete: "true",
    signup_consent_version: CONSENT_VERSION,
  };
  const trimmedName = displayName?.trim();
  if (trimmedName) metadata.display_name = trimmedName;
  return metadata;
}

async function bootstrapSignupRecords(displayName) {
  const { data, error } = await supabase.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: displayName?.trim() || null,
    p_consent_version: CONSENT_VERSION,
  });
  if (error) return { error };
  return { error: null, customerId: data?.customer_id ?? null };
}

export default function AuthPanel({ onLoginSuccess, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [consents, setConsents] = useState({
    consent_personal: false,
    consent_sensitive_health: false,
    consent_ai_analysis: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const allConsented = CONSENTS.every((c) => consents[c.key]);
  const reset = () => {
    setError("");
    setMessage("");
  };

  const toggleConsent = (key) =>
    setConsents((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleLogin = async (e) => {
    e.preventDefault();
    reset();
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setLoading(false);
      setError(toCustomerErrorMessage(err, "로그인에 실패했습니다."));
      return;
    }

    const displayNameFromMeta =
      data.user?.user_metadata?.display_name ?? data.user?.user_metadata?.displayName ?? null;
    const { error: bootstrapError } = await bootstrapSignupRecords(displayNameFromMeta);
    setLoading(false);
    if (bootstrapError) {
      setError(
        "로그인은 되었지만 프로필 동기화에 실패했습니다. " +
          toCustomerErrorMessage(bootstrapError, "잠시 후 다시 시도해 주세요."),
      );
      return;
    }

    onLoginSuccess?.();
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    reset();
    if (!email || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    if (!allConsented) {
      setError("필수 동의 3개를 모두 체크해 주세요.");
      return;
    }
    setLoading(true);

    const signupMetadata = buildSignupMetadata(displayName);
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: signupMetadata },
    });
    if (authError) {
      setLoading(false);
      setError(toCustomerErrorMessage(authError, "회원가입에 실패했습니다."));
      return;
    }

    if (data.session) {
      if (data.user) {
        await supabase.auth.updateUser({ data: signupMetadata });
      }
      const { error: saveError } = await bootstrapSignupRecords(displayName);
      if (saveError) {
        setLoading(false);
        setError(
          "회원가입은 되었지만 프로필·동의 저장에 실패했습니다. " +
            toCustomerErrorMessage(saveError, "잠시 후 다시 시도해 주세요."),
        );
        return;
      }
    }

    setLoading(false);
    setMessage("회원가입 완료. 이메일 인증 후 로그인해 주세요.");
    setMode("login");
    setConsents({
      consent_personal: false,
      consent_sensitive_health: false,
      consent_ai_analysis: false,
    });
  };

  return (
    <div style={S.shell}>
      <div style={S.hero}>
        <h1 style={S.title}>LIFEGUARD 보험 AI</h1>
        <p style={S.subtitle}>
          가입 보험·문서·건강 정보를 바탕으로 보장 공백, 인수 위험, 맞춤 설계안을 안내합니다.
        </p>
      </div>

      <div style={S.card}>
        <div style={S.tabs}>
          <button type="button" style={S.tab(mode === "login")} onClick={() => { setMode("login"); reset(); }}>
            로그인
          </button>
          <button type="button" style={S.tab(mode === "signup")} onClick={() => { setMode("signup"); reset(); }}>
            회원가입
          </button>
        </div>

        {error ? <div style={{ ...S.error, marginBottom: "16px" }}>{error}</div> : null}
        {message ? <div style={{ ...S.success, marginBottom: "16px" }}>{message}</div> : null}

        <form
          onSubmit={mode === "login" ? handleLogin : handleSignup}
          style={{ display: "flex", flexDirection: "column", gap: "18px" }}
        >
          {mode === "signup" ? (
            <label style={S.label}>
              이름
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="실명 또는 표시 이름"
                style={S.input}
              />
            </label>
          ) : null}

          <label style={S.label}>
            이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일 주소"
              required
              autoComplete="email"
              style={S.input}
            />
          </label>

          <label style={S.label}>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              style={S.input}
            />
          </label>

          {mode === "signup" ? (
            <>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#cbd5e1" }}>
                  추가 정보 (선택 · 순차 연결 예정)
                </div>
                <div style={S.sectionNote}>
                  아래 항목은 Customer Memory 출발점으로 준비 중입니다. 이번 단계에서는 저장하지 않습니다.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
                  {FUTURE_FIELDS.map((field) => (
                    <label key={field.label} style={S.label}>
                      {field.label}
                      <input
                        type="text"
                        disabled
                        readOnly
                        value=""
                        placeholder={field.placeholder}
                        style={S.inputDisabled}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#cbd5e1" }}>정보제공 동의</div>
                {CONSENTS.map((c) => (
                  <div
                    key={c.key}
                    style={{
                      ...S.checkRow,
                      borderColor: consents[c.key]
                        ? "rgba(59,130,246,0.4)"
                        : "rgba(148,163,184,0.12)",
                      background: consents[c.key]
                        ? "rgba(37,99,235,0.12)"
                        : "rgba(15,23,42,0.45)",
                    }}
                    onClick={() => toggleConsent(c.key)}
                  >
                    <input
                      type="checkbox"
                      checked={consents[c.key]}
                      onChange={() => toggleConsent(c.key)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: "3px", accentColor: "#3b82f6", cursor: "pointer", width: "18px", height: "18px" }}
                    />
                    <div>
                      <div style={{ ...S.checkLabel, fontWeight: 700 }}>
                        {c.label} <span style={{ color: "#ef4444" }}>*</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{c.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <button
            type="submit"
            style={{
              ...S.btn,
              opacity: loading || (mode === "signup" && !allConsented) ? 0.55 : 1,
              cursor: loading || (mode === "signup" && !allConsented) ? "not-allowed" : "pointer",
            }}
            disabled={loading || (mode === "signup" && !allConsented)}
          >
            {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>
      </div>
    </div>
  );
}
