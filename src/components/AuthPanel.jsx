import { useState } from "react";
import { supabase } from "../lib/supabase.js";

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "32px 36px",
    maxWidth: "480px",
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

async function createCustomerProfile(userId, displayName) {
  const { error } = await supabase.from("customer_profiles").insert({
    user_id: userId,
    display_name: displayName || null,
    status: "draft",
  });
  return error;
}

export default function AuthPanel() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState(null);

  const reset = () => {
    setError("");
    setMessage("");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    reset();
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSession(data.session);
    setMessage("로그인 성공: " + data.user.email);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    reset();
    if (!email || !password) { setError("이메일과 비밀번호를 입력해 주세요."); return; }
    setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    if (err) { setLoading(false); setError(err.message); return; }
    if (data.user) {
      const profileError = await createCustomerProfile(data.user.id, displayName);
      if (profileError && !profileError.message?.includes("duplicate")) {
        setLoading(false);
        setError("회원가입 완료, 프로필 생성 실패: " + profileError.message);
        return;
      }
    }
    setLoading(false);
    setMessage("회원가입 완료. 이메일 인증 후 로그인해 주세요.");
    setMode("login");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setEmail("");
    setPassword("");
    setDisplayName("");
    reset();
  };

  if (session) {
    return (
      <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          로그인/회원가입
        </h1>
        <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={S.success}>로그인 중: {session.user?.email}</div>
          <button type="button" style={S.btnSecondary} onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </div>
    );
  }

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
                border: mode === m ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(148,163,184,0.15)",
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
              이름 (선택)
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
          <button type="submit" style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>
      </div>
    </div>
  );
}
