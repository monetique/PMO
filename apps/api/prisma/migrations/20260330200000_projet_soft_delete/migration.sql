-- AlterTable
ALTER TABLE "Projet" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Projet_deletedAt_idx" ON "Projet"("deletedAt");
