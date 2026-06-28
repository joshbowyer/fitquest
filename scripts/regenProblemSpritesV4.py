#!/usr/bin/env python3
"""
V4 regen: tuned for thin sprites (walking cane) + a softer fallback
when wipe+threshold nukes the subject.

Key insight from v3: walking cane has cane shaft pixels at
rgb(111, 97, 96) — a dark desaturated brown. The wipe step
correctly removes the gray halo, but then the cane itself is
mistaken by rembg for a "dark shadow" and partially stripped.

V4 strategy:
  - More saturated colors in prompts (use #5c5d75 minimum, not below)
  - Try the wipe+isnet+threshold pipeline first
  - If the result has fewer than N opaque pixels (i.e. the wipe
    nuked the subject), retry WITHOUT the wipe — use isnet directly
    on the raw fal output

This protects thin sprites from being wiped out by the gray canvas
detector. Walking cane and sabatons should both look right after
this fallback.

Reads specs from /tmp/regen-specs-v4.json.
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

SPEC_PATH = Path("/tmp/regen-specs-v4.json")
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

# Minimum acceptable opaque pixel count. If a sprite ends up with
# fewer than this, we retry WITHOUT the wipe step.
MIN_OPAQUE_PIXELS = 100

def build_prompt(spec):
    cls = spec["cls"]
    color = DEFAULT_HEX.get(cls, "14d6e8")
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
    px = img.load()
    w, h = img.size
    br, bg, bb = bg_color
    white = (255, 255, 255, 255)
    n_wiped = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 50: continue
            sat = max(r, g, b) - min(r, g, b)
            val = max(r, g, b)
            if abs(r - br) <= 16 and abs(g - bg) <= 16 and abs(b - bb) <= 16 and sat <= 30:
                px[x, y] = white; n_wiped += 1
            elif sat <= 25 and 150 <= val <= 245:
                px[x, y] = white; n_wiped += 1
    return n_wiped

def detect_bg_color(img):
    w, h = img.size
    samples = []
    for y in range(0, h, 8):
        for x in range(0, w, 8):
            if 32 < x < w - 32 and 32 < y < h - 32: continue
            p = img.getpixel((x, y))
            if len(p) == 4:
                r, g, b, a = p
            else:
                r, g, b = p[:3]; a = 255
            if a < 50: continue
            samples.append((r, g, b))
    if not samples: return None
    rs = sorted(s[0] for s in samples); gs = sorted(s[1] for s in samples); bs = sorted(s[2] for s in samples)
    mid = len(samples) // 2
    return (rs[mid], gs[mid], bs[mid])

def threshold_clamp(img, threshold=128):
    """alpha < threshold → 0; alpha < 255 → 255."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < threshold:
                px[x, y] = (0, 0, 0, 0)
            elif a < 255:
                px[x, y] = (r, g, b, 255)

def soft_clamp(img, threshold_low=1, threshold_high=255):
    """Keep isnet's gradient alpha but kill the soft halo."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if threshold_low <= a <= threshold_high:
                px[x, y] = (0, 0, 0, 0)

def isnet_remove(img):
    import rembg
    session = rembg.new_session("isnet-general-use")
    return rembg.remove(img, session=session)

def process_wipe(raw_path: Path, dst_path: Path, threshold=128):
    """Wipe bg → isnet → threshold clamp."""
    img = Image.open(raw_path).convert("RGBA")
    bg = detect_bg_color(img)
    if bg:
        wipe_bg(img, bg)
    cleaned = isnet_remove(img)
    threshold_clamp(cleaned, threshold)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    threshold_clamp(final, threshold)
    final.save(dst_path, "PNG", optimize=True)
    return final

def process_no_wipe(raw_path: Path, dst_path: Path):
    """Skip wipe — use isnet directly. Higher chance of preserving
    thin sprites, but the gray halo might come back."""
    img = Image.open(raw_path).convert("RGBA")
    cleaned = isnet_remove(img)
    # Use a softer clamp (only kill alpha 1-50, keep 51-199 gradient)
    soft_clamp(cleaned, threshold_low=1, threshold_high=50)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    soft_clamp(final, threshold_low=1, threshold_high=50)
    final.save(dst_path, "PNG", optimize=True)
    return final

def raw_path_for(name: str) -> Path:
    if name in LEGACY_IDS:
        return RAW_BASE / "items" / f"{LEGACY_IDS[name]}.png"
    if name in SHARED_GEAR:
        slot, letter = SHARED_GEAR[name]
        return RAW_BASE / "gear" / slot / f"{letter}.png"
    raise ValueError(f"unknown spec: {name}")

def opaque_count(img):
    import collections
    return collections.Counter(img.split()[3].getdata()).get(255, 0)

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
        dst = REPO / TARGETS[name]
        try:
            # Try wipe+isnet first
            result = process_wipe(png, dst)
            n_opaque = opaque_count(result)
            print(f"  [post] wipe+isnet → {n_opaque} opaque px")
            if n_opaque < MIN_OPAQUE_PIXELS:
                # Fallback: skip wipe, use soft clamp
                print(f"    → too few opaque px ({n_opaque} < {MIN_OPAQUE_PIXELS}), retrying without wipe")
                result = process_no_wipe(png, dst)
                n_opaque = opaque_count(result)
                print(f"  [post] no-wipe fallback → {n_opaque} opaque px")
            ok += 1
        except Exception as e:
            failed.append(name)
            print(f"  [post] {name} failed: {e}")

    print(f"\nDone: {ok}/{len(SPECS)} regenerated")
    if failed:
        print(f"Failed: {failed}")
        sys.exit(1)

if __name__ == "__main__":
    main()