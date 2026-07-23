/**
 * Customer shell visual SSOT — STATIC Full-Shell V3.1 photo
 * (scripts/.tmp-customer-ui-v1-shots/customer-ui-v1-fullshell-v3-desktop.png)
 *
 * Photo-exact face: teal / navy / cream / coral. Purple KEY face forbidden.
 */
export const FINAL_UI = {
  bg0: "#EEF3F8",
  bg1: "#F7F4EF",
  bg: "#F3F6FB",
  surface: "#FFFFFF",
  line: "#E4E9F0",
  text: "#152238",
  muted: "#5F6B7C",
  navy: "#12325F",
  navyDeep: "#0C2344",
  /** Primary accent — V3.1 teal (not purple) */
  accent: "#0F8A7A",
  accentSoft: "#E6F7F3",
  teal: "#0F8A7A",
  tealSoft: "#E6F7F3",
  coral: "#E86A4A",
  coralSoft: "#FFF0EB",
  warn: "#E86A4A",
  warnSoft: "#FFF0EB",
  amber: "#D97706",
  amberSoft: "#FFF6E8",
  sky: "#3B82C4",
  skySoft: "#EAF3FB",
  green: "#0F8A7A",
  soft: "#EAF3FB",
  cream: "#FAF7F2",
  barTrack: "#E8EDF3",
  pendingBar: "#C5CAD6",
  /** Layout — V3.1 Full-Shell grid @ 1440×900 photo-exact */
  designW: 1440,
  designH: 900,
  leftColPx: 268,
  centerColPx: 840,
  rightColPx: 308,
  /** V3.1 room: L–C / C–R gap */
  gutterPx: 10,
  /** V3.1 header below → room */
  bodyGapPx: 8,
  roomInlinePx: 2,
  /** Unified shell header height (single DOM header) */
  headerPx: 90,
  /** Hero pad inside left rail (below unified header) */
  heroPadPx: 10,
  /** Unified rail inner pad / stack gap (L·R same rhythm) */
  railInnerPadPx: 10,
  railStackGapPx: 7,
  /** Shared card padding + title/section spacing */
  cardPadY: 10,
  cardPadX: 12,
  cardHeadGapPx: 8,
  sectionKMbPx: 6,
  /** Center conversation vertical rhythm (font-size unchanged) */
  msgLineHeight: 1.55,
  msgPadYUser: 6,
  msgPadYAssistant: 10,
  msgDateMbPx: 10,
  emptyGuidePadTopPx: 4,
  emptyGuideTitleMbPx: 6,
  emptyGuideSubMbPx: 8,
  /** Hydrated action slot above tabs */
  actionSlotPadTopPx: 6,
  actionSlotPadBottomPx: 4,
  /** Bottom of composer wrap — aligns tabs to tabsY @ 1440×900 */
  composerWrapPadBottomPx: 11,
  heroY: 87,
  heroX: 27,
  heroW: 230,
  actionX: 356,
  actionY: 295,
  actionW: 756,
  /** Content-fit height after tightened inner gaps (was 185 sparse) */
  actionH: 168,
  actionEyebrowMbPx: 4,
  actionTitleMbPx: 6,
  actionBodyLine: 1.5,
  actionBodyMbPx: 10,
  actionCtaPadY: 9,
  actionCtaPadX: 16,
  actionCtaHintMtPx: 6,
  actionCtaHintSize: 11,
  actionMarginBottomPx: 6,
  tabsX: 296,
  tabsY: 781,
  tabsW: 420,
  tabsH: 42,
  composerX: 280,
  composerY: 851,
  composerW: 840,
  composerH: 38,
  cardRadius: 16,
  shellRadius: 22,
  sectionPadX: 12,
  sectionPadY: 10,
  /** Typography — V3.1 full-shell-preview-v3.html exact stacks */
  logoSize: 24,
  headerLeftSize: 14,
  headerLeftWeight: 600,
  heroTitleSize: 17,
  heroTitleLine: 21,
  actionTitleSize: 20,
  actionTitleWeight: 600,
  actionTitleLine: 22,
  actionBodySize: 14,
  actionCtaSize: 14,
  sectionTitleSize: 13,
  leftValueSize: 14,
  rightValueSize: 16,
  composerSize: 15,
  tabSize: 13,
  titleSize: 13,
  bodySize: 13,
  metricTitleSize: 14,
  /** Exact --serif from scripts/.tmp-customer-ui-v1-full-shell-preview-v3.html */
  gothic: '"Fraunces", Georgia, "Times New Roman", serif',
  /** Exact --sans from scripts/.tmp-customer-ui-v1-full-shell-preview-v3.html */
  sans: '"Manrope", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  heroGradient: "linear-gradient(145deg, #12325F 0%, #0F8A7A 78%, #3B82C4 120%)",
  ctaGradient: "linear-gradient(135deg, #12325F 0%, #0F6E62 100%)",
  roomShadow: "0 10px 30px rgba(18, 50, 95, 0.06)",
  actionShadow: "0 8px 24px rgba(232, 106, 74, 0.08)",
};

/** Room atmosphere — V3.1 photo background (not flat white). */
export const FINAL_UI_ROOM_CSS = `
.lg-final-shell {
  background:
    radial-gradient(900px 420px at 8% -10%, rgba(15, 138, 122, 0.14), transparent 55%),
    radial-gradient(800px 380px at 92% 0%, rgba(232, 106, 74, 0.12), transparent 50%),
    radial-gradient(700px 360px at 70% 100%, rgba(59, 130, 196, 0.10), transparent 55%),
    linear-gradient(165deg, ${FINAL_UI.bg0}, ${FINAL_UI.bg1} 55%, #F3F6FB) !important;
}
.lg-final-shell .lg-v31-rail {
  border-radius: ${FINAL_UI.shellRadius}px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: ${FINAL_UI.roomShadow};
}
.lg-final-shell .lg-v31-center {
  border-radius: ${FINAL_UI.shellRadius}px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 10px 30px rgba(18, 50, 95, 0.05);
}
`;

/** Hide scrollbars; overflow scroll behavior stays. */
export const FINAL_UI_SCROLLBAR_CSS = `
.lg-final-shell,
.lg-final-shell * {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
.lg-final-shell *::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
  background: transparent !important;
}
`;
