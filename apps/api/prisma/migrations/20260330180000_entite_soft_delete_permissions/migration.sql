-- AlterTable
ALTER TABLE "Entite" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Entite_deletedAt_idx" ON "Entite"("deletedAt");

-- AddForeignKey
ALTER TABLE "Entite" ADD CONSTRAINT "Entite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
