-- Phase 5 intentionally resets pre-release test loot instead of migrating it.
DELETE FROM "LootBid";
DELETE FROM "LootItem";

ALTER TABLE "Event"
ADD COLUMN "resourceLootPolicy" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN "resourceInstructions" TEXT,
ADD COLUMN "lootInstructions" TEXT,
ADD COLUMN "lootAwardMethod" TEXT NOT NULL DEFAULT 'FULL_QUANTITY',
ADD COLUMN "lootRepeatWinnerMode" TEXT NOT NULL DEFAULT 'DIFFERENT_WINNERS';

ALTER TABLE "EventTemplate"
ADD COLUMN "lootDurationHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN "resourceLootPolicy" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN "resourceInstructions" TEXT,
ADD COLUMN "lootInstructions" TEXT,
ADD COLUMN "lootAwardMethod" TEXT NOT NULL DEFAULT 'FULL_QUANTITY',
ADD COLUMN "lootRepeatWinnerMode" TEXT NOT NULL DEFAULT 'DIFFERENT_WINNERS';

ALTER TABLE "LootRaffle"
ADD COLUMN "automaticDrawEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LootItem"
DROP COLUMN "winnerUserId",
DROP COLUMN "winnerTag",
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "quality" INTEGER,
ADD COLUMN "unit" TEXT;

CREATE TABLE "LootAward" (
  "id" TEXT NOT NULL,
  "lootItemId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "discordTag" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LootAward_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LootAward_lootItemId_idx" ON "LootAward"("lootItemId");
ALTER TABLE "LootAward" ADD CONSTRAINT "LootAward_lootItemId_fkey"
FOREIGN KEY ("lootItemId") REFERENCES "LootItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
