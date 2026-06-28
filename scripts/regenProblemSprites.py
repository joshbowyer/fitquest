#!/usr/bin/env python3
"""
Regenerate problem sprites with stricter prompts that explicitly
forbid highlights, glows, glints, rim lights, bright strokes, and
neon accents. Then re-apply the isnet-soft pass via applyPassToAll.

Reads specs from /tmp/regen-specs.json (built by the inline Python
snippet in the conversation; could be moved into a committed file).
For each item:
  1. Generate a new fal.ai raw PNG with the strict prompt
  2. Run rembg-isnet-soft on it
  3. Write to web/public/sprites/<target>

After running this, the dev catalog will pick up the new sprites on
the next page load.
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

# Loads the inline spec the conversation wrote
SPEC_PATH = Path("/tmp/regen-specs.json")
spec_data = json.loads(SPEC_PATH.read_text())
SPECS = spec_data["specs"]
LEGACY_IDS = spec_data["legacy_ids"]
SHARED_GEAR = spec_data["shared_gear"]
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
        f"ONLY use these colors: background=transparent, fill=#1c1d2b shadow, "
        f"#5c5d75 midtone, #d8d9e8 highlight (max 10% of pixels), #14d6e8 cyan accent "
        f"(only on outline, never as fill). "
        f"Outline 2px in class color #{color}, closed and unbroken. "
        f"Negative space dominant. Recognisable at 16x16. "
        f"1024x1024 px square canvas, transparent background PNG. "
        f"No watermarks, no text, no border, no frame. "
        f"No realistic skin, no character, no person. "
        f"Single object, centered, flat color fills."
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

def soft_post(img):
    """Pass-through rembg alpha (gradient)."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, a)

def post_process(raw_path: Path, dst_path: Path):
    import rembg
    session = rembg.new_session("isnet-general-use")
    img = Image.open(raw_path).convert("RGBA")
    cleaned = rembg.remove(img, session=session)
    soft_post(cleaned)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)

def raw_path_for(name: str) -> Path:
    if name in LEGACY_IDS:
        return RAW_BASE / "items" / f"{LEGACY_IDS[name]}.png"
    slot, letter = SHARED_GEAR[name]
    return RAW_BASE / "gear" / slot / f"{letter}.png"

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