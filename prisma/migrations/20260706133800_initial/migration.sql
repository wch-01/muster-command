CREATE TYPE "EventStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "RaffleStatus" AS ENUM ('OPEN', 'DRAWN');

CREATE TABLE "Event" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "reportChannelId" TEXT,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "lootDurationHours" INTEGER NOT NULL DEFAULT 24,
  "status" "EventStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrewSlot" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "CrewSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrewAssignment" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "crewSlotId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "discordTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrewAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LootRaffle" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "name" TEXT NOT NULL,
  "endsAt" TIMESTAMP(3),
  "status" "RaffleStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LootRaffle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LootItem" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "lootRaffleId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "winnerUserId" TEXT,
  "winnerTag" TEXT,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "LootItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LootBid" (
  "id" TEXT NOT NULL,
  "lootItemId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "discordTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LootBid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewAssignment_eventId_discordUserId_key" ON "CrewAssignment"("eventId", "discordUserId");
CREATE UNIQUE INDEX "LootBid_lootItemId_discordUserId_key" ON "LootBid"("lootItemId", "discordUserId");
CREATE INDEX "Event_guildId_status_idx" ON "Event"("guildId", "status");
CREATE INDEX "CrewSlot_eventId_sortOrder_idx" ON "CrewSlot"("eventId", "sortOrder");
CREATE INDEX "CrewAssignment_crewSlotId_idx" ON "CrewAssignment"("crewSlotId");
CREATE INDEX "LootRaffle_status_endsAt_idx" ON "LootRaffle"("status", "endsAt");
CREATE INDEX "LootItem_eventId_idx" ON "LootItem"("eventId");
CREATE INDEX "LootItem_lootRaffleId_sortOrder_idx" ON "LootItem"("lootRaffleId", "sortOrder");

ALTER TABLE "CrewSlot" ADD CONSTRAINT "CrewSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_crewSlotId_fkey" FOREIGN KEY ("crewSlotId") REFERENCES "CrewSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LootRaffle" ADD CONSTRAINT "LootRaffle_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LootItem" ADD CONSTRAINT "LootItem_lootRaffleId_fkey" FOREIGN KEY ("lootRaffleId") REFERENCES "LootRaffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LootBid" ADD CONSTRAINT "LootBid_lootItemId_fkey" FOREIGN KEY ("lootItemId") REFERENCES "LootItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
