-- CreateTable
CREATE TABLE "UserEntite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEntite_pkey" PRIMARY KEY ("id")
);

-- Migrate existing data from User.entiteId to UserEntite
INSERT INTO "UserEntite" ("id", "userId", "entiteId", "createdAt")
SELECT gen_random_uuid()::text, "id", "entiteId", "createdAt"
FROM "User"
WHERE "entiteId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "UserEntite_userId_entiteId_key" ON "UserEntite"("userId", "entiteId");

-- CreateIndex
CREATE INDEX "UserEntite_userId_idx" ON "UserEntite"("userId");

-- CreateIndex
CREATE INDEX "UserEntite_entiteId_idx" ON "UserEntite"("entiteId");

-- AddForeignKey
ALTER TABLE "UserEntite" ADD CONSTRAINT "UserEntite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEntite" ADD CONSTRAINT "UserEntite_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_entiteId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "User_entiteId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "entiteId";

