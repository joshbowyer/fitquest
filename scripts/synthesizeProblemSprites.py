#!/usr/bin/env python3
"""
Procedural sprite synthesizer for thin/simple shapes that fal.ai
renders with too much halo / wrong colors.

Used as a fallback when fal consistently produces sprites with
embedded gray backgrounds that confuse rembg + the wipe step.

  draw_cane:         J-hook handle + vertical shaft + foot tip.
                     Dark wood brown, periwinkle outline.
  draw_plain_cotton: Tunic with crossed sash + V-neck (toga-like).
                     Pale linen color, cyan outline.
  draw_sabatons:     Heavy knight plate boot, side profile.
                     L-shape with articulated bands, dark navy,
                     red outline.

Each renders at 256×256 then downscales to 64×64. Outline drawn as
a 2px ring via MaxFilter dilate minus silhouette, then threshold-
clamped so there are no partial-alpha pixels.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageChops

WEB = Path(__file__).resolve().parent.parent / "web" / "public" / "sprites"

# Per-class outline colors
ORACLE = (125, 123, 255)      # periwinkle
JUGG = (220, 38, 38)           # juggernaut red
UNIVERSAL = (20, 214, 232)     # cyan

# Fill colors
DARK_WOOD = (92, 93, 117)
TUNIC_LIGHT = (200, 195, 175)   # pale undyed linen (warm beige)
TUNIC_DARK = (140, 135, 115)    # darker hem/sash
ARMOR_NAVY = (28, 28, 38)        # #1c1d2b dark
ARMOR_MID = (92, 93, 117)         # #5c5d75 midtone
ARMOR_RIVET = (60, 60, 75)        # mid-dark for rivets/details


def add_outline(img, class_color, dilate_size=5, threshold=128):
    """Trace silhouette, dilate, subtract to get a 2px ring in
    `class_color`. Returns a 256×256 image with the ring added."""
    silhouette = img.convert("L").point(lambda a: 255 if a > 30 else 0)
    silhouette = silhouette.filter(ImageFilter.MaxFilter(dilate_size))
    ring_only = ImageChops.subtract(silhouette, img.convert("L").point(lambda a: 255 if a > 30 else 0))
    ring_rgb = Image.new("RGBA", img.size, class_color + (255,))
    ring_img = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ring_img.paste(ring_rgb, (0, 0), ring_only)
    return Image.alpha_composite(img, ring_img)


def clamp_alpha(img, threshold=128):
    """Threshold clamp: alpha < threshold → 0; alpha < 255 → 255.
    Removes partial-alpha pixels introduced by LANCZOS resampling."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < threshold:
                px[x, y] = (0, 0, 0, 0)
            elif a < 255:
                px[x, y] = (r, g, b, 255)


def draw_cane(dst_path: Path, class_color):
    """Walking cane: J-hook handle on top, vertical shaft, small foot tip."""
    SIZE = 256
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Shaft (vertical rectangle, 24px wide, fills most of canvas)
    shaft_x = SIZE // 2
    shaft_top = int(SIZE * 0.20)
    shaft_bot = int(SIZE * 0.85)
    shaft_w = 24
    draw.rectangle(
        [(shaft_x - shaft_w // 2, shaft_top), (shaft_x + shaft_w // 2, shaft_bot)],
        fill=DARK_WOOD + (255,),
    )

    # J-hook handle — vertical line up from shaft top + arc curving left
    handle_top = int(SIZE * 0.10)
    handle_thick = 24
    draw.line(
        [(shaft_x, handle_top), (shaft_x, shaft_top + 6)],
        fill=DARK_WOOD + (255,),
        width=handle_thick,
    )
    arc_r = int(SIZE * 0.10)
    draw.arc(
        [shaft_x - arc_r, handle_top - arc_r, shaft_x + arc_r, handle_top + arc_r],
        start=180, end=270,
        fill=DARK_WOOD + (255,),
        width=handle_thick,
    )

    # Foot tip (slight knob at the bottom of the shaft)
    tip_w = shaft_w + 8
    tip_h = 12
    draw.rectangle(
        [(shaft_x - tip_w // 2, shaft_bot - 2),
         (shaft_x + tip_w // 2, shaft_bot + tip_h - 2)],
        fill=DARK_WOOD + (255,),
    )

    img = add_outline(img, class_color)
    final = img.resize((64, 64), Image.LANCZOS)
    clamp_alpha(final)
    final.save(dst_path, "PNG", optimize=True)


def draw_plain_cotton(dst_path: Path, class_color):
    """Medieval tunic shape — V-neck, draped sash, simple silhouette.
    Toga-like: not fitted, no collar, side drape over one shoulder."""
    SIZE = 256
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Main tunic body — wider rectangle, slightly trapezoidal (A-line)
    # Wider at hem than at shoulders, to suggest draping
    tunic = [
        (94, 70),    # left shoulder
        (162, 70),   # right shoulder
        (180, 222),  # right hem (wider)
        (76, 222),   # left hem (wider)
    ]
    draw.polygon(tunic, fill=TUNIC_LIGHT + (255,))

    # Sleeves — short, slightly flared
    draw.polygon([(94, 70), (60, 110), (62, 142), (94, 134)],
                fill=TUNIC_LIGHT + (255,))
    draw.polygon([(162, 70), (196, 110), (194, 142), (162, 134)],
                fill=TUNIC_LIGHT + (255,))

    # Sash — diagonal cloth strip crossing the chest from right
    # shoulder to left hip (toga wrap). One color darker than the body.
    draw.polygon([
        (162, 72),   # top right
        (175, 90),   # right side
        (95, 200),   # bottom-left along body
        (82, 184),   # bottom-left outer
    ], fill=TUNIC_DARK + (255,))

    # V-neck cutout (transparent triangle at top center)
    draw.polygon([(115, 70), (141, 70), (128, 92)], fill=(0, 0, 0, 0))

    # Hem stripe (slightly darker bottom edge)
    draw.polygon([
        (76, 212), (180, 212), (180, 222), (76, 222),
    ], fill=TUNIC_DARK + (255,))

    # Sleeve cuffs
    draw.rectangle([(60, 130), (94, 142)], fill=TUNIC_DARK + (255,))
    draw.rectangle([(162, 130), (196, 142)], fill=TUNIC_DARK + (255,))

    img = add_outline(img, class_color)
    final = img.resize((64, 64), Image.LANCZOS)
    clamp_alpha(final)
    final.save(dst_path, "PNG", optimize=True)


def draw_sabatons(dst_path: Path, class_color):
    """Heavy medieval knight plate boots (sabatons), side profile.

    A heavy armored boot from the side: tall shin plate on the leg,
    a leather sole, articulated plate bands wrapping the foot,
    a rounded toe cap, a small spur at the heel.
    """
    SIZE = 256
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Shin plate (vertical, covers the leg from above the ankle to mid-shin)
    draw.polygon([
        (110, 60),
        (190, 60),
        (200, 200),
        (100, 200),
    ], fill=ARMOR_NAVY + (255,))

    # Articulated bands — three horizontal stripes across the shin
    for y in (95, 130, 165):
        draw.rectangle([(103, y), (197, y + 8)], fill=ARMOR_RIVET + (255,))

    # Knee cap (small protrusion at top of shin plate)
    draw.ellipse([(135, 50), (165, 75)], fill=ARMOR_NAVY + (255,))

    # Foot — extends forward from the shin plate, darker plate
    draw.polygon([
        (60, 200),
        (210, 200),
        (210, 232),
        (60, 232),
    ], fill=ARMOR_NAVY + (255,))

    # Toe cap — rounded protrusion at the front
    draw.ellipse([(40, 188), (75, 232)], fill=ARMOR_NAVY + (255,))

    # Heel spur — small triangular projection at the back
    draw.polygon([
        (210, 215),
        (228, 222),
        (210, 230),
    ], fill=ARMOR_NAVY + (255,))

    # Leather sole strip at the very bottom (lighter, midtone gray)
    draw.rectangle([(60, 226), (210, 234)], fill=ARMOR_MID + (255,))

    # Ankle joint — horizontal divider between shin and foot
    draw.rectangle([(95, 195), (205, 205)], fill=ARMOR_RIVET + (255,))

    img = add_outline(img, class_color)
    final = img.resize((64, 64), Image.LANCZOS)
    clamp_alpha(final)
    final.save(dst_path, "PNG", optimize=True)


def main():
    # Walking cane — write to BOTH possible paths so it doesn't
    # matter which one the seed points at.
    draw_cane(WEB / "items/weapon_healer_1.png", ORACLE)
    print(f"Wrote {WEB / 'items/weapon_healer_1.png'}")
    draw_cane(WEB / "gear/weapons/oracle.png", ORACLE)
    print(f"Wrote {WEB / 'gear/weapons/oracle.png'}")
    # Plain Cotton (per-item only)
    draw_plain_cotton(WEB / "items/shirt_starter_universal.png", UNIVERSAL)
    print(f"Wrote {WEB / 'items/shirt_starter_universal.png'}")
    # Heavy Knight Boots (sabatons — shared Tron sprite)
    draw_sabatons(WEB / "gear/feet/juggernaut.png", JUGG)
    print(f"Wrote {WEB / 'gear/feet/juggernaut.png'}")


if __name__ == "__main__":
    main()