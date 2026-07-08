/**
 * KEY Voice Visual Blocks — Hand UI renderers (below KEY text bubble).
 */

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const blockWrap = {
  marginTop: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontFamily: FONT,
};

const blockCard = {
  background: "rgba(15, 23, 42, 0.55)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "10px",
  padding: "10px 12px",
  overflowX: "auto",
};

const blockTitle = {
  margin: "0 0 8px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#94a3b8",
  letterSpacing: "0.02em",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  color: "#e2e8f0",
};

const thStyle = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
  color: "#94a3b8",
  fontWeight: 600,
  fontSize: "12px",
};

const tdStyle = {
  padding: "6px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
  verticalAlign: "top",
};

const statusNeutral = {
  color: "#cbd5e1",
};

const stepRow = {
  display: "flex",
  gap: "8px",
  alignItems: "flex-start",
  padding: "6px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
  fontSize: "13px",
  color: "#e2e8f0",
};

const stepOrder = {
  flexShrink: 0,
  width: "20px",
  height: "20px",
  borderRadius: "999px",
  background: "rgba(59, 130, 246, 0.2)",
  color: "#93c5fd",
  fontSize: "11px",
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function SummaryTable({ block }) {
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];
  return (
    <div style={blockCard}>
      <p style={blockTitle}>{block.title}</p>
      <table style={tableStyle}>
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} style={thStyle}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${block.type}-row-${idx}`}>
              {row.map((cell, cellIdx) => (
                <td key={`${idx}-${cellIdx}`} style={tdStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageGapTable({ block }) {
  return (
    <div style={blockCard}>
      <p style={blockTitle}>{block.title ?? "암 보장 점검표"}</p>
      <table style={tableStyle}>
        <thead>
          <tr>
            {(block.columns ?? ["보장 항목", "확인 상태", "다음 확인"]).map((col) => (
              <th key={col} style={thStyle}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(block.rows ?? []).map((row, idx) => (
            <tr key={`gap-${idx}`}>
              <td style={tdStyle}>{row[0]}</td>
              <td style={{ ...tdStyle, ...statusNeutral }}>{row[1]}</td>
              <td style={{ ...tdStyle, color: "#94a3b8", fontSize: "12px" }}>{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NextStepsCard({ block }) {
  return (
    <div style={blockCard}>
      <p style={blockTitle}>{block.title ?? "다음 확인 순서"}</p>
      {(block.steps ?? []).map((step) => (
        <div key={`step-${step.order}`} style={stepRow}>
          <span style={stepOrder}>{step.order}</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>{step.label}</div>
            <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.45 }}>{step.move}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderBlock(block, index) {
  if (!block?.type) return null;
  const key = `${block.type}-${index}`;
  if (block.type === "coverage_gap_table") {
    return <CoverageGapTable key={key} block={block} />;
  }
  if (block.type === "next_steps_card") {
    return <NextStepsCard key={key} block={block} />;
  }
  if (block.type === "premium_summary_table" || block.type === "policy_count_summary") {
    return <SummaryTable key={key} block={block} />;
  }
  return null;
}

/**
 * @param {{ blocks?: object[] }} props
 */
export default function KeyVisualBlocks({ blocks = [] }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return <div style={blockWrap}>{blocks.map((block, index) => renderBlock(block, index))}</div>;
}
