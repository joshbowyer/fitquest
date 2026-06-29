import { prisma } from './prisma.js';
import { hashPassword } from './auth.js';

// Known default admin credentials. Common convention — when running
// fresh, log in as `admin` / `fitquest` and change the password from
// /settings (or /admin → Reset password for your own user).
// If someone else has already registered, this is a no-op (you'd need
// to nuke the DB to reset; that's the user's problem per the README).
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'fitquest';

let seeded = false;

export async function ensureDefaultAdmin() {
  if (seeded) return;
  seeded = true;
  // Only seed if User table is empty. This keeps existing installs
  // untouched while making fresh boots self-managing.
  const count = await prisma.user.count();
  if (count > 0) return;
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      email: `${DEFAULT_ADMIN_USERNAME}@local.fitquest`,
      username: DEFAULT_ADMIN_USERNAME,
      // Case-folded copy of username — required by the login route
      // for case-insensitive lookup. The default admin username is
      // already lowercase so this is a no-op for the seed case.
      usernameLower: DEFAULT_ADMIN_USERNAME.toLowerCase(),
      passwordHash,
      isAdmin: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(
    `\n┌─ fitquest default admin ─────────────────────────────\n` +
    `│  username: ${DEFAULT_ADMIN_USERNAME}\n` +
    `│  password: ${DEFAULT_ADMIN_PASSWORD}\n` +
    `│  Change it from /settings after first login.\n` +
    `└────────────────────────────────────────────────────────\n`,
  );
}
