# Sprite cleanup pass comparison

Side-by-side comparison of 8 different sprite post-processing
pipelines, run on `armor_warrior_1` (Bronze Cuirass) and
`ring_iron_band` (Iron Band). Each pass produces one 64x64 PNG per
sprite, named `<id>-<pass>.png`.

## Passes

| Pass | Model | Post-processing | Notes |
|---|---|---|---|
| `rembg-u2net-soft` | u2net | pass-through alpha | smooth gradient edges, halo on most sprites |
| `rembg-u2net-hard` | u2net | `min(rgb)>8 → opaque` | hard cutout, clean binary alpha |
| `rembg-isnet-soft` | isnet-general-use | pass-through alpha | smoother than u2net on complex shapes |
| `rembg-isnet-hard` | isnet-general-use | `min(rgb)>8 → opaque` | hard cutout, often the cleanest |
| `rembg-birefnet-hard` | birefnet-general | `min(rgb)>8 → opaque` | newest model, best for fine detail |
| `rembg-silueta-soft` | silueta | pass-through alpha | optimised for clean line art |
| `chroma-dark` | (u2net) | detect dark bg, hard threshold | only works when fal renders on dark bg |
| `chroma-light` | (u2net) | detect light bg, hard threshold | only works when fal renders on light bg |

## Viewing

* Open `_contact_sheet.png` for a stacked view (8 rows × 2 columns).
* Or open the individual `*-<pass>.png` files in any image viewer.

## Picking a winner

Compare passes on both sprites. Things to look for:

- **Edge crispness** — sharp vs soft boundaries
- **Detail preservation** — small features (rivets, knot ends, gem
  highlights) should survive, not get clipped by threshold
- **Color fidelity** — the class outline color should stay pure
  (no leftover white halo)
- **Internal contrast** — should the inside of the bronze cuirass
  have shading or stay flat?

Once you've decided, run the winning pass on all 91 sprites:

```bash
python3 scripts/applyPassToAll.py --pass <winner>
```

(That script gets written once you pick.)
