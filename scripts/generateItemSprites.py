#!/usr/bin/env python3
"""
Generate per-item sprites for legacy catalog items via fal.ai nano-banana-2,
post-process them with rembg + downscale to 64x64 transparent PNGs, and
drop them into web/public/sprites/items/.

Reads the prompt from web/public/sprites/items/MANIFEST.json. Skips
items whose output PNG already exists so the script is idempotent
(restart-safe). Defaults to legacy items only (anything not starting
with `tron_`) but takes an optional --all flag to regenerate the Tron
set too.

Usage:
  python3 scripts/generateItemSprites.py          # generate only missing legacy items
  python3 scripts/generateItemSprites.py --all    # include Tron items
  python3 scripts/generateItemSprites.py --id shirt_jugg_basic   # single item
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "web/public/sprites/items/MANIFEST.json"
ITEMS_DIR = REPO_ROOT / "web/public/sprites/items"
RAW_DIR = Path("/home/josh/.local/share/fitquest-sprites/items")
OPENCLAW = "/home/josh/.npm-global/bin/openclaw"
MODEL = "fal/fal-ai/nano-banana-2"
TIMEOUT_MS = 90_000

CLASS_HEX = {
    "JUGGERNAUT": "dc2626",
    "BERSERKER":  "f55cc4",
    "PHANTOM":    "9bff5c",
    "TRACER":     "ff8c00",
    "SCOUT":      "ffc34d",
    "ORACLE":     "7d7bff",
}
RARITY_BORDER = {
    "COMMON":    "94a3b8",
    "UNCOMMON":  "9bff5c",
    "RARE":      "14d6e8",
    "EPIC":      "f55cc4",
    "LEGENDARY": "ffc34d",
    "MYTHIC":    "ff2bd6",
}
RARITY_GLOW = {
    "COMMON":    "94a3b833",
    "UNCOMMON":  "9bff5c33",
    "RARE":      "14d6e833",
    "EPIC":      "f55cc433",
    "LEGENDARY": "ffc34d33",
    "MYTHIC":    "ff2bd633",
}
SLOT_NOUN = {
    "HEAD":  "helmet or hood",
    "BODY":  "torso armor or robe",
    "HANDS": "glove or bracer",
    "FEET":  "boot or shoe",
    "MAIN":  "weapon",
    "OFF":   "shield or off-hand weapon",
    "NECK":  "amulet, pendant, or necklace",
    "RING":  "ring",
}

def prompt_for(item):
    """Build a fal-friendly prompt from a MANIFEST.json entry."""
    cls = item.get("classRestriction") or "universal"
    cls_color = CLASS_HEX.get(cls, "14d6e8")
    rarity = item.get("rarity", "COMMON")
    border = RARITY_BORDER.get(rarity, "94a3b8")
    glow = RARITY_GLOW.get(rarity, "94a3b833")
    slot = item.get("slot", "")
    slot_noun = SLOT_NOUN.get(slot, "object")
    name = item.get("name", "")
    return (
        f"Single piece of {slot_noun} equipment, isolated on transparent background. "
        f"Tron cyberpunk hologram style. {name} — a specific variant of {slot_noun} "
        f"with distinctive details that set it apart from other items in the same slot. "
        f"ONLY use these colors: background=transparent, fill=#1c1d2b shadow, "
        f"#5c5d75 midtone, #d8d9e8 highlight, #14d6e8 cyan accent, #9bff5c lime accent, "
        f"rarity border #{border} ({rarity}), inner glow #{glow}. "
        f"Outline 2px in the class color #{cls_color}, closed and unbroken. "
        f"Negative space dominant over detail. Recognisable at 16x16 — silhouette first, detail second. "
        f"1024x1024 px square canvas, transparent background PNG with alpha channel. "
        f"No watermarks, no text, no border, no frame. No realistic skin, no character, "
        f"no person holding or wearing it. Single object, centered."
    )

def generate_one(item_id, prompt):
    """Call openclaw to generate one image, return the raw PNG path."""
    out_prefix = RAW_DIR / item_id
    if (out_prefix.with_suffix(".png")).exists():
        print(f"  [skip] {item_id} (raw exists)")
        return out_prefix.with_suffix(".png")
    print(f"  [gen ] {item_id} ...", end="", flush=True)
    cmd = [
        OPENCLAW, "capability", "image", "generate",
        "--model", MODEL,
        "--prompt", prompt,
        "--aspect-ratio", "1:1",
        "--count", "1",
        "--output", str(out_prefix),
        "--timeout-ms", str(TIMEOUT_MS),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f" FAILED: {res.stderr[-200:]}")
        return None
    png_path = out_prefix.with_suffix(".png")
    if not png_path.exists():
        # Some openclaw versions append a suffix; look for any matching file
        candidates = list(RAW_DIR.glob(f"{item_id}*"))
        if candidates:
            return candidates[0]
        print(f" no output file produced")
        return None
    print(f" ok ({png_path.stat().st_size // 1024} KB)")
    return png_path

def post_process(raw_path, dst_path):
    """rembg + downscale to 64x64 transparent PNG."""
    from PIL import Image
    import rembg
    img = Image.open(raw_path).convert("RGBA")
    cleaned = rembg.remove(img)
    mid = cleaned.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    final.save(dst_path, "PNG", optimize=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--all", action="store_true", help="include Tron set too")
    p.add_argument("--id", help="single item id to generate")
    p.add_argument("--skip-post", action="store_true", help="only generate raw, no rembg")
    args = p.parse_args()

    ITEMS_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(MANIFEST_PATH.read_text())
    if args.id:
        items = [it for it in manifest if it["id"] == args.id]
    elif args.all:
        items = manifest
    else:
        items = [it for it in manifest if not it["id"].startswith("tron_")]

    print(f"Will process {len(items)} items")
    ok = 0
    skipped = 0
    failed = []
    for it in items:
        item_id = it["id"]
        dst = ITEMS_DIR / f"{item_id}.png"
        if dst.exists() and not args.id:
            skipped += 1
            continue
        prompt = prompt_for(it)
        raw = generate_one(item_id, prompt)
        if raw is None:
            failed.append(item_id)
            continue
        if args.skip_post:
            continue
        try:
            post_process(raw, dst)
            ok += 1
        except Exception as e:
            print(f"  [post] {item_id} failed: {e}")
            failed.append(item_id)

    print(f"\n=== done ===")
    print(f"  generated: {ok}")
    print(f"  skipped (existed): {skipped}")
    print(f"  failed: {len(failed)}")
    if failed:
        print("  failed ids:")
        for fid in failed:
            print(f"    {fid}")
        sys.exit(1)

if __name__ == "__main__":
    main()