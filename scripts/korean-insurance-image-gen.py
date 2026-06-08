#!/usr/bin/env python3
"""Generate Korean insurance OCR sample PNGs for Phase 22D Step 4 tests."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:
    raise SystemExit(
        "Pillow is required. Install with: pip install Pillow"
    ) from exc

OUT_DIR = Path(__file__).resolve().parent / "samples" / "korean-insurance"
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]

SAMPLES = [
    (
        "ko-insurance-terms-1.png",
        [
            "보험약관 요약",
            "제1조 목적",
            "제4조 보상 — 실손의료비 보장",
            "입원·통원 의료비를 약관 한도 내에서 보상합니다.",
            "암진단비: 암으로 진단 확정 시 1회 지급",
            "고지의무: 청약 전 건강상태를 사실대로 알려야 합니다.",
        ],
    ),
    (
        "ko-insurance-terms-2.png",
        [
            "특약 안내",
            "K603 골절진단특약",
            "골절로 진단 확정 시 보험금 지급",
            "입원일당: 1일당 5만원, 최대 180일",
            "청구 서류: 진단서, 입원확인서, 세부내역서",
        ],
    ),
    (
        "ko-insurance-terms-3.png",
        [
            "청구 및 고지 안내",
            "고지의무 위반 시 계약 해지 또는 보험금 감액 가능",
            "실손의료비는 기본계약과 특약 한도를 따릅니다.",
            "암진단비 청구 시 진단서 제출 필요",
            "문의: 보험금 청구 가능 여부는 약관·특약 기준으로 확인",
        ],
    ),
]


def load_font(size: int = 36) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        candidate = Path(path)
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def render_page(filename: str, lines: list[str]) -> None:
    font = load_font(34)
    width, height = 1200, 900
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    y = 48
    for line in lines:
        draw.text((40, y), line, fill="black", font=font)
        y += 56

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / filename)
    print(f"wrote {OUT_DIR / filename}")


def main() -> None:
    for filename, lines in SAMPLES:
        render_page(filename, lines)
    print(f"generated {len(SAMPLES)} sample images")


if __name__ == "__main__":
    main()
