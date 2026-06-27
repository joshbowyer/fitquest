# FitQuest Sprite Art Brief

A reference document for commissioning or AI-generating the sprites that
replace the current Habitica-sourced set. Optimised for **batch generation
+ manual curation**: write a tight prompt, generate 8–16 variants per slot,
pick the best, normalise into the file-naming scheme below.

The brief is deliberately concrete (hex values, pixel ratios, file paths)
so the same input produces the same output across tools and sessions.

---

## 1. Visual identity

### Mood
- **Tron / cyberpunk hologram** — the user is a digital avatar rendered as
  glowing line art over a dark substrate. Think *Tron Legacy* UI + the
  character select screens of a 90s arcade fighter, but flat-shaded.
- **NO pixel art** unless explicitly listed. Raster output should look
  like clean vector at any scale. The current 32×32 PNGs are a
  holdover — the goal is 128×128 or 256×256 vector-first assets.
- **NO realism.** No skin texture, no realistic proportions, no faces
  beyond a stylised "Tron identity disc" silhouette. Recognise a class
  by silhouette + accent colour, not by face.

### Output format
- **Vector primary**: SVG (single file, no embedded raster, no external
  fonts). Used by `BodyModel`, `EquippedAvatar`, `SpriteAvatar`.
- **Raster fallback**: 256×256 PNG with transparent background. Used
  where the avatar must composite over a body (the class column on
  `/quest`, the 3D body hologram).
- Two silhouettes per asset (idle + attack). Damage states are
  re-coloured (more red) rather than redrawn.

### Palette anchors
Every asset must use **only** these colours. The full class + world
+ item-rarity palettes are all derivable from these.

| Anchor | Hex | Use |
|---|---|---|
| `--ink-900` | `#0a0a0f` | background fill / outline |
| `--ink-700` | `#1c1d2b` | shadow / recessed shapes |
| `--ink-400` | `#5c5d75` | midtone metal / cloth |
| `--ink-100` | `#d8d9e8` | highlight / chrome |
| `--neon-cyan` | `#14d6e8` | UI accent, default glow |
| `--neon-lime` | `#9bff5c` | success / positive |
| `--neon-amber` | `#ffc34d` | warning / gold |
| `--neon-magenta` | `#f55cc4` | crit / danger |
| `--neon-red` | `#ff5c5c` | damage / blood |

Class-specific colours are full-saturation, **never pastel** — neon
that reads cleanly on `#0a0a0f`. Outline width = 2 px @ 256×256.

### Silhouette rules
The class must be readable in 3 frames at 64×64. Concretely:

- **Negative space is more important than detail.** Heavy shapes, lots
  of empty interior.
- **One signature silhouette per class** (see §2). If you can't tell
  the class from the silhouette, redraw.
- **Outline must be closed.** A 2-px unbroken stroke around the whole
  figure, even if the figure is asymmetric.
- **No internal detail smaller than 8×8 px at 256×256** — anything
  smaller disappears at avatar size on the quest overworld.

### Animation states
- `idle` — gentle bob (4 px vertical, 1.5 s loop). Hands rest on
  weapon hilt. This is the **default** sprite.
- `attack` — 3-frame slash / thrust / pose, played once on a damage
  event. Total duration ≤ 600 ms. Returns to `idle`.
- `wounded` — same silhouette as `idle`, recoloured so the body and
  gear show ≥ 30 % red. Triggered when HP < 30 %.
- `victory` — optional, same silhouette with arms raised 8 px.

Naming: `<class>-<state>.svg` and `<class>-<state>.png`. E.g.
`juggernaut-idle.png`. Bosses use `<world>-<state>.png`.

---

## 2. Class specs

The 6 classes are listed in the order they appear on the class
selector. Each block has the colour, the **signature silhouette**
(one-line test), the gear defaults, and an AI-prompt seed.

### JUGGERNAUT (`#dc2626` red)
- **Silhouette**: front-facing wide stance, broad shoulders 2× head
  width, kettlebell / barbell in both hands at hip height.
- **Vibe**: powerlifter. Square jaw, short hair or helmet, no cape.
- **Default gear**: broad shoulder plate, heavy gloves, weighted boots.
- **Animation signature**: idle = flex between reps; attack = deadlift
  pull from the floor.
- **AI prompt seed**:
  > Flat vector character, Tron-style, glowing red outline, no face
  > details, bodybuilder silhouette with barbell in both hands,
  > 256×256 transparent background, single pose.

### PHANTOM (`#9bff5c` lime)
- **Silhouette**: narrow torso, long arms, finger-tips at knee
  height. Caped (short cape, ends at mid-thigh).
- **Vibe**: gymnast / ninja. Hood up, mask covering lower face.
- **Default gear**: hood + half-mask, fingerless gloves, tabi boots.
- **Animation signature**: idle = subtle hover (1 px vertical); attack
  = two-fingered thrust from hip.
- **AI prompt seed**:
  > Flat vector character, Tron-style, glowing lime outline, slimmer
  > build than juggernaut, hooded, short cape, two daggers held
  > low, 256×256 transparent background.

### SCOUT (`#ffc34d` goldenrod)
- **Silhouette**: mid-height, mid-width, walking stick in one hand,
  satchel over opposite shoulder. Capeless. Hair tied back.
- **Vibe**: ranger. Leather, no metal, lots of pockets.
- **Default gear**: wide-brim hat, satchel, trail boots.
- **Animation signature**: idle = one foot forward, slight sway; attack
  = overhead swing with the walking stick.
- **AI prompt seed**:
  > Flat vector character, Tron-style, goldenrod outline, mid-build,
  > ranger silhouette with walking stick and satchel, 256×256
  > transparent background, single pose.

### BERSERKER (`#f55cc4` magenta)
- **Silhouette**: very wide, low crouch, dual axes (one raised, one
  at hip). Bare chest, lots of scars (drawn as 2-px red lines).
- **Vibe**: barbarian. Wild hair or topknot, no shirt, ragged belt.
- **Default gear**: shoulder spikes, wrist guards, no boots (bare
  feet or wrappings only).
- **Animation signature**: idle = head-shake between breaths;
  attack = overhead double-axe slam.
- **AI prompt seed**:
  > Flat vector character, Tron-style, magenta outline, stocky crouch
  > silhouette, dual axes, no shirt, wild hair, 256×256 transparent
  > background, single pose.

### TRACER (`#ff8c00` orange)
- **Silhouette**: tall, lean, slight forward lean (always mid-stride).
  Single short blade held in reverse grip at hip. Bandana or short
  ponytail.
- **Vibe**: sprinter / duelist. Tight clothing, exposed calves, lots
  of speed lines.
- **Default gear**: bandana, sleeveless top, light boots.
- **Animation signature**: idle = continuous lean; attack = forward
  thrust / lunge.
- **AI prompt seed**:
  > Flat vector character, Tron-style, orange outline, tall lean
  > silhouette, forward lean as if running, short blade in reverse
  > grip, 256×256 transparent background, single pose.

### ORACLE (`#7d7bff` periwinkle)
- **Silhouette**: tallest, thinnest, flowing robes that pool at the
  feet. Hands held forward, palms up, holding a glowing orb.
- **Vibe**: monk / mystic. Smooth bald head, serene posture.
- **Default gear**: robes, prayer beads, no visible weapon.
- **Animation signature**: idle = orb pulses on a 1.2 s cycle; attack
  = both hands extend, orb launches forward.
- **AI prompt seed**:
  > Flat vector character, Tron-style, periwinkle outline, tall
  > robed silhouette, hands held forward holding a glowing orb,
  > 256×256 transparent background, single pose.

---

## 3. World boss specs

Each boss unlocks when the player clears all 5 levels in a world.
The boss card on `/quest/:worldId` shows the boss glyph; this brief
specifies the **full-body** portrait used on the boss fight scene
+ the unlock modal.

Bosses should look like a **twisted version of the world theme**:
- `spire` — Stone Titan (Golem, slab body, cracks glowing red)
- `glade` — The Old Shade (hollow face, root tendrils)
- `citadel` — Iron Sentinel (knight in scorched plate)
- `sanctum` — Mind Pact boss (lanky figure with too many arms)
- `longpath` — A wandering boss (wanderer with a staff)
- `crossroads` — The Eidolon (faceless, multi-coloured, the user's mirror)
- `gap` — The Stride (impossibly tall sprinter silhouette)

Boss rules:
- 256×256, full body centred, 10 % padding.
- Glyph (in `world.boss.glyph`) **must** be present in the portrait
  somewhere visible (chest emblem, weapon, or floating above head).
- Colour = world colour (`WORLD_COLOR_HEX[worldColor]`).
- HP bar should not be drawn; that's a UI overlay, not part of the
  sprite.
- One pose (no idle/attack) — bosses don't move on the fight
  screen, they react to damage via a red flash (CSS only).

AI prompt seed for any boss:
> Flat vector boss portrait, Tron-style, glowing `<colour>` outline,
> 256×256 transparent background, imposing silhouette with the glyph
> `<glyph>` visible on chest or weapon. No background.

---

## 4. Gear slot specs

The Inventory system (8 slots) uses a `slot`-tagged PNG icon. All
gear icons are 64×64 PNG, transparent background, single object
centred. Outline 2 px, fills from the rarity palette.

### Slots
| Slot | Anchor | Renders as |
|---|---|---|
| `HEAD` | top-centre, sits on avatar's head | helmet, hood, hat |
| `BODY` | torso | shirt, armor, robe |
| `HANDS` | hands / forearms | gloves, gauntlets |
| `FEET` | below torso | boots, shoes |
| `MAIN` | right hand | weapon |
| `OFF` | left hand | shield, off-hand weapon |
| `NECK` | neck | amulet, pendant |
| `RING` | one finger | ring, trinket |

### Rarity palette (icon border + inner glow)
| Rarity | Border hex | Inner glow hex |
|---|---|---|
| `COMMON` | `#94a3b8` | none |
| `UNCOMMON` | `#9bff5c` | `#9bff5c33` |
| `RARE` | `#14d6e8` | `#14d6e833` |
| `EPIC` | `#f55cc4` | `#f55cc433` |
| `LEGENDARY` | `#ffc34d` | `#ffc34d33` |
| `MYTHIC` | `#ff2bd6` | `#ff2bd633` |

### File paths (current convention)
- `web/public/sprites/head/<id>.png` — 64×64
- `web/public/sprites/shirts/<id>.png` — 64×64
- `web/public/sprites/armor/<id>.png` — 64×64
- `web/public/sprites/weapon/<id>.png` — 64×64
- `web/public/sprites/shield/<id>.png` — 64×64
- `web/public/sprites/neck/<id>.png` — 64×64
- `web/public/sprites/ring/<id>.png` — 64×64

Item id naming: `<class>-<slot>-<tier>` e.g. `phantom-head-1`,
`juggernaut-main-3`. Freeform suffix for unique items.

AI prompt seed for any gear icon:
> Flat vector icon, 64×64, Tron-style, `<rarity border colour>`
> outline 2 px, isolated object (no background), single piece of
> `<slot>` equipment, recognisable silhouette at 32×32.

---

## 5. AI generation workflow

### Recommended pipeline
1. **Batch generate**: produce 8–16 variants per slot per tier in
   one pass. Don't try to be perfect on the first try.
2. **Curate**: pick the 1–2 best from each batch. The criteria:
   - Silhouette readable at 32×32
   - Palette adheres to §1
   - No accidental extra elements (faces, text, etc.)
3. **Normalise**: re-export through SVG optimiser (svgo) or
   re-rasterise PNGs at 64×64 / 256×256 with the correct transparent
   background.
4. **Place in the right directory** with the right id (see §4).
5. **Wire via Inventory** — add a row in the seed that references
   the new item def. Existing `ItemDef` schema covers it.

### Model settings that worked in testing
- Resolution: 1024×1024 native, downscale to 64×64 / 256×256.
- Style reference: paste an existing class sprite + the palette
  table from §1 as the first thing the model sees.
- Negative prompt: `face, photo, realistic, background, frame,
  border, watermark, text, blurry`.
- Variation: prompt the same seed 3–4× with slight wording
  changes, then pick the strongest silhouette.

### How to extend the brief
- New class? Add a row to §2 + a row to `CLASS_META` in
  `web/src/lib/types.ts` + an entry in `WorldAffiliation`.
- New gear slot? Add a row to §4 + a value to the `EquipSlot` enum
  in `api/prisma/schema.prisma`.
- New world? Add a row to §3 + an entry in `WORLDS` in
  `api/src/lib/worlds.ts`.
- New rarity? Add a row to §4 palette + an entry in the `ItemRarity`
  enum in `api/prisma/schema.prisma`.

---

## 6. Acceptance criteria

A sprite is "done" when:
- [ ] Matches the silhouette test in §2 (or whatever the new slot's test is)
- [ ] Uses **only** colours from §1
- [ ] Outline is 2 px, closed, single stroke
- [ ] No element smaller than 8×8 px at 256×256
- [ ] Reads correctly at 32×32, 64×64, 128×128, 256×256
- [ ] Background is fully transparent
- [ ] Idle + attack variants match the pose described
- [ ] Damage flash (recolour to 30 % red) is visible on the
      wounded variant

A gear icon is "done" when:
- [ ] Recognisable at 16×16 (icon size in inventory list)
- [ ] Rarity border + glow correct
- [ ] Same outline width + palette as character sprites
