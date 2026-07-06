ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "ownerWebKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Event_ownerWebKey_key" ON "Event"("ownerWebKey");
