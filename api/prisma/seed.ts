import { PrismaClient } from '@prisma/client';
import { ensureAchievementsSeeded } from '../src/lib/achievements.js';
import { ensureSkillsSeeded } from '../src/lib/skills.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding achievements…');
  await ensureAchievementsSeeded();
  console.log('Seeding skills…');
  await ensureSkillsSeeded();
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
