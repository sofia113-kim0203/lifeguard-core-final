import { formatCompletenessLabel } from "../lib/intakeCompleteness.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

export default function IntakeCompletenessBar({ completeness, compact = false }) {
  if (!completeness) return null;

  const { score, sections } = completeness;
  const label = formatCompletenessLabel(score);

  return (
    <div
      style={{
        fontFamily: FONT,
        padding: compact ? "14px 16px" : "16px 18px",
        borderRadius: "12px",
        background: "rgba(15, 23, 42, 0.45)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: compact ? "8px" : "12px",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#e2e8f0" }}>
          입력 완료도
        </span>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#60a5fa" }}>
          {score}% · {label}
        </span>
      </div>
      <div
        style={{
          height: "8px",
          borderRadius: "999px",
          background: "rgba(30, 41, 59, 0.9)",
          overflow: "hidden",
          marginBottom: compact ? 0 : "12px",
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            borderRadius: "999px",
            background: "linear-gradient(90deg, #3b82f6 0%, #22d3ee 100%)",
            transition: "width 0.25s ease",
          }}
        />
      </div>
      {!compact ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "8px",
          }}
        >
          {Object.values(sections).map((section) => (
            <div
              key={section.label}
              style={{
                fontSize: "12px",
                color: "#94a3b8",
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span>{section.label}</span>
              <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                {section.score}/{section.max}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
