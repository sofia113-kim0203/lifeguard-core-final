/**
 * Right rail — KEY turn mirror. Same KEY answer only; no separate judgment.
 */
import { useState } from "react";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { KEY_TURN_MIRROR_EMPTY } from "../lib/keyInsuranceScreenFacts.js";

function CollapsibleSection({ title, accent, items = [], defaultOpen = true, children = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasList = Array.isArray(items) && items.length > 0;
  if (!hasList && !children) return null;

  return (
    <section style={{ marginBottom: "14px" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          border: "none",
          background: "transparent",
          padding: "0 0 8px",
          cursor: "pointer",
          fontFamily: LG.sans,
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: accent || LG.textMuted,
          }}
        >
          {title}
        </span>
        <span style={{ color: LG.textSoft, fontSize: "12px" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        children ? (
          children
        ) : (
          <ul
            style={{
              margin: 0,
              paddingLeft: "18px",
              color: LG.text,
              fontSize: "13px",
              lineHeight: 1.6,
            }}
          >
            {items.map((item) => (
              <li key={item} style={{ marginBottom: "4px" }}>
                {item}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

export default function KeyTurnMirrorRail({ mirror = null, style = {}, onClose = null }) {
  const empty = !mirror || mirror.empty;
  const emptyMessage = mirror?.emptyMessage || KEY_TURN_MIRROR_EMPTY;
  const confirmed = mirror?.confirmed ?? [];
  const needs = mirror?.needsConfirmation ?? [];
  const judgment = mirror?.judgment || null;

  return (
    <aside
      aria-label="KEY 확인 내용"
      style={{
        width: "100%",
        maxWidth: "340px",
        flexShrink: 0,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "18px 16px 10px",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div
          style={{
            fontFamily: LG.serif,
            fontSize: "15px",
            fontWeight: 600,
            color: LG.navy,
            lineHeight: 1.4,
          }}
        >
          KEY가 이번 대화에서 확인한 내용
        </div>
        {typeof onClose === "function" ? (
          <button
            type="button"
            aria-label="KEY 확인 닫기"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: LG.textSoft,
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 20px" }}>
        {empty ? (
          <p style={{ margin: "8px 0", fontSize: "13px", color: LG.textMuted, lineHeight: 1.6 }}>
            {emptyMessage}
          </p>
        ) : (
          <>
            <CollapsibleSection title="확인됨" accent={LG.verified} items={confirmed} />
            <CollapsibleSection title="확인 필요" accent={LG.needs} items={needs} />
            {judgment ? (
              <CollapsibleSection title="KEY의 판단" accent={LG.navy} items={[]}>
                <div
                  style={{
                    margin: 0,
                    padding: "12px 14px",
                    borderRadius: "12px",
                    background: "rgba(26, 43, 75, 0.04)",
                    border: `1px solid ${LG.border}`,
                    fontSize: "13px",
                    lineHeight: 1.65,
                    color: LG.text,
                  }}
                >
                  {judgment}
                </div>
              </CollapsibleSection>
            ) : null}
          </>
        )}
      </div>
      <div
        style={{
          padding: "10px 16px 16px",
          fontSize: "11px",
          color: LG.textSoft,
          lineHeight: 1.45,
          flexShrink: 0,
        }}
      >
        현재 KEY 답변과 같은 내용만 정리합니다
      </div>
    </aside>
  );
}
