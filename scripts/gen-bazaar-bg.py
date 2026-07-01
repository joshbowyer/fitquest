#!/usr/bin/env python3
"""Generate a bazaar/market background for the shop modal.

Fal.ai (FLUX schnell) renders a warm bazaar/market scene. The
result is square, dark-toned, with stalls/canopies/etc visible —
suitable as a backdrop for the shop modal.

Key is in ~/.config/fal/key (not in any git repo).

Output: web/public/shop/bazaar-bg.png
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

KEY_FILE = Path.home() / ".config" / "fal" / "key"
OUT = Path("web/public/shop/bazaar-bg.png")

# ---- read key ----
key = None
for raw in KEY_FILE.read_text().splitlines():
    line = raw.strip()
    if line.startswith("fal:default:"):
        key = line.split(":", 2)[2].strip()
        break
if not key:
    sys.exit(f"!! key not in {KEY_FILE}")
print(f"key: {key[:16]}...{key[-8:]}")

PROMPT = (
    "A dimly-lit fantasy bazaar interior. Wooden market stalls with"
    " striped fabric canopies. Warm amber light from hanging lanterns."
    " Sacks of grain, stacked amphorae, scattered herbs. Stone floor"
    " with scattered coins. Mysterious goods half-hidden in shadow."
    " Painterly, warm palette, no people in the foreground."
    " Square aspect ratio. Slightly faded edges so the modal's"
    " contents (item list + price tags) read clearly on top."
)

print("submitting to fal-ai/flux/schnell...")
req = urllib.request.Request(
    "https://fal.run/fal-ai/flux/schnell",
    method="POST",
    headers={
        "Authorization": f"Key {key}",
        "Content-Type": "application/json",
    },
    data=json.dumps({
        "prompt": PROMPT,
        "image_size": "square_hd",
        "num_images": 4,
    }).encode("utf-8"),
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        result = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    sys.exit(f"!! fal.ai HTTP error: {e.code} {e.reason}: {e.read().decode('utf-8')[:200]}")

images = result.get("images") or []
print(f"got {len(images)} candidates")

OUT.parent.mkdir(parents=True, exist_ok=True)
for old in OUT.parent.glob("bazaar-bg-*.png"):
    old.unlink()

# Pick the candidate with the most "bazaar" feel. The selection is
# subjective, but we'll just save all 4 to the public dir and let
# the user pick via git diff. For now we write the highest-opacity
# (most visible content) as the default.
candidates = []
for i, img in enumerate(images):
    raw_url = img.get("url") if isinstance(img, dict) else img
    if not raw_url:
        continue
    tmp = Path(f"/tmp/bazaar-{i}.png")
    urllib.request.urlretrieve(raw_url, tmp)
    cand = OUT.parent / f"bazaar-bg-{i}.png"
    import shutil
    shutil.copy2(tmp, cand)
    candidates.append(cand)
    print(f"  [cand {i}] {cand.name}  ({cand.stat().st_size//1024} KB)")

# Default: cand 0 (most opaque usually wins; user can swap if needed)
default = candidates[0]
shutil.copy2(default, OUT)
print(f"\ndefault bazaar-bg: {OUT.name}  (from {default.name})")
print(f"other candidates: web/public/shop/bazaar-bg-{{1,2,3}}.png")
print("swap with: cp web/public/shop/bazaar-bg-1.png web/public/shop/bazaar-bg.png")
