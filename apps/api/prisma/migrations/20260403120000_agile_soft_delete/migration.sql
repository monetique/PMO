-- AlterTable
ALTER TABLE "Epic" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserStory" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tache" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Epic_deletedAt_idx" ON "Epic"("deletedAt");

-- CreateIndex
CREATE INDEX "UserStory_deletedAt_idx" ON "UserStory"("deletedAt");

-- CreateIndex
CREATE INDEX "Tache_deletedAt_idx" ON "Tache"("deletedAt");
