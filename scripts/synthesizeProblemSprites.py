#!/usr/bin/env python3
"""
Procedural sprite synthesizer for thin/simple shapes that fal.ai
renders with too much halo / wrong colors.

Used as a fallback when fal consistently produces sprites with
embedded gray backgrounds that confuse rembg + the wipe step.
Currently draws:
  - walking_cane:    wooden cane with J-hook handle, dark brown
  - plain_cotton:    medieval tunic, pale cyan, simple shape

Both render directly into web/public/sprites/<path>.png at 64×64
with a periwinkle 2px outline.
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

WEB = Path(__file__).resolve().parent.parent / "web" / "public" / "sprites"

# Per-class outline colors
ORACLE = (125, 123, 255)  # periwinkle
UNIVERSAL = (20, 214, 232)  # cyan

OUTLINE_W = 2
DARK_WOOD = (92, 93, 117)  # #5c5d75 midtone (the prompt color, but with alpha)
TUNIC = (170, 180, 200)  # pale undyed linen
TUNIC_DEEP = (130, 140, 160)  # slightly darker for hem/sleeves


def draw_cane(dst_path: Path, class_color):
    """Walking cane: J-hook handle on top, vertical shaft, small foot tip.
    Renders at 256×256 first (clean curves), then downscales."""
    SIZE = 256
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Layout: handle hook at top, shaft down the middle, tip at bottom
    shaft_x = SIZE // 2
    shaft_top_y = int(SIZE * 0.18)
    shaft_bot_y = int(SIZE * 0.86)
    shaft_w = 26

    # 1. Shaft (vertical rectangle with rounded ends)
    shaft = [
        (shaft_x - shaft_w // 2, shaft_top_y),
        (shaft_x + shaft_w // 2, shaft_top_y),
        (shaft_x + shaft_w // 2, shaft_bot_y),
        (shaft_x - shaft_w // 2, shaft_bot_y),
    ]
    draw.polygon(shaft, fill=DARK_WOOD + (255,))

    # 2. J-hook handle on top: curved hook on the left
    # Use an arc: thick line from (shaft_x, shaft_top_y) going up and curving left
    handle_y_top = int(SIZE * 0.10)
    handle_y_bot = shaft_top_y + 4
    # Draw thick line straight up from shaft top, then hook curve
    handle_thickness = 24
    # Vertical part of the handle
    draw.line(
        [(shaft_x, handle_y_top), (shaft_x, handle_y_bot)],
        fill=DARK_WOOD + (255,),
        width=handle_thickness,
    )
    # Hook curve: arc from shaft top going up and curving left
    arc_radius = int(SIZE * 0.10)
    arc_box = [
        shaft_x - arc_radius,
        handle_y_top - arc_radius,
        shaft_x + arc_radius,
        handle_y_top + arc_radius,
    ]
    # PIL arc: draws an arc inside bbox. start=180, end=270 means top-left quadrant
    draw.arc(arc_box, start=180, end=270, fill=DARK_WOOD + (255,),
            width=handle_thickness)

    # 3. Foot tip at bottom (small rounded knob)
    tip_w = shaft_w + 8
    tip_h = 14
    tip = [
        (shaft_x - tip_w // 2, shaft_bot_y - 2),
        (shaft_x + tip_w // 2, shaft_bot_y - 2),
        (shaft_x + tip_w // 2, shaft_bot_y + tip_h),
        (shaft_x - tip_w // 2, shaft_bot_y + tip_h),
    ]
    draw.polygon(tip, fill=DARK_WOOD + (255,))

    # 4. Outline: trace the silhouette in class color, 2px
    # We composite a 2px outline by drawing the same shapes with
    # class_color then masking to silhouette of original
    silhouette = Image.new("L", (SIZE, SIZE), 0)
    sdraw = ImageDraw.Draw(silhouette)
    sdraw.polygon(shaft, fill=255)
    sdraw.line(
        [(shaft_x, handle_y_top), (shaft_x, handle_y_bot)],
        fill=255, width=handle_thickness,
    )
    sdraw.arc(arc_box, start=180, end=270, fill=255, width=handle_thickness)
    sdraw.polygon(tip, fill=255)
    # Dilate by 2px for outline width
    from PIL import ImageFilter
    outline_mask = silhouette.filter(ImageFilter.MaxFilter(5))
    outline_mask = outline_mask.filter(ImageFilter.GaussianBlur(0))
    # Subtract silhouette to get just the outline ring
    from PIL import ImageChops
    ring_only = ImageChops.subtract(outline_mask, silhouette)
    # Tint the ring with class_color
    ring_rgb = Image.new("RGBA", (SIZE, SIZE), class_color + (255,))
    ring_img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ring_img.paste(ring_rgb, (0, 0), ring_only)
    img = Image.alpha_composite(img, ring_img)

    # Downscale 256 -> 64
    final = img.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)


def draw_plain_cotton(dst_path: Path, class_color):
    """Medieval-style plain cotton tunic.
    Long loose-fitting shirt reaching mid-thigh. No collar, no buttons.
    Wide short sleeves ending above the elbow. Hemmed bottom edge.
    Plain undyed linen/cotton color (pale grey/cyan tint)."""
    SIZE = 256
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Layout (in 256×256 space):
    # tunic body:  rect from (80, 70) to (176, 220)  — torso rectangle
    # sleeves:    two trapezoids on either side
    # neckline:   small triangular notch at top center

    tunic = [
        (90, 76),    # left shoulder
        (166, 76),   # right shoulder
        (176, 220),  # right hem
        (80, 220),   # left hem
    ]
    draw.polygon(tunic, fill=TUNIC + (255,))

    # Sleeves — short, ending above elbow, flared slightly
    left_sleeve = [
        (90, 76),    # shoulder
        (66, 110),   # sleeve outer
        (66, 140),   # sleeve outer-bottom
        (90, 134),   # sleeve inner-bottom
    ]
    draw.polygon(left_sleeve, fill=TUNIC + (255,))

    right_sleeve = [
        (166, 76),
        (190, 110),
        (190, 140),
        (166, 134),
    ]
    draw.polygon(right_sleeve, fill=TUNIC + (255,))

    # Hemmed bottom edge (slightly darker stripe)
    hem = [
        (80, 210),
        (176, 210),
        (176, 220),
        (80, 220),
    ]
    draw.polygon(hem, fill=TUNIC_DEEP + (255,))

    # Side slits at hips (cut into the silhouette)
    # Left slit
    draw.polygon([(80, 195), (90, 195), (90, 220), (80, 220)], fill=(0, 0, 0, 0))
    # Right slit
    draw.polygon([(166, 195), (176, 195), (176, 220), (166, 220)], fill=(0, 0, 0, 0))

    # Neckline notch — small V cut at top
    # (overdraw with transparent)
    draw.polygon([(120, 76), (136, 76), (128, 90)], fill=(0, 0, 0, 0))

    # Outline (2px)
    silhouette = Image.new("L", (SIZE, SIZE), 0)
    sdraw = ImageDraw.Draw(silhouette)
    sdraw.polygon(tunic, fill=255)
    sdraw.polygon(left_sleeve, fill=255)
    sdraw.polygon(right_sleeve, fill=255)
    from PIL import ImageFilter, ImageChops
    outline_mask = silhouette.filter(ImageFilter.MaxFilter(5))
    ring_only = ImageChops.subtract(outline_mask, silhouette)
    ring_rgb = Image.new("RGBA", (SIZE, SIZE), class_color + (255,))
    ring_img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ring_img.paste(ring_rgb, (0, 0), ring_only)
    img = Image.alpha_composite(img, ring_img)

    final = img.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)


def draw_sabatons(dst_path: Path, class_color):
    """Medieval sabatons — L-shape armored boot in profile.
    Horizontal foot sole + vertical shin guard + small toe cap."""
    SIZE = 256
    DARK = (92, 93, 117)
    MID = (130, 140, 160)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Foot sole (horizontal at bottom)
    foot = [
        (60, 195),
        (210, 195),
        (210, 222),
        (60, 222),
    ]
    draw.polygon(foot, fill=DARK + (255,))

    # Toe cap (rounded extension at the front of the foot)
    toe = [
        (60, 180),
        (110, 180),
        (105, 222),
        (60, 222),
    ]
    draw.polygon(toe, fill=DARK + (255,))

    # Shin plate (vertical) — sits above the foot
    shin = [
        (130, 75),
        (200, 75),
        (200, 195),
        (130, 195),
    ]
    draw.polygon(shin, fill=MID + (255,))

    # Heel plate (small) — back of the foot, lighter shade
    heel = [
        (200, 175),
        (215, 175),
        (215, 222),
        (200, 222),
    ]
    draw.polygon(heel, fill=MID + (255,))

    # Outline
    silhouette = Image.new("L", (SIZE, SIZE), 0)
    sdraw = ImageDraw.Draw(silhouette)
    sdraw.polygon(foot, fill=255)
    sdraw.polygon(toe, fill=255)
    sdraw.polygon(shin, fill=255)
    sdraw.polygon(heel, fill=255)
    from PIL import ImageFilter, ImageChops
    outline_mask = silhouette.filter(ImageFilter.MaxFilter(5))
    ring_only = ImageChops.subtract(outline_mask, silhouette)
    ring_rgb = Image.new("RGBA", (SIZE, SIZE), class_color + (255,))
    ring_img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ring_img.paste(ring_rgb, (0, 0), ring_only)
    img = Image.alpha_composite(img, ring_img)

    final = img.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)


def main():
    draw_cane(WEB / "gear/weapons/oracle.png", ORACLE)
    print(f"Wrote {WEB / 'gear/weapons/oracle.png'}")
    draw_plain_cotton(WEB / "items/shirt_starter_universal.png", UNIVERSAL)
    print(f"Wrote {WEB / 'items/shirt_starter_universal.png'}")
    draw_sabatons(WEB / "gear/feet/juggernaut.png", (220, 38, 38))  # juggernaut red
    print(f"Wrote {WEB / 'gear/feet/juggernaut.png'}")


if __name__ == "__main__":
    main()