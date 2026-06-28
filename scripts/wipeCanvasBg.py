#!/usr/bin/env python3
"""
Pre-process a fal.ai raw sprite to wipe the canvas background
before rembg sees it.

Why: fal doesn't always render on pure transparent or pure black.
It sometimes leaves a gray wash (e.g. rgb(192, 192, 192)) that
rembg's model treats as part of the image, because the gradient
into the gray is "valid silhouette content" by its training.
Result: a light-gray shadow/halo around the sprite.

Fix:
  1. Sample the canvas corners to detect the dominant bg color
  2. For every pixel, if it's close to that bg color AND low
     saturation, snap it to pure white (255, 255, 255) and zero
     the alpha. rembg then sees a clean white background and
     strips it cleanly.
  3. Pass the wiped image to the standard rembg pipeline.

Usage:
  python3 scripts/wipeCanvasBg.py <raw.png> <out.png>
  python3 scripts/wipeCanvasBg.py --dir <dir> # process every .png in dir
"""

import argparse
import collections
import sys
from pathlib import Path

from PIL import Image


def detect_bg_color(img, sample_step=8, sample_ring=32):
    """Sample the outer ring of the image (away from the center where
    the sprite lives) to detect the dominant canvas color. Returns the
    median RGB of those samples — robust to single-pixel noise."""
    w, h = img.size
    samples = []
    for y in range(0, h, sample_step):
        for x in range(0, w, sample_step):
            # Skip the central area where the sprite lives
            if (sample_ring < x < w - sample_ring
                    and sample_ring < y < h - sample_ring):
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
    # Median per channel — robust to noise
    rs = sorted(s[0] for s in samples)
    gs = sorted(s[1] for s in samples)
    bs = sorted(s[2] for s in samples)
    mid = len(samples) // 2
    return (rs[mid], gs[mid], bs[mid])


def wipe_bg(img, bg_color):
    """Aggressive canvas-wipe for fal output that has a gray halo drawn
    around the sprite.

    Two passes:
      1. Exact-match: any pixel within 16 RGB units of `bg_color`
         AND saturation <= 30 → white
      2. Light-gray rule: any pixel where R≈G≈B (saturation <= 25)
         AND value in [150..245] → white (catches the gray halo
         even when it varies spatially)

    Sprite pixels (dark or saturated) are left alone.
    """
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
            # Pass 1: close to detected bg color, low saturation
            if abs(r - br) <= 16 and abs(g - bg) <= 16 and abs(b - bb) <= 16 and sat <= 30:
                px[x, y] = white
                n_wiped += 1
                continue
            # Pass 2: any near-gray pixel in the light-gray range
            # (the gray halo fal draws around sprites). Catches the
            # case where the bg color varies spatially.
            if sat <= 25 and 150 <= val <= 245:
                px[x, y] = white
                n_wiped += 1
    return n_wiped


def process_one(raw_path: Path, dst_path: Path):
    img = Image.open(raw_path).convert("RGBA")
    bg = detect_bg_color(img)
    if bg is None:
        print(f"  [skip] {raw_path.name}: no opaque edge pixels")
        return False
    n_wiped = wipe_bg(img, bg)
    img.save(dst_path, "PNG", optimize=True)
    print(f"  [wipe] {raw_path.name}: bg={bg}, wiped {n_wiped} px → {dst_path.name}")
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input", nargs="?", help="single raw PNG to process")
    p.add_argument("--dir", help="process every .png in this directory")
    p.add_argument("--out-dir", default="/tmp/wiped",
                   help="where to write the wiped PNGs (default: /tmp/wiped)")
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.dir:
        d = Path(args.dir)
        for p in sorted(d.glob("*.png")):
            process_one(p, out_dir / p.name)
    elif args.input:
        process_one(Path(args.input), out_dir / Path(args.input).name)
    else:
        print("Pass either an input file or --dir")
        sys.exit(1)


if __name__ == "__main__":
    main()