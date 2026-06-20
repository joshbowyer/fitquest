CREATE TYPE "PartyInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

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

CREATE INDEX "PartyInvite_inviteeId_status_idx" ON "PartyInvite"("inviteeId", "status");
CREATE INDEX "PartyInvite_partyId_idx" ON "PartyInvite"("partyId");

ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;