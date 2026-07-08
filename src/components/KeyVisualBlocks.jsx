/**
 * KEY Voice Visual Blocks — Hand UI renderers (below KEY text bubble).
 */

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const THEMES = {
  dark: {
    blockCard: {
      background: "rgba(15, 23, 42, 0.55)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: "10px",
      padding: "10px 12px",
      overflowX: "auto",
    },
    blockTitle: {
      margin: "0 0 8px",
      fontSize: "12px",
      fontWeight: 600,
      color: "#94a3b8",
      letterSpacing: "0.02em",
    },
    blockSubtitle: {
      margin: "0 0 8px",
      fontSize: "11px",
      color: "#94a3b8",
      lineHeight: 1.45,
    },
    tableStyle: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "13px",
      color: "#e2e8f0",
    },
    thStyle: {
      textAlign: "left",
      padding: "6px 8px",
      borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
      color: "#94a3b8",
      fontWeight: 600,
      fontSize: "12px",
    },
    tdStyle: {
      padding: "6px 8px",
      borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
      verticalAlign: "top",
    },
    statusNeutral: { color: "#cbd5e1" },
    mutedCell: { color: "#94a3b8", fontSize: "12px" },
    stepRow: {
      display: "flex",
      gap: "8px",
      alignItems: "flex-start",
      padding: "6px 0",
      borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
      fontSize: "13px",
      color: "#e2e8f0",
    },
    stepOrder: {
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
    },
  },
  home: {
    blockCard: {
      background: "#FFFFFF",
      border: "1px solid #E8E8E4",
      borderRadius: "10px",
      padding: "10px 12px",
      overflowX: "auto",
    },
    blockTitle: {
      margin: "0 0 8px",
      fontSize: "12px",
      fontWeight: 600,
      color: "#666666",
      letterSpacing: "0.02em",
    },
    blockSubtitle: {
      margin: "0 0 8px",
      fontSize: "11px",
      color: "#999999",
      lineHeight: 1.45,
    },
    tableStyle: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "13px",
      color: "#111111",
    },
    thStyle: {
      textAlign: "left",
      padding: "6px 8px",
      borderBottom: "1px solid #E8E8E4",
      color: "#666666",
      fontWeight: 600,
      fontSize: "12px",
    },
    tdStyle: {
      padding: "6px 8px",
      borderBottom: "1px solid #F3F3F0",
      verticalAlign: "top",
    },
    statusNeutral: { color: "#666666" },
    mutedCell: { color: "#999999", fontSize: "12px" },
    stepRow: {
      display: "flex",
      gap: "8px",
      alignItems: "flex-start",
      padding: "6px 0",
      borderBottom: "1px solid #F3F3F0",
      fontSize: "13px",
      color: "#111111",
    },
    stepOrder: {
      flexShrink: 0,
      width: "20px",
      height: "20px",
      borderRadius: "999px",
      background: "rgba(31, 41, 55, 0.08)",
      color: "#1F2937",
      fontSize: "11px",
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
  },
};

function resolveTheme(variant) {
  return THEMES[variant === "home" ? "home" : "dark"] ?? THEMES.dark;
}

function SummaryTable({ block, theme }) {
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];
  return (
    <div style={theme.blockCard}>
      <p style={theme.blockTitle}>{block.title}</p>
      {block.subtitle ? <p style={theme.blockSubtitle}>{block.subtitle}</p> : null}
      <table style={theme.tableStyle}>
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} style={theme.thStyle}>
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
                <td key={`${idx}-${cellIdx}`} style={theme.tdStyle}>
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

function CoverageGapTable({ block, theme }) {
  return (
    <div style={theme.blockCard}>
      <p style={theme.blockTitle}>{block.title ?? "암 보장 점검표"}</p>
      {block.subtitle ? <p style={theme.blockSubtitle}>{block.subtitle}</p> : null}
      <table style={theme.tableStyle}>
        <thead>
          <tr>
            {(block.columns ?? ["보장 항목", "확인 상태", "다음 확인"]).map((col) => (
              <th key={col} style={theme.thStyle}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(block.rows ?? []).map((row, idx) => (
            <tr key={`gap-${idx}`}>
              <td style={theme.tdStyle}>{row[0]}</td>
              <td style={{ ...theme.tdStyle, ...theme.statusNeutral }}>{row[1]}</td>
              <td style={{ ...theme.tdStyle, ...theme.mutedCell }}>{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NextStepsCard({ block, theme }) {
  return (
    <div style={theme.blockCard}>
      <p style={theme.blockTitle}>{block.title ?? "다음 확인 순서"}</p>
      {(block.steps ?? []).map((step) => (
        <div key={`step-${step.order}`} style={theme.stepRow}>
          <span style={theme.stepOrder}>{step.order}</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>{step.label}</div>
            <div style={{ ...theme.mutedCell, lineHeight: 1.45 }}>{step.move}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderBlock(block, index, theme) {
  if (!block?.type) return null;
  const key = `${block.type}-${index}`;
  if (block.type === "coverage_gap_table") {
    return <CoverageGapTable key={key} block={block} theme={theme} />;
  }
  if (block.type === "next_steps_card") {
    return <NextStepsCard key={key} block={block} theme={theme} />;
  }
  if (block.type === "premium_summary_table" || block.type === "policy_count_summary") {
    return <SummaryTable key={key} block={block} theme={theme} />;
  }
  return null;
}

/**
 * @param {{ blocks?: object[], variant?: 'dark' | 'home' }} props
 */
export default function KeyVisualBlocks({ blocks = [], variant = "dark" }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const theme = resolveTheme(variant);
  return (
    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px", fontFamily: FONT }}>
      {blocks.map((block, index) => renderBlock(block, index, theme))}
    </div>
  );
}
