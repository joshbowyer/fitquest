// =============================================================
// Pet breed seed.
//
// Run as part of `npm run db:seed` (which calls seed.ts, which
// calls ensurePetBreedsSeeded() here). Idempotent — uses upsert.
//
// Seeds the 3 v1 breeds. Variant values match the sprite
// filenames under web/public/sprites/pets/.
// =============================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STAGES = JSON.stringify(['puppy', 'adult', 'adultArmored', 'injuredArmored']);

const BREEDS = [
  {
    slug: 'german-shepherd',
    displayName: 'German Shepherd',
    species: 'dog',
    costGold: 1000,
    isStarter: true, // always in stock
    colorVariants: JSON.stringify(['black-tan']),
    description:
      'Saddle-patterned working dog. Loyal companion that auto-trains with you and helps in monster and boss fights. Starter breed — always in stock.',
    baseHp: 50,
    baseAttack: 2,
    spriteBasePath: 'german-shepherd',
    spriteStages: STAGES,
  },
  {
    slug: 'akita',
    displayName: 'Akita',
    species: 'dog',
    costGold: 1000,
    isStarter: false,
    colorVariants: JSON.stringify(['red-fawn']),
    description:
      'Sturdy Japanese spitz with a curled tail. Calm and aloof but powerful in combat. Not always in stock — rotates weekly.',
    baseHp: 50,
    baseAttack: 2,
    spriteBasePath: 'akita',
    spriteStages: STAGES,
  },
  {
    slug: 'axolotl',
    displayName: 'Axolotl',
    species: 'amphibian',
    costGold: 1000,
    isStarter: false,
    colorVariants: JSON.stringify(['leucistic']),
    description:
      'Pink leucistic axolotl with feathery external gills. Unusual but earns its keep — same combat math as the dogs, twice the charm. Rotates weekly.',
    baseHp: 50,
    baseAttack: 2,
    spriteBasePath: 'axolotl',
    spriteStages: STAGES,
  },
];

/**
 * Idempotent: upserts each v1 breed. Safe to run on every
 * db:seed invocation.
 */
export async function ensurePetBreedsSeeded(): Promise<void> {
  for (const breed of BREEDS) {
    await prisma.petBreed.upsert({
      where: { slug: breed.slug },
      create: breed,
      update: {
        displayName: breed.displayName,
        species: breed.species,
        costGold: breed.costGold,
        colorVariants: breed.colorVariants,
        description: breed.description,
        baseHp: breed.baseHp,
        baseAttack: breed.baseAttack,
        spriteBasePath: breed.spriteBasePath,
        spriteStages: breed.spriteStages,
      },
    });
  }
}

// Allow direct invocation: `tsx prisma/seed-pets.ts`. When the
// file is imported by seed.ts as a module, the URL won't match
// `process.argv[1]`, so we skip the auto-run. (We can't use the
// CommonJS `require.main === module` check — this is an ESM module
// under tsx, and `require` is undefined.)
const isMainModule = (() => {
  try {
    if (typeof require !== 'undefined' && require.main === module) return true;
  } catch {}
  if (typeof process !== 'undefined' && process.argv[1]) {
    const argv1 = process.argv[1];
    return argv1.endsWith('seed-pets.ts') || argv1.endsWith('seed-pets.js');
  }
  return false;
})();

if (isMainModule) {
  ensurePetBreedsSeeded()
    .then(() => console.log(`seeded ${BREEDS.length} pet breeds`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}