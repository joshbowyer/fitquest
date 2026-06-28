#!/usr/bin/env python3
"""
Apply a chosen sprite-cleanup pass to every catalog sprite.

Reads web/public/sprites/items/MANIFEST.json to find all item ids
(legacy + tron), then walks web/public/sprites/gear/<slot>/ to find
all shared Tron gear. For each one, finds the raw fal.ai source
under ~/.local/share/fitquest-sprites/, runs the chosen rembg pass,
and writes the final 64x64 PNG to its web/public/ location.

Usage:
  python3 scripts/applyPassToAll.py --pass isnet-soft
  python3 scripts/applyPassToAll.py --pass u2net-hard
  python3 scripts/applyPassToAll.py --pass birefnet-hard
  python3 scripts/applyPassToAll.py --pass u2net-soft

Each pass matches the same naming the contact sheet used
(rembg-{model}-{soft|hard}).
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
RAW_DIR = Path("/home/josh/.local/share/fitquest-sprites")
MANIFEST_PATH = REPO / "web/public/sprites/items/MANIFEST.json"
WEB = REPO / "web/public/sprites"
WEB_ITEMS = WEB / "items"
WEB_GEAR = WEB / "gear"

CLASS_LETTER = {
    "JUGGERNAUT": "j",
    "BERSERKER":  "b",
    "PHANTOM":    "p",
    "TRACER":     "t",
    "SCOUT":      "s",
    "ORACLE":     "o",
}
SLOT_FOLDER = {
    "HEAD":  "head",
    "BODY":  "body",
    "HANDS": "hands",
    "FEET":  "feet",
    "MAIN":  "weapons",
    "OFF":   "off",
    "NECK":  "neck",
    "RING":  "ring",
}

# (model, post_fn) per pass name
PASSES = {
    "u2net-soft":     ("u2net", "soft"),
    "u2net-hard":     ("u2net", "hard"),
    "isnet-soft":     ("isnet-general-use", "soft"),
    "isnet-hard":     ("isnet-general-use", "hard"),
    "birefnet-hard":  ("birefnet-general", "hard"),
    "silueta-soft":   ("silueta", "soft"),
}

def soft_post(img):
    """Pass through rembg's alpha (gradient)."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, a)

def hard_post(img, cutoff=8):
    """min(rgb) > cutoff → opaque, else transparent."""
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

def process(raw_path, dst_path, model, post_name):
    """rembg(model) → post → 256 → 64 → save."""
    import rembg
    session = rembg.new_session(model)
    img = Image.open(raw_path).convert("RGBA")
    cleaned = rembg.remove(img, session=session)
    if post_name == "soft":
        soft_post(cleaned)
    else:
        hard_post(cleaned)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)

def find_raw_for_web(web_path: Path) -> Path | None:
    """Map a web/public/sprites/<path> back to its raw fal source."""
    rel = web_path.relative_to(WEB)
    parts = rel.parts  # e.g. ('items', 'shirt_jugg_basic.png')
    if parts[0] == "items":
        return RAW_DIR / "items" / parts[1]
    if parts[0] == "gear":
        # gear/<slot>/<class>.png  ←  raw at gear/<slot>/<letter>.png
        slot_dir, class_png = parts[1], parts[2]
        class_name = class_png.replace(".png", "")
        letter = next((v for k, v in CLASS_LETTER.items() if k.lower() == class_name), None)
        if letter is None:
            return None
        return RAW_DIR / "gear" / slot_dir / f"{letter}.png"
    return None

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pass", dest="pass_name", required=True, choices=list(PASSES.keys()))
    p.add_argument("--only", help="limit to a slot prefix (e.g. items, gear)")
    args = p.parse_args()

    if args.pass_name not in PASSES:
        print(f"Unknown pass: {args.pass_name}")
        sys.exit(1)
    model, post = PASSES[args.pass_name]
    print(f"Pass: {args.pass_name}  (model={model}, post={post})")

    # Collect every target PNG under web/public/sprites/ that has a
    # matching raw source we can re-process.
    targets: list[Path] = []
    if args.only in (None, "items"):
        for p in WEB_ITEMS.glob("*.png"):
            if p.name in ("MANIFEST.json", "README.md"):
                continue
            if (RAW_DIR / "items" / p.name).exists():
                targets.append(p)
    if args.only in (None, "gear"):
        for p in WEB_GEAR.glob("*/*.png"):
            if find_raw_for_web(p) is not None:
                targets.append(p)

    # Dedup + sort for stable output
    targets = sorted(set(targets))
    print(f"Will process {len(targets)} sprites\n")

    ok = 0
    errs = []
    for web_path in targets:
        raw_path = find_raw_for_web(web_path)
        if raw_path is None or not raw_path.exists():
            errs.append((str(web_path), "raw not found"))
            continue
        try:
            process(raw_path, web_path, model, post)
            ok += 1
            if ok % 10 == 0 or ok == len(targets):
                print(f"  [{ok}/{len(targets)}] processed")
        except Exception as e:
            errs.append((str(web_path), str(e)))

    print(f"\nDone: {ok}/{len(targets)} processed")
    if errs:
        print(f"Errors ({len(errs)}):")
        for path, e in errs[:20]:
            print(f"  {path}: {e}")

if __name__ == "__main__":
    main()