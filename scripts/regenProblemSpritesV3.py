#!/usr/bin/env python3
"""
Regenerate problem sprites with stricter prompts + the wipe+isnet
hybrid pipeline:

  1. fal.ai generates raw PNG (often with a gray wash halo)
  2. wipeCanvasBg detects the canvas color from the corners and
     snaps any near-gray pixel to white (kills the gray halo)
  3. rembg isnet-general-use removes the white background,
     keeping a soft gradient alpha on the sprite edge
  4. threshold clamp: alpha < 128 → 0, alpha >= 128 → 255. This
     preserves the silhouette but eliminates the soft halo that
     users reported as 'shadow'.

Result: clean Tron-style sprites with no fringe and no halo.

Reads specs from /tmp/regen-specs-v3.json.
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

SPEC_PATH = Path("/tmp/regen-specs-v3.json")
spec_data = json.loads(SPEC_PATH.read_text())
SPECS = spec_data["specs"]
LEGACY_IDS = spec_data["legacy_ids"]
SHARED_GEAR = spec_data["shared_gear"]
TARGETS = spec_data["targets"]

DEFAULT_HEX = {
    "JUGGERNAUT": "dc2626",
    "BERSERKER":  "f55cc4",
    "PHANTOM":    "9bff5c",
    "TRACER":     "ff8c00",
    "SCOUT":      "ffc34d",
    "ORACLE":     "7d7bff",
    "universal":  "14d6e8",
}

def build_prompt(spec):
    cls = spec["cls"]
    color = spec.get("class_color") or DEFAULT_HEX.get(cls, "14d6e8")
    return (
        f"Single piece of {spec['slot'].lower()} equipment, isolated on transparent background. "
        f"Tron cyberpunk hologram style. {spec['name']} — {spec['desc']}. "
        f"STRICT PROHIBITIONS: NO highlights, NO glow, NO glints, NO bright stroke, "
        f"NO inner glow, NO neon accent, NO rim light, NO bright halo, NO shine. "
        f"NO circle around it, NO ring around it, NO decorative halo frame, "
        f"NO enchanted circle, NO magical aura, NO energy field, NO shadow, "
        f"NO ground plane, NO reflection, NO surface beneath, NO finger band, "
        f"NO loop, NO choker, NO through-hole. "
        f"ONLY use these colors: background=transparent, fill=#1c1d2b shadow, "
        f"#5c5d75 midtone. No other fill colors. The class color "
        f"#{color} is used ONLY on the 2px outline, NEVER as a fill. "
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

def wipe_bg(img, bg_color):
    """Aggressive gray-wipe (see wipeCanvasBg.py)."""
    px = img.load()
    w, h = img.size
    br, bg, bb = bg_color
    white = (255, 255, 255, 255)
    n_wiped = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 50:
                continue
            sat = max(r, g, b) - min(r, g, b)
            val = max(r, g, b)
            if abs(r - br) <= 16 and abs(g - bg) <= 16 and abs(b - bb) <= 16 and sat <= 30:
                px[x, y] = white
                n_wiped += 1
            elif sat <= 25 and 150 <= val <= 245:
                px[x, y] = white
                n_wiped += 1
    return n_wiped

def detect_bg_color(img):
    w, h = img.size
    samples = []
    for y in range(0, h, 8):
        for x in range(0, w, 8):
            if 32 < x < w - 32 and 32 < y < h - 32:
                continue
            p = img.getpixel((x, y))
            if len(p) == 4:
                r, g, b, a = p
            else:
                r, g, b = p[:3]; a = 255
            if a < 50:
                continue
            samples.append((r, g, b))
    if not samples:
        return None
    rs = sorted(s[0] for s in samples)
    gs = sorted(s[1] for s in samples)
    bs = sorted(s[2] for s in samples)
    mid = len(samples) // 2
    return (rs[mid], gs[mid], bs[mid])

def post_process(raw_path: Path, dst_path: Path):
    img = Image.open(raw_path).convert("RGBA")
    bg = detect_bg_color(img)
    if bg:
        wipe_bg(img, bg)
    import rembg
    session = rembg.new_session("isnet-general-use")
    cleaned = rembg.remove(img, session=session)
    # Threshold clamp
    px = cleaned.load()
    w, h = cleaned.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
            elif a < 255:
                px[x, y] = (r, g, b, 255)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    # Clamp again after resize
    px = final.load()
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
            elif a < 255:
                px[x, y] = (r, g, b, 255)
    final.save(dst_path, "PNG", optimize=True)

def raw_path_for(name: str) -> Path:
    if name in LEGACY_IDS:
        return RAW_BASE / "items" / f"{LEGACY_IDS[name]}.png"
    if name in SHARED_GEAR:
        slot, letter = SHARED_GEAR[name]
        return RAW_BASE / "gear" / slot / f"{letter}.png"
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