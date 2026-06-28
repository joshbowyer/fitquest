#!/usr/bin/env python3
"""
Strict alpha cleanup for sprite PNGs.

The earlier post-processing used a soft fade `min(rgb)/40` which
left a halo of partial-alpha pixels around each sprite. This script
applies a HARD threshold — anything with min(rgb) <= 8 becomes
fully transparent; anything brighter becomes fully opaque. Result:
clean edges with no halo, transparent background, opaque interior.

Also offers `--regen` to re-run fal.ai nano-banana-2 with a tighter
prompt for sprites that came out wrong (e.g. cloth_band rendering
as a motorcycle helmet).
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
OPENCLAW = "/home/josh/.npm-global/bin/openclaw"
MODEL = "fal/fal-ai/nano-banana-2"
RAW_DIR = Path("/home/josh/.local/share/fitquest-sprites/items")
WEB_ITEMS = REPO / "web/public/sprites/items"
WEB_GEAR = REPO / "web/public/sprites/gear"

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

# Sprite cleanup specs. Each entry has:
#   kind: 'shared' | 'item'
#   path: source path under web/public/sprites/
#   raw: optional path to a fal raw image to use for re-clean
#   regen: dict {prompt: ...} to call fal and replace the source
#   class: (optional) for prompt color
#   slot: for prompt
#   name: for prompt

SPECS = [
    # 12 dirty-alpha sprites in the reprocess list
    ("walking_cane",       dict(kind="shared", path="gear/weapons/oracle.png",     raw="weapons/processed/o.png", slot="MAIN",  name="Walking Cane",       cls="ORACLE")),
    ("twin_daggers",       dict(kind="shared", path="gear/weapons/phantom.png",    raw="weapons/processed/p.png", slot="MAIN",  name="Twin Daggers",       cls="PHANTOM")),
    ("fang_necklace",      dict(kind="shared", path="gear/neck/berserker.png",     raw="neck/processed/b.png",    slot="NECK",  name="Fang Necklace",      cls="BERSERKER")),
    ("hammered_iron_band", dict(kind="shared", path="gear/ring/berserker.png",     raw="ring/processed/b.png",    slot="RING",  name="Hammered Iron Band", cls="BERSERKER")),
    ("iron_torque",        dict(kind="shared", path="gear/neck/juggernaut.png",    raw="neck/processed/j.png",    slot="NECK",  name="Iron Torque",        cls="JUGGERNAUT")),
    ("leather_strap",      dict(kind="shared", path="gear/neck/scout.png",         raw="neck/processed/s.png",    slot="NECK",  name="Leather Strap",      cls="SCOUT")),
    ("iron_signet",        dict(kind="shared", path="gear/ring/juggernaut.png",    raw="ring/processed/j.png",    slot="RING",  name="Iron Signet",        cls="JUGGERNAUT")),
    ("mind_circlet",       dict(kind="shared", path="gear/head/oracle.png",        raw="head/processed/o.png",    slot="HEAD",  name="Mind Circlet",       cls="ORACLE")),
    ("prayer_beads",       dict(kind="shared", path="gear/neck/oracle.png",        raw="neck/processed/o.png",    slot="NECK",  name="Prayer Beads",       cls="ORACLE")),
    ("quartz_ring",        dict(kind="shared", path="gear/ring/oracle.png",        raw="ring/processed/o.png",    slot="RING",  name="Quartz Ring",        cls="ORACLE")),
    ("ring_of_focus",      dict(kind="item",   path="items/ring_focus.png",        raw=None,                     slot="RING",  name="Ring of Focus",      cls="ORACLE")),
    ("silver_band",        dict(kind="shared", path="gear/ring/phantom.png",       raw="ring/processed/p.png",    slot="RING",  name="Silver Band",        cls="PHANTOM")),
]

# Cloth band is the redo-completely case. It's a per-item sprite.
REDO = [
    ("head_healer_1", dict(slot="HEAD",  name="Cloth Band",   cls="ORACLE",
                            description="a simple linen cloth band wrapped once around the brow, knotted at the side, no metal, no visor, no padding — just a flat strip of pale linen fabric with a small visible knot")),
]

def hard_clean(img):
    """Hard-threshold alpha: min(rgb) > 8 → opaque, else transparent."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue  # already transparent
            brightness = min(r, g, b)
            if brightness > 8:
                px[x, y] = (r, g, b, 255)
            else:
                px[x, y] = (0, 0, 0, 0)

def regen_prompt(spec):
    """Build a fal prompt from a spec."""
    cls = spec["cls"]
    color = CLASS_HEX.get(cls, "14d6e8")
    slot = spec["slot"]
    name = spec["name"]
    desc = spec.get("description", f"{name} — a clearly recognisable single piece of {slot} equipment")
    return (
        f"Single piece of {slot.lower()} equipment, isolated on transparent background. "
        f"Tron cyberpunk hologram style. {desc}. "
        f"ONLY use these colors: background=transparent, fill=#1c1d2b shadow, "
        f"#5c5d75 midtone, #d8d9e8 highlight, #14d6e8 cyan accent. "
        f"Outline 2px in class color #{color}, closed and unbroken. "
        f"Negative space dominant. Recognisable at 16x16. "
        f"1024x1024 px square canvas, transparent background PNG. "
        f"No watermarks, no text, no border, no frame. "
        f"No realistic skin, no character, no person. "
        f"Single object, centered."
    )

def gen_one(item_id, prompt):
    out_prefix = RAW_DIR / item_id
    cmd = [
        OPENCLAW, "capability", "image", "generate",
        "--model", MODEL,
        "--prompt", prompt,
        "--aspect-ratio", "1:1",
        "--count", "1",
        "--output", str(out_prefix),
        "--timeout-ms", "90000",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    png = out_prefix.with_suffix(".png")
    return png if png.exists() else None

def post_process(raw_path, dst_path):
    """Clean a raw sprite PNG: rembg background removal, hard alpha
    threshold (no halo), downscale to 64x64, hard threshold again
    after resampling."""
    import rembg
    img = Image.open(raw_path).convert("RGBA")
    # rembg first — fal-generated PNGs often have alpha=255 with a
    # near-white background that hard_clean alone can't strip.
    img = rembg.remove(img)
    hard_clean(img)
    mid = img.resize((256, 256), Image.LANCZOS)
    final = mid.resize((64, 64), Image.LANCZOS)
    # Resampling introduces sub-pixel alpha values. Apply the hard
    # threshold a second time AFTER downscale so the final pixels
    # are 0 or 255 only.
    hard_clean(final)
    final.save(dst_path, "PNG", optimize=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--clean-only", action="store_true", help="only re-clean existing PNGs, no regeneration")
    args = p.parse_args()

    print("=== Reprocessing the 12 dirty-alpha sprites ===")
    for item_id, spec in SPECS:
        web_path = REPO / "web/public/sprites" / spec["path"]
        # For shared items, the raw source is in
        # ~/.local/share/fitquest-sprites/gear/<spec.raw>
        if spec["kind"] == "shared":
            raw_path = Path("/home/josh/.local/share/fitquest-sprites/gear") / spec["raw"]
        else:
            raw_path = RAW_DIR / f"{item_id}.png"
        if not raw_path.exists():
            print(f"  [skip] {item_id}: raw not found at {raw_path}")
            continue
        try:
            post_process(raw_path, web_path)
            sz = web_path.stat().st_size // 1024
            print(f"  [clean] {item_id:25s} → {web_path.relative_to(REPO)} ({sz} KB)")
        except Exception as e:
            print(f"  [err ] {item_id}: {e}")

    if args.clean_only:
        return

    print("\n=== Redoing cloth_band (was rendering as motorcycle helmet) ===")
    for item_id, spec in REDO:
        prompt = regen_prompt(spec)
        print(f"  [gen ] {item_id} ...", end="", flush=True)
        raw = gen_one(item_id, prompt)
        if not raw:
            print("FAILED")
            continue
        dst = REPO / "web/public/sprites/items" / f"{item_id}.png"
        post_process(raw, dst)
        print(f"ok ({dst.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()