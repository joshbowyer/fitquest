import { PrismaClient } from '@prisma/client';
import { ensureAchievementsSeeded } from '../src/lib/achievements.js';
import { seedSkills } from '../src/lib/seedSkills.js';
import { seedItems } from '../src/lib/seedItems.js';
import { ensurePetBreedsSeeded } from './seed-pets.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding achievements…');
  await ensureAchievementsSeeded();
  console.log('Seeding skills…');
  await seedSkills();
  console.log('Seeding items…');
  await seedItems();
  console.log('Seeding pet breeds…');
  await ensurePetBreedsSeeded();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
