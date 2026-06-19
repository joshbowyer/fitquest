-- Track when the user last changed their class. Pairs with a 7-day cooldown
-- gate on the API to prevent casual class swapping.
ALTER TABLE "User" ADD COLUMN "classChangedAt" TIMESTAMP(3);
