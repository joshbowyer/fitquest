-- CreateEnum
CREATE TYPE "ClassName" AS ENUM ('JUGGERNAUT', 'PHANTOM', 'SCOUT', 'BERSERKER', 'TRACER', 'ORACLE');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('BICEP', 'CHEST', 'SHOULDER', 'QUAD', 'CALF', 'FOREARM', 'NECK', 'WAIST', 'BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'OHP_1RM', 'PULLUP_1RM', 'BODY_FAT_PCT', 'LEAN_MASS', 'FFMI', 'WEIGHT', 'VO2_MAX', 'RESTING_HR', 'HRV', 'FIVE_K_TIME', 'ONE_MILE_TIME', 'PLANK_HOLD', 'L_SIT_HOLD', 'PUSHUP_MAX', 'PULLUP_MAX', 'POWERLIFT_TOTAL', 'SLEEP_HOURS', 'SLEEP_QUALITY', 'CALORIES', 'PROTEIN_G', 'WATER_ML', 'MOOD', 'ENERGY', 'SORENESS', 'STRESS', 'BODY_BATTERY', 'STEPS', 'RESPIRATION_RATE', 'SLEEP_ONSET');

-- CreateEnum
CREATE TYPE "MetricCategory" AS ENUM ('HYPERTROPHY', 'STRENGTH', 'BODY_COMP', 'CARDIO', 'CALISTHENICS');

-- CreateEnum
CREATE TYPE "WorkoutType" AS ENUM ('STRENGTH', 'HYPERTROPHY', 'CALISTHENICS', 'CARDIO', 'MOBILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('DEXA', 'BOD_POD', 'NAVY_TAPE', 'CALIPERS', 'BIA', 'VISUAL', 'UNKNOWN', 'MANUAL');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "HairStyle" AS ENUM ('SHORT', 'LONG', 'MOHAWK', 'BUZZ', 'PONYTAIL', 'PIXIE');

-- CreateEnum
CREATE TYPE "PrType" AS ENUM ('ONE_RM', 'VOLUME', 'REPS', 'TIME', 'HOLD');

-- CreateEnum
CREATE TYPE "CalorieGoal" AS ENUM ('CUT', 'MAINTAIN', 'BULK');

-- CreateEnum
CREATE TYPE "CalorieSource" AS ENUM ('BASELINE', 'BMR', 'BMR_NEAT');

-- CreateEnum
CREATE TYPE "SkillTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "UserMode" AS ENUM ('CASUAL', 'HARDCORE');

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('STRENGTH', 'HYPERTROPHY', 'CONSISTENCY', 'ENDURANCE', 'SOCIAL', 'CALISTHENICS', 'BODY_COMP');

-- CreateEnum
CREATE TYPE "GeneticMaxSource" AS ENUM ('FORMULA', 'MANUAL', 'PROJECTED');

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('METRIC', 'IMPERIAL');

-- CreateEnum
CREATE TYPE "RaidStatus" AS ENUM ('ACTIVE', 'VICTORY', 'DEFEAT');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('INJURY', 'ILLNESS', 'FATIGUE', 'EQUIPMENT', 'SCHEDULE', 'OTHER');

-- CreateEnum
CREATE TYPE "ShieldTier" AS ENUM ('FORTIFIED', 'STABLE', 'COMPROMISED', 'BREECHED');

-- CreateEnum
CREATE TYPE "BreachTier" AS ENUM ('MINOR', 'ELITE', 'LEGENDARY', 'APEX');

-- CreateEnum
CREATE TYPE "BreachDifficulty" AS ENUM ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE');

-- CreateEnum
CREATE TYPE "BreachClassAffinity" AS ENUM ('JUGGERNAUT', 'BERSERKER', 'PHANTOM', 'SCOUT', 'TRACER', 'ORACLE', 'ANY');

-- CreateEnum
CREATE TYPE "BreachProgressStatus" AS ENUM ('LOCKED', 'ACTIVE', 'VICTORY', 'COOLDOWN');

-- CreateEnum
CREATE TYPE "PortalLeakStatus" AS ENUM ('ACTIVE', 'DEFEATED', 'OVERWHELMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TeamWorkoutStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TeamParticipantStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'JOINED', 'CONFIRMED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PlateauKind" AS ENUM ('NO_PR_RECENT', 'ONE_RM_REGRESSION', 'VOLUME_REGRESSION', 'WEIGHT_FLATLINE', 'METRIC_FLATLINE', 'ALL');

-- CreateEnum
CREATE TYPE "BodyPart" AS ENUM ('HEAD', 'NECK', 'TRAPS', 'PECTORAL', 'BACK_UPPER', 'BACK_LOWER', 'LAT_L', 'LAT_R', 'ABS', 'OBLIQUE_L', 'OBLIQUE_R', 'CHEST', 'HIP_L', 'HIP_R', 'SHOULDER_L', 'SHOULDER_R', 'ROTATOR_CUFF_L', 'ROTATOR_CUFF_R', 'BICEP_L', 'BICEP_R', 'TRICEP_L', 'TRICEP_R', 'FOREARM_L', 'FOREARM_R', 'WRIST_L', 'WRIST_R', 'GLUTE_L', 'GLUTE_R', 'ADDUCTOR_L', 'ADDUCTOR_R', 'ABDUCTOR_L', 'ABDUCTOR_R', 'QUAD_L', 'QUAD_R', 'HAMSTRING_L', 'HAMSTRING_R', 'KNEE_L', 'KNEE_R', 'CALF_L', 'CALF_R', 'ANKLE_L', 'ANKLE_R', 'FOOT_L', 'FOOT_R');

-- CreateEnum
CREATE TYPE "WorldBossStatus" AS ENUM ('LOCKED', 'ACTIVE', 'DEFEATED');

-- CreateEnum
CREATE TYPE "PartyInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SpiritualSubclass" AS ENUM ('CATECHUMEN', 'CRUSADER', 'TEMPLAR');

-- CreateEnum
CREATE TYPE "PrayerType" AS ENUM ('ROSARY', 'MASS', 'SCRIPTURE', 'CONTEMPLATION', 'LITURGY_HOURS', 'CONFESSION', 'OTHER');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');

-- CreateEnum
CREATE TYPE "DailyCategory" AS ENUM ('USER', 'WORKOUT', 'SPIRITUAL', 'SLEEP');

-- CreateEnum
CREATE TYPE "HabitDirection" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "EquipSlot" AS ENUM ('HEAD', 'BODY', 'HANDS', 'FEET', 'MAIN', 'OFF', 'NECK', 'RING');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('MONSTER_DROP', 'BOSS_DROP', 'PORTAL_LEAK', 'QUEST_REWARD', 'SHOP', 'CRAFTED', 'ACHIEVEMENT', 'STARTER_KIT');

-- CreateEnum
CREATE TYPE "TrackedItemCategory" AS ENUM ('VITAMIN', 'MINERAL', 'FATTY_ACID', 'PROBIOTIC', 'HERB', 'AMINO_ACID', 'OTHER');

-- CreateEnum
CREATE TYPE "TrackedItemUnit" AS ENUM ('mg', 'g', 'mcg', 'iu', 'cfu', 'capsule', 'drop', 'scoop', 'pill');

-- CreateEnum
CREATE TYPE "SubstanceCategory" AS ENUM ('NICOTINE', 'CAFFEINE', 'ALCOHOL', 'ELECTROLYTE');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "FoodSource" AS ENUM ('OPENFOODFACTS', 'USDA', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "class" "ClassName",
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "soulstones" INTEGER NOT NULL DEFAULT 0,
    "units" "UnitSystem" NOT NULL DEFAULT 'METRIC',
    "heightCm" DOUBLE PRECISION,
    "wristCm" DOUBLE PRECISION,
    "ankleCm" DOUBLE PRECISION,
    "forearmLengthCm" DOUBLE PRECISION,
    "neckCircCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "birthDate" TIMESTAMP(3),
    "benchPr" DOUBLE PRECISION,
    "squatPr" DOUBLE PRECISION,
    "deadliftPr" DOUBLE PRECISION,
    "ohpPr" DOUBLE PRECISION,
    "pullupPr" INTEGER,
    "classChangedAt" TIMESTAMP(3),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorBackupCodes" TEXT,
    "spiritualDailyPrayers" "PrayerType"[] DEFAULT ARRAY['ROSARY', 'SCRIPTURE']::"PrayerType"[],
    "creatine" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "spiritualSubclass" "SpiritualSubclass",
    "spiritualXp" INTEGER NOT NULL DEFAULT 0,
    "ordained" BOOLEAN NOT NULL DEFAULT false,
    "ordainedAt" TIMESTAMP(3),
    "sex" "Sex",
    "goal" "CalorieGoal" NOT NULL DEFAULT 'MAINTAIN',
    "mode" "UserMode" NOT NULL DEFAULT 'CASUAL',
    "hearts" INTEGER NOT NULL DEFAULT 5,
    "heartsLastRegenAt" TIMESTAMP(3),
    "calorieBaseline" INTEGER NOT NULL DEFAULT 2200,
    "calorieSource" "CalorieSource" NOT NULL DEFAULT 'BASELINE',
    "usdaApiKey" TEXT,
    "navOrder" JSONB,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "MetricType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "MeasurementSource" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneticMax" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "MetricType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" "GeneticMaxSource" NOT NULL DEFAULT 'FORMULA',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneticMax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WorkoutType" NOT NULL,
    "name" TEXT,
    "duration" INTEGER,
    "notes" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackJson" JSONB NOT NULL DEFAULT '[]',
    "cardio" JSONB,
    "validityFlags" JSONB,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "musclesWorked" "BodyPart"[] DEFAULT ARRAY[]::"BodyPart"[],

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Set" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "reps" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION,
    "duration" INTEGER,
    "rpe" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" "SkipReason",

    CONSTRAINT "Set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pr" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PrType" NOT NULL,
    "exercise" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workoutId" TEXT,

    CONSTRAINT "Pr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "className" "ClassName" NOT NULL,
    "tier" "SkillTier" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 1,
    "prerequisites" TEXT[],
    "position" INTEGER NOT NULL,
    "effects" JSONB NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avatar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hairStyle" "HairStyle" NOT NULL DEFAULT 'SHORT',
    "hairColor" TEXT NOT NULL DEFAULT '#56e88e',
    "skinTone" TEXT NOT NULL DEFAULT '#d0a878',
    "shirtColor" TEXT NOT NULL DEFAULT '#14d6e8',
    "pantsColor" TEXT NOT NULL DEFAULT '#424553',
    "accentColor" TEXT NOT NULL DEFAULT '#f55cc4',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shield" INTEGER NOT NULL DEFAULT 100,
    "tier" "ShieldTier" NOT NULL DEFAULT 'FORTIFIED',
    "shieldLastDecay" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenanceTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "flavor" TEXT,
    "shieldDelta" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenanceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "penanceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shieldDelta" INTEGER NOT NULL,
    "shieldAfter" INTEGER NOT NULL,
    "tierAfter" "ShieldTier" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachBoss" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lore" TEXT,
    "difficulty" "BreachDifficulty" NOT NULL,
    "tier" "BreachTier" NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "hp" INTEGER NOT NULL,
    "classAffinity" "BreachClassAffinity" NOT NULL DEFAULT 'ANY',
    "preferredTags" JSONB NOT NULL,
    "bonusTags" JSONB NOT NULL DEFAULT '[]',
    "intro" TEXT,
    "spriteEmoji" TEXT NOT NULL DEFAULT '◉',
    "spriteColor" TEXT NOT NULL DEFAULT '#dc2626',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachBoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBreachProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentBossId" TEXT,
    "bossHp" INTEGER NOT NULL DEFAULT 0,
    "status" "BreachProgressStatus" NOT NULL DEFAULT 'LOCKED',
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "lastDeathAt" TIMESTAMP(3),
    "soulstones" INTEGER NOT NULL DEFAULT 0,
    "damageToday" INTEGER NOT NULL DEFAULT 0,
    "damageDayKey" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "recentBossIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBreachProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachDamageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bossId" TEXT NOT NULL,
    "workoutId" TEXT,
    "damage" INTEGER NOT NULL,
    "bossHpAfter" INTEGER NOT NULL,
    "matchType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachDamageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalLeak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monsterName" TEXT NOT NULL,
    "monsterEmoji" TEXT NOT NULL,
    "monsterColor" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "preferredTags" JSONB NOT NULL,
    "bonusTags" JSONB NOT NULL DEFAULT '[]',
    "hp" INTEGER NOT NULL DEFAULT 100,
    "maxHp" INTEGER NOT NULL DEFAULT 100,
    "status" "PortalLeakStatus" NOT NULL DEFAULT 'ACTIVE',
    "spawnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "itemDrop" TEXT,
    "resolvedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalLeak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalLeakDamageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leakId" TEXT NOT NULL,
    "workoutId" TEXT,
    "damage" INTEGER NOT NULL,
    "leakHpAfter" INTEGER NOT NULL,
    "matchType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalLeakDamageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyMember" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamWorkout" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" "TeamWorkoutStatus" NOT NULL DEFAULT 'PENDING',
    "routineName" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TeamWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamParticipant" (
    "id" TEXT NOT NULL,
    "teamWorkoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TeamParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "workoutId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "TeamParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyCamaraderie" (
    "partyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'Cold',
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyCamaraderie_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "PartyBuff" (
    "partyId" TEXT NOT NULL,
    "raidDmgBonusPct" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PartyBuff_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "Raid" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "bossName" TEXT NOT NULL,
    "bossHp" INTEGER NOT NULL,
    "bossMaxHp" INTEGER NOT NULL,
    "status" "RaidStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Raid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaidContribution" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "damage" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "contributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "icon" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateauPause" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PlateauKind" NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateauPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateauSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "plateaus" TEXT NOT NULL,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateauSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamenResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "consoled" TEXT NOT NULL,
    "desolated" TEXT NOT NULL,
    "godsPresence" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamenResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'FULL',

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWorldProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWorldProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PainLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bodyPart" "BodyPart" NOT NULL,
    "intensity" INTEGER NOT NULL,
    "notes" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weeklyGoal" INTEGER NOT NULL DEFAULT 3,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedWeek" TEXT,
    "streakUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldBoss" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "bossName" TEXT NOT NULL,
    "bossGlyph" TEXT NOT NULL,
    "bossHp" INTEGER NOT NULL,
    "bossMaxHp" INTEGER NOT NULL,
    "status" "WorldBossStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMP(3),
    "defeatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldBoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyInvite" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT,
    "inviteeUsername" TEXT NOT NULL,
    "status" "PartyInviteStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PrayerType",
    "dailyId" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 15,
    "notes" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "goldAwarded" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrayerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "workout" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DailyCategory" NOT NULL DEFAULT 'USER',
    "days" "DayOfWeek"[],
    "isDaily" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "goldReward" INTEGER NOT NULL DEFAULT 5,
    "xpReward" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyId" TEXT NOT NULL,
    "dailyKey" TEXT NOT NULL,
    "goldDelta" INTEGER NOT NULL DEFAULT 0,
    "xpDelta" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doseMg" INTEGER,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Habit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "direction" "HabitDirection" NOT NULL,
    "goldReward" INTEGER NOT NULL DEFAULT 5,
    "xpReward" INTEGER NOT NULL DEFAULT 2,
    "icon" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "goldDelta" INTEGER NOT NULL DEFAULT 0,
    "xpDelta" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDef" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slot" "EquipSlot" NOT NULL,
    "sprite" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#a8a8b8',
    "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "classRestriction" "ClassName",
    "setId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemDefId" TEXT NOT NULL,
    "equippedSlot" "EquipSlot",
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ItemSource" NOT NULL DEFAULT 'MONSTER_DROP',
    "notes" TEXT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'OPENAI',
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackProvider" TEXT,
    "fallbackApiKey" TEXT,
    "fallbackBaseUrl" TEXT,
    "fallbackModel" TEXT,
    "taskOverrides" JSONB,
    "systemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MorningReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "general" TEXT,
    "sleep" TEXT,
    "training" TEXT,
    "recovery" TEXT,
    "nutrition" TEXT,
    "spiritual" TEXT,
    "riskFlags" TEXT,
    "penalties" TEXT,
    "plateaus" TEXT,
    "nudges" TEXT,
    "positiveNudges" TEXT,
    "impossibleValueFlags" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MorningReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsccbDailyReading" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "liturgicalInfo" TEXT,
    "firstReading" TEXT,
    "firstReadingRef" TEXT,
    "responsorialPsalm" TEXT,
    "psalmRef" TEXT,
    "gospelAcclamation" TEXT,
    "gospel" TEXT,
    "gospelRef" TEXT,
    "source" TEXT NOT NULL DEFAULT 'usccb',
    "sourceHash" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsccbDailyReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpiritualReflection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "gospelRef" TEXT,
    "gospelText" TEXT,
    "liturgicalInfo" TEXT,
    "reflection" TEXT NOT NULL,
    "patronSuggestion" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpiritualReflection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrackedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TrackedItemCategory" NOT NULL,
    "defaultDose" DOUBLE PRECISION NOT NULL,
    "doseUnit" "TrackedItemUnit" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrackedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTrackedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dose" DOUBLE PRECISION NOT NULL,
    "doseUnit" "TrackedItemUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTrackedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstanceLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "SubstanceCategory" NOT NULL,
    "form" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "unit" TEXT,
    "context" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL,
    "source" "FoodSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "imageUrl" TEXT,
    "servingSizeG" DOUBLE PRECISION,
    "calories" DOUBLE PRECISION NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "fiberG" DOUBLE PRECISION,
    "sugarG" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "meal" "MealType" NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFood" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "servingSizeG" DOUBLE PRECISION,
    "calories" DOUBLE PRECISION NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "fiberG" DOUBLE PRECISION,
    "sugarG" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "recipe" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCache" (
    "key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "shortName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "zoom" INTEGER NOT NULL DEFAULT 10,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CorrelationSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "lookbackDays" INTEGER NOT NULL,
    "habit" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "r" DOUBLE PRECISION NOT NULL,
    "n" INTEGER NOT NULL,

    CONSTRAINT "CorrelationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastIp" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "MetricType" NOT NULL,
    "summary" TEXT NOT NULL,
    "factors" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "recoveryLoad" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "factors" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "Measurement_userId_metric_recordedAt_idx" ON "Measurement"("userId", "metric", "recordedAt");

-- CreateIndex
CREATE INDEX "Measurement_userId_metric_source_recordedAt_idx" ON "Measurement"("userId", "metric", "source", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneticMax_userId_metric_key" ON "GeneticMax"("userId", "metric");

-- CreateIndex
CREATE INDEX "Workout_userId_performedAt_idx" ON "Workout"("userId", "performedAt");

-- CreateIndex
CREATE INDEX "Pr_userId_exercise_achievedAt_idx" ON "Pr"("userId", "exercise", "achievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_userId_key" ON "Avatar"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_userId_skillId_key" ON "UserSkill"("userId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeBase_userId_key" ON "HomeBase"("userId");

-- CreateIndex
CREATE INDEX "PenanceTemplate_userId_enabled_idx" ON "PenanceTemplate"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PenanceTemplate_userId_key_key" ON "PenanceTemplate"("userId", "key");

-- CreateIndex
CREATE INDEX "PenanceEvent_userId_createdAt_idx" ON "PenanceEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PenanceEvent_userId_source_idx" ON "PenanceEvent"("userId", "source");

-- CreateIndex
CREATE INDEX "BreachBoss_tier_difficulty_idx" ON "BreachBoss"("tier", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "UserBreachProgress_userId_key" ON "UserBreachProgress"("userId");

-- CreateIndex
CREATE INDEX "UserBreachProgress_status_idx" ON "UserBreachProgress"("status");

-- CreateIndex
CREATE INDEX "BreachDamageEvent_userId_createdAt_idx" ON "BreachDamageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BreachDamageEvent_bossId_createdAt_idx" ON "BreachDamageEvent"("bossId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalLeak_userId_status_idx" ON "PortalLeak"("userId", "status");

-- CreateIndex
CREATE INDEX "PortalLeak_userId_spawnedAt_idx" ON "PortalLeak"("userId", "spawnedAt");

-- CreateIndex
CREATE INDEX "PortalLeakDamageEvent_userId_createdAt_idx" ON "PortalLeakDamageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalLeakDamageEvent_leakId_createdAt_idx" ON "PortalLeakDamageEvent"("leakId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartyMember_userId_key" ON "PartyMember"("userId");

-- CreateIndex
CREATE INDEX "TeamWorkout_partyId_status_idx" ON "TeamWorkout"("partyId", "status");

-- CreateIndex
CREATE INDEX "TeamWorkout_leaderId_idx" ON "TeamWorkout"("leaderId");

-- CreateIndex
CREATE INDEX "TeamParticipant_userId_status_idx" ON "TeamParticipant"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamParticipant_teamWorkoutId_userId_key" ON "TeamParticipant"("teamWorkoutId", "userId");

-- CreateIndex
CREATE INDEX "RaidContribution_raidId_userId_idx" ON "RaidContribution"("raidId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "PlateauPause_userId_resumeAt_idx" ON "PlateauPause"("userId", "resumeAt");

-- CreateIndex
CREATE INDEX "PlateauSnapshot_userId_generatedAt_idx" ON "PlateauSnapshot"("userId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlateauSnapshot_userId_weekStart_key" ON "PlateauSnapshot"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "ExamenResponse_userId_createdAt_idx" ON "ExamenResponse"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamenResponse_userId_weekStart_key" ON "ExamenResponse"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "UserWorldProgress_userId_idx" ON "UserWorldProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWorldProgress_userId_levelId_key" ON "UserWorldProgress"("userId", "levelId");

-- CreateIndex
CREATE INDEX "PainLog_userId_bodyPart_idx" ON "PainLog"("userId", "bodyPart");

-- CreateIndex
CREATE INDEX "PainLog_userId_loggedAt_idx" ON "PainLog"("userId", "loggedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Routine_userId_key" ON "Routine"("userId");

-- CreateIndex
CREATE INDEX "WorldBoss_userId_idx" ON "WorldBoss"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldBoss_userId_worldId_key" ON "WorldBoss"("userId", "worldId");

-- CreateIndex
CREATE INDEX "PartyInvite_inviteeId_status_idx" ON "PartyInvite"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "PartyInvite_partyId_idx" ON "PartyInvite"("partyId");

-- CreateIndex
CREATE INDEX "PrayerLog_userId_loggedAt_idx" ON "PrayerLog"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "RoutineDay_userId_idx" ON "RoutineDay"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_userId_day_key" ON "RoutineDay"("userId", "day");

-- CreateIndex
CREATE INDEX "Daily_userId_archived_idx" ON "Daily"("userId", "archived");

-- CreateIndex
CREATE INDEX "DailyLog_userId_dailyKey_loggedAt_idx" ON "DailyLog"("userId", "dailyKey", "loggedAt");

-- CreateIndex
CREATE INDEX "DailyLog_userId_loggedAt_idx" ON "DailyLog"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "DailyLog_dailyId_loggedAt_idx" ON "DailyLog"("dailyId", "loggedAt");

-- CreateIndex
CREATE INDEX "SupplementLog_userId_name_takenAt_idx" ON "SupplementLog"("userId", "name", "takenAt");

-- CreateIndex
CREATE INDEX "Habit_userId_archived_idx" ON "Habit"("userId", "archived");

-- CreateIndex
CREATE INDEX "HabitLog_userId_loggedAt_idx" ON "HabitLog"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "HabitLog_habitId_loggedAt_idx" ON "HabitLog"("habitId", "loggedAt");

-- CreateIndex
CREATE INDEX "ItemDef_slot_idx" ON "ItemDef"("slot");

-- CreateIndex
CREATE INDEX "ItemDef_rarity_idx" ON "ItemDef"("rarity");

-- CreateIndex
CREATE INDEX "ItemDef_classRestriction_idx" ON "ItemDef"("classRestriction");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_equippedSlot_idx" ON "InventoryItem"("userId", "equippedSlot");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_userId_itemDefId_acquiredAt_key" ON "InventoryItem"("userId", "itemDefId", "acquiredAt");

-- CreateIndex
CREATE INDEX "MorningReport_userId_date_idx" ON "MorningReport"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MorningReport_userId_date_key" ON "MorningReport"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UsccbDailyReading_date_key" ON "UsccbDailyReading"("date");

-- CreateIndex
CREATE INDEX "SpiritualReflection_userId_date_idx" ON "SpiritualReflection"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SpiritualReflection_userId_date_key" ON "SpiritualReflection"("userId", "date");

-- CreateIndex
CREATE INDEX "UserTrackedItem_userId_category_idx" ON "UserTrackedItem"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "UserTrackedItem_userId_name_category_key" ON "UserTrackedItem"("userId", "name", "category");

-- CreateIndex
CREATE INDEX "DailyTrackedItem_userId_date_idx" ON "DailyTrackedItem"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyTrackedItem_itemId_date_idx" ON "DailyTrackedItem"("itemId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTrackedItem_userId_itemId_date_key" ON "DailyTrackedItem"("userId", "itemId", "date");

-- CreateIndex
CREATE INDEX "SubstanceLog_userId_loggedAt_idx" ON "SubstanceLog"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "SubstanceLog_userId_category_loggedAt_idx" ON "SubstanceLog"("userId", "category", "loggedAt");

-- CreateIndex
CREATE INDEX "FoodItem_name_idx" ON "FoodItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_source_sourceId_key" ON "FoodItem"("source", "sourceId");

-- CreateIndex
CREATE INDEX "MealEntry_userId_loggedAt_idx" ON "MealEntry"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "MealEntry_userId_meal_loggedAt_idx" ON "MealEntry"("userId", "meal", "loggedAt");

-- CreateIndex
CREATE INDEX "SavedFood_userId_lastUsedAt_idx" ON "SavedFood"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedFood_userId_name_key" ON "SavedFood"("userId", "name");

-- CreateIndex
CREATE INDEX "CorrelationSnapshot_userId_habit_outcome_snapshotDate_idx" ON "CorrelationSnapshot"("userId", "habit", "outcome", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "CorrelationSnapshot_userId_snapshotDate_habit_outcome_lagDa_key" ON "CorrelationSnapshot"("userId", "snapshotDate", "habit", "outcome", "lagDays", "lookbackDays");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_expiresAt_idx" ON "TrustedDevice"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "MetricInsight_userId_idx" ON "MetricInsight"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MetricInsight_userId_metric_key" ON "MetricInsight"("userId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityInsight_workoutId_key" ON "ActivityInsight"("workoutId");

-- CreateIndex
CREATE INDEX "ActivityInsight_userId_idx" ON "ActivityInsight"("userId");

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneticMax" ADD CONSTRAINT "GeneticMax_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pr" ADD CONSTRAINT "Pr_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeBase" ADD CONSTRAINT "HomeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenanceTemplate" ADD CONSTRAINT "PenanceTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenanceEvent" ADD CONSTRAINT "PenanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBreachProgress" ADD CONSTRAINT "UserBreachProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBreachProgress" ADD CONSTRAINT "UserBreachProgress_currentBossId_fkey" FOREIGN KEY ("currentBossId") REFERENCES "BreachBoss"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_bossId_fkey" FOREIGN KEY ("bossId") REFERENCES "BreachBoss"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeak" ADD CONSTRAINT "PortalLeak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_leakId_fkey" FOREIGN KEY ("leakId") REFERENCES "PortalLeak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamWorkout" ADD CONSTRAINT "TeamWorkout_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamWorkout" ADD CONSTRAINT "TeamWorkout_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamParticipant" ADD CONSTRAINT "TeamParticipant_teamWorkoutId_fkey" FOREIGN KEY ("teamWorkoutId") REFERENCES "TeamWorkout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamParticipant" ADD CONSTRAINT "TeamParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyCamaraderie" ADD CONSTRAINT "PartyCamaraderie_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyBuff" ADD CONSTRAINT "PartyBuff_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Raid" ADD CONSTRAINT "Raid_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidContribution" ADD CONSTRAINT "RaidContribution_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "Raid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidContribution" ADD CONSTRAINT "RaidContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateauPause" ADD CONSTRAINT "PlateauPause_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateauSnapshot" ADD CONSTRAINT "PlateauSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamenResponse" ADD CONSTRAINT "ExamenResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorldProgress" ADD CONSTRAINT "UserWorldProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PainLog" ADD CONSTRAINT "PainLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldBoss" ADD CONSTRAINT "WorldBoss_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerLog" ADD CONSTRAINT "PrayerLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerLog" ADD CONSTRAINT "PrayerLog_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "Daily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDay" ADD CONSTRAINT "RoutineDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Daily" ADD CONSTRAINT "Daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "Daily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementLog" ADD CONSTRAINT "SupplementLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemDefId_fkey" FOREIGN KEY ("itemDefId") REFERENCES "ItemDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MorningReport" ADD CONSTRAINT "MorningReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritualReflection" ADD CONSTRAINT "SpiritualReflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrackedItem" ADD CONSTRAINT "UserTrackedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTrackedItem" ADD CONSTRAINT "DailyTrackedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTrackedItem" ADD CONSTRAINT "DailyTrackedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "UserTrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstanceLog" ADD CONSTRAINT "SubstanceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFood" ADD CONSTRAINT "SavedFood_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationSnapshot" ADD CONSTRAINT "CorrelationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricInsight" ADD CONSTRAINT "MetricInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInsight" ADD CONSTRAINT "ActivityInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

