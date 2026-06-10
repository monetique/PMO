-- Représentants légaux (aligné sur schema.prisma) — certaines bases n'avaient que ClientFournisseur sans cette table
CREATE TABLE IF NOT EXISTS "RepresentantLegal" (
    "id" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "fonction" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'en_exercice',
    "dateDebut" TIMESTAMP(3),
    "dateFin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepresentantLegal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RepresentantLegal_clientFournisseurId_idx" ON "RepresentantLegal"("clientFournisseurId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RepresentantLegal_clientFournisseurId_fkey'
  ) THEN
    ALTER TABLE "RepresentantLegal"
      ADD CONSTRAINT "RepresentantLegal_clientFournisseurId_fkey"
      FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
