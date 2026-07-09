/**
 * Shadow visual_blocks override — unit tests (no Claude · local only).
 */
import {
  resolveShadowVisualBlocksOverride,
  sanitizeShadowVisualBlocksOverride,
} from "../server/keyCore/shadowVisualBlocksOverride.js";

const fixtureBlocks = [
  {
    type: "premium_summary_table",
    title: "확인된 납입 요약",
    columns: ["구분", "확인값", "비고"],
    rows: [
      ["등록 계약 수", "22건", "전체 등록 기준"],
      ["대표 확인 계약 납입", "월 4만5천 원", "삼성생명 실손의료비보험 · 대표 계약 기준"],
      ["전체 월 납입 합계", "아직 정리 중", "22건 합산 · 확인 전"],
    ],
  },
];

const cases = [
  {
    id: "OV1_sanitize_ok",
    run: () => {
      const out = sanitizeShadowVisualBlocksOverride(fixtureBlocks);
      return out?.length === 1 && out[0].type === "premium_summary_table" && out[0].rows.length === 3;
    },
  },
  {
    id: "OV2_shadow_accepts",
    run: () => {
      const out = resolveShadowVisualBlocksOverride(fixtureBlocks, { KEY_BORROWED_SENSES: "shadow" });
      return out?.length === 1;
    },
  },
  {
    id: "OV3_off_rejects",
    run: () => resolveShadowVisualBlocksOverride(fixtureBlocks, { KEY_BORROWED_SENSES: "off" }) === null,
  },
  {
    id: "OV4_active_rejects",
    run: () => resolveShadowVisualBlocksOverride(fixtureBlocks, { KEY_BORROWED_SENSES: "active" }) === null,
  },
  {
    id: "OV5_empty_rejects",
    run: () => resolveShadowVisualBlocksOverride([], { KEY_BORROWED_SENSES: "shadow" }) === null,
  },
];

let failed = 0;
for (const c of cases) {
  const ok = Boolean(c.run());
  if (!ok) {
    failed += 1;
    console.error("FAIL", c.id);
  } else {
    console.log("PASS", c.id);
  }
}

if (failed) {
  console.error(`${failed} override test(s) failed`);
  process.exit(1);
}
console.log("PASS all shadow visual override tests");
