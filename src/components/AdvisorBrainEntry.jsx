import { useState } from "react";
import { fetchHomeBrainFact } from "../lib/customerHomeBrainFact.js";
import { toCustomerErrorMessage } from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const EXAMPLE_QUESTIONS = [
  "암보험 부족해?",
  "분당 맛집 알려줘",
  "상속세 얼마야?",
  "내 보험료 얼마야?",
];

const S = {
  hero: {
    background: "linear-gradient(165deg, rgba(37, 99, 235, 0.28) 0%, rgba(15, 23, 42, 0.95) 100%)",
    border: "1px solid rgba(96, 165, 250, 0.4)",
    borderRadius: "24px",
    padding: "32px 32px 28px",
    fontFamily: FONT,
    boxShadow: "0 20px 56px rgba(37, 99, 235, 0.16)",
  },
  title: {
    margin: 0,
    fontSize: "24px",
    fontWeight: 700,
    color: "#f8fafc",
  },
  desc: {
    margin: "10px 0 0",
    fontSize: "15px",
    color: "#cbd5e1",
    lineHeight: 1.65,
    maxWidth: "640px",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "18px",
  },
  chip: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "rgba(15, 23, 42, 0.55)",
    color: "#e2e8f0",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: FONT,
  },
  inputRow: {
    display: "flex",
    gap: "10px",
    marginTop: "20px",
    flexWrap: "wrap",
  },
  input: {
    flex: "1 1 280px",
    minWidth: "220px",
    padding: "14px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "rgba(15, 23, 42, 0.65)",
    color: "#f1f5f9",
    fontSize: "15px",
    fontFamily: FONT,
    outline: "none",
  },
  btn: {
    padding: "14px 20px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  answer: {
    marginTop: "18px",
    padding: "16px 18px",
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.6)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    color: "#e2e8f0",
    fontSize: "15px",
    lineHeight: 1.65,
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
    <section style={S.hero}>
      <h2 style={S.title}>Tom</h2>
      <p style={S.desc}>
        보험 관련 궁금한 점을 편하게 물어보세요. 보장내역서가 있으면 더 정확히 볼게요.
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
          placeholder="Tom에게 물어보세요"
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
          {loading ? "답변 중…" : "보내기"}
        </button>
      </div>

      {error ? <div style={S.error}>{error}</div> : null}
      {answerText ? <div style={S.answer}>{answerText}</div> : null}
    </section>
  );
}
