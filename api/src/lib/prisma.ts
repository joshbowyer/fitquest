// ============================================================
// Prisma client + named-export re-exports
// ============================================================
//
// @prisma/client's package.json `import` field points to a CJS
// file (default.js). When Node ESM imports a CJS module, only the
// default export is available — named imports fail at runtime
// with:
//
//   SyntaxError: Named export 'X' not found. The requested module
//   '@prisma/client' is a CommonJS module, which may not support
//   all module.exports as named exports.
//
// Even `import pkg from '@prisma/client'` (default import) trips
// the same SyntaxError on Node 22 + ESM strict resolution.
//
// Solution: use createRequire to pull the CJS module via the
// Node CommonJS loader. This works in any module system, gives
// full access to module.exports, and avoids the ESM/CJS interop
// dance entirely. The destructure happens at module load and
// the named exports are re-bound as proper ESM exports so
// consumers do
//
//   import { PrismaClient, ClassName, Prisma, ... } from './lib/prisma.js';
//
// without hitting the @prisma/client CJS export error.
//
// PrismaClient is a CLASS, not a type. It is included in the
// runtime destructure below and the value `export { ... }` block,
// but NOT in the `export type { ... }` block. Putting it in the
// type-only block caused tsc to elide the runtime import in
// downstream files, breaking `new PrismaClient()`.
// ============================================================

import { createRequire } from 'module';
import { config } from './config.js';

// createRequire(import.meta.url) returns a require function
// rooted at THIS file's URL. Works inside ESM since Node 12.
const requireCjs = createRequire(import.meta.url);

// Load @prisma/client as a CommonJS module. The destructure
// gives us the runtime values of every enum + the PrismaClient
// class.
const {
  PrismaClient,
  Prisma,
  // Enums (alphabetical for diff hygiene)
  AchievementCategory,
  BodyPart,
  CalorieGoal,
  CalorieSource,
  ClassName,
  DailyCategory,
  DayOfWeek,
  EquipSlot,
  FoodSource,
  GeneticMaxSource,
  HabitDirection,
  HairStyle,
  HeartLossTrigger,
  ItemRarity,
  MealType,
  MeasurementSource,
  MetricType,
  PrayerType,
  ShieldTier,
  SkipReason,
  SubstanceCategory,
  TrackedItemCategory,
  TrackedItemUnit,
  WorkoutSource,
  WorkoutType,
} = requireCjs('@prisma/client');

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });

if (config.isDev) {
  globalThis.__prisma = prisma;
}

// Type-only exports — ONLY for things that don't exist as
// runtime values (interfaces, model types, the Prisma namespace
// for type-only queries). Enums are NOT here: they're runtime
// const objects exported in the next block, and TypeScript
// infers the type from the value via `typeof X`. Putting an
// enum name in BOTH the type and value exports causes tsc to
// silently strip downstream `import { X }` from compiled JS
// when the consumer uses X in a value position (e.g.
// `z.nativeEnum(X)`), because tsc defaults to the type-only
// re-export when both exist. Lesson learned.
export type {
  Prisma,
  User,
} from '@prisma/client';

// Runtime exports — consumers do
//   import { PrismaClient, ClassName } from '../lib/prisma.js';
// without hitting the @prisma/client CJS-named-export error.
// Each enum's TYPE is inferred from the const via `typeof X`,
// so `let x: ClassName = 'JUGGERNAUT'` works downstream.
export {
  PrismaClient,
  AchievementCategory,
  BodyPart,
  CalorieGoal,
  CalorieSource,
  ClassName,
  DailyCategory,
  DayOfWeek,
  EquipSlot,
  FoodSource,
  GeneticMaxSource,
  HabitDirection,
  HairStyle,
  HeartLossTrigger,
  ItemRarity,
  MealType,
  MeasurementSource,
  MetricType,
  PrayerType,
  ShieldTier,
  SkipReason,
  SubstanceCategory,
  TrackedItemCategory,
  TrackedItemUnit,
  WorkoutSource,
  WorkoutType,
};