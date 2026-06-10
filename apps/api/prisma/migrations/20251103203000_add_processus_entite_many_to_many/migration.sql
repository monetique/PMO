-- CreateTable
CREATE TABLE "ProcessusEntite" (
    "id" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessusEntite_pkey" PRIMARY KEY ("id")
);

-- Migrate existing data from Processus.entiteId to ProcessusEntite
INSERT INTO "ProcessusEntite" ("id", "processusId", "entiteId", "createdAt")
SELECT gen_random_uuid()::text, "id", "entiteId", "createdAt"
FROM "Processus"
WHERE "entiteId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProcessusEntite_processusId_entiteId_key" ON "ProcessusEntite"("processusId", "entiteId");

-- CreateIndex
CREATE INDEX "ProcessusEntite_processusId_idx" ON "ProcessusEntite"("processusId");

-- CreateIndex
CREATE INDEX "ProcessusEntite_entiteId_idx" ON "ProcessusEntite"("entiteId");

-- AddForeignKey
ALTER TABLE "ProcessusEntite" ADD CONSTRAINT "ProcessusEntite_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessusEntite" ADD CONSTRAINT "ProcessusEntite_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "Processus" DROP CONSTRAINT IF EXISTS "Processus_entiteId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Processus_entiteId_idx";

-- AlterTable
ALTER TABLE "Processus" DROP COLUMN "entiteId";

