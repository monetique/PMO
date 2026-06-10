-- CreateTable
CREATE TABLE "ProcessusCategorie" (
    "id" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "categorieId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessusCategorie_pkey" PRIMARY KEY ("id")
);

-- Migrate existing data from Processus.categorieId to ProcessusCategorie
INSERT INTO "ProcessusCategorie" ("id", "processusId", "categorieId", "createdAt")
SELECT gen_random_uuid()::text, "id", "categorieId", "createdAt"
FROM "Processus"
WHERE "categorieId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProcessusCategorie_processusId_categorieId_key" ON "ProcessusCategorie"("processusId", "categorieId");

-- CreateIndex
CREATE INDEX "ProcessusCategorie_processusId_idx" ON "ProcessusCategorie"("processusId");

-- CreateIndex
CREATE INDEX "ProcessusCategorie_categorieId_idx" ON "ProcessusCategorie"("categorieId");

-- AddForeignKey
ALTER TABLE "ProcessusCategorie" ADD CONSTRAINT "ProcessusCategorie_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessusCategorie" ADD CONSTRAINT "ProcessusCategorie_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "CategorieProcessus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "Processus" DROP CONSTRAINT IF EXISTS "Processus_categorieId_fkey";

-- AlterTable
ALTER TABLE "Processus" DROP COLUMN "categorieId";

