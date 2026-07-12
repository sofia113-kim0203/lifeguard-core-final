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
        <strong key={key} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

/**
 * @param {{ text: string, muted?: boolean, fontFamily?: string }} props
 */
export function LifeguardAssistantMarkdown({ text, muted = false, fontFamily }) {
  const cleaned = prepareAssistantChatText(text);
  if (!cleaned) return null;

  const color = muted ? "#666666" : "#111111";
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

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
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
