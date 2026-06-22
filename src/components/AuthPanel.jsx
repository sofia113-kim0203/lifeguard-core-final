import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { resolvePasswordResetRedirectUrl } from "../lib/authRecovery.js";
import {
  bootstrapSignupRecords,
  buildSignupMetadata,
  extractSignupProfileFromMetadata,
} from "../lib/signupBootstrap.js";
import { validateSignupBasicProfile } from "../lib/signupValidation.js";
import { formatLoginErrorMessage, toCustomerErrorMessage } from "../lib/uiLocale.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";

const CONSENTS = [
  { key: "consent_personal", label: "개인정보 수집 및 이용 동의", required: true },
  { key: "consent_sensitive_health", label: "민감정보 처리 동의", required: true },
  { key: "consent_ai_analysis", label: "서비스 이용 동의", required: true },
];

const AUTH_MODES = new Set(["login", "signup", "forgot-password"]);

function normalizeInitialMode(initialMode) {
  return AUTH_MODES.has(initialMode) ? initialMode : "login";
}

function MasterBrand({ signup = false }) {
  return (
    <header style={{ textAlign: "center", marginBottom: signup ? "36px" : "40px" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: LG.serif,
          fontSize: "clamp(36px, 8vw, 52px)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: LG.text,
          lineHeight: 1.1,
        }}
      >
        LIFEGUARD
      </h1>
      {!signup ? (
        <>
          <p style={{ margin: "14px 0 0", fontSize: "15px", color: LG.textMuted, letterSpacing: "0.02em" }}>
            당신의 보험 파트너
          </p>
          <p
            style={{
              margin: "20px auto 0",
              maxWidth: "320px",
              fontSize: "15px",
              lineHeight: 1.75,
              color: LG.textMuted,
              whiteSpace: "pre-line",
            }}
          >
            {"보험도,\n건강도,\n가족의 미래도.\n편하게 이야기하세요."}
          </p>
        </>
      ) : (
        <p style={{ margin: "16px 0 0", fontSize: "18px", color: LG.text, fontWeight: 500 }}>
          LIFEGUARD 시작하기
        </p>
      )}
    </header>
  );
}

function FieldLabel({ children }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontSize: "13px",
        fontWeight: 500,
        color: LG.textMuted,
      }}
    >
      {children}
    </label>
  );
}

function TextInput({ className = "", ...props }) {
  return (
    <input
      className={className}
      {...props}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "14px 16px",
        minHeight: "48px",
        borderRadius: "10px",
        border: `1px solid ${LG.border}`,
        background: LG.inputBg,
        color: LG.text,
        fontSize: "16px",
        fontFamily: LG.sans,
        outline: "none",
        ...(props.style ?? {}),
      }}
    />
  );
}

function PrimaryButton({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        width: "100%",
        minHeight: "48px",
        padding: "14px 20px",
        border: "none",
        borderRadius: "10px",
        background: props.disabled ? LG.buttonDisabled : LG.button,
        color: "#FFFFFF",
        fontSize: "16px",
        fontWeight: 600,
        fontFamily: LG.sans,
        cursor: props.disabled ? "not-allowed" : "pointer",
        ...(props.style ?? {}),
      }}
    />
  );
}

function TextLink({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        background: "none",
        border: "none",
        padding: "8px 4px",
        color: LG.textMuted,
        fontSize: "14px",
        fontFamily: LG.sans,
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
        ...(props.style ?? {}),
      }}
    >
      {children}
    </button>
  );
}

function Notice({ type, children }) {
  const isError = type === "error";
  return (
    <div
      style={{
        marginBottom: "20px",
        padding: "12px 14px",
        borderRadius: "10px",
        fontSize: "14px",
        lineHeight: 1.6,
        whiteSpace: "pre-line",
        background: isError ? "#FEF2F2" : "#F3F4F6",
        color: isError ? "#991B1B" : LG.text,
        border: `1px solid ${isError ? "#FECACA" : LG.border}`,
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
  const [phone, setPhone] = useState("");
  const [signupFieldErrors, setSignupFieldErrors] = useState({});
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
  const toggleConsent = (key) => setConsents((prev) => ({ ...prev, [key]: !prev[key] }));

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

    const profileFromMeta = extractSignupProfileFromMetadata(data.user?.user_metadata ?? {});
    const { error: bootstrapError } = await bootstrapSignupRecords(profileFromMeta);
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
      setError("필수 동의를 모두 체크해 주세요.");
      return;
    }

    const profileValidation = validateSignupBasicProfile({ displayName, phone });
    if (!profileValidation.valid) {
      setSignupFieldErrors(profileValidation.fieldErrors);
      setError(Object.values(profileValidation.fieldErrors)[0] ?? "입력값을 확인해 주세요.");
      return;
    }
    setSignupFieldErrors({});
    setLoading(true);

    const signupProfile = {
      displayName,
      phone: profileValidation.normalizedPhone,
    };
    const signupMetadata = buildSignupMetadata(signupProfile);
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
      const { error: saveError } = await bootstrapSignupRecords(signupProfile);
      if (saveError) {
        setLoading(false);
        setError(
          "회원가입은 되었지만 프로필 저장에 실패했습니다. " +
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
    setSignupFieldErrors({});
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo });
    setLoading(false);

    if (resetError) {
      setError(toCustomerErrorMessage(resetError, "비밀번호 재설정 요청에 실패했습니다."));
      return;
    }

    setMessage("입력하신 이메일로 비밀번호 재설정 안내를 보냈습니다.");
  };

  const renderLogin = () => (
    <>
      <MasterBrand />
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FieldLabel>
          이메일
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </FieldLabel>
        <FieldLabel>
          비밀번호
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </FieldLabel>
        <PrimaryButton type="submit" disabled={loading} style={{ marginTop: "8px" }}>
          {loading ? "로그인 중…" : "로그인"}
        </PrimaryButton>
      </form>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "20px",
          marginTop: "28px",
          flexWrap: "wrap",
        }}
      >
        <TextLink onClick={() => switchMode("signup")}>회원가입</TextLink>
        <TextLink onClick={() => switchMode("forgot-password")}>비밀번호 찾기</TextLink>
      </div>
    </>
  );

  const renderSignup = () => (
    <>
      <TextLink onClick={() => switchMode("login")} style={{ marginBottom: "8px", textAlign: "left", width: "100%" }}>
        ← 로그인
      </TextLink>
      <MasterBrand signup />
      <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FieldLabel>
          이름
          <TextInput
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            style={signupFieldErrors.displayName ? { borderColor: "#DC2626" } : undefined}
          />
        </FieldLabel>
        <FieldLabel>
          휴대폰
          <TextInput
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            required
            autoComplete="tel"
            style={signupFieldErrors.phone ? { borderColor: "#DC2626" } : undefined}
          />
        </FieldLabel>
        <FieldLabel>
          이메일
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </FieldLabel>
        <FieldLabel>
          비밀번호
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </FieldLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
          {CONSENTS.map((c) => (
            <label
              key={c.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "13px",
                color: LG.textMuted,
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={consents[c.key]} onChange={() => toggleConsent(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <PrimaryButton type="submit" disabled={loading || !allConsented} style={{ marginTop: "8px" }}>
          {loading ? "처리 중…" : "가입하기"}
        </PrimaryButton>
      </form>
    </>
  );

  const renderForgotPassword = () => (
    <>
      <TextLink onClick={() => switchMode("login")} style={{ marginBottom: "24px" }}>
        ← 로그인
      </TextLink>
      <h2 style={{ margin: "0 0 8px", fontSize: "22px", fontWeight: 600, color: LG.text, textAlign: "center" }}>
        비밀번호 찾기
      </h2>
      <p style={{ margin: "0 0 24px", textAlign: "center", color: LG.textMuted, fontSize: "14px", lineHeight: 1.6 }}>
        가입 이메일로 재설정 링크를 보내 드립니다.
      </p>
      <form onSubmit={handleForgotPassword} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FieldLabel>
          이메일
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </FieldLabel>
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "발송 중…" : "재설정 링크 보내기"}
        </PrimaryButton>
      </form>
    </>
  );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "400px",
        margin: "0 auto",
        fontFamily: LG.sans,
        color: LG.text,
      }}
    >
      {error ? <Notice type="error">{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}
      {mode === "login" ? renderLogin() : mode === "signup" ? renderSignup() : renderForgotPassword()}
    </div>
  );
}
