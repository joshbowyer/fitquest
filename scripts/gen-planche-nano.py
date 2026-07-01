#!/usr/bin/env python3
"""Generate planche icons via fal.ai nano-banana-2.

Uses the same model the existing sprite scripts use (fal/fal-ai/
nano-banana-2) but with a prompt targeting flat human silhouettes
+ neon strokes + class-color tint. nano-banana-2 is much better
at clean linework than FLUX schnell (which gave us 'cand 0-2 look
horrifying, cand 3 looks decent' — FLUX's linework is too thin
and noisy).

Style target (matching the user's spec):
  - Flat human silhouettes (single solid fill, no gradients)
  - Neon glowing strokes around them
  - Class-color tint (PHANTOM = lime #56e88e; pass via tint arg)
  - Movement-specific props visible (planche: arms DOWN, body
    horizontal, hands on ground — NO bar above)
  - Transparent background
  - 512x512 PNG

This script generates 4 candidates with nano-banana-2 and saves
the best 4 to /tmp/planche-nano-candidates/ + writes the
highest-quality one to web/public/icons/calitree/planche.png.

Key is read from ~/.config/fal/key (not in any git repo).
"""
import json
import shutil
import sys
import urllib.request
import urllib.error
from pathlib import Path

KEY_FILE = Path.home() / ".config" / "fal" / "key"
OUT_PNG = Path("web/public/icons/calitree/planche.png")
CAND_DIR = Path("/tmp/planche-nano-candidates")

# ---- 1. read key ----
key_line = None
for raw in KEY_FILE.read_text().splitlines():
    line = raw.strip()
    if line.startswith("fal:default:"):
        key_line = line.split(":", 2)[2].strip()
        break
if not key_line:
    print(f"!! Could not parse key from {KEY_FILE}", file=sys.stderr)
    sys.exit(1)
print(f"key: {key_line[:16]}...{key_line[-8:]}")

# ---- 2. prompt ----
# We render the silhouette WITHOUT a stroke. The stroke + glow are
# applied at render time via CSS (mask-image + drop-shadow filter),
# so the PNG is just a shape file and CSS controls all visual
# treatment. This means the same PNG can render neon-lime for
# PHANTOM, neon-amber for god-tier, gray for locked, etc. — no
# per-state PNG regeneration needed.
PHANTOM_HEX = "#56e88e"   # class color (lime) — used as FILL only, no stroke

PROMPT = f"""Minimalist icon: a single person doing a full PLANCHE (calisthenics
skill, the move where the body is held horizontally face-down, supported
ONLY by the hands below on the ground — NO bar above, NO rope above, the
body is NOT hanging from anything, it is fully supported by the hands
pushing into the ground).

Pose requirements:
  - Person face-down, body parallel to the ground, fully extended
  - ARMS REACHING STRAIGHT DOWN from the shoulders to the hands on the ground
    (this is the defining planche feature — arms go DOWN, not UP)
  - Hands planted on the ground directly below the shoulders
  - Head at the front end of the body, feet pointing back
  - NO bar above (front lever has a bar — planche does NOT)
  - No floor stripes, no background scenery, no equipment

Visual style — match this EXACTLY:
  - Flat human silhouette filled with a single solid color: {PHANTOM_HEX}
  - NO outline, NO stroke, NO border around the silhouette. Just the
    solid filled shape on transparent background. (Stroke + glow are
    applied separately at render time via CSS, so the PNG itself
    should be stroke-free.)
  - Transparent background
  - 512x512 square canvas
  - No shading inside the silhouette, no gradient, no highlights
  - No texture, no inner linework, no facial features
  - Clean vector-style icon — should look like a hand-drawn emblem,
    not a photograph and not a 3D render

Single icon only. No text, no border, no frame, no watermark, no
realistic anatomy detail (no face features, no muscle definition,
no fingers). The body should read as a clean shape at small sizes
(down to 24x24 pixels)."""

# ---- 3. submit to fal-ai/nano-banana-2 ----
# nano-banana-2 is a google model hosted on fal. Endpoint:
#   POST https://fal.run/fal-ai/nano-banana-2
# Body schema (per fal docs): { prompt, num_images, image_size, ... }
print("submitting to fal-ai/nano-banana-2 (4 candidates)...")
req = urllib.request.Request(
    "https://fal.run/fal-ai/nano-banana-2",
    method="POST",
    headers={
        "Authorization": f"Key {key_line}",
        "Content-Type": "application/json",
    },
    data=json.dumps({
        "prompt": PROMPT,
        "num_images": 4,
        "image_size": "square_hd",   # 1024x1024 raw, we downscale to 512
    }).encode("utf-8"),
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        result = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print(f"!! fal.ai HTTP error: {e.code} {e.reason}", file=sys.stderr)
    print(e.read().decode("utf-8"), file=sys.stderr)
    sys.exit(2)

images = result.get("images") or []
print(f"got {len(images)} candidates")
if not images:
    print(f"!! no images in response: {json.dumps(result)[:500]}", file=sys.stderr)
    sys.exit(3)

# ---- 4. download + post-process each ----
try:
    from rembg import remove as rembg_remove  # type: ignore
    HAS_REMBG = True
except ImportError:
    HAS_REMBG = False
print(f"rembg available: {HAS_REMBG}")

from PIL import Image

def post_process(raw_path: Path, dst_path: Path) -> bool:
    """rembg → hard alpha threshold → downscale to 512 → re-threshold."""
    img = Image.open(raw_path).convert("RGBA")
    if HAS_REMBG:
        img = rembg_remove(img)
    # hard alpha threshold (kill the gray halo rembg leaves)
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if min(r, g, b) <= 8:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)
    # downscale to 512 (calitree's standard icon size)
    final = img.resize((512, 512), Image.LANCZOS)
    px2 = final.load()
    w2, h2 = final.size
    for y in range(h2):
        for x in range(w2):
            r, g, b, a = px2[x, y]
            if a == 0:
                continue
            if min(r, g, b) <= 8:
                px2[x, y] = (0, 0, 0, 0)
            else:
                px2[x, y] = (r, g, b, 255)
    final.save(dst_path, "PNG", optimize=True)
    return True

CAND_DIR.mkdir(parents=True, exist_ok=True)
# Clean old candidates
for old in CAND_DIR.glob("*.png"):
    old.unlink()

results = []
for i, img in enumerate(images):
    raw_url = img.get("url") if isinstance(img, dict) else img
    if not raw_url:
        continue
    tmp = Path(f"/tmp/planche-nano-{i}.png")
    try:
        urllib.request.urlretrieve(raw_url, tmp)
    except Exception as e:
        print(f"  [err ] candidate {i}: download: {e}")
        continue
    cand = CAND_DIR / f"planche-nano-{i}.png"
    try:
        post_process(tmp, cand)
    except Exception as e:
        print(f"  [err ] candidate {i}: post-process: {e}")
        continue
    sz = cand.stat().st_size
    # quick opaque-pixel count for ranking
    pim = Image.open(cand).convert("RGBA")
    n_opaque = sum(1 for px in pim.getdata() if px[3] > 0)
    print(f"  [cand {i}] {sz//1024} KB, {n_opaque} opaque px → {cand}")
    results.append((n_opaque, cand))

if not results:
    print("!! no candidates successfully generated", file=sys.stderr)
    sys.exit(4)

# Pick the highest-opacity candidate as the new planche.png
# (most opaque = most visible silhouette after alpha cleanup).
results.sort(key=lambda r: r[0], reverse=True)
best = results[0][1]
OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(best, OUT_PNG)
print(f"\n✓ wrote {OUT_PNG} (best: {best.name})")
print(f"  other candidates in {CAND_DIR}/")
print(f"  swap command: cp {CAND_DIR}/planche-nano-N.png {OUT_PNG}")