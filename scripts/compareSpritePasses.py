#!/usr/bin/env python3
"""
Compare multiple sprite-cleanup passes side-by-side. For each test
sprite, run the raw fal.ai PNG through 8 different post-processing
pipelines and save each output with a clear suffix in
web/public/sprites/_compare/.

Passes:
  rembg-u2net-soft:        rembg u2net, soft fade alpha (round(255*alpha))
  rembg-u2net-hard:        rembg u2net, hard threshold (>= 8 → opaque)
  rembg-isnet-soft:        rembg isnet-general-use, soft fade
  rembg-isnet-hard:        rembg isnet-general-use, hard threshold
  rembg-birefnet-hard:     rembg birefnet-general, hard threshold
  chroma-dark:             detect dark bg (min(rgb) <= 8 → transparent)
  chroma-light:            detect light bg (min(rgb) >= 245 → transparent)
  rembg-silueta-soft:      rembg silueta, soft fade (often best for clean line art)

The user can browse web/public/sprites/_compare/ and pick the winner
via filename suffix. Then we re-run the chosen pipeline on all 91
sprites.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
RAW_DIR = Path("/home/josh/.local/share/fitquest-sprites/items")
WEB_ITEMS = REPO / "web/public/sprites/items"
COMPARE_DIR = REPO / "web/public/sprites/_compare"

# Default test sprites — can override via --id
DEFAULT_TESTS = ["armor_warrior_1", "ring_iron_band"]

def hard_threshold(img, cutoff=8):
    """min(rgb) > cutoff → fully opaque; else fully transparent."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if min(r, g, b) > cutoff:
                px[x, y] = (r, g, b, 255)
            else:
                px[x, y] = (0, 0, 0, 0)

def soft_fade(img):
    """Pass through rembg's alpha (typically 0..255)."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
            else:
                # Keep alpha as-is — rembg already returns gradient alpha.
                px[x, y] = (r, g, b, a)

def chroma_dark(img, cutoff=8):
    """Treat dark pixels (min(rgb) <= cutoff) as background."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if min(r, g, b) <= cutoff:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)

def chroma_light(img, cutoff=245):
    """Treat near-white pixels (min(rgb) >= cutoff) as background."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if min(r, g, b) >= cutoff:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)

def process_pass(raw_path, dst_path, model, post):
    """One pass: rembg with `model`, then `post` cleanup, then resize."""
    import rembg
    img = Image.open(raw_path).convert("RGBA")
    cleaned = rembg.remove(img, session=rembg.new_session(model))
    post(cleaned)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    # Hard-threshold a second time after resample to clean up any
    # interpolated alpha values (only for hard variants).
    if post in (hard_threshold, chroma_dark, chroma_light):
        post(final)
    final.save(dst_path, "PNG", optimize=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--id", action="append", help="item id to compare (can repeat)")
    args = p.parse_args()
    test_ids = args.id or DEFAULT_TESTS
    COMPARE_DIR.mkdir(parents=True, exist_ok=True)
    # Clear out any prior comparison output for these sprites.
    for tid in test_ids:
        for f in COMPARE_DIR.glob(f"{tid}-*.png"):
            f.unlink()

    passes = [
        ("rembg-u2net-soft",      "u2net",               soft_fade),
        ("rembg-u2net-hard",      "u2net",               hard_threshold),
        ("rembg-isnet-soft",      "isnet-general-use",   soft_fade),
        ("rembg-isnet-hard",      "isnet-general-use",   hard_threshold),
        ("rembg-birefnet-hard",   "birefnet-general",    hard_threshold),
        ("chroma-dark",           "u2net",               chroma_dark),
        ("chroma-light",          "u2net",               chroma_light),
        ("rembg-silueta-soft",    "silueta",             soft_fade),
    ]

    for tid in test_ids:
        raw = RAW_DIR / f"{tid}.png"
        if not raw.exists():
            print(f"  [skip] {tid} (raw missing)")
            continue
        print(f"\n=== {tid} ===")
        for pass_name, model, post in passes:
            dst = COMPARE_DIR / f"{tid}-{pass_name}.png"
            try:
                process_pass(raw, dst, model, post)
                sz = dst.stat().st_size
                print(f"  {pass_name:24s} → {dst.name} ({sz // 1024} KB)")
            except Exception as e:
                print(f"  {pass_name:24s} → FAILED: {e}")

    print(f"\nDone. Browse: {COMPARE_DIR}")
    print("Open web/public/sprites/_compare/{tid}-{pass}.png in any viewer")

if __name__ == "__main__":
    main()