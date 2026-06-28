import { prisma } from './prisma.js';

/**
 * One-shot remap of stale ItemDef sprite paths.
 *
 * The old catalog referenced Habitica-sourced 32×32 sprites under
 * /sprites/{shirts,armor,head,weapon,shield,ring,neck,hands,feet}/.
 * Those folders have been deleted; the new generated Tron-style set
 * lives under /sprites/gear/<slot>/<class>.png with one icon per
 * (class, slot) combo.
 *
 * Existing prod rows still hold the old paths. This remap rewrites
 * each affected row to point at the closest new icon (same slot,
 * same class when known; falls back to a universal class icon for
 * universal items + slots that only ship a subset of class icons).
 *
 * It's idempotent — running it twice is a no-op because the second
 * pass matches no rows.
 */

// Slot folders in /sprites/gear/. Note: weapons/ is plural here but
// the folder on disk is named that way (the /weapons/ directory was
// kept from the original sprite brief).
const SLOT_FOLDER: Record<string, string> = {
  HEAD:  'head',
  BODY:  'body',
  HANDS: 'hands',
  FEET:  'feet',
  MAIN:  'weapons',
  OFF:   'off',
  NECK:  'neck',
  RING:  'ring',
};

// Old sprite-path → new gear sprite-path. Keys are the *exact* old
// sprite strings from the previous seed. The value is a function of
// the item's classRestriction + slot because some classes have no
// OFF icon (phantom / tracer / oracle don't carry shields) — those
// fall back to the juggernaut shield as a universal placeholder.
//
// Universal items (no classRestriction) also fall back to the
// juggernaut icon — the most "default" Tron class. We could
// special-case each one by color but the catalog doesn't really
// care: the rarity chip + name + class-lock badge carry the
// identity; the icon just needs to render.
const JUGG = 'JUGGERNAUT';
const BERS = 'BERSERKER';
const PHAN = 'PHANTOM';
const TRAC = 'TRACER';
const SCOT = 'SCOUT';
const ORAC = 'ORACLE';

// OFF slot — only juggernaut, berserker, scout have icons. Phantom,
// tracer, oracle fall back to the juggernaut shield.
function offFallback(c: string | null): string {
  if (c === BERS) return BERS;
  if (c === SCOT) return SCOT;
  return JUGG;
}

// Universal items + classes without an off icon get the juggernaut
// shield as a placeholder. (The visual cost is small — every shield
// looks similar anyway — and avoids broken-image boxes.)
function remapForItem(oldSprite: string, slot: string, classRestriction: string | null): string | null {
  const folder = SLOT_FOLDER[slot];
  if (!folder) return null;
  const cls = classRestriction ?? JUGG;
  const classIcon = slot === 'OFF' ? offFallback(cls) : cls;
  return `gear/${folder}/${classIcon.toLowerCase()}.png`;
}

// Patterns of old sprite paths that need remapping. Anything not
// matching one of these prefixes is left alone (e.g. the new
// /sprites/gear/... paths from the Tron set).
//
// We also remap the bare `<slot>/<file>` family — that was an
// earlier seed convention where ItemDef.sprite was just the
// basename without a `gear/` prefix. Even older rows carry a
// `legacy/` prefix (a previous public-sprite folder convention
// that's gone); those get remapped the same way since we read
// the slot/class off the row itself, not the path.
const OLD_SPRITE_PREFIXES = [
  'shirts/',
  'armor/',
  'head/',
  'weapon/',
  'shield/',
  'ring/',
  'neck/',
  'hands/',
  'feet/',
  'legacy/',
];

function isOldSprite(sprite: string): boolean {
  return OLD_SPRITE_PREFIXES.some((p) => sprite.startsWith(p));
}

export async function remapLegacyItemSprites(): Promise<{ updated: number; skipped: number }> {
  const items = await prisma.itemDef.findMany({
    select: { id: true, sprite: true, slot: true, classRestriction: true },
  });
  let updated = 0;
  let skipped = 0;
  for (const it of items) {
    if (!isOldSprite(it.sprite)) {
      skipped++;
      continue;
    }
    const newSprite = remapForItem(it.sprite, it.slot, it.classRestriction);
    if (!newSprite || newSprite === it.sprite) {
      skipped++;
      continue;
    }
    await prisma.itemDef.update({
      where: { id: it.id },
      data: { sprite: newSprite },
    });
    updated++;
  }
  return { updated, skipped };
}

if (process.argv[1]?.endsWith('remapItemSprites.ts') || process.argv[1]?.endsWith('remapItemSprites.js')) {
  remapLegacyItemSprites()
    .then((r) => {
      console.log(`[remap] updated ${r.updated} ItemDef rows, skipped ${r.skipped}`);
      return prisma.$disconnect();
    })
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
      process.exit(1);
    });
}
