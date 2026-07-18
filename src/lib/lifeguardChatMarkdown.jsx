/**
 * Hand — customer chat presentation for assistant answers.
 * Renders a small safe markdown subset without HTML injection.
 * Strips decorative noise (<cite>, emoji) for display only — does not change server seal.
 */
import { prepareAssistantChatText } from "./lifeguardChatMarkdownCore.js";

export { prepareAssistantChatText };

function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-i${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} style={{ fontWeight: 650, color: "#2563EB" }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function splitTableCells(line) {
  return String(line)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line) {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isTableRow(line) {
  const t = String(line).trim();
  return t.startsWith("|") && t.includes("|", 1);
}

/**
 * @param {{ text: string, muted?: boolean, fontFamily?: string }} props
 */
export function LifeguardAssistantMarkdown({ text, muted = false, fontFamily }) {
  const cleaned = prepareAssistantChatText(text);
  if (!cleaned) return null;

  const color = muted ? "#5B6475" : "#1A2B4B";
  const lines = cleaned.split("\n");
  const blocks = [];
  let listBuf = [];
  let listType = null; // "ul" | "ol"
  let key = 0;

  const flushList = () => {
    if (!listBuf.length) return;
    const Tag = listType === "ol" ? "ol" : "ul";
    const items = listBuf;
    listBuf = [];
    listType = null;
    blocks.push(
      <Tag
        key={`list-${key++}`}
        style={{
          margin: "8px 0 12px",
          paddingLeft: "1.25em",
          color,
          fontFamily,
        }}
      >
        {items.map((item, idx) => (
          <li key={`li-${idx}`} style={{ marginBottom: "4px" }}>
            {renderInline(item, `li-${idx}`)}
          </li>
        ))}
      </Tag>,
    );
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (isTableRow(trimmed)) {
      flushList();
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      const bodyLines = tableLines.filter((l) => !isTableSeparator(l));
      if (bodyLines.length) {
        const header = splitTableCells(bodyLines[0]);
        const rows = bodyLines.slice(1).map(splitTableCells);
        blocks.push(
          <div
            key={`table-${key++}`}
            style={{
              margin: "10px 0 14px",
              overflowX: "auto",
              border: "1px solid #E8E8E4",
              borderRadius: "10px",
              background: "#FFFFFF",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
                color,
                fontFamily,
              }}
            >
              <thead>
                <tr>
                  {header.map((cell, idx) => (
                    <th
                      key={`th-${idx}`}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderBottom: "1px solid #E8E8E4",
                        color: "#666666",
                        fontWeight: 600,
                      }}
                    >
                      {renderInline(cell, `th-${idx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={`tr-${rIdx}`}>
                    {row.map((cell, cIdx) => (
                      <td
                        key={`td-${rIdx}-${cIdx}`}
                        style={{
                          padding: "8px 10px",
                          borderBottom: "1px solid #F3F3F0",
                          verticalAlign: "top",
                          lineHeight: 1.5,
                        }}
                      >
                        {renderInline(cell, `td-${rIdx}-${cIdx}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushList();
      blocks.push(
        <hr
          key={`hr-${key++}`}
          style={{
            border: "none",
            borderTop: "1px solid #E8E8E4",
            margin: "14px 0",
          }}
        />,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const fontSize = level === 1 ? "18px" : level === 2 ? "17px" : "16px";
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      blocks.push(
        <Tag
          key={`h-${key++}`}
          style={{
            margin: "14px 0 6px",
            fontSize,
            fontWeight: 600,
            lineHeight: 1.45,
            color,
            fontFamily,
          }}
        >
          {renderInline(heading[2], `h-${key}`)}
        </Tag>,
      );
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(trimmed);
    if (ul) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listBuf.push(ul[1]);
      continue;
    }
    const ol = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (ol) {
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listBuf.push(ol[2]);
      continue;
    }
    flushList();
    blocks.push(
      <p
        key={`p-${key++}`}
        style={{
          margin: "0 0 10px",
          color,
          fontFamily,
          lineHeight: 1.75,
        }}
      >
        {renderInline(trimmed, `p-${key}`)}
      </p>,
    );
  }
  flushList();

  return <div style={{ width: "100%" }}>{blocks}</div>;
}
