ALTER TABLE "Event" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "lootDurationHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "LootRaffle" ALTER COLUMN "endsAt" DROP NOT NULL;

ALTER TABLE "LootItem" ADD COLUMN "eventId" TEXT;
UPDATE "LootItem"
SET "eventId" = "LootRaffle"."eventId"
FROM "LootRaffle"
WHERE "LootItem"."lootRaffleId" = "LootRaffle"."id";
ALTER TABLE "LootItem" ALTER COLUMN "eventId" SET NOT NULL;
CREATE INDEX "LootItem_eventId_idx" ON "LootItem"("eventId");
