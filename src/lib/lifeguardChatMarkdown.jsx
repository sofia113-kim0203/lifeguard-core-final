/**
 * Hand — customer chat presentation for assistant answers.
 * Renders a small safe markdown subset without HTML injection.
 * Strips decorative noise (<cite>, emoji) for display only — does not change server seal.
 * Completed blocks are memo-stable; only the trailing live block updates during stream paint.
 */
import { memo } from "react";
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
 * Same markdown subset rules as before — descriptors with stable type+start keys.
 * @param {string} cleaned
 * @returns {Array<{
 *   type: string,
 *   start: number,
 *   contentKey: string,
 *   text?: string,
 *   items?: string[],
 *   header?: string[],
 *   rows?: string[][],
 *   level?: number,
 * }>}
 */
export function parseAssistantMarkdownBlocks(cleaned) {
  const text = String(cleaned ?? "");
  if (!text) return [];

  const lines = text.split("\n");
  const lineStart = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineStart.push(offset);
    offset += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }

  const blocks = [];
  let listBuf = [];
  let listType = null;
  let listStart = 0;

  const flushList = () => {
    if (!listBuf.length) return;
    const type = listType === "ol" ? "ol" : "ul";
    const items = listBuf;
    listBuf = [];
    listType = null;
    blocks.push({
      type,
      start: listStart,
      items,
      contentKey: items.join("\n"),
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (isTableRow(trimmed)) {
      flushList();
      const tableStart = lineStart[i];
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
        blocks.push({
          type: "table",
          start: tableStart,
          header,
          rows,
          contentKey: JSON.stringify({ header, rows }),
        });
      }
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushList();
      blocks.push({
        type: "hr",
        start: lineStart[i],
        contentKey: "hr",
      });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const headingText = heading[2];
      blocks.push({
        type: `h${level}`,
        start: lineStart[i],
        level,
        text: headingText,
        contentKey: headingText,
      });
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(trimmed);
    if (ul) {
      if (listType && listType !== "ul") flushList();
      if (!listBuf.length) listStart = lineStart[i];
      listType = "ul";
      listBuf.push(ul[1]);
      continue;
    }
    const ol = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (ol) {
      if (listType && listType !== "ol") flushList();
      if (!listBuf.length) listStart = lineStart[i];
      listType = "ol";
      listBuf.push(ol[2]);
      continue;
    }
    flushList();
    blocks.push({
      type: "p",
      start: lineStart[i],
      text: trimmed,
      contentKey: trimmed,
    });
  }
  flushList();
  return blocks;
}

const StableMarkdownBlock = memo(
  function StableMarkdownBlock({
    type,
    start,
    contentKey,
    text,
    items,
    header,
    rows,
    level,
    color,
    fontFamily,
  }) {
    const blockKey = `${type}-${start}`;
    void contentKey;

    if (type === "ul" || type === "ol") {
      const Tag = type === "ol" ? "ol" : "ul";
      return (
        <Tag
          style={{
            margin: "8px 0 12px",
            paddingLeft: "1.25em",
            color,
            fontFamily,
          }}
        >
          {(items || []).map((item, idx) => (
            <li key={`${blockKey}-li-${idx}`} style={{ marginBottom: "4px" }}>
              {renderInline(item, `${blockKey}-li-${idx}`)}
            </li>
          ))}
        </Tag>
      );
    }

    if (type === "table") {
      return (
        <div
          className="lg-md-table-wrap"
          style={{
            margin: "10px 0 14px",
            overflowX: "auto",
            maxWidth: "100%",
            border: "1px solid #E8E8E4",
            borderRadius: "10px",
            background: "#FFFFFF",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "14px",
              color,
              fontFamily,
            }}
          >
            <thead>
              <tr>
                {(header || []).map((cell, idx) => (
                  <th
                    key={`${blockKey}-th-${idx}`}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderBottom: "1px solid #E8E8E4",
                      color: "#666666",
                      fontWeight: 600,
                      wordBreak: "keep-all",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderInline(cell, `${blockKey}-th-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((row, rIdx) => (
                <tr key={`${blockKey}-tr-${rIdx}`}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={`${blockKey}-td-${rIdx}-${cIdx}`}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #F3F3F0",
                        verticalAlign: "top",
                        lineHeight: 1.55,
                        wordBreak: "keep-all",
                      }}
                    >
                      {renderInline(cell, `${blockKey}-td-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (type === "hr") {
      return (
        <hr
          style={{
            border: "none",
            borderTop: "1px solid #E8E8E4",
            margin: "14px 0",
          }}
        />
      );
    }

    if (type === "h1" || type === "h2" || type === "h3") {
      const fontSize = level === 1 ? "18px" : level === 2 ? "17px" : "16px";
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      return (
        <Tag
          style={{
            margin: "14px 0 6px",
            fontSize,
            fontWeight: 600,
            lineHeight: 1.45,
            color,
            fontFamily,
          }}
        >
          {renderInline(text || "", blockKey)}
        </Tag>
      );
    }

    return (
      <p
        style={{
          margin: "0 0 10px",
          color,
          fontFamily,
          lineHeight: 1.75,
        }}
      >
        {renderInline(text || "", blockKey)}
      </p>
    );
  },
  (prev, next) =>
    prev.type === next.type &&
    prev.start === next.start &&
    prev.contentKey === next.contentKey &&
    prev.color === next.color &&
    prev.fontFamily === next.fontFamily,
);

/**
 * @param {{ text: string, muted?: boolean, fontFamily?: string }} props
 */
export function LifeguardAssistantMarkdown({ text, muted = false, fontFamily }) {
  const cleaned = prepareAssistantChatText(text);
  if (!cleaned) return null;

  const color = muted ? "#5B6475" : "#1A2B4B";
  const blocks = parseAssistantMarkdownBlocks(cleaned);

  return (
    <div style={{ width: "100%" }}>
      {blocks.map((block) => (
        <StableMarkdownBlock
          key={`${block.type}-${block.start}`}
          type={block.type}
          start={block.start}
          contentKey={block.contentKey}
          text={block.text}
          items={block.items}
          header={block.header}
          rows={block.rows}
          level={block.level}
          color={color}
          fontFamily={fontFamily}
        />
      ))}
    </div>
  );
}
