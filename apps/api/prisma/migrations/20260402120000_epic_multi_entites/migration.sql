-- CreateTable EpicEntite
CREATE TABLE "EpicEntite" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpicEntite_pkey" PRIMARY KEY ("id")
);

-- Migrate existing Epic.entiteId -> EpicEntite
INSERT INTO "EpicEntite" ("id", "epicId", "entiteId", "createdAt")
SELECT gen_random_uuid()::text, "id", "entiteId", CURRENT_TIMESTAMP
FROM "Epic"
WHERE "entiteId" IS NOT NULL;

-- Drop FK and column on Epic
ALTER TABLE "Epic" DROP CONSTRAINT IF EXISTS "Epic_entiteId_fkey";
DROP INDEX IF EXISTS "Epic_entiteId_idx";
ALTER TABLE "Epic" DROP COLUMN IF EXISTS "entiteId";

-- Indexes EpicEntite
CREATE UNIQUE INDEX "EpicEntite_epicId_entiteId_key" ON "EpicEntite"("epicId", "entiteId");
CREATE INDEX "EpicEntite_epicId_idx" ON "EpicEntite"("epicId");
CREATE INDEX "EpicEntite_entiteId_idx" ON "EpicEntite"("entiteId");

-- FKs
ALTER TABLE "EpicEntite" ADD CONSTRAINT "EpicEntite_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpicEntite" ADD CONSTRAINT "EpicEntite_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
