import { PrismaClient, ItemRarity, EquipSlot, ClassName } from './prisma.js';

const prisma = new PrismaClient();

/**
 * Seed catalog of equippable items. ~40 items across all 8 slots, 6
 * rarities, and tied to the 5 class-locked sprite sets we downloaded
 * (warrior / rogue / healer / wizard + base shirts).
 *
 * Stat curves per rarity (additive, applied to combat math):
 *   COMMON     :  1 stat ×  5-8
 *   UNCOMMON   :  2 stats × 10-15
 *   RARE      :  2 stats × 18-25
 *   EPIC      :  3 stats × 30-45
 *   LEGENDARY  :  4 stats × 55-75
 *   MYTHIC    :  5 stats × 90-120
 *
 * Class restrictions mirror Habitica's four sprite "classes" loosely —
 * we don't have full set bonuses yet, but we lock items by primary
 * aspect so a Juggernaut (STR) gets warrior-tier loot, Berserker
 * (CONST/Intensity) gets rogue-tier loot, etc.
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
  // ---- BODY (broad shirts, class-color coded) ---------------------------
  { id: 'shirt_jugg_basic',   name: 'Iron Thread Vest',     slot: 'BODY', sprite: 'shirts/broad_shirt_redblue',  color: '#dc2626', rarity: 'COMMON',    stats: { '+DMG': 5 },                              classRestriction: 'JUGGERNAUT' },
  { id: 'shirt_phantom_basic',name: 'Mossy Wrap',           slot: 'BODY', sprite: 'shirts/broad_shirt_green',   color: '#56e88e', rarity: 'COMMON',    stats: { '+EVA': 0.05 },                           classRestriction: 'PHANTOM' },
  { id: 'shirt_scout_basic',  name: 'Trail-Worn Tunic',     slot: 'BODY', sprite: 'shirts/broad_shirt_yellow',  color: '#daa520', rarity: 'COMMON',    stats: { '+DISC': 0.05 },                          classRestriction: 'SCOUT' },
  { id: 'shirt_berserker_basic', name: 'Rage-Bound Tunic',  slot: 'BODY', sprite: 'shirts/broad_shirt_redblue',  color: '#f55cc4', rarity: 'COMMON',    stats: { '+CRIT': 0.05 },                          classRestriction: 'BERSERKER' },
  { id: 'shirt_tracer_basic', name: 'Lightstep Wrap',       slot: 'BODY', sprite: 'shirts/broad_shirt_white',   color: '#ff8c00', rarity: 'COMMON',    stats: { '+BURST': 0.05 },                          classRestriction: 'TRACER' },
  { id: 'shirt_oracle_basic', name: 'Stillness Robes',      slot: 'BODY', sprite: 'shirts/broad_shirt_purple',  color: '#8b9eff', rarity: 'COMMON',    stats: { '+HEAL': 0.05 },                           classRestriction: 'ORACLE' },
  { id: 'shirt_starter_universal', name: 'Plain Cotton',     slot: 'BODY', sprite: 'shirts/broad_shirt_blue',    color: '#14d6e8', rarity: 'COMMON',    stats: { '+HP': 10 } },

  // ---- BODY (rare/epic sets) ---------------------------------------------
  { id: 'armor_warrior_1', name: 'Bronze Cuirass',         slot: 'BODY', sprite: 'armor/broad_armor_warrior_1', color: '#dc2626', rarity: 'UNCOMMON',  stats: { '+DMG': 8, '+DEF': 5 },                      classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'armor_warrior_2', name: 'Iron Cuirass',           slot: 'BODY', sprite: 'armor/broad_armor_warrior_2', color: '#dc2626', rarity: 'RARE',      stats: { '+DMG': 18, '+DEF': 12, '+HP': 30 },         classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'armor_warrior_3', name: 'Steel Cuirass',          slot: 'BODY', sprite: 'armor/broad_armor_warrior_3', color: '#dc2626', rarity: 'EPIC',      stats: { '+DMG': 35, '+DEF': 25, '+HP': 60, '+CRIT': 0.05 }, classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'armor_rogue_1', name: 'Shadowed Leathers',       slot: 'BODY', sprite: 'armor/broad_armor_rogue_1',  color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+EVA': 0.10, '+CRIT': 0.05 },              classRestriction: 'PHANTOM' },
  { id: 'armor_rogue_2', name: 'Whispering Leathers',     slot: 'BODY', sprite: 'armor/broad_armor_rogue_2',  color: '#56e88e', rarity: 'RARE',      stats: { '+EVA': 0.18, '+CRIT': 0.10, '+DMG': 8 },   classRestriction: 'PHANTOM' },
  { id: 'armor_healer_1', name: 'Linen Wraps',            slot: 'BODY', sprite: 'armor/broad_armor_healer_1', color: '#8b9eff', rarity: 'UNCOMMON',  stats: { '+HEAL': 0.10, '+HP': 20 },                  classRestriction: 'ORACLE' },
  { id: 'armor_healer_2', name: 'Silk Wraps',             slot: 'BODY', sprite: 'armor/broad_armor_healer_2', color: '#8b9eff', rarity: 'RARE',      stats: { '+HEAL': 0.18, '+HP': 40, '+DEF': 10 },     classRestriction: 'ORACLE' },

  // ---- HEAD --------------------------------------------------------------
  { id: 'head_basic_hood', name: 'Traveler\'s Hood',       slot: 'HEAD', sprite: 'head/head_0',                  color: '#a8a8b8', rarity: 'COMMON',    stats: { '+DEF': 3 } },
  { id: 'head_warrior_1', name: 'Bronze Helm',            slot: 'HEAD', sprite: 'head/head_warrior_1',          color: '#dc2626', rarity: 'UNCOMMON',  stats: { '+DEF': 8, '+HP': 15 },                      classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'head_warrior_3', name: 'Steel Helm',             slot: 'HEAD', sprite: 'head/head_warrior_3',          color: '#dc2626', rarity: 'EPIC',      stats: { '+DEF': 25, '+HP': 50, '+DMG': 15 },        classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'head_rogue_1', name: 'Shadow Hood',             slot: 'HEAD', sprite: 'head/head_rogue_1',           color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+EVA': 0.08, '+CRIT': 0.05 },              classRestriction: 'PHANTOM' },
  { id: 'head_rogue_3', name: 'Whisper Cowl',            slot: 'HEAD', sprite: 'head/head_rogue_3',           color: '#56e88e', rarity: 'EPIC',      stats: { '+EVA': 0.20, '+CRIT': 0.12, '+DMG': 10 }, classRestriction: 'PHANTOM' },
  { id: 'head_healer_1', name: 'Cloth Band',             slot: 'HEAD', sprite: 'head/head_healer_1',          color: '#8b9eff', rarity: 'UNCOMMON',  stats: { '+HEAL': 0.10, '+HP': 20 },                  classRestriction: 'ORACLE' },
  { id: 'head_healer_3', name: 'Mind Circlet',            slot: 'HEAD', sprite: 'head/head_healer_3',          color: '#8b9eff', rarity: 'EPIC',      stats: { '+HEAL': 0.22, '+HP': 60, '+DEF': 18 },     classRestriction: 'ORACLE' },

  // ---- MAIN HAND (weapons) -----------------------------------------------
  { id: 'weapon_warrior_1', name: 'Iron Shortsword',       slot: 'MAIN', sprite: 'weapon/weapon_warrior_1',     color: '#dc2626', rarity: 'COMMON',    stats: { '+DMG': 8 },                                classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'weapon_warrior_2', name: 'Steel Longsword',       slot: 'MAIN', sprite: 'weapon/weapon_warrior_2',     color: '#dc2626', rarity: 'UNCOMMON',  stats: { '+DMG': 18, '+CRIT': 0.05 },                  classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'weapon_warrior_4', name: 'Meteoric Greatsword',    slot: 'MAIN', sprite: 'weapon/weapon_warrior_4',     color: '#dc2626', rarity: 'EPIC',      stats: { '+DMG': 50, '+CRIT': 0.15, '+HP': 40 },      classRestriction: 'JUGGERNAUT' },
  { id: 'weapon_rogue_0',  name: 'Twin Daggers',          slot: 'MAIN', sprite: 'weapon/weapon_rogue_0',       color: '#56e88e', rarity: 'COMMON',    stats: { '+DMG': 6, '+EVA': 0.05 },                    classRestriction: 'PHANTOM' },
  { id: 'weapon_rogue_2',  name: 'Shadow Fangs',          slot: 'MAIN', sprite: 'weapon/weapon_rogue_2',       color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+DMG': 14, '+CRIT': 0.10, '+EVA': 0.10 },   classRestriction: 'PHANTOM' },
  { id: 'weapon_healer_1', name: 'Walking Cane',          slot: 'MAIN', sprite: 'weapon/weapon_healer_1',      color: '#8b9eff', rarity: 'COMMON',    stats: { '+HEAL': 0.05, '+DEF': 3 },                  classRestriction: 'ORACLE' },
  { id: 'weapon_healer_3', name: 'Sagewood Staff',         slot: 'MAIN', sprite: 'weapon/weapon_healer_3',      color: '#8b9eff', rarity: 'EPIC',      stats: { '+HEAL': 0.20, '+HP': 80, '+DMG': 10 },      classRestriction: 'ORACLE' },
  { id: 'weapon_burst_dagger', name: 'Lightning Stiletto',  slot: 'MAIN', sprite: 'weapon/weapon_rogue_0',       color: '#ff8c00', rarity: 'UNCOMMON',  stats: { '+BURST': 0.15, '+DMG': 12 },                 classRestriction: 'TRACER' },
  { id: 'weapon_burst_axe', name: 'Stormhatch',             slot: 'MAIN', sprite: 'weapon/weapon_warrior_2',     color: '#ff8c00', rarity: 'RARE',      stats: { '+BURST': 0.20, '+DMG': 25, '+CRIT': 0.10 },  classRestriction: 'TRACER' },

  // ---- OFF HAND (shields) ------------------------------------------------
  { id: 'shield_warrior_1', name: 'Wooden Round Shield',   slot: 'OFF',  sprite: 'shield/shield_warrior_1',    color: '#dc2626', rarity: 'COMMON',    stats: { '+DEF': 5, '+HP': 10 },                      classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'shield_warrior_3', name: 'Steel Bulwark',         slot: 'OFF',  sprite: 'shield/shield_warrior_3',    color: '#dc2626', rarity: 'RARE',      stats: { '+DEF': 18, '+HP': 35, '+DMG': 8 },         classRestriction: 'JUGGERNAUT', setId: 'iron_pact' },
  { id: 'shield_rogue_1',   name: 'Buckler of Whispers',  slot: 'OFF',  sprite: 'shield/shield_rogue_1',      color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+EVA': 0.10, '+DEF': 5 },                  classRestriction: 'PHANTOM' },
  { id: 'shield_healer_1',  name: 'Tome of Rest',          slot: 'OFF',  sprite: 'shield/shield_healer_1',     color: '#8b9eff', rarity: 'COMMON',    stats: { '+HEAL': 0.08, '+HP': 15 },                  classRestriction: 'ORACLE' },
  { id: 'shield_healer_3',  name: 'Codex of Mending',      slot: 'OFF',  sprite: 'shield/shield_healer_3',     color: '#8b9eff', rarity: 'EPIC',      stats: { '+HEAL': 0.20, '+HP': 50, '+DEF': 15 },      classRestriction: 'ORACLE' },

  // ---- NECK (amulets) ----------------------------------------------------
  { id: 'neck_bloodstone', name: 'Bloodstone Pendant',     slot: 'NECK', sprite: 'weapon/weapon_warrior_0',     color: '#dc2626', rarity: 'UNCOMMON',  stats: { '+DMG': 12, '+CRIT': 0.05 } },
  { id: 'neck_amber',      name: 'Amber Focus',            slot: 'NECK', sprite: 'weapon/weapon_healer_1',      color: '#daa520', rarity: 'UNCOMMON',  stats: { '+HEAL': 0.10, '+DISC': 0.10 } },
  { id: 'neck_legendary_compass', name: 'Compass of the Pathfinders', slot: 'NECK', sprite: 'shield/shield_warrior_1', color: '#daa520', rarity: 'LEGENDARY', stats: { '+DISC': 0.30, '+XP': 0.10, '+GOLD': 0.05 }, classRestriction: 'SCOUT' },

  // ---- RING (stat sticks, low-impact) -----------------------------------
  { id: 'ring_iron_band',    name: 'Iron Band',            slot: 'RING', sprite: 'shield/shield_warrior_2',    color: '#a8a8b8', rarity: 'COMMON',    stats: { '+DEF': 3 } },
  { id: 'ring_lucky',        name: 'Lucky Coin',           slot: 'RING', sprite: 'shield/shield_rogue_1',      color: '#ffc34d', rarity: 'UNCOMMON',  stats: { '+GOLD': 0.10, '+DISC': 0.05 } },
  { id: 'ring_focus',        name: 'Ring of Focus',        slot: 'RING', sprite: 'shield/shield_healer_1',     color: '#8b9eff', rarity: 'UNCOMMON',  stats: { '+XP': 0.05, '+HEAL': 0.05 } },
  { id: 'ring_mythic_blood', name: 'Band of the Berserker',slot: 'RING', sprite: 'shield/shield_warrior_5',    color: '#dc2626', rarity: 'MYTHIC',    stats: { '+DMG': 100, '+CRIT': 0.30, '+HP': 100, '+BURST': 0.30, '+DEF': 50 } },

  // ---- HANDS (gloves) ----------------------------------------------------
  { id: 'hands_gauntlets_iron', name: 'Iron Gauntlets',    slot: 'HANDS',sprite: 'weapon/weapon_warrior_0',     color: '#a8a8b8', rarity: 'COMMON',    stats: { '+DMG': 5, '+DEF': 3 } },
  { id: 'hands_rogue_wraps', name: 'Silent Wraps',         slot: 'HANDS',sprite: 'shield/shield_rogue_1',      color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+CRIT': 0.08, '+EVA': 0.05 } },

  // ---- FEET (boots) ------------------------------------------------------
  { id: 'feet_traveler_boots', name: 'Traveler\'s Boots',   slot: 'FEET', sprite: 'shield/shield_warrior_2',    color: '#a8a8b8', rarity: 'COMMON',    stats: { '+HP': 15, '+DISC': 0.05 } },
  { id: 'feet_swift_boots',    name: 'Swift Boots',         slot: 'FEET', sprite: 'shield/shield_rogue_1',      color: '#56e88e', rarity: 'UNCOMMON',  stats: { '+EVA': 0.08, '+BURST': 0.05 } },

  // ---- TRON SET (user-generated Tron-style sprites, /sprites/gear/<slot>/<class>.png) ----
  // One item per (class, slot) combo. Sprite paths reference the
  // generated 64×64 transparent PNGs in /sprites/gear/. Rarity is
  // UNCOMMON — the new "tier 1" baseline that the old Habitica sprites
  // were playing the role of. Class colors match WORLD_COLOR_HEX.
  // Set: 'tron_set' so a future set-bonus could award +DMG/+DEF for
  // wearing 2+ pieces from the same class.

  // ---- HEAD ----
  { id: 'tron_juggernaut_head', name: 'Iron Crown',            slot: 'HEAD', sprite: 'gear/head/juggernaut',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 8, '+HP': 15 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_head',  name: 'Topknot Bind',         slot: 'HEAD', sprite: 'gear/head/berserker',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.08, '+DEF': 5 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_head',    name: 'Cowl of Whispers',     slot: 'HEAD', sprite: 'gear/head/phantom',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+DISC': 0.05 },           classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_head',     name: 'Wind Wrap',            slot: 'HEAD', sprite: 'gear/head/tracer',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },          classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_head',      name: 'Boonie Hat',           slot: 'HEAD', sprite: 'gear/head/scout',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+HEAL': 0.05 },          classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_head',     name: 'Mind Circlet',         slot: 'HEAD', sprite: 'gear/head/oracle',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+HP': 10 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- BODY ----
  { id: 'tron_juggernaut_body', name: 'Cuirass Plate',        slot: 'BODY', sprite: 'gear/body/juggernaut',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 10, '+DEF': 8, '+HP': 20 },        classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_body',  name: 'Spiked Pauldron',      slot: 'BODY', sprite: 'gear/body/berserker',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.10, '+DMG': 5, '+HP': 15 },    classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_body',    name: 'Diagonal Wrap',        slot: 'BODY', sprite: 'gear/body/phantom',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.12, '+DEF': 6 },              classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_body',     name: 'Lightstep Top',        slot: 'BODY', sprite: 'gear/body/tracer',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.12, '+EVA': 0.05 },         classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_body',      name: 'Quilted Chest Piece',  slot: 'BODY', sprite: 'gear/body/scout',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.10, '+HP': 15 },             classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_body',     name: 'Folded Robes',         slot: 'BODY', sprite: 'gear/body/oracle',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.12, '+HP': 18 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- HANDS ----
  { id: 'tron_juggernaut_hands', name: 'Heavy Gauntlets',     slot: 'HANDS', sprite: 'gear/hands/juggernaut',   color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 8, '+DEF': 6 },                  classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_hands',  name: 'Studded Bracers',     slot: 'HANDS', sprite: 'gear/hands/berserker',    color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.08, '+DMG': 4 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_hands',    name: 'Fingerless Gloves',   slot: 'HANDS', sprite: 'gear/hands/phantom',      color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+CRIT': 0.05 },            classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_hands',     name: 'Light Bracer',        slot: 'HANDS', sprite: 'gear/hands/tracer',       color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },           classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_hands',      name: 'Archer Bracer',       slot: 'HANDS', sprite: 'gear/hands/scout',        color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+DISC': 0.05 },           classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_hands',     name: 'Hand Wraps',          slot: 'HANDS', sprite: 'gear/hands/oracle',       color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+HP': 10 },             classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- FEET ----
  { id: 'tron_juggernaut_feet', name: 'Sabatons',             slot: 'FEET', sprite: 'gear/feet/juggernaut',    color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+HP': 12 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_feet',  name: 'Foot Wraps',          slot: 'FEET', sprite: 'gear/feet/berserker',     color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+EVA': 0.05 },            classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_feet',    name: 'Tabi Boots',          slot: 'FEET', sprite: 'gear/feet/phantom',       color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.10, '+DEF': 4 },               classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_feet',     name: 'Light Boots',         slot: 'FEET', sprite: 'gear/feet/tracer',        color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+HP': 8 },              classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_feet',      name: 'Combat Boots',        slot: 'FEET', sprite: 'gear/feet/scout',         color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+DEF': 5 },              classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_feet',     name: 'Sandals',             slot: 'FEET', sprite: 'gear/feet/oracle',        color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.10, '+EVA': 0.05 },           classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- OFF HAND (shields) — only juggernaut/berserker/scout get one ----
  { id: 'tron_juggernaut_off', name: 'Tower Shield',         slot: 'OFF', sprite: 'gear/off/juggernaut',       color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 12, '+HP': 25 },                  classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_off',  name: 'Round Shield',         slot: 'OFF', sprite: 'gear/off/berserker',        color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+DEF': 8, '+CRIT': 0.05 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_scout_off',      name: 'Round Buckler',        slot: 'OFF', sprite: 'gear/off/scout',            color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+DISC': 0.05 },              classRestriction: 'SCOUT',     setId: 'tron_set' },

  // ---- NECK ----
  { id: 'tron_juggernaut_neck', name: 'Iron Torque',          slot: 'NECK', sprite: 'gear/neck/juggernaut',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 6, '+HP': 12 },                   classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_neck',  name: 'Fang Necklace',       slot: 'NECK', sprite: 'gear/neck/berserker',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.06, '+DMG': 5 },               classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_neck',    name: 'Cloth Scarf',          slot: 'NECK', sprite: 'gear/neck/phantom',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.08, '+DISC': 0.05 },           classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_neck',     name: 'Speed Charm',         slot: 'NECK', sprite: 'gear/neck/tracer',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.10, '+EVA': 0.05 },          classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_neck',      name: 'Leather Strap',        slot: 'NECK', sprite: 'gear/neck/scout',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.08, '+HEAL': 0.05 },          classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_neck',     name: 'Prayer Beads',         slot: 'NECK', sprite: 'gear/neck/oracle',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.12, '+HP': 8 },              classRestriction: 'ORACLE',    setId: 'tron_set' },

  // ---- RING ----
  { id: 'tron_juggernaut_ring', name: 'Iron Signet',          slot: 'RING', sprite: 'gear/ring/juggernaut',     color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DEF': 4 } },
  { id: 'tron_berserker_ring',  name: 'Hammered Iron Band',   slot: 'RING', sprite: 'gear/ring/berserker',      color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+CRIT': 0.04 } },
  { id: 'tron_phantom_ring',    name: 'Silver Band',          slot: 'RING', sprite: 'gear/ring/phantom',        color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+EVA': 0.05 } },
  { id: 'tron_tracer_ring',     name: 'Bronze Band',          slot: 'RING', sprite: 'gear/ring/tracer',         color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+BURST': 0.05 } },
  { id: 'tron_scout_ring',      name: 'Carved Wood Ring',     slot: 'RING', sprite: 'gear/ring/scout',          color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DISC': 0.05 } },
  { id: 'tron_oracle_ring',     name: 'Quartz Ring',          slot: 'RING', sprite: 'gear/ring/oracle',         color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.05 } },

  // ---- MAIN HAND (weapons) — the iconic per-class weapon ----
  { id: 'tron_juggernaut_weapon', name: 'War Hammer',          slot: 'MAIN', sprite: 'gear/weapons/juggernaut',   color: '#dc2626', rarity: 'UNCOMMON', stats: { '+DMG': 18, '+CRIT': 0.05 },              classRestriction: 'JUGGERNAUT', setId: 'tron_set' },
  { id: 'tron_berserker_weapon',  name: 'Battle Axe',           slot: 'MAIN', sprite: 'gear/weapons/berserker',    color: '#f55cc4', rarity: 'UNCOMMON', stats: { '+DMG': 15, '+CRIT': 0.08 },              classRestriction: 'BERSERKER', setId: 'tron_set' },
  { id: 'tron_phantom_weapon',    name: 'Twin Daggers',         slot: 'MAIN', sprite: 'gear/weapons/phantom',      color: '#9bff5c', rarity: 'UNCOMMON', stats: { '+DMG': 12, '+EVA': 0.10, '+CRIT': 0.08 },  classRestriction: 'PHANTOM',   setId: 'tron_set' },
  { id: 'tron_tracer_weapon',     name: 'Short Sword',         slot: 'MAIN', sprite: 'gear/weapons/tracer',       color: '#ff8c00', rarity: 'UNCOMMON', stats: { '+DMG': 14, '+BURST': 0.12 },             classRestriction: 'TRACER',    setId: 'tron_set' },
  { id: 'tron_scout_weapon',      name: 'Recurve Bow',          slot: 'MAIN', sprite: 'gear/weapons/scout',        color: '#ffc34d', rarity: 'UNCOMMON', stats: { '+DMG': 13, '+CRIT': 0.10 },              classRestriction: 'SCOUT',     setId: 'tron_set' },
  { id: 'tron_oracle_weapon',     name: 'Glowing Orb',          slot: 'MAIN', sprite: 'gear/weapons/oracle',       color: '#7d7bff', rarity: 'UNCOMMON', stats: { '+HEAL': 0.15, '+DMG': 8 },                classRestriction: 'ORACLE',    setId: 'tron_set' },
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