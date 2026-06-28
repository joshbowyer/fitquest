# Per-item sprite pipeline

Every catalog item (`api/src/lib/seedItems.ts`) gets its own unique
64×64 PNG at `web/public/sprites/items/<id>.png`. The pipeline:

1. **Seed** defines the catalog — 91 items (45 Tron-set + 46 legacy),
   each with `sprite: 'items/<id>.png'`.
2. **Manifest** (`web/public/sprites/items/MANIFEST.json`) is a
   generated JSON file listing every item + its prompt seed for
   image generation. Regenerate it whenever the seed changes:
   ```
   npm run sprites:manifest
   ```
3. **Generator** (your GitHub Action) reads `MANIFEST.json`,
   iterates each entry, calls the image model with `prompt`, and
   drops the PNG at the `sprite` path. One PNG per item = 91 PNGs
   total in `web/public/sprites/items/`.
4. **Runtime** — the inventory page reads `ItemDef.sprite` from the
   DB and renders `/sprites/<sprite>`. After deploy the seed's
   `upsert.update` block rewrites every row's sprite column to
   `items/<id>.png`, so the catalog immediately points at the new
   per-item PNGs.

## Why per-item

The previous convention used one PNG per (class × slot) — 45
sprites total. That left 19 sprites shared by 2+ items, so the
catalog showed the same icon for e.g. Iron Shortsword, Steel
Longsword, Meteoric Greatsword, and War Hammer (all juggernaut
weapons). With per-item sprites every item reads as itself at
32×32: name, hook phrase, class color, rarity border all vary.

## Adding a new item

1. Add the row to `api/src/lib/seedItems.ts` with `sprite:
   itemSprite('<id>')`.
2. (Optional) Add a custom visual hook to
   `ITEM_VISUAL_HOOK` in `scripts/buildSpriteManifest.ts`. Without
   a hook, the prompt will fall back to a generic slot description
   + the item name; you'll get a unique icon but it may not
   differentiate well from neighbours in the same slot.
3. Run `npm run sprites:manifest` to refresh
   `MANIFEST.json` with the new entry.
4. Run the GH Action to generate the new PNG.
5. Ship via the normal deploy flow — the seed upsert picks up the
   new row + new sprite path on the next boot.

## Prompt conventions

Each `prompt` field in MANIFEST.json is built from:
- **Name** — so each item reads as itself (e.g. "Bronze Cuirass"
  gets hammered bronze texture, "Iron Cuirass" gets dark iron
  bands, "Steel Cuirass" gets polished layered plates).
- **Visual hook** from `ITEM_VISUAL_HOOK` — one-line description
  of what makes this specific item recognisable (e.g. "a single
  chest emblem and broad shoulders", "a heavy sabaton with
  overlapping plate bands").
- **Slot + class color + rarity border** — anchors the sprite to
  the broader Tron palette without each item drifting off-style.
- **Fixed Tron boilerplate** — flat vector, 64×64 transparent
  background, 2px outline, palette anchors from
  `SPRITE_ART_BRIEF.md` §1.

See `SPRITE_ART_BRIEF.md` at the repo root for the full visual
spec.
