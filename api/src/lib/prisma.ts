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
// dance entirely. The named exports are re-bound as proper ESM
// exports so consumers do
//
//   import { PrismaClient, ClassName, Prisma, ... } from './lib/prisma.js';
//
// without hitting the @prisma/client CJS export error.
//
// TYPES: requireCjs returns `any`, which used to make PrismaClient
// and every enum collapse to `any` for consumers (breaking type
// positions with TS2749 and untying all query-result types). The
// fix: cast the loaded module to `typeof import('@prisma/client')`
// — same runtime object, real static types — and pair each value
// export with a type alias of the same name. An exported name with
// both a value meaning (the runtime const/class) and a type meaning
// (instance type / literal union) behaves exactly like the original
// class/enum declaration for consumers:
//
//   export const ClassName = cjs.ClassName;                    // value
//   export type ClassName = import('@prisma/client').ClassName; // type
//
// Because the value side is a genuine runtime export, tsc/tsx never
// elide downstream `import { X }` when X is used in a value position
// (e.g. `z.nativeEnum(X)`, `new PrismaClient()`), while type-only
// consumers still get proper elision. Do NOT convert these to
// `export type { ... } from '@prisma/client'` re-exports — that
// removes the runtime binding and breaks value consumers.
// ============================================================

import { createRequire } from 'module';
import { config } from './config.js';

// createRequire(import.meta.url) returns a require function
// rooted at THIS file's URL. Works inside ESM since Node 12.
const requireCjs = createRequire(import.meta.url);

// Load @prisma/client as a CommonJS module. The cast gives tsc the
// real module shape (generated in node_modules/.prisma/client);
// runtime behavior is unchanged.
const cjs = requireCjs('@prisma/client') as typeof import('@prisma/client');

// PrismaClient is a CLASS: export both the constructor value and
// the instance type under the same name, mirroring the original
// class declaration.
export const PrismaClient = cjs.PrismaClient;
export type PrismaClient = import('@prisma/client').PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });

if (config.isDev) {
  globalThis.__prisma = prisma;
}

// Prisma namespace: BOTH a runtime value (Prisma.AnyNull /
// Prisma.DbNull / Prisma.JsonNull sentinels for Json-column
// filters, Prisma.sql, etc.) and a type namespace
// (Prisma.TransactionClient). Export both sides so routes can
// write `test: { not: Prisma.AnyNull }` — the only spelling
// Prisma 5 accepts for "Json column IS NOT NULL" (a bare `null`
// throws PrismaClientValidationError at runtime).
// Runtime side of the Prisma namespace: the Json-null sentinels
// (Prisma.AnyNull / DbNull / JsonNull — the only spellings Prisma 5
// accepts for Json-column null filters; a bare `null` throws
// PrismaClientValidationError), Prisma.sql, etc. Exported under a
// DISTINCT name because TS cannot merge a const with a type-only
// re-export of the same identifier (TS2484) — `Prisma` below stays
// type-only for Prisma.TransactionClient-style usage.
export const PrismaRuntime = cjs.Prisma;

export type {
  Prisma,
  User,
} from '@prisma/client';

// Runtime enum exports — consumers do
//   import { ClassName } from '../lib/prisma.js';
// and can use the name as a value (`ClassName.JUGGERNAUT`,
// `z.nativeEnum(ClassName)`) or a type (`let x: ClassName`).
// Enums alphabetical for diff hygiene.
export const AchievementCategory = cjs.AchievementCategory;
export type AchievementCategory = import('@prisma/client').AchievementCategory;

export const BodyPart = cjs.BodyPart;
export type BodyPart = import('@prisma/client').BodyPart;

export const CalorieGoal = cjs.CalorieGoal;
export type CalorieGoal = import('@prisma/client').CalorieGoal;

export const CalorieSource = cjs.CalorieSource;
export type CalorieSource = import('@prisma/client').CalorieSource;

export const ClassName = cjs.ClassName;
export type ClassName = import('@prisma/client').ClassName;

export const CoachPersonality = cjs.CoachPersonality;
export type CoachPersonality = import('@prisma/client').CoachPersonality;

export const TodoPriority = cjs.TodoPriority;
export type TodoPriority = import('@prisma/client').TodoPriority;

export const TodoStatus = cjs.TodoStatus;
export type TodoStatus = import('@prisma/client').TodoStatus;

export const NotificationCategory = cjs.NotificationCategory;
export type NotificationCategory = import('@prisma/client').NotificationCategory;

export const DailyCategory = cjs.DailyCategory;
export type DailyCategory = import('@prisma/client').DailyCategory;

export const DayOfWeek = cjs.DayOfWeek;
export type DayOfWeek = import('@prisma/client').DayOfWeek;

export const EquipSlot = cjs.EquipSlot;
export type EquipSlot = import('@prisma/client').EquipSlot;

export const FoodSource = cjs.FoodSource;
export type FoodSource = import('@prisma/client').FoodSource;

export const GeneticMaxSource = cjs.GeneticMaxSource;
export type GeneticMaxSource = import('@prisma/client').GeneticMaxSource;

export const HabitDirection = cjs.HabitDirection;
export type HabitDirection = import('@prisma/client').HabitDirection;

export const HairStyle = cjs.HairStyle;
export type HairStyle = import('@prisma/client').HairStyle;

export const HeartLossTrigger = cjs.HeartLossTrigger;
export type HeartLossTrigger = import('@prisma/client').HeartLossTrigger;

export const ItemRarity = cjs.ItemRarity;
export type ItemRarity = import('@prisma/client').ItemRarity;

export const MealType = cjs.MealType;
export type MealType = import('@prisma/client').MealType;

export const MeasurementSource = cjs.MeasurementSource;
export type MeasurementSource = import('@prisma/client').MeasurementSource;

export const MetricType = cjs.MetricType;
export type MetricType = import('@prisma/client').MetricType;

export const PrayerType = cjs.PrayerType;
export type PrayerType = import('@prisma/client').PrayerType;

export const ShieldTier = cjs.ShieldTier;
export type ShieldTier = import('@prisma/client').ShieldTier;

export const SkipReason = cjs.SkipReason;
export type SkipReason = import('@prisma/client').SkipReason;

export const SubstanceCategory = cjs.SubstanceCategory;
export type SubstanceCategory = import('@prisma/client').SubstanceCategory;

export const TrackedItemCategory = cjs.TrackedItemCategory;
export type TrackedItemCategory = import('@prisma/client').TrackedItemCategory;

export const TrackedItemUnit = cjs.TrackedItemUnit;
export type TrackedItemUnit = import('@prisma/client').TrackedItemUnit;

export const WorkoutSource = cjs.WorkoutSource;
export type WorkoutSource = import('@prisma/client').WorkoutSource;

export const WorkoutType = cjs.WorkoutType;
export type WorkoutType = import('@prisma/client').WorkoutType;
