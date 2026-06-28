import { PrismaClient, ItemRarity, EquipSlot, ClassName } from './prisma.js';

const prisma = new PrismaClient();

/**
 * Seed catalog of equippable items. The catalog is a single Tron-themed
 * set: one item per (class, slot) combo referencing the generated
 * 64×64 PNGs in /sprites/gear/. Six classes × seven slots (HEAD, BODY,
 * HANDS, FEET, OFF, NECK, RING, MAIN) — off-hand has no entry for
 * PHANTOM / TRACER / ORACLE because they don't use shields by design.
 *
 * Stat curves per rarity (additive, applied to combat math):
 *   COMMON     :  1 stat ×  5-8
 *   UNCOMMON   :  2 stats × 10-15
 *   RARE      :  2 stats × 18-25
 *   EPIC      :  3 stats × 30-45
 *   LEGENDARY  :  4 stats × 55-75
 *   MYTHIC    :  5 stats × 90-120
 *
 * Class restrictions lock items to a single class so the rarity drop
 * matches the user's progression (a Juggernaut can't wear phantom
 * leathers). Items without a classRestriction are universally
 * equippable.
 */

type SeedItem = {
  id: string;
  name: string;
  description?: string;
  slot: EquipSlot;
  sprite: string;
  color: string;
  rarity: ItemRarity;
  stats: Record<string, number>;
  classRestriction?: ClassName | null;
  setId?: string | null;
};

const ITEMS: SeedItem[] = [
  // ---- TRON SET (user-generated Tron-style sprites, /sprites/gear/<slot>/<class>.png) ----
  // One item per (class, slot) combo. Sprite paths reference the
  // generated 64×64 transparent PNGs in /sprites/gear/. Rarity is
  // UNCOMMON — the "tier 1" baseline. Class colors match WORLD_COLOR_HEX.
  // Set: 'tron_set' so a future set-bonus could award +DMG/+DEF for
  // wearing 2+ pieces from the same class.
  //
  // The previous seed had 40+ items pointing at Habitica-sourced
  // broad_shirts / broad_armors / head_/weapon_/shield_/neck_/ring_
  // sprites. Those sprite folders have been deleted; this catalog
  // is now a single coherent Tron-themed set.

  // ---- HEAD ----
  { id: 'tron_juggernaut_head', name: 'Iron Crown',            slot: 'HEAD', sprite: 'gear/head/juggernaut.png',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 8, '+HP': 15 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_head',  name: 'Topknot Bind',         slot: 'HEAD', sprite: 'gear/head/berserker.png',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.08, '+DEF': 5 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_head',    name: 'Cowl of Whispers',     slot: 'HEAD', sprite: 'gear/head/phantom.png',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+DISC': 0.05 },           classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_head',     name: 'Wind Wrap',            slot: 'HEAD', sprite: 'gear/head/tracer.png',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },          classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_head',      name: 'Boonie Hat',           slot: 'HEAD', sprite: 'gear/head/scout.png',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+HEAL': 0.05 },          classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_head',     name: 'Mind Circlet',         slot: 'HEAD', sprite: 'gear/head/oracle.png',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+HP': 10 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- BODY ----
  { id: 'tron_juggernaut_body', name: 'Cuirass Plate',        slot: 'BODY', sprite: 'gear/body/juggernaut.png',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 10, '+DEF': 8, '+HP': 20 },        classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_body',  name: 'Spiked Pauldron',      slot: 'BODY', sprite: 'gear/body/berserker.png',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.10, '+DMG': 5, '+HP': 15 },    classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_body',    name: 'Diagonal Wrap',        slot: 'BODY', sprite: 'gear/body/phantom.png',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.12, '+DEF': 6 },              classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_body',     name: 'Lightstep Top',        slot: 'BODY', sprite: 'gear/body/tracer.png',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.12, '+EVA': 0.05 },         classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_body',      name: 'Quilted Chest Piece',  slot: 'BODY', sprite: 'gear/body/scout.png',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.10, '+HP': 15 },             classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_body',     name: 'Folded Robes',         slot: 'BODY', sprite: 'gear/body/oracle.png',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.12, '+HP': 18 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- HANDS ----
  { id: 'tron_juggernaut_hands', name: 'Heavy Gauntlets',     slot: 'HANDS', sprite: 'gear/hands/juggernaut.png',   color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 8, '+DEF': 6 },                  classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_hands',  name: 'Studded Bracers',     slot: 'HANDS', sprite: 'gear/hands/berserker.png',    color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.08, '+DMG': 4 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_hands',    name: 'Fingerless Gloves',   slot: 'HANDS', sprite: 'gear/hands/phantom.png',      color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+CRIT': 0.05 },            classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_hands',     name: 'Light Bracer',        slot: 'HANDS', sprite: 'gear/hands/tracer.png',       color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },           classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_hands',      name: 'Archer Bracer',       slot: 'HANDS', sprite: 'gear/hands/scout.png',        color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+DISC': 0.05 },           classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_hands',     name: 'Hand Wraps',          slot: 'HANDS', sprite: 'gear/hands/oracle.png',       color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+HP': 10 },             classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- FEET ----
  { id: 'tron_juggernaut_feet', name: 'Sabatons',             slot: 'FEET', sprite: 'gear/feet/juggernaut.png',    color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+HP': 12 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_feet',  name: 'Foot Wraps',          slot: 'FEET', sprite: 'gear/feet/berserker.png',     color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+EVA': 0.05 },            classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_feet',    name: 'Tabi Boots',          slot: 'FEET', sprite: 'gear/feet/phantom.png',       color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+DEF': 4 },               classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_feet',     name: 'Light Boots',         slot: 'FEET', sprite: 'gear/feet/tracer.png',        color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+HP': 8 },              classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_feet',      name: 'Combat Boots',        slot: 'FEET', sprite: 'gear/feet/scout.png',         color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+DEF': 5 },              classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_feet',     name: 'Sandals',             slot: 'FEET', sprite: 'gear/feet/oracle.png',        color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+EVA': 0.05 },           classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- OFF HAND (shields) — only juggernaut/berserker/scout get one ----
  { id: 'tron_juggernaut_off', name: 'Tower Shield',         slot: 'OFF', sprite: 'gear/off/juggernaut.png',       color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 12, '+HP': 25 },                  classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_off',  name: 'Round Shield',         slot: 'OFF', sprite: 'gear/off/berserker.png',        color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+DEF': 8, '+CRIT': 0.05 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_scout_off',      name: 'Round Buckler',        slot: 'OFF', sprite: 'gear/off/scout.png',            color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+DISC': 0.05 },              classRestriction: 'SCOUT',     setId: 'tron_set' },

  // ---- NECK ----
  { id: 'tron_juggernaut_neck', name: 'Iron Torque',          slot: 'NECK', sprite: 'gear/neck/juggernaut.png',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+HP': 12 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_neck',  name: 'Fang Necklace',       slot: 'NECK', sprite: 'gear/neck/berserker.png',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+DMG': 5 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_neck',    name: 'Cloth Scarf',          slot: 'NECK', sprite: 'gear/neck/phantom.png',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.08, '+DISC': 0.05 },           classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_neck',     name: 'Speed Charm',         slot: 'NECK', sprite: 'gear/neck/tracer.png',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },          classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_neck',      name: 'Leather Strap',        slot: 'NECK', sprite: 'gear/neck/scout.png',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+HEAL': 0.05 },          classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_neck',     name: 'Prayer Beads',         slot: 'NECK', sprite: 'gear/neck/oracle.png',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.12, '+HP': 8 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- RING ----
  { id: 'tron_juggernaut_ring', name: 'Iron Signet',          slot: 'RING', sprite: 'gear/ring/juggernaut.png',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 4 } },
  { id: 'tron_berserker_ring',  name: 'Hammered Iron Band',   slot: 'RING', sprite: 'gear/ring/berserker.png',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.04 } },
  { id: 'tron_phantom_ring',    name: 'Silver Band',          slot: 'RING', sprite: 'gear/ring/phantom.png',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.05 } },
  { id: 'tron_tracer_ring',     name: 'Bronze Band',          slot: 'RING', sprite: 'gear/ring/tracer.png',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.05 } },
  { id: 'tron_scout_ring',      name: 'Carved Wood Ring',     slot: 'RING', sprite: 'gear/ring/scout.png',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.05 } },
  { id: 'tron_oracle_ring',     name: 'Quartz Ring',          slot: 'RING', sprite: 'gear/ring/oracle.png',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.05 } },

  // ---- MAIN HAND (weapons) — the iconic per-class weapon ----
  { id: 'tron_juggernaut_weapon', name: 'War Hammer',          slot: 'MAIN', sprite: 'gear/weapons/juggernaut.png',   color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 18, '+CRIT': 0.05 },              classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_weapon',  name: 'Battle Axe',           slot: 'MAIN', sprite: 'gear/weapons/berserker.png',    color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+DMG': 15, '+CRIT': 0.08 },              classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_weapon',    name: 'Twin Daggers',         slot: 'MAIN', sprite: 'gear/weapons/phantom.png',      color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+DMG': 12, '+EVA': 0.10, '+CRIT': 0.08 },  classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_weapon',     name: 'Short Sword',         slot: 'MAIN', sprite: 'gear/weapons/tracer.png',       color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+DMG': 14, '+BURST': 0.12 },             classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_weapon',      name: 'Recurve Bow',          slot: 'MAIN', sprite: 'gear/weapons/scout.png',        color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DMG': 13, '+CRIT': 0.10 },              classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_weapon',     name: 'Glowing Orb',          slot: 'MAIN', sprite: 'gear/weapons/oracle.png',       color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.15, '+DMG': 8 },                classRestriction: 'ORACLE',    setId: 'tron_set' },
];

export async function seedItems() {
  for (const item of ITEMS) {
    await prisma.itemDef.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        name: item.name,
        description: item.description ?? null,
        slot: item.slot,
        sprite: item.sprite,
        color: item.color,
        rarity: item.rarity,
        stats: item.stats as any,
        classRestriction: item.classRestriction ?? null,
        setId: item.setId ?? null,
      },
      update: {
        name: item.name,
        description: item.description ?? null,
        slot: item.slot,
        sprite: item.sprite,
        color: item.color,
        rarity: item.rarity,
        stats: item.stats as any,
        classRestriction: item.classRestriction ?? null,
        setId: item.setId ?? null,
      },
    });
  }
  console.log(`[seed] upserted ${ITEMS.length} ItemDef rows`);
}

if (process.argv[1]?.endsWith('seedItems.ts') || process.argv[1]?.endsWith('seedItems.js')) {
  seedItems()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
      process.exit(1);
    });
}