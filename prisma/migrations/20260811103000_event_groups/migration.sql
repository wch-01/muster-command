CREATE TABLE "EventGroup" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scheduleMode" TEXT NOT NULL DEFAULT 'AS_DIRECTED',
  "startsAt" TIMESTAMP(3),
  "timingNote" TEXT,
  "predecessorGroupId" TEXT,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "EventGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTemplateGroup" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scheduleMode" TEXT NOT NULL DEFAULT 'AS_DIRECTED',
  "startsAt" TIMESTAMP(3),
  "timingNote" TEXT,
  "predecessorGroupId" TEXT,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "EventTemplateGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CrewSlot" ADD COLUMN "groupId" TEXT;
ALTER TABLE "EventTemplateSlot" ADD COLUMN "groupId" TEXT;

INSERT INTO "EventGroup" ("id", "eventId", "kind", "name", "scheduleMode", "sortOrder")
SELECT 'fleet-' || e."id", e."id", 'FLEET', 'Fleet 1',
  CASE WHEN e."startsAt" IS NULL THEN 'AS_DIRECTED' ELSE 'EVENT_START' END,
  0
FROM "Event" e
WHERE EXISTS (
  SELECT 1 FROM "CrewSlot" s WHERE s."eventId" = e."id" AND s."assignmentGroup" = 'ship'
);

INSERT INTO "EventGroup" ("id", "eventId", "kind", "name", "scheduleMode", "sortOrder")
SELECT 'ground-' || md5(s."eventId" || ':' || s."category"), s."eventId", 'GROUND', s."category",
  'AS_DIRECTED',
  (100 + ROW_NUMBER() OVER (PARTITION BY s."eventId" ORDER BY MIN(s."sortOrder")))::INTEGER
FROM "CrewSlot" s
WHERE s."assignmentGroup" = 'ground'
GROUP BY s."eventId", s."category";

UPDATE "CrewSlot" s
SET "groupId" = 'fleet-' || s."eventId"
WHERE s."assignmentGroup" = 'ship';

UPDATE "CrewSlot" s
SET "groupId" = 'ground-' || md5(s."eventId" || ':' || s."category")
WHERE s."assignmentGroup" = 'ground';

INSERT INTO "EventTemplateGroup" ("id", "templateId", "kind", "name", "scheduleMode", "sortOrder")
SELECT 'fleet-' || t."id", t."id", 'FLEET', 'Fleet 1', 'EVENT_START', 0
FROM "EventTemplate" t
WHERE EXISTS (
  SELECT 1 FROM "EventTemplateSlot" s WHERE s."templateId" = t."id" AND s."assignmentGroup" = 'ship'
);

INSERT INTO "EventTemplateGroup" ("id", "templateId", "kind", "name", "scheduleMode", "sortOrder")
SELECT 'ground-' || md5(s."templateId" || ':' || s."category"), s."templateId", 'GROUND', s."category",
  'AS_DIRECTED',
  (100 + ROW_NUMBER() OVER (PARTITION BY s."templateId" ORDER BY MIN(s."sortOrder")))::INTEGER
FROM "EventTemplateSlot" s
WHERE s."assignmentGroup" = 'ground'
GROUP BY s."templateId", s."category";

UPDATE "EventTemplateSlot" s
SET "groupId" = 'fleet-' || s."templateId"
WHERE s."assignmentGroup" = 'ship';

UPDATE "EventTemplateSlot" s
SET "groupId" = 'ground-' || md5(s."templateId" || ':' || s."category")
WHERE s."assignmentGroup" = 'ground';

CREATE INDEX "EventGroup_eventId_sortOrder_idx" ON "EventGroup"("eventId", "sortOrder");
CREATE INDEX "EventGroup_predecessorGroupId_idx" ON "EventGroup"("predecessorGroupId");
CREATE INDEX "EventTemplateGroup_templateId_sortOrder_idx" ON "EventTemplateGroup"("templateId", "sortOrder");
CREATE INDEX "EventTemplateGroup_predecessorGroupId_idx" ON "EventTemplateGroup"("predecessorGroupId");
CREATE INDEX "CrewSlot_groupId_idx" ON "CrewSlot"("groupId");
CREATE INDEX "EventTemplateSlot_groupId_idx" ON "EventTemplateSlot"("groupId");

ALTER TABLE "EventGroup"
ADD CONSTRAINT "EventGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventGroup"
ADD CONSTRAINT "EventGroup_predecessorGroupId_fkey" FOREIGN KEY ("predecessorGroupId") REFERENCES "EventGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventTemplateGroup"
ADD CONSTRAINT "EventTemplateGroup_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EventTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTemplateGroup"
ADD CONSTRAINT "EventTemplateGroup_predecessorGroupId_fkey" FOREIGN KEY ("predecessorGroupId") REFERENCES "EventTemplateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrewSlot"
ADD CONSTRAINT "CrewSlot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EventGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventTemplateSlot"
ADD CONSTRAINT "EventTemplateSlot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EventTemplateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
