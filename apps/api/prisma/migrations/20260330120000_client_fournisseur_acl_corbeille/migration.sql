-- AlterEnum
ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'clientFournisseur';

-- AlterTable
ALTER TABLE "ClientFournisseur" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "ClientFournisseur" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientFournisseurHistorique" (
    "id" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeEvenement" TEXT NOT NULL,
    "libelle" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFournisseurHistorique_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientFournisseurHistorique_clientFournisseurId_createdAt_idx" ON "ClientFournisseurHistorique"("clientFournisseurId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientFournisseurHistorique_userId_idx" ON "ClientFournisseurHistorique"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientFournisseurHistorique_clientFournisseurId_fkey') THEN
    ALTER TABLE "ClientFournisseurHistorique" ADD CONSTRAINT "ClientFournisseurHistorique_clientFournisseurId_fkey"
      FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientFournisseurHistorique_userId_fkey') THEN
    ALTER TABLE "ClientFournisseurHistorique" ADD CONSTRAINT "ClientFournisseurHistorique_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientFournisseur_createdById_fkey') THEN
    ALTER TABLE "ClientFournisseur" ADD CONSTRAINT "ClientFournisseur_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
