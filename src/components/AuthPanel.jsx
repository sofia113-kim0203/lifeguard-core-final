import { useState } from "react";
import { supabase } from "../lib/supabase.js";

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "32px 36px",
    maxWidth: "520px",
    width: "100%",
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
  label: {
    fontSize: "13px",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(15, 23, 42, 0.4)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    cursor: "pointer",
  },
  checkLabel: {
    fontSize: "13px",
    color: "#cbd5e1",
    lineHeight: 1.55,
    cursor: "pointer",
    userSelect: "none",
  },
  btn: {
    width: "100%",
    padding: "13px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
    marginTop: "8px",
  },
  btnSecondary: {
    background: "transparent",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    color: "#94a3b8",
    padding: "10px",
    width: "100%",
    borderRadius: "10px",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: FONT,
    marginTop: "4px",
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
};

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

function buildSignupMetadata(displayName) {
  const metadata = {
    signup_complete: "true",
    signup_consent_version: CONSENT_VERSION,
  };
  const trimmedName = displayName?.trim();
  if (trimmedName) {
    metadata.display_name = trimmedName;
  }
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

export default function AuthPanel({ onLoginSuccess }) {
  const [mode, setMode] = useState("login");
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

  const reset = () => { setError(""); setMessage(""); };

  const toggleConsent = (key) =>
    setConsents((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleLogin = async (e) => {
    e.preventDefault();
    reset();
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setLoading(false); setError(err.message); return; }

    const displayNameFromMeta =
      data.user?.user_metadata?.display_name ?? data.user?.user_metadata?.displayName ?? null;
    const { error: bootstrapError } = await bootstrapSignupRecords(displayNameFromMeta);
    setLoading(false);
    if (bootstrapError) {
      setError("로그인 성공, 프로필 동기화 실패: " + bootstrapError.message);
      return;
    }

    onLoginSuccess?.();
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    reset();
    if (!email || !password) { setError("이메일과 비밀번호를 입력해 주세요."); return; }
    if (!allConsented) { setError("필수 동의 3개를 모두 체크해 주세요."); return; }
    setLoading(true);

    const signupMetadata = buildSignupMetadata(displayName);

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: signupMetadata,
      },
    });
    if (authError) { setLoading(false); setError(authError.message); return; }

    if (data.session) {
      if (data.user) {
        await supabase.auth.updateUser({ data: signupMetadata });
      }

      const { error: saveError } = await bootstrapSignupRecords(displayName);
      if (saveError) {
        setLoading(false);
        setError("회원가입 완료, 프로필/동의 저장 실패: " + saveError.message);
        return;
      }
    }

    setLoading(false);
    setMessage("회원가입 완료. 이메일 인증 후 로그인해 주세요.");
    setMode("login");
    setConsents({ consent_personal: false, consent_sensitive_health: false, consent_ai_analysis: false });
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
        로그인/회원가입
      </h1>

      <div style={S.card}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
          {["login", "signup"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); reset(); }}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: "10px",
                border: mode === m
                  ? "1px solid rgba(59,130,246,0.5)"
                  : "1px solid rgba(148,163,184,0.15)",
                background: mode === m ? "rgba(37,99,235,0.25)" : "transparent",
                color: mode === m ? "#f8fafc" : "#64748b",
                fontSize: "14px",
                fontWeight: mode === m ? 600 : 400,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {m === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>

        {error && <div style={{ ...S.error, marginBottom: "16px" }}>{error}</div>}
        {message && <div style={{ ...S.success, marginBottom: "16px" }}>{message}</div>}

        <form
          onSubmit={mode === "login" ? handleLogin : handleSignup}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          {mode === "signup" && (
            <label style={S.label}>
              이름
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="홍길동"
                style={S.input}
              />
            </label>
          )}

          <label style={S.label}>
            이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
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
              style={S.input}
            />
          </label>

          {mode === "signup" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "2px" }}>
                필수 동의 항목 (3개 모두 동의 필요)
              </div>
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
                      : "rgba(15,23,42,0.4)",
                  }}
                  onClick={() => toggleConsent(c.key)}
                >
                  <input
                    type="checkbox"
                    checked={consents[c.key]}
                    onChange={() => toggleConsent(c.key)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: "2px", accentColor: "#3b82f6", cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ ...S.checkLabel, fontWeight: 600 }}>
                      {c.label} <span style={{ color: "#ef4444" }}>*</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                      {c.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            style={{
              ...S.btn,
              opacity: loading || (mode === "signup" && !allConsented) ? 0.5 : 1,
              cursor: loading || (mode === "signup" && !allConsented) ? "not-allowed" : "pointer",
            }}
            disabled={loading || (mode === "signup" && !allConsented)}
          >
            {loading
              ? "처리 중…"
              : mode === "login"
              ? "로그인"
              : "회원가입"}
          </button>
        </form>
      </div>
    </div>
  );
}
