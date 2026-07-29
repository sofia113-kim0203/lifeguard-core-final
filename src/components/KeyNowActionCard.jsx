/** Center “지금 하시면 돼요” — always on; honest empty until KEY judgment. */

import { FINAL_UI } from "../lib/customerUiFinalTokens.js";

const C = FINAL_UI;

const DEFAULT_ACTION = Object.freeze({
  pending: true,
  title: "다음 행동 · 확인 전",
  body: "KEY가 자료와 대화를 확인하면 다음 행동을 이 자리에 제시합니다.",
  ctaLabel: "준비가 되면 알려주기",
  ctaHint: "사진으로 보내 주셔도 괜찮아요",
});

export default function KeyNowActionCard({
  action = null,
  onCta = null,
  disabled = false,
}) {
  const a = action && typeof action === "object" ? { ...DEFAULT_ACTION, ...action } : DEFAULT_ACTION;
  const title = String(a.title || DEFAULT_ACTION.title).trim() || DEFAULT_ACTION.title;
  const body = String(a.body || DEFAULT_ACTION.body).trim() || DEFAULT_ACTION.body;
  const ctaLabel = String(a.ctaLabel || DEFAULT_ACTION.ctaLabel).trim() || DEFAULT_ACTION.ctaLabel;
  const ctaHint = String(a.ctaHint || DEFAULT_ACTION.ctaHint || "").trim();

  // Compact one-step shrink vs FINAL_UI tokens — keep 2lh body reserve; no clamp/fixed outer height.
  const eyebrowMb = Math.max(2, C.actionEyebrowMbPx - 2);
  const titleMb = Math.max(4, C.actionTitleMbPx - 2);
  const bodyMb = Math.max(6, C.actionBodyMbPx - 4);
  const hintMt = Math.max(4, C.actionCtaHintMtPx - 2);
  const ctaPadY = Math.max(8, C.actionCtaPadY - 1);
  const cardMinH = Math.max(120, C.actionH - 28);

  return (
    <div
      aria-label="지금 할 일"
      style={{
        marginTop: 0,
        marginBottom: `${Math.max(4, C.actionMarginBottomPx - 2)}px`,
        marginLeft: 0,
        marginRight: 0,
        borderRadius: "22px",
        padding: "10px 20px 10px",
        background: "linear-gradient(180deg, #FFFFFF 0%, #FFFAF6 100%)",
        border: "1px solid rgba(232, 106, 74, 0.18)",
        boxShadow: C.actionShadow,
        position: "relative",
        overflow: "hidden",
        fontFamily: C.sans,
        width: "100%",
        maxWidth: "100%",
        minHeight: `${cardMinH}px`,
        height: "auto",
        boxSizing: "border-box",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: "5px",
          background: `linear-gradient(180deg, ${C.coral}, ${C.amber})`,
        }}
      />
      <div
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color: C.coral,
          marginBottom: `${eyebrowMb}px`,
        }}
      >
        지금 하시면 돼요
      </div>
      <h2
        style={{
          margin: `0 0 ${titleMb}px`,
          fontFamily: C.gothic,
          fontSize: `${C.actionTitleSize}px`,
          fontWeight: C.actionTitleWeight,
          color: a.pending ? C.muted : C.navyDeep,
          letterSpacing: "-0.02em",
          lineHeight: `${C.actionTitleLine}px`,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: `${C.actionBodySize}px`,
          lineHeight: C.actionBodyLine,
          minHeight: "2lh",
          color: C.muted,
          margin: `0 0 ${bodyMb}px`,
        }}
      >
        {body}
      </p>
      <button
        type="button"
        disabled={disabled || typeof onCta !== "function"}
        onClick={typeof onCta === "function" ? onCta : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          background: C.ctaGradient,
          color: "#fff",
          border: "none",
          borderRadius: "999px",
          padding: `${ctaPadY}px ${C.actionCtaPadX}px`,
          minHeight: "40px",
          fontSize: `${C.actionCtaSize}px`,
          fontWeight: 700,
          boxShadow: "0 6px 16px rgba(18, 50, 95, 0.22)",
          cursor: disabled || typeof onCta !== "function" ? "default" : "pointer",
          fontFamily: C.sans,
          opacity: disabled ? 0.7 : 1,
          boxSizing: "border-box",
        }}
      >
        {ctaLabel}
      </button>
      {ctaHint ? (
        <div
          style={{
            marginTop: `${hintMt}px`,
            fontSize: `${C.actionCtaHintSize}px`,
            color: C.muted,
          }}
        >
          {ctaHint}
        </div>
      ) : null}
    </div>
  );
}

export { DEFAULT_ACTION };
