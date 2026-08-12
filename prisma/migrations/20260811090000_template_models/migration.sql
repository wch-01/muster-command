CREATE TABLE IF NOT EXISTS "EventTemplate" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventTemplateSlot" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "assignmentGroup" TEXT NOT NULL DEFAULT 'ship',
  "label" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "EventTemplateSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventTemplate_guildId_name_key" ON "EventTemplate"("guildId", "name");
CREATE INDEX IF NOT EXISTS "EventTemplate_guildId_idx" ON "EventTemplate"("guildId");
CREATE INDEX IF NOT EXISTS "EventTemplateSlot_templateId_sortOrder_idx" ON "EventTemplateSlot"("templateId", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventTemplateSlot_templateId_fkey') THEN
    ALTER TABLE "EventTemplateSlot"
    ADD CONSTRAINT "EventTemplateSlot_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "EventTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
