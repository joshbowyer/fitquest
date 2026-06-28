/**
 * Build the sprite generation manifest from the seed catalog.
 *
 * Reads api/src/lib/seedItems.ts and writes
 * web/public/sprites/items/MANIFEST.json with one entry per item:
 *   {
 *     id, name, slot, rarity, classRestriction, color,
 *     sprite: "items/<id>.png",
 *     prompt: "<seed prompt derived from item name + slot + class + rarity>"
 *   }
 *
 * The sprite-generation GitHub Action reads MANIFEST.json, iterates
 * each entry, calls the image model with `prompt`, and drops the
 * resulting PNG at the `sprite` path. The manifest is the single
 * source of truth: regenerate it whenever the catalog changes
 * (`npm run sprites:manifest`).
 *
 * Prompt construction is name-driven so each item gets a unique
 * sprite. The base conventions come from SPRITE_ART_BRIEF.md
 * (Tron-style, flat vector, palette in §1, slot-by-slot silhouettes
 * in §2-§4).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type SeedItem = {
  id: string;
  name: string;
  description?: string;
  slot: string;
  sprite: string;
  color: string;
  rarity: string;
  stats: Record<string, number>;
  classRestriction?: string | null;
  setId?: string | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, '../api/src/lib/seedItems.ts');
const MANIFEST_PATH = resolve(__dirname, '../web/public/sprites/items/MANIFEST.json');

// ---- palette + class color helpers (mirror SPRITE_ART_BRIEF §1) ---

const CLASS_HEX: Record<string, string> = {
  JUGGERNAUT: '#dc2626',
  BERSERKER:  '#f55cc4',
  PHANTOM:    '#9bff5c',
  TRACER:     '#ff8c00',
  SCOUT:      '#ffc34d',
  ORACLE:     '#7d7bff',
};

const RARITY_BORDER: Record<string, string> = {
  COMMON:    '#94a3b8',
  UNCOMMON:  '#9bff5c',
  RARE:      '#14d6e8',
  EPIC:      '#f55cc4',
  LEGENDARY: '#ffc34d',
  MYTHIC:    '#ff2bd6',
};

const SLOT_NOUN: Record<string, string> = {
  HEAD:  'helmet or hood covering the top of the head',
  BODY:  'torso armor or robe',
  HANDS: 'glove or bracer covering the hand and forearm',
  FEET:  'boot or shoe covering the foot and ankle',
  MAIN:  'one-handed weapon held in the right hand',
  OFF:   'shield or off-hand weapon held in the left hand',
  NECK:  'amulet, pendant, or necklace worn around the neck',
  RING:  'ring worn on one finger',
};

// Per-item visual hooks: the prompt seed that makes THIS item
// recognisable from its name. Anything not listed here gets a
// generic slot description; the generator can still vary on class
// color + rarity glow.
const ITEM_VISUAL_HOOK: Record<string, string> = {
  // Tron baseline
  tron_juggernaut_head:  'a heavy iron crown with rivets and a flat top plate',
  tron_berserker_head:   'a ragged cloth headband with a topknot tie at the crown',
  tron_phantom_head:     'a deep cowl with a shadowed face opening, cloth draping over the shoulders',
  tron_tracer_head:      'a tight wind wrap / bandana with trailing fabric at the back',
  tron_scout_head:       'a wide-brim boonie hat with a chin strap',
  tron_oracle_head:      'a thin metallic circlet floating just above the brow with a small forehead gem',

  tron_juggernaut_body:  'a thick chest plate with a single chest emblem and broad shoulders',
  tron_berserker_body:   'a one-shoulder spiked pauldron over a bare chest wrap',
  tron_phantom_body:     'a diagonal cloth wrap from one shoulder across the torso',
  tron_tracer_body:      'a light sleeveless crop top with high collar',
  tron_scout_body:       'a quilted chest piece with horizontal stitching and small pockets',
  tron_oracle_body:      'folded layered robes hanging past the hips',

  tron_juggernaut_hands: 'massive forearm gauntlets with visible bolts at the wrist',
  tron_berserker_hands:  'studded leather bracers with exposed rivets',
  tron_phantom_hands:    'fingerless dark gloves with a torn cuff',
  tron_tracer_hands:     'a thin aerodynamic bracer with a single strap',
  tron_scout_hands:      'an archer bracer with a small side quiver loop',
  tron_oracle_hands:     'soft hand wraps that spiral up to mid-forearm',

  tron_juggernaut_feet:  'heavy sabatons with overlapping plate bands',
  tron_berserker_feet:   'cloth foot wraps with exposed toes',
  tron_phantom_feet:     'split-toe tabi boots with low profile',
  tron_tracer_feet:      'light minimalist boots with mesh side panels',
  tron_scout_feet:       'mid-height combat boots with a reinforced toe cap',
  tron_oracle_feet:      'open-toe sandals with thin ankle straps',

  tron_juggernaut_off:   'a tall rectangular tower shield with a centered emblem',
  tron_berserker_off:    'a round shield with two central impact dents',
  tron_scout_off:        'a small round buckler with a single hand grip',

  tron_juggernaut_neck:  'a thick iron torque with a squared clasp',
  tron_berserker_neck:   'a string of animal fangs threaded on a leather cord',
  tron_phantom_neck:     'a loose cloth scarf with frayed ends',
  tron_tracer_neck:      'a small aerodynamic speed charm on a thin chain',
  tron_scout_neck:       'a worn leather strap with a small buckle',
  tron_oracle_neck:      'a string of round prayer beads with one larger central bead',

  tron_juggernaut_ring:  'a flat iron signet with a square engraved face',
  tron_berserker_ring:   'a hammered iron band with visible texture',
  tron_phantom_ring:     'a smooth silver band with no engraving',
  tron_tracer_ring:      'a thin bronze band with a subtle ridge',
  tron_scout_ring:       'a carved wooden ring with a vine pattern',
  tron_oracle_ring:      'a quartz-set ring with a single small clear stone',

  tron_juggernaut_weapon: 'a large rectangular war hammer with a long haft and reinforced striking face',
  tron_berserker_weapon:  'a single-bladed battle axe with a thick wooden haft',
  tron_phantom_weapon:    'two slim daggers crossed at the hilt',
  tron_tracer_weapon:     'a short single-edged sword with a thin cross-guard',
  tron_scout_weapon:      'a recurve bow with a single strung arc',
  tron_oracle_weapon:     'a smooth floating orb suspended in a wire frame',

  // Legacy shirts (per-class COMMON)
  shirt_jugg_basic:       'a fitted sleeveless vest with vertical seams and small shoulder studs',
  shirt_phantom_basic:    'a moss-coloured cloth wrap with a leaf pattern',
  shirt_scout_basic:      'a dirt-stained tunic with rolled sleeves and small chest pockets',
  shirt_berserker_basic:  'a torn red-and-blue checkered tunic with frayed hems',
  shirt_tracer_basic:     'a white wrap top with breathable side panels',
  shirt_oracle_basic:     'a pale purple robe with a high cowl neck',
  shirt_starter_universal: 'a plain cyan cotton shirt with no decoration',

  // Legacy tiered armor
  armor_warrior_1: 'a bronze cuirass with a hammered metal texture and small chest emblem',
  armor_warrior_2: 'a dark iron cuirass with riveted bands and a cross-shaped chest emblem',
  armor_warrior_3: 'a polished steel cuirass with layered shoulder plates and a centre crest',
  armor_rogue_1:   'dark leather leathers with shadow stitching and a high collar',
  armor_rogue_2:   'a darker leather chest piece with whisper-line stitching and a soft hood',
  armor_healer_1:  'a natural linen wrap with simple folds and a rope belt',
  armor_healer_2:  'a pale silk wrap with flowing fabric and a thin silver belt',

  // Legacy tiered helms
  head_basic_hood:  'a simple traveller hood with a drawstring and a small front fold',
  head_warrior_1:   'a bronze open-faced helm with cheek guards',
  head_warrior_3:   'a steel helm with a full face guard and a single crest ridge',
  head_rogue_1:     'a shadow hood pulled low over the brow with a face shadow',
  head_rogue_3:     'a whisper cowl with layered cloth and a thin face veil',
  head_healer_1:    'a simple cloth band wrapped around the brow',
  head_healer_3:    'a mind circlet with a floating forehead gem and thin metal side arcs',

  // Legacy tiered weapons
  weapon_warrior_1:    'a straight iron shortsword with a simple cross-guard and leather grip',
  weapon_warrior_2:    'a longer steel longsword with a wrapped grip and a flat pommel',
  weapon_warrior_4:    'a massive greatsword with a meteoric pattern in the blade and a heavy pommel',
  weapon_rogue_0:      'two slim daggers with curved blades, crossed',
  weapon_rogue_2:      'two longer shadow daggers with hooked blades',
  weapon_healer_1:     'a simple wooden walking cane with a hooked handle',
  weapon_healer_3:     'a tall sagewood staff with a small gem at the top',
  weapon_burst_dagger: 'a slim stiletto with a lightning-shaped fuller down the blade',
  weapon_burst_axe:    'a hatchet with a storm-patterned blade and a single edge',

  // Legacy shields
  shield_warrior_1: 'a round wooden shield with a single iron boss at the centre',
  shield_warrior_3: 'a tall steel bulwark with layered plating and a central cross',
  shield_rogue_1:   'a small whisper-pattern buckler with a single hand strap',
  shield_healer_1:  'a leather-bound tome held closed with a single brass clasp',
  shield_healer_3:  'a large codex with two silver clasps and a centred healing sigil',

  // Legacy necks
  neck_bloodstone:             'a small bloodstone pendant on a thin chain',
  neck_amber:                  'a smooth amber teardrop pendant on a leather cord',
  neck_legendary_compass:      'a compass-shaped pendant with a glowing central needle',

  // Legacy rings
  ring_iron_band:    'a flat iron band with no ornamentation',
  ring_lucky:        'a small coin mounted in a ring setting',
  ring_focus:        'a thin band with a single inset gem',
  ring_mythic_blood: 'a heavy band carved with small angular runes',

  // Legacy hands
  hands_gauntlets_iron: 'simple iron forearm gauntlets with a wrist strap',
  hands_rogue_wraps:    'soft silent wraps with no metal pieces',

  // Legacy feet
  feet_traveler_boots: 'worn leather traveller boots with scuffed toes',
  feet_swift_boots:    'low-profile swift boots with thin laces',
};

/**
 * Compose a prompt for one item. The prompt is built from:
 *   - name  (so each item reads as itself, e.g. "Bronze Cuirass" vs "Iron Cuirass")
 *   - the per-item visual hook from ITEM_VISUAL_HOOK (or a generic slot fallback)
 *   - slot + class color + rarity glow (style + palette anchors)
 *   - the fixed Tron style boilerplate (flat vector, palette, transparency)
 */
function promptFor(item: SeedItem): string {
  const cls = item.classRestriction ?? 'universal';
  const clsColor = CLASS_HEX[cls] ?? '#14d6e8';
  const rarityBorder = RARITY_BORDER[item.rarity] ?? '#94a3b8';
  const slotNoun = SLOT_NOUN[item.slot] ?? 'object';
  const hook = ITEM_VISUAL_HOOK[item.id]
    ?? `${slotNoun} named "${item.name}"`;
  return [
    `Flat vector icon, Tron-style, ${item.rarity.toLowerCase()} rarity border ${rarityBorder},`,
    `${clsColor} outline 2px,`,
    `64x64 transparent background, single piece of ${item.slot.toLowerCase()} equipment,`,
    `${hook},`,
    `recognizable silhouette at 32x32,`,
    `isolated object with no background,`,
    `no face, no realistic detail, no text, no watermark,`,
    `palette anchored to neon cyan #14d6e8, neon lime #9bff5c, neon amber #ffc34d, neon magenta #f55cc4, neon red #ff5c5c on ink-900 #0a0a0f substrate.`,
  ].join(' ');
}

// ---- main: parse the seed file, build the manifest, write it ----

function parseSeed(): SeedItem[] {
  const src = readFileSync(SEED_PATH, 'utf8');
  // Each row is `{ id: '...', name: '...', slot: '...', sprite: itemSprite('...'), ...rarity..., ...classRestriction..., ...setId... }`.
  // We grab everything between the matching braces by scanning lines.
  const out: SeedItem[] = [];
  const lines = src.split('\n');
  let buf: string[] | null = null;
  let depth = 0;
  const flush = () => {
    if (!buf) return;
    const text = buf.join('\n');
    buf = null;
    // Parse the fields we care about with simple regexes. This is
    // tighter than eval and avoids pulling in a TS parser.
    const id = text.match(/id:\s*'([^']+)'/)?.[1];
    // Names are usually single-quoted but apostrophes inside the
    // name forced a couple of entries to switch to double quotes
    // (e.g. "Traveler's Hood"). Accept both, plus escaped
    // apostrophes inside single-quoted strings.
    const name =
      text.match(/name:\s*'((?:\\'|[^'])*?)',\s*slot:/)?.[1]?.replace(/\\'/g, "'")
      ?? text.match(/name:\s*"([^"]+)",\s*slot:/)?.[1];
    const slot = text.match(/slot:\s*'([^']+)'/)?.[1];
    const color = text.match(/color:\s*'([^']+)'/)?.[1];
    const rarity = text.match(/rarity:\s*'([^']+)'/)?.[1];
    const classRestriction = text.match(/classRestriction:\s*'([^']+)'/)?.[1]
      ?? (text.includes('classRestriction: null') ? null : undefined);
    const setId = text.match(/setId:\s*'([^']+)'/)?.[1]
      ?? (text.includes('setId: null') ? null : undefined);
    const sprite = text.match(/sprite:\s*itemSprite\('([^']+)'\)/)?.[1];
    if (!id || !name || !slot || !color || !rarity || !sprite) return;
    out.push({
      id, name, slot, color, rarity, sprite: `items/${sprite}.png`,
      stats: {},
      classRestriction: classRestriction ?? null,
      setId: setId ?? null,
    });
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!buf && trimmed.startsWith('{') && trimmed.includes("id:")) {
      buf = [line];
      depth = (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
      if (depth <= 0) { flush(); }
      continue;
    }
    if (buf) {
      buf.push(line);
      depth += (line.match(/{/g) ?? []).length;
      depth -= (line.match(/}/g) ?? []).length;
      if (depth <= 0) flush();
    }
  }
  return out;
}

function main() {
  const items = parseSeed();
  if (items.length === 0) {
    console.error('No items parsed from seed file — check regex.');
    process.exit(1);
  }
  const manifest = items.map((it) => ({
    id: it.id,
    name: it.name,
    slot: it.slot,
    rarity: it.rarity,
    classRestriction: it.classRestriction,
    color: it.color,
    setId: it.setId,
    sprite: it.sprite,
    prompt: promptFor(it),
  }));
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`[manifest] wrote ${manifest.length} entries → ${MANIFEST_PATH}`);
}

main();
