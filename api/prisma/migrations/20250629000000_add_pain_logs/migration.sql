-- Pain logs for the STATUS tab. The user clicks a body part on
-- the 3D avatar to log intensity (0-10) + notes. Used to spot
-- patterns (left knee hurting after squats, etc.) and surface
-- recovery insights.
CREATE TYPE "BodyPart" AS ENUM (
  'HEAD', 'NECK', 'CHEST',
  'BACK_UPPER', 'BACK_LOWER',
  'SHOULDER_L', 'SHOULDER_R',
  'BICEP_L', 'BICEP_R',
  'FOREARM_L', 'FOREARM_R',
  'WRIST_L', 'WRIST_R',
  'HIP_L', 'HIP_R',
  'QUAD_L', 'QUAD_R',
  'HAMSTRING_L', 'HAMSTRING_R',
  'KNEE_L', 'KNEE_R',
  'CALF_L', 'CALF_R',
  'ANKLE_L', 'ANKLE_R',
  'FOOT_L', 'FOOT_R'
);

CREATE TABLE "PainLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bodyPart" "BodyPart" NOT NULL,
    "intensity" INTEGER NOT NULL,
    "notes" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PainLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PainLog_userId_bodyPart_idx" ON "PainLog"("userId", "bodyPart");
CREATE INDEX "PainLog_userId_loggedAt_idx" ON "PainLog"("userId", "loggedAt");

ALTER TABLE "PainLog" ADD CONSTRAINT "PainLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
