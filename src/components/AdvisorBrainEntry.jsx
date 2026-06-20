import { useState } from "react";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const EXAMPLE_QUESTIONS = [
  "내 보험료 얼마야?",
  "보험 몇 개 가입돼 있어?",
  "어느 보험사 가입돼 있어?",
  "보험료 미확인 건 있어?",
  "나를 기억하고 있어?",
];

const S = {
  card: {
    background: "linear-gradient(160deg, rgba(37, 99, 235, 0.22) 0%, rgba(15, 23, 42, 0.92) 100%)",
    border: "1px solid rgba(96, 165, 250, 0.35)",
    borderRadius: "20px",
    padding: "24px 28px",
    fontFamily: FONT,
  },
  title: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 700,
    color: "#f8fafc",
  },
  desc: {
    margin: "8px 0 0",
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "16px",
  },
  chip: {
    padding: "8px 12px",
    borderRadius: "999px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(15, 23, 42, 0.55)",
    color: "#cbd5e1",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: FONT,
  },
  inputRow: {
    display: "flex",
    gap: "10px",
    marginTop: "16px",
    flexWrap: "wrap",
  },
  input: {
    flex: "1 1 240px",
    minWidth: "200px",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    outline: "none",
  },
  btn: {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  answer: {
    marginTop: "16px",
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.15)",
    color: "#e2e8f0",
    fontSize: "14px",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  error: {
    marginTop: "12px",
    color: "#fca5a5",
    fontSize: "13px",
  },
};

export default function AdvisorBrainEntry({ disabled = false }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [answerText, setAnswerText] = useState("");

  const submitQuestion = async (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || disabled || loading) return;

    setLoading(true);
    setError("");
    setAnswerText("");

    try {
      const result = await fetchHomeBrainFact(trimmed);
      setAnswerText(result.answerText);
      setQuestion(trimmed);
    } catch (err) {
      setError(toCustomerErrorMessage(err, "질문에 답변하지 못했습니다."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={S.card}>
      <h2 style={S.title}>Advisor Brain</h2>
      <p style={S.desc}>
        등록된 보험 정보를 바탕으로 바로 답변합니다. 숫자는 시스템에 저장된 데이터만 사용합니다.
      </p>

      <div style={S.row}>
        {EXAMPLE_QUESTIONS.map((example) => (
          <button
            key={example}
            type="button"
            style={S.chip}
            disabled={disabled || loading}
            onClick={() => submitQuestion(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <div style={S.inputRow}>
        <input
          style={S.input}
          type="text"
          value={question}
          placeholder="예: 내 보험료 얼마야?"
          disabled={disabled || loading}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitQuestion(question);
          }}
        />
        <button
          type="button"
          style={S.btn}
          disabled={disabled || loading || !question.trim()}
          onClick={() => submitQuestion(question)}
        >
          {loading ? "답변 중…" : "질문하기"}
        </button>
      </div>

      {error ? <div style={S.error}>{error}</div> : null}
      {answerText ? <div style={S.answer}>{answerText}</div> : null}
    </section>
  );
}
