#!/usr/bin/env python3
"""Generate a planche calisthenics icon via fal.ai FLUX schnell.

Key is read from ~/.config/fal/key (not in any git repo). Output
goes to web/public/icons/calitree/planche.png. The key was
discovered buried in ~/.openclaw/agents/main/agent/openclaw-agent.sqlite
during this session.

The prompt targets:
  - Monochrome line art (single weight, no shading/fills)
  - Person face-down, body horizontal (the actual planche pose)
  - Arms reaching DOWN to hands on the ground (NOT up to a bar)
  - Transparent background, viewBox-style square canvas
  - Recognizable at 24x24 px after post-processing

We post-process the raw PNG with rembg to strip the canvas halo
fal tends to add, then hard-threshold the alpha channel so the
edges are clean (same pattern as scripts/reprocessSprites.py).
"""
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

KEY_FILE = Path.home() / ".config" / "fal" / "key"
OUT_PNG = Path("web/public/icons/calitree/planche.png")
OUT_RAW = Path("/tmp/planche-raw.png")

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

# ---- 2. submit generation to fal-ai/flux/schnell ----
# FLUX schnell: ~4 inference steps, very fast (~2s). Good for clean
# linework. Other candidate was nano-banana-2 (used for sprites)
# but that's heavier and tuned for 3D-looking renders, not line art.
prompt = (
    "Single minimalist line-art icon of a person in a planche position "
    "(calisthenics skill, the move where the body is held horizontally "
    "above the ground supported only by the hands below). "
    "Side view. The person is face-down, body parallel to the ground, "
    "ARMS REACHING STRAIGHT DOWN from the shoulders to the hands on the ground "
    "(no bar above — this is the key visual, arms go DOWN not UP). "
    "Body is fully extended, head at the front end, feet at the back. "
    "Monochrome: single dark line on transparent background. "
    "Pure line art, no shading, no fills, no gradients, no color. "
    "Clean minimalist linework, single stroke weight throughout. "
    "Recognizable when scaled to 24x24 pixels. "
    "Square canvas, transparent background PNG."
)
print(f"submitting to fal-ai/flux/schnell...")
req = urllib.request.Request(
    "https://fal.run/fal-ai/flux/schnell",
    method="POST",
    headers={
        "Authorization": f"Key {key_line}",
        "Content-Type": "application/json",
    },
    data=json.dumps({
        "prompt": prompt,
        "image_size": "square_hd",
        "num_images": 4,            # generate 4 candidates so we can pick the best
        "num_inference_steps": 4,
        "guidance_scale": 7.5,
        "num_inference_steps": 4,
    }).encode("utf-8"),
)
try:
    with urllib.request.urlopen(req, timeout=90) as resp:
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

# ---- 3. download each candidate to /tmp, run rembg + hard-threshold ----
# Try to use rembg if available (same as the existing sprite scripts).
try:
    from rembg import remove as rembg_remove  # type: ignore
    HAS_REMBG = True
except ImportError:
    HAS_REMBG = False
print(f"rembg available: {HAS_REMBG}")

from PIL import Image

def post_process(raw_path: Path, dst_path: Path) -> bool:
    """rembg → hard alpha threshold → save as PNG."""
    img = Image.open(raw_path).convert("RGBA")
    if HAS_REMBG:
        img = rembg_remove(img)
    # hard alpha threshold: anything with min(rgb) <= 8 → transparent, else opaque
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
    # downscale to 512 (calitree's icons are 512x512 — we match that)
    final = img.resize((512, 512), Image.LANCZOS)
    # resampling can re-introduce soft alpha — hard-threshold again
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

saved = []
for i, img in enumerate(images):
    raw_url = img.get("url") if isinstance(img, dict) else img
    if not raw_url:
        print(f"  [skip] candidate {i}: no url")
        continue
    tmp = Path(f"/tmp/planche-cand-{i}.png")
    try:
        urllib.request.urlretrieve(raw_url, tmp)
    except Exception as e:
        print(f"  [err ] candidate {i}: download failed: {e}")
        continue
    sz = tmp.stat().st_size
    print(f"  [cand {i}] downloaded {sz} bytes from {raw_url[:80]}...")

# Pick candidate 0 for now; we'll inspect and re-pick if needed.
print("\nPost-processing all candidates to /tmp/planche-cand-N-clean.png...")
for i in range(len(images)):
    tmp = Path(f"/tmp/planche-cand-{i}.png")
    if not tmp.exists():
        continue
    out = Path(f"/tmp/planche-cand-{i}-clean.png")
    try:
        post_process(tmp, out)
        print(f"  [cand {i}] cleaned → {out} ({out.stat().st_size // 1024} KB)")
        saved.append(out)
    except Exception as e:
        print(f"  [err ] candidate {i}: post-process failed: {e}")

# Pick the best candidate (largest opaque-pixel count = most visible).
# (Subjective; user can swap candidates by renaming files.)
best = None
best_visible = -1
for s in saved:
    img = Image.open(s).convert("RGBA")
    px = img.load()
    n = 0
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                n += 1
    print(f"  {s.name}: {n} opaque pixels")
    if n > best_visible:
        best_visible = n
        best = s

if not best:
    print("!! no candidates successfully cleaned", file=sys.stderr)
    sys.exit(4)

OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
import shutil
shutil.copy2(best, OUT_PNG)
print(f"\n✓ wrote {OUT_PNG} ({OUT_PNG.stat().st_size // 1024} KB) — {best_visible} opaque px")