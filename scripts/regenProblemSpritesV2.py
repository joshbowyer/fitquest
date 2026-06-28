#!/usr/bin/env python3
"""
Regenerate problem sprites with stricter prompts + improved alpha
post-process.

Diff from regenProblemSprites.py:
  - Improved alpha post-process: clamps both low (1-50) and high
    (200-254) partial pixels to either 0 or 255. The earlier
    isnet-soft pass left near-opaque partial pixels (alpha 200-254)
    that visually read as a dark shadow on certain sprites (e.g. the
    cane shaft tapering off).
  - Handles per-item targets (glowing_orb gets its own per-item
    sprite rather than sharing the canonical gear/weapons/oracle.png
    which is also the walking cane).

Reads specs from /tmp/regen-specs.json (built by the inline Python
snippet in the conversation).
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
RAW_BASE = Path("/home/josh/.local/share/fitquest-sprites")
OPENCLAW = "/home/josh/.npm-global/bin/openclaw"
MODEL = "fal/fal-ai/nano-banana-2"

SPEC_PATH = Path("/tmp/regen-specs.json")
spec_data = json.loads(SPEC_PATH.read_text())
SPECS = spec_data["specs"]
LEGACY_IDS = spec_data["legacy_ids"]
SHARED_GEAR = spec_data["shared_gear"]
PER_ITEM_TARGETS = spec_data.get("per_item_targets", {})
TARGETS = spec_data["targets"]

CLASS_HEX = {
    "JUGGERNAUT": "dc2626",
    "BERSERKER":  "f55cc4",
    "PHANTOM":    "9bff5c",
    "TRACER":     "ff8c00",
    "SCOUT":      "ffc34d",
    "ORACLE":     "7d7bff",
}

def build_prompt(spec):
    cls = spec["cls"]
    color = CLASS_HEX.get(cls, "14d6e8")
    return (
        f"Single piece of {spec['slot'].lower()} equipment, isolated on transparent background. "
        f"Tron cyberpunk hologram style. {spec['name']} — {spec['desc']}. "
        f"STRICT PROHIBITIONS: NO highlights, NO glow, NO glints, NO bright stroke, "
        f"NO inner glow, NO neon accent, NO rim light, NO bright halo, NO shine. "
        f"NO circle around it, NO ring around it, NO decorative halo frame, "
        f"NO enchanted circle, NO magical aura, NO energy field, NO shadow, "
        f"NO ground plane, NO reflection, NO surface beneath. "
        f"ONLY use these colors: background=transparent, fill=#1c1d2b shadow, "
        f"#5c5d75 midtone. No other colors except the 2px class outline #{color}. "
        f"Negative space dominant. Recognisable at 16x16. "
        f"1024x1024 px square canvas, transparent background PNG. "
        f"No watermarks, no text, no border, no frame. "
        f"No realistic skin, no character, no person. "
        f"Single object, centered, flat color fills only."
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

def clamped_soft_post(img):
    """rembg alpha but clamp both ends — kill very-low (1..50) and
    near-opaque (200..254) partial pixels so they don't read as a
    dark shadow at the silhouette edge.

    - alpha 1..50  → alpha 0  (kill soft halo)
    - alpha 51..199 → alpha unchanged (let the gradient silhouette through)
    - alpha 200..254 → alpha 255  (kill near-opaque shadow fringe)
    """
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
            elif 1 <= a <= 50:
                px[x, y] = (0, 0, 0, 0)
            elif 200 <= a <= 254:
                px[x, y] = (r, g, b, 255)
            # else: keep as-is (gradient 51..199)

def post_process(raw_path: Path, dst_path: Path):
    import rembg
    session = rembg.new_session("isnet-general-use")
    img = Image.open(raw_path).convert("RGBA")
    cleaned = rembg.remove(img, session=session)
    clamped_soft_post(cleaned)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    # After resampling, partial pixels might creep in. Apply the clamp
    # one more time to lock the alpha to 0 or 255.
    clamped_soft_post(final)
    final.save(dst_path, "PNG", optimize=True)

def raw_path_for(name: str) -> Path:
    """All current specs are either shared gear (gear/<slot>/<letter>.png)
    or per-item targets (raw at items/<per_item_id>.png)."""
    if name in LEGACY_IDS:
        return RAW_BASE / "items" / f"{LEGACY_IDS[name]}.png"
    if name in SHARED_GEAR:
        slot, letter = SHARED_GEAR[name]
        return RAW_BASE / "gear" / slot / f"{letter}.png"
    if name in PER_ITEM_TARGETS:
        # per-item target: derive raw filename from the target path
        target = Path(TARGETS[name])
        # /sprites/items/tron_oracle_weapon.png → /items/tron_oracle_weapon.png
        return RAW_BASE / "items" / target.name
    raise ValueError(f"unknown spec: {name}")

def main():
    print(f"Will regenerate {len(SPECS)} sprites\n")
    ok = 0
    failed = []
    for name, spec in SPECS.items():
        prompt = build_prompt(spec)
        raw = raw_path_for(name)
        png = gen_one(name, prompt, raw)
        if png is None:
            failed.append(name)
            continue
        try:
            dst = REPO / TARGETS[name]
            post_process(png, dst)
            ok += 1
            print(f"  [post] → {TARGETS[name]}")
        except Exception as e:
            failed.append(name)
            print(f"  [post] {name} failed: {e}")

    print(f"\nDone: {ok}/{len(SPECS)} regenerated")
    if failed:
        print(f"Failed: {failed}")
        sys.exit(1)

if __name__ == "__main__":
    main()