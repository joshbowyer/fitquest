#!/usr/bin/env python3
"""
Green-screen sprite generation pipeline.

fal-ai/nano-banana-2 always renders on a gray wash that confuses
rembg. Ask fal to render on PURE BRIGHT GREEN BACKGROUND
(#00FF00) instead, then chroma-key the green out:

  1. fal generates raw PNG (with a solid green BG)
  2. wipe_green() replaces any green-dominant pixel with pure white
  3. rembg/isnet-general-use strips the white background
  4. threshold clamp removes soft halo
  5. resize 256→64, threshold clamp again

End result: clean Tron-style sprites drawn by fal (not procedural)
with no halo / shadow artifacts.

Usage:
  python3 scripts/greenScreenRegen.py walking_cane plain_cotton sabatons
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
RAW_BASE = Path("/home/josh/.local/share/fitquest-sprites")
OPENCLAW = "/home/josh/.npm-global/bin/openclaw"
MODEL = "fal/fal-ai/nano-banana-2"

# Item specs — green-bg prompts. Each is a manual fix for the items
# that the gray-wash + rembg-isnet pipeline consistently failed on.
SPECS = {
    "walking_cane": {
        "slot": "MAIN", "cls": "ORACLE", "name": "Walking Cane",
        "description": (
            "a simple wooden walking cane: a single thick straight vertical "
            "shaft of medium brown wood, with a curved J-shape hook at the "
            "top serving as the handle, and a small rounded foot tip at the "
            "bottom. Flat medium-brown wood fill, dark brown outline. "
            "Single 2px periwinkle #7d7bff outline. NO highlights, NO glints, "
            "NO glow, NO decorative carving"
        ),
        "raw": "gear/weapons/o.png",
        "targets": [
            "items/weapon_healer_1.png",
            "gear/weapons/oracle.png",
        ],
    },
    "plain_cotton": {
        "slot": "BODY", "cls": "universal", "name": "Plain Cotton Tunic",
        "description": (
            "a medieval-style plain cotton tunic (NOT a modern T-shirt). "
            "Loose-fitting long shirt reaching mid-thigh, with NO collar, NO "
            "buttons, NO zipper, NO fitted waist. Wide short sleeves ending "
            "above the elbow, simple straight hem. Light undyed natural linen "
            "color. ONE flat color fill throughout the tunic body with subtle "
            "darker stripe along the hem and sleeve cuffs. NO modern T-shirt "
            "cut, NO shoulder pads, NO armor, NO embroidery"
        ),
        "raw": "items/shirt_starter_universal.png",
        "targets": [
            "items/shirt_starter_universal.png",
        ],
    },
    "sabatons": {
        "slot": "FEET", "cls": "JUGGERNAUT", "name": "Heavy Knight Boots",
        "description": (
            "heavy medieval knight plate boots (sabatons) viewed from the "
            "side profile. A heavy armored boot with: a tall shin plate covering "
            "the front of the leg from ankle to knee, articulated horizontal "
            "plate bands wrapping the foot, a rounded pointed toe cap at the "
            "front, a small spur at the heel, a leather sole visible at the "
            "bottom. The boot should clearly look like a heavy armored boot. "
            "Two flat color regions: armor plates dark navy #1c1d2b, leather "
            "sole midtone gray #5c5d75. Single 2px red outline. NO glow, NO "
            "highlights, NO shading"
        ),
        "raw": "gear/feet/j.png",
        "targets": [
            "gear/feet/juggernaut.png",
        ],
    },
}

DEFAULT_HEX = {
    "JUGGERNAUT": "dc2626", "BERSERKER":  "f55cc4", "PHANTOM": "9bff5c",
    "TRACER": "ff8c00", "SCOUT": "ffc34d", "ORACLE": "7d7bff",
    "universal": "14d6e8",
}


def build_prompt(spec):
    cls = spec["cls"]
    color = DEFAULT_HEX.get(cls, "14d6e8")
    return (
        f"Single piece of {spec['slot'].lower()} equipment, isolated on a "
        f"SOLID PURE BRIGHT GREEN BACKGROUND (background must be exactly pure "
        f"#00FF00 bright green — NOT gray, NOT white, NOT dark, NO gradients, "
        f"NO shadows, NO floor, NO vignette, NO lighting effects on the "
        f"background). "
        f"Tron cyberpunk hologram style. {spec['name']} — {spec['description']}. "
        f"Only use these colors in the SUBJECT: fill=#1c1d2b shadow, "
        f"#5c5d75 midtone. The class color #{color} is used ONLY on the 2px "
        f"outline of the subject. Negative space dominant. Recognisable at "
        f"16x16. 1024x1024 px square canvas with PURE BRIGHT GREEN #00FF00 "
        f"background. No watermarks, no text, no border, no frame. "
        f"Single object, centered."
    )


def gen_one(item_id, prompt, raw_path: Path):
    print(f"  [gen ] {item_id}...", end="", flush=True)
    cmd = [
        OPENCLAW, "capability", "image", "generate",
        "--model", MODEL,
        "--prompt", prompt,
        "--aspect-ratio", "1:1",
        "--count", "1",
        "--output", str(raw_path.with_suffix("")),
        "--timeout-ms", "90000",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    png = raw_path.with_suffix(".png")
    if png.exists():
        print(f" ok ({png.stat().st_size // 1024} KB)")
        return png
    print(f" FAILED: {res.stderr[-200:]}")
    return None


def wipe_green(img):
    """Replace any green-dominant pixel with pure white. Catches both
    the pure #00FF00 bg AND the desaturated green halo LANCZOS
    resampling creates at the silhouette edge."""
    px = img.load()
    w, h = img.size
    white = (255, 255, 255, 255)
    n_wiped = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 50: continue
            # Pure green: G dominant, R and B near zero
            if g > 120 and g > r + 30 and g > b + 30 and r < 60 and b < 60:
                px[x, y] = white
                n_wiped += 1
                continue
            # Mid green-gray (the halo wash)
            if (80 < r < 220 and 140 < g < 240 and 80 < b < 220
                    and g > r + 25 and g > b + 25):
                px[x, y] = white
                n_wiped += 1
    return n_wiped


def threshold_clamp(img, threshold=128):
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < threshold: px[x, y] = (0, 0, 0, 0)
            elif a < 255: px[x, y] = (r, g, b, 255)


def process(raw_path: Path, dst_path: Path, threshold=128):
    img = Image.open(raw_path).convert("RGBA")
    wipe_green(img)
    import rembg
    session = rembg.new_session("isnet-general-use")
    cleaned = rembg.remove(img, session=session)
    threshold_clamp(cleaned, threshold)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    threshold_clamp(final, threshold)
    final.save(dst_path, "PNG", optimize=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("items", nargs="*",
                   help="items to regenerate (default: all 3)")
    args = p.parse_args()
    items = args.items or list(SPECS.keys())
    print(f"Will regenerate {len(items)} sprites with green-screen method\n")
    ok = 0
    failed = []
    for name in items:
        if name not in SPECS:
            print(f"  [skip] {name}: unknown spec")
            continue
        spec = SPECS[name]
        prompt = build_prompt(spec)
        raw = RAW_BASE / spec["raw"]
        png = gen_one(name, prompt, raw)
        if png is None:
            failed.append(name)
            continue
        try:
            for target in spec["targets"]:
                dst = REPO / "web/public/sprites" / target
                process(png, dst)
                print(f"  [post] → web/public/sprites/{target}")
            ok += 1
        except Exception as e:
            failed.append(name)
            print(f"  [post] {name} failed: {e}")
    print(f"\nDone: {ok}/{len(items)} regenerated")
    if failed:
        print(f"Failed: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()