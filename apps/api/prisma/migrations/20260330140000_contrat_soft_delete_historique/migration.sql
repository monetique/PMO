ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'contrat';

ALTER TABLE "Contrat" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ContratHistorique" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeEvenement" TEXT NOT NULL,
    "libelle" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContratHistorique_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContratHistorique_contratId_createdAt_idx" ON "ContratHistorique"("contratId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContratHistorique_userId_idx" ON "ContratHistorique"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContratHistorique_contratId_fkey') THEN
    ALTER TABLE "ContratHistorique" ADD CONSTRAINT "ContratHistorique_contratId_fkey"
      FOREIGN KEY ("contratId") REFERENCES "Contrat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContratHistorique_userId_fkey') THEN
    ALTER TABLE "ContratHistorique" ADD CONSTRAINT "ContratHistorique_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
