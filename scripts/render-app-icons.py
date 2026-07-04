#!/usr/bin/env python3
"""
Render the FitQuest triangle logo (web/public/favicon.svg) to PNGs at all
Android launcher-icon densities. Two outputs:

  - ic_launcher.png / ic_launcher_round.png per mipmap-{mdpi..xxxhdpi}
    (legacy launcher icons, used on Android <8 / API <26)
  - ic_launcher_foreground.png per mipmap-{mdpi..xxxhdpi} at 432px
    equivalent (Android adaptive-icon foreground layer)

For the adaptive icon the background is just a solid colour set in
values/ic_launcher_background.xml (no raster needed). The adaptive-icon
XML in mipmap-anydpi-v26 already references the foreground + background
by name, so this script only needs to write the foreground PNGs.

Sizes per density:
  mdpi    48  px (launcher),  108 px (foreground @1x)
  hdpi    72  px,             162 px
  xhdpi   96  px,             216 px
  xxhdpi  144 px,             324 px
  xxxhdpi 192 px,             432 px
"""
import cairosvg
from pathlib import Path
from PIL import Image

SVG = Path("/home/josh/claw-code/FitnessStats/web/public/favicon.svg")
OUT_BASE = Path("/home/josh/claw-code/FitnessStats/web/android/app/src/main/res")
OUT_BRIDGE = Path("/home/josh/claw-code/FitQuestBridge/app/src/main/res")

DENSITIES = [
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
]

# Adaptive-icon foreground sizes (always rendered square; Android's
# adaptive-icon spec wants the foreground to fill 108dp safely — the
# viewable circle is the inner 66dp of that).
FG_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}


def render_square(svg_bytes: bytes, size: int) -> Image.Image:
    """Render the SVG as a square RGBA PNG at the given pixel size.

    The favicon SVG already has a dark rounded-rect background, so the
    result is a finished launcher icon — no compositing needed. Returns
    a PIL Image ready to save.
    """
    import io
    png_bytes = cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")


def render_round(square_img: Image.Image) -> Image.Image:
    """Take a square launcher image and return a circular-cropped version
    for the ic_launcher_round.png. Used on launchers that show a round
    icon (older Pixel devices, some OEM skins).
    """
    size = square_img.size[0]
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(square_img, (0, 0), mask)
    return out


def write_set(out_dir: Path, svg_bytes: bytes, density: str, launcher_size: int):
    """Write ic_launcher.png + ic_launcher_round.png + ic_launcher_foreground.png
    for one density bucket.
    """
    mipmap = out_dir / f"mipmap-{density}"
    mipmap.mkdir(parents=True, exist_ok=True)

    sq = render_square(svg_bytes, launcher_size)
    sq.save(mipmap / "ic_launcher.png", "PNG")
    rd = render_round(sq)
    rd.save(mipmap / "ic_launcher_round.png", "PNG")

    # Foreground — render square at the adaptive-icon density. Android
    # will mask it; we render the SVG full-bleed so the triangle stays
    # centred in the visible circle.
    fg_size = FG_SIZES[density]
    fg = render_square(svg_bytes, fg_size)
    fg.save(mipmap / "ic_launcher_foreground.png", "PNG")
    print(f"  {density}: launcher {launcher_size}px, fg {fg_size}px")


def main():
    svg_bytes = SVG.read_bytes()

    print(f"Render from: {SVG}")
    print(f"FitQuest (Capacitor): {OUT_BASE}")
    print(f"FitQuestBridge:       {OUT_BRIDGE}")

    print("\nFitQuest:")
    for density, size in DENSITIES:
        write_set(OUT_BASE, svg_bytes, density, size)

    # FitQuestBridge has no mipmap dirs at all. Build them.
    print("\nFitQuestBridge:")
    for density, size in DENSITIES:
        write_set(OUT_BRIDGE, svg_bytes, density, size)

    print("\nDone.")


if __name__ == "__main__":
    main()