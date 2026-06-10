import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { resolvePasswordResetRedirectUrl } from "../lib/authRecovery.js";
import { formatLoginErrorMessage, toCustomerErrorMessage } from "../lib/uiLocale.js";

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

const SERVICE_FEATURES = [
  { icon: "🧠", title: "보험 기억", desc: "가입·문서·상담 내역을 고객별로 기억합니다." },
  { icon: "📊", title: "보장 분석", desc: "보장 공백과 인수 위험을 데이터로 분석합니다." },
  { icon: "✦", title: "AI 추천", desc: "고객 상황에 맞는 보험 방향을 제안합니다." },
  { icon: "📋", title: "보험 설계", desc: "맞춤 설계안과 리밸런싱을 안내합니다." },
];

const SIGNUP_UI_FIELDS = [
  { label: "휴대폰", placeholder: "연결 예정" },
  { label: "생년월일", placeholder: "연결 예정" },
  { label: "성별", placeholder: "연결 예정" },
  { label: "직업", placeholder: "연결 예정" },
  { label: "기본 건강정보", placeholder: "연결 예정" },
];

const AUTH_MODES = new Set(["login", "signup", "forgot-password", "find-id"]);

function normalizeInitialMode(initialMode) {
  return AUTH_MODES.has(initialMode) ? initialMode : "login";
}

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

function AuthBrandHeader({ compact = false }) {
  return (
    <header className="auth-brand-header" style={{ textAlign: "center", marginBottom: compact ? "20px" : "clamp(28px, 5vw, 44px)" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          borderRadius: "999px",
          background: "rgba(37, 99, 235, 0.15)",
          border: "1px solid rgba(96, 165, 250, 0.35)",
          marginBottom: "16px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #60a5fa, #818cf8)",
            boxShadow: "0 0 12px rgba(96, 165, 250, 0.8)",
          }}
        />
        <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.18em", color: "#93c5fd" }}>
          LIFEGUARD
        </span>
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: "clamp(26px, 5.5vw, 40px)",
          fontWeight: 800,
          color: "#f8fafc",
          lineHeight: 1.25,
          letterSpacing: "-0.03em",
        }}
      >
        내 보험을 기억하고 분석하는
        <br />
        <span
          style={{
            background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 55%, #38bdf8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          AI 보험설계사
        </span>
      </h1>
      {!compact ? (
        <p
          style={{
            margin: "16px auto 0",
            maxWidth: "520px",
            fontSize: "clamp(14px, 2.8vw, 17px)",
            color: "#94a3b8",
            lineHeight: 1.7,
          }}
        >
          보험·문서·건강 정보를 바탕으로 보장 공백, 인수 위험, 맞춤 설계안을 안내하는 고객 전용 보험 AI 서비스입니다.
        </p>
      ) : null}
    </header>
  );
}

function ServiceFeatureGrid() {
  return (
    <section className="auth-feature-grid" aria-label="서비스 소개">
      {SERVICE_FEATURES.map((feature) => (
        <div key={feature.title} className="auth-feature-card">
          <div className="auth-feature-icon">{feature.icon}</div>
          <div className="auth-feature-title">{feature.title}</div>
          <div className="auth-feature-desc">{feature.desc}</div>
        </div>
      ))}
    </section>
  );
}

function AlertBox({ type, children }) {
  const styles =
    type === "error"
      ? {
          background: "rgba(127, 29, 29, 0.35)",
          color: "#fecaca",
          border: "1px solid rgba(248, 113, 113, 0.25)",
        }
      : {
          background: "rgba(20, 83, 45, 0.35)",
          color: "#86efac",
          border: "1px solid rgba(74, 222, 128, 0.25)",
        };
  return (
    <div
      style={{
        ...styles,
        padding: "14px 16px",
        borderRadius: "14px",
        fontSize: "14px",
        lineHeight: 1.6,
        whiteSpace: "pre-line",
        marginBottom: "20px",
      }}
    >
      {children}
    </div>
  );
}

export default function AuthPanel({ onLoginSuccess, initialMode = "login" }) {
  const [mode, setMode] = useState(() => normalizeInitialMode(initialMode));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [findName, setFindName] = useState("");
  const [findHint, setFindHint] = useState("");
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

  const switchMode = (nextMode) => {
    setMode(nextMode);
    reset();
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
      setError(formatLoginErrorMessage(err));
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

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    reset();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("비밀번호 재설정을 받을 이메일 주소를 입력해 주세요.");
      return;
    }

    setLoading(true);
    const redirectTo = resolvePasswordResetRedirectUrl();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });
    setLoading(false);

    if (resetError) {
      setError(toCustomerErrorMessage(resetError, "비밀번호 재설정 요청에 실패했습니다."));
      return;
    }

    setMessage(
      "입력하신 이메일로 비밀번호 재설정 안내를 보냈습니다. 메일함을 확인한 뒤 링크를 통해 새 비밀번호를 설정해 주세요.",
    );
  };

  const handleFindIdSubmit = (e) => {
    e.preventDefault();
    reset();
    setMessage(
      "가입 아이디는 이메일 주소입니다. 이메일을 기억하시면 '비밀번호 찾기'로 이동해 주세요. 기억나지 않으시면 담당 설계사 또는 고객센터로 문의해 주세요.",
    );
  };

  const renderLoginScreen = () => (
    <>
      <AuthBrandHeader />
      <ServiceFeatureGrid />

      <div className="auth-login-card">
        <h2 className="auth-card-title">로그인</h2>
        <p className="auth-card-subtitle">가입 이메일과 비밀번호로 LIFEGUARD에 접속합니다.</p>

        <form onSubmit={handleLogin} className="auth-form-stack">
          <label className="auth-field-label">
            이메일
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일 주소"
              required
              autoComplete="email"
            />
          </label>

          <label className="auth-field-label">
            비밀번호
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
              required
              autoComplete="current-password"
            />
          </label>

          <button type="submit" className="auth-primary-btn" disabled={loading}>
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <nav className="auth-footer-links" aria-label="계정 도움말">
          <button type="button" className="auth-footer-link" onClick={() => switchMode("find-id")}>
            아이디 찾기
          </button>
          <span className="auth-footer-divider" aria-hidden="true" />
          <button type="button" className="auth-footer-link" onClick={() => switchMode("forgot-password")}>
            비밀번호 찾기
          </button>
          <span className="auth-footer-divider" aria-hidden="true" />
          <button type="button" className="auth-footer-link auth-footer-link-strong" onClick={() => switchMode("signup")}>
            회원가입
          </button>
        </nav>
      </div>
    </>
  );

  const renderSignupScreen = () => (
    <>
      <button type="button" className="auth-back-link" onClick={() => switchMode("login")}>
        ← 로그인 화면으로
      </button>

      <AuthBrandHeader compact />

      <div className="auth-signup-card">
        <h2 className="auth-signup-title">회원가입</h2>
        <p className="auth-signup-subtitle">
          LIFEGUARD 보험 AI 서비스에 가입하고, 내 보험 분석·AI 상담·맞춤 설계를 시작하세요.
        </p>

        <form onSubmit={handleSignup} className="auth-form-stack auth-form-stack-wide">
          <div className="auth-form-section">
            <div className="auth-form-section-title">기본 정보</div>
            <label className="auth-field-label">
              이름
              <input
                type="text"
                className="auth-input auth-input-lg"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="실명 또는 표시 이름"
              />
            </label>
            <label className="auth-field-label">
              이메일
              <input
                type="email"
                className="auth-input auth-input-lg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일 주소"
                required
                autoComplete="email"
              />
            </label>
            <label className="auth-field-label">
              비밀번호
              <input
                type="password"
                className="auth-input auth-input-lg"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상"
                required
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="auth-form-section">
            <div className="auth-form-section-title">추가 정보 (UI · 순차 연결 예정)</div>
            <p className="auth-form-section-note">
              아래 항목은 Customer Memory 출발점으로 준비 중입니다. 이번 단계에서는 저장하지 않습니다.
            </p>
            <div className="auth-signup-field-grid">
              {SIGNUP_UI_FIELDS.map((field) => (
                <label key={field.label} className="auth-field-label">
                  {field.label}
                  <input
                    type="text"
                    className="auth-input auth-input-lg auth-input-disabled"
                    disabled
                    readOnly
                    value=""
                    placeholder={field.placeholder}
                    tabIndex={-1}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="auth-form-section">
            <div className="auth-form-section-title">정보제공 동의</div>
            <div className="auth-consent-stack">
              {CONSENTS.map((c) => (
                <div
                  key={c.key}
                  className={`auth-consent-row${consents[c.key] ? " auth-consent-row-active" : ""}`}
                  onClick={() => toggleConsent(c.key)}
                >
                  <input
                    type="checkbox"
                    checked={consents[c.key]}
                    onChange={() => toggleConsent(c.key)}
                    onClick={(e) => e.stopPropagation()}
                    className="auth-consent-checkbox"
                  />
                  <div>
                    <div className="auth-consent-label">
                      {c.label} <span className="auth-required">*</span>
                    </div>
                    <div className="auth-consent-desc">{c.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="auth-primary-btn auth-primary-btn-xl"
            disabled={loading || !allConsented}
          >
            {loading ? "가입 처리 중…" : "회원가입 완료"}
          </button>
        </form>
      </div>
    </>
  );

  const renderForgotPassword = () => (
    <div className="auth-subflow-card">
      <button type="button" className="auth-back-link" onClick={() => switchMode("login")}>
        ← 로그인으로 돌아가기
      </button>
      <h2 className="auth-card-title">비밀번호 찾기</h2>
      <p className="auth-card-subtitle">가입 시 사용한 이메일로 비밀번호 재설정 링크를 보내 드립니다.</p>
      <form onSubmit={handleForgotPassword} className="auth-form-stack">
        <label className="auth-field-label">
          이메일
          <input
            type="email"
            className="auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="가입 이메일 주소"
            required
            autoComplete="email"
          />
        </label>
        <button type="submit" className="auth-primary-btn" disabled={loading}>
          {loading ? "발송 중…" : "재설정 링크 보내기"}
        </button>
      </form>
    </div>
  );

  const renderFindId = () => (
    <div className="auth-subflow-card">
      <button type="button" className="auth-back-link" onClick={() => switchMode("login")}>
        ← 로그인으로 돌아가기
      </button>
      <h2 className="auth-card-title">아이디 찾기</h2>
      <div className="auth-info-box">
        가입 아이디는 이메일 주소입니다.
        <br />
        보안상 가입 여부는 안내하지 않습니다. 이메일을 기억하시면 비밀번호 찾기를 이용해 주세요.
      </div>
      <form onSubmit={handleFindIdSubmit} className="auth-form-stack">
        <label className="auth-field-label">
          이름
          <input
            type="text"
            className="auth-input"
            value={findName}
            onChange={(e) => setFindName(e.target.value)}
            placeholder="가입 시 입력한 이름"
          />
        </label>
        <label className="auth-field-label">
          휴대폰 또는 이메일 일부
          <input
            type="text"
            className="auth-input"
            value={findHint}
            onChange={(e) => setFindHint(e.target.value)}
            placeholder="예: 010-**** 또는 sofia"
          />
        </label>
        <button type="submit" className="auth-primary-btn">
          안내 확인
        </button>
        <button type="button" className="auth-inline-link" onClick={() => switchMode("forgot-password")}>
          이메일을 알고 있다면 비밀번호 찾기로 이동
        </button>
      </form>
    </div>
  );

  return (
    <div className="auth-first-screen" style={{ fontFamily: FONT }}>
      <style>{`
        .auth-first-screen {
          width: 100%;
          max-width: 960px;
          margin: 0 auto;
          padding: clamp(8px, 2vw, 16px) 0 clamp(32px, 6vw, 56px);
        }
        .auth-feature-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: clamp(10px, 2.5vw, 16px);
          margin-bottom: clamp(24px, 5vw, 40px);
        }
        .auth-feature-card {
          padding: clamp(16px, 3.5vw, 22px);
          border-radius: 18px;
          background: linear-gradient(160deg, rgba(30, 58, 138, 0.22) 0%, rgba(15, 23, 42, 0.75) 100%);
          border: 1px solid rgba(96, 165, 250, 0.18);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        }
        .auth-feature-icon { font-size: clamp(22px, 4vw, 28px); margin-bottom: 10px; }
        .auth-feature-title {
          font-size: clamp(14px, 2.8vw, 16px);
          font-weight: 800;
          color: #e2e8f0;
          margin-bottom: 6px;
        }
        .auth-feature-desc {
          font-size: clamp(12px, 2.4vw, 13px);
          color: #94a3b8;
          line-height: 1.55;
        }
        .auth-login-card,
        .auth-signup-card,
        .auth-subflow-card {
          background: rgba(15, 23, 42, 0.82);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: clamp(20px, 4vw, 28px);
          padding: clamp(24px, 5vw, 40px);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
        }
        .auth-signup-card {
          padding: clamp(28px, 6vw, 48px);
        }
        .auth-card-title,
        .auth-signup-title {
          margin: 0 0 8px;
          font-size: clamp(22px, 4.5vw, 30px);
          font-weight: 800;
          color: #f8fafc;
          text-align: center;
        }
        .auth-signup-title { font-size: clamp(26px, 5vw, 36px); }
        .auth-card-subtitle,
        .auth-signup-subtitle {
          margin: 0 0 clamp(20px, 4vw, 28px);
          text-align: center;
          font-size: clamp(14px, 2.8vw, 16px);
          color: #94a3b8;
          line-height: 1.65;
        }
        .auth-form-stack {
          display: flex;
          flex-direction: column;
          gap: clamp(16px, 3.5vw, 22px);
        }
        .auth-form-stack-wide { gap: clamp(22px, 4vw, 32px); }
        .auth-form-section-title {
          font-size: clamp(15px, 3vw, 17px);
          font-weight: 800;
          color: #e2e8f0;
          margin-bottom: 12px;
        }
        .auth-form-section-note {
          margin: 0 0 14px;
          font-size: 13px;
          color: #64748b;
          line-height: 1.55;
        }
        .auth-signup-field-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .auth-field-label {
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: clamp(14px, 2.8vw, 15px);
          font-weight: 700;
          color: #94a3b8;
        }
        .auth-input {
          width: 100%;
          box-sizing: border-box;
          padding: clamp(16px, 3.5vw, 20px) clamp(16px, 3.5vw, 18px);
          min-height: 56px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          background: rgba(2, 6, 23, 0.55);
          color: #f1f5f9;
          font-size: clamp(16px, 3.2vw, 18px);
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .auth-input:focus {
          border-color: rgba(96, 165, 250, 0.65);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
        }
        .auth-input-lg { min-height: 58px; }
        .auth-input-disabled {
          border-style: dashed;
          border-color: rgba(148, 163, 184, 0.2);
          background: rgba(15, 23, 42, 0.35);
          color: #64748b;
          cursor: not-allowed;
        }
        .auth-primary-btn {
          width: 100%;
          min-height: 58px;
          padding: 18px 20px;
          border: none;
          border-radius: 16px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 55%, #4f46e5 100%);
          color: #fff;
          font-size: clamp(17px, 3.4vw, 19px);
          font-weight: 800;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 14px 36px rgba(37, 99, 235, 0.38);
        }
        .auth-primary-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          box-shadow: none;
        }
        .auth-primary-btn-xl {
          min-height: 64px;
          font-size: clamp(18px, 3.6vw, 20px);
          margin-top: 8px;
        }
        .auth-footer-links {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px 14px;
          margin-top: clamp(22px, 4vw, 30px);
          padding-top: clamp(18px, 3.5vw, 24px);
          border-top: 1px solid rgba(148, 163, 184, 0.14);
        }
        .auth-footer-link {
          background: none;
          border: none;
          padding: 10px 6px;
          color: #60a5fa;
          font-size: clamp(14px, 2.8vw, 15px);
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 4px;
        }
        .auth-footer-link-strong { color: #93c5fd; font-size: clamp(15px, 3vw, 16px); }
        .auth-footer-divider {
          width: 1px;
          height: 14px;
          background: rgba(148, 163, 184, 0.35);
        }
        .auth-back-link {
          background: none;
          border: none;
          padding: 0 0 16px;
          color: #94a3b8;
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          text-align: left;
        }
        .auth-consent-stack { display: flex; flex-direction: column; gap: 12px; }
        .auth-consent-row {
          display: flex;
          gap: 14px;
          padding: clamp(14px, 3vw, 18px);
          border-radius: 14px;
          background: rgba(2, 6, 23, 0.45);
          border: 1px solid rgba(148, 163, 184, 0.14);
          cursor: pointer;
        }
        .auth-consent-row-active {
          border-color: rgba(59, 130, 246, 0.45);
          background: rgba(37, 99, 235, 0.12);
        }
        .auth-consent-checkbox {
          width: 20px;
          height: 20px;
          margin-top: 2px;
          accent-color: #3b82f6;
          cursor: pointer;
          flex-shrink: 0;
        }
        .auth-consent-label {
          font-size: clamp(14px, 2.8vw, 15px);
          font-weight: 700;
          color: #e2e8f0;
          line-height: 1.5;
        }
        .auth-consent-desc {
          margin-top: 4px;
          font-size: 12px;
          color: #64748b;
          line-height: 1.5;
        }
        .auth-required { color: #f87171; }
        .auth-info-box {
          padding: 16px 18px;
          border-radius: 14px;
          background: rgba(30, 58, 138, 0.22);
          border: 1px solid rgba(59, 130, 246, 0.28);
          color: #bfdbfe;
          font-size: 14px;
          line-height: 1.65;
          margin-bottom: 20px;
        }
        .auth-inline-link {
          background: none;
          border: none;
          padding: 8px 0 0;
          color: #60a5fa;
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          text-decoration: underline;
          text-align: center;
        }
        @media (min-width: 720px) {
          .auth-feature-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .auth-signup-field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      {error ? <AlertBox type="error">{error}</AlertBox> : null}
      {message ? <AlertBox type="success">{message}</AlertBox> : null}

      {mode === "login"
        ? renderLoginScreen()
        : mode === "signup"
          ? renderSignupScreen()
          : mode === "forgot-password"
            ? (
              <>
                <AuthBrandHeader compact />
                {renderForgotPassword()}
              </>
            )
            : (
              <>
                <AuthBrandHeader compact />
                {renderFindId()}
              </>
            )}
    </div>
  );
}
