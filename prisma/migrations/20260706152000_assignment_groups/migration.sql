ALTER TABLE "CrewSlot" ADD COLUMN "assignmentGroup" TEXT NOT NULL DEFAULT 'ship';
ALTER TABLE "CrewAssignment" ADD COLUMN "assignmentGroup" TEXT NOT NULL DEFAULT 'ship';

UPDATE "CrewSlot"
SET "assignmentGroup" = 'ground'
WHERE lower("category" || ' ' || "label") LIKE '%ground%'
   OR lower("category" || ' ' || "label") LIKE '%medic%'
   OR lower("category" || ' ' || "label") LIKE '%industrial%'
   OR lower("category" || ' ' || "label") LIKE '%combat%'
   OR lower("category" || ' ' || "label") LIKE '%tech%';

UPDATE "CrewAssignment"
SET "assignmentGroup" = "CrewSlot"."assignmentGroup"
FROM "CrewSlot"
WHERE "CrewAssignment"."crewSlotId" = "CrewSlot"."id";

DROP INDEX "CrewAssignment_eventId_discordUserId_key";
CREATE UNIQUE INDEX "CrewAssignment_eventId_discordUserId_assignmentGroup_key"
ON "CrewAssignment"("eventId", "discordUserId", "assignmentGroup");
