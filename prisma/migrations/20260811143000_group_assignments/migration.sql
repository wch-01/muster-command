ALTER TABLE "CrewAssignment"
ADD COLUMN "groupId" TEXT;

UPDATE "CrewAssignment" AS assignment
SET "groupId" = slot."groupId"
FROM "CrewSlot" AS slot
WHERE assignment."crewSlotId" = slot.id;

DROP INDEX IF EXISTS "CrewAssignment_eventId_discordUserId_assignmentGroup_key";

CREATE UNIQUE INDEX "CrewAssignment_eventId_discordUserId_groupId_key"
ON "CrewAssignment"("eventId", "discordUserId", "groupId");

CREATE INDEX "CrewAssignment_groupId_idx"
ON "CrewAssignment"("groupId");

ALTER TABLE "CrewAssignment"
ADD CONSTRAINT "CrewAssignment_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "EventGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
