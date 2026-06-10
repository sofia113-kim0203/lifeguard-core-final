import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { isRecoveryHash } from "../lib/authRecovery.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
    background: "linear-gradient(145deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
    fontFamily: FONT,
    color: "#e2e8f0",
  },
  shell: {
    width: "100%",
    maxWidth: "480px",
  },
  title: {
    margin: "0 0 8px",
    fontSize: "26px",
    fontWeight: 700,
    color: "#f8fafc",
    textAlign: "center",
  },
  subtitle: {
    margin: "0 0 28px",
    fontSize: "14px",
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 1.6,
  },
  card: {
    background: "rgba(30, 41, 59, 0.72)",
    border: "1px solid rgba(148, 163, 184, 0.14)",
    borderRadius: "20px",
    padding: "32px 34px",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
  },
  label: {
    fontSize: "14px",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    fontWeight: 600,
  },
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
  linkBtn: {
    width: "100%",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "transparent",
    color: "#94a3b8",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
    marginTop: "12px",
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    lineHeight: 1.55,
    marginBottom: "16px",
  },
  success: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(20, 83, 45, 0.35)",
    color: "#86efac",
    fontSize: "13px",
    lineHeight: 1.55,
    marginBottom: "16px",
  },
  info: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(30, 58, 138, 0.25)",
    color: "#bfdbfe",
    fontSize: "13px",
    lineHeight: 1.55,
    marginBottom: "16px",
  },
};

const EXPIRED_LINK_MESSAGE =
  "비밀번호 재설정 링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요.";

export default function ResetPasswordPanel({ onGoToLogin }) {
  const [ready, setReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    const evaluateSession = (session, fromRecoveryEvent = false) => {
      if (!mounted) return;
      const recoveryContext = fromRecoveryEvent || isRecoveryHash();
      setHasRecoverySession(Boolean(session && recoveryContext));
      setReady(true);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      evaluateSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        evaluateSession(session, true);
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (isRecoveryHash()) {
          evaluateSession(session, true);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("비밀번호는 8자 이상으로 설정해 주세요.");
      return;
    }
    if (password !== confirmPassword) {
      setError("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(toCustomerErrorMessage(updateError, "비밀번호 변경에 실패했습니다. 다시 시도해 주세요."));
      return;
    }

    setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
    await supabase.auth.signOut();
    window.setTimeout(() => onGoToLogin?.(), 1200);
  };

  if (!ready) {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <p style={{ ...S.subtitle, marginBottom: 0 }}>비밀번호 재설정 화면을 준비하는 중…</p>
        </div>
      </div>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <h1 style={S.title}>비밀번호 재설정</h1>
          <p style={S.subtitle}>재설정 링크를 확인한 뒤 새 비밀번호를 설정할 수 있습니다.</p>
          <div style={S.card}>
            <div style={S.error}>{EXPIRED_LINK_MESSAGE}</div>
            <button type="button" style={S.linkBtn} onClick={() => onGoToLogin?.("forgot-password")}>
              비밀번호 찾기 다시 요청
            </button>
            <button type="button" style={{ ...S.linkBtn, marginTop: "8px" }} onClick={() => onGoToLogin?.("login")}>
              로그인 화면으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.shell}>
        <h1 style={S.title}>새 비밀번호 설정</h1>
        <p style={S.subtitle}>안전한 새 비밀번호를 입력한 뒤 변경을 완료해 주세요.</p>
        <div style={S.card}>
          {error ? <div style={S.error}>{error}</div> : null}
          {message ? <div style={S.success}>{message}</div> : null}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <label style={S.label}>
              새 비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상"
                required
                autoComplete="new-password"
                style={S.input}
              />
            </label>

            <label style={S.label}>
              새 비밀번호 확인
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="비밀번호를 다시 입력"
                required
                autoComplete="new-password"
                style={S.input}
              />
            </label>

            <button
              type="submit"
              style={{ ...S.btn, opacity: loading ? 0.55 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              disabled={loading}
            >
              {loading ? "변경 중…" : "비밀번호 변경"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
