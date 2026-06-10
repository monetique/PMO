-- Liaisons N-N licence ↔ contrat / processus / client-fournisseur
CREATE TABLE IF NOT EXISTS "LicenceContrat" (
    "licenceId" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceContrat_pkey" PRIMARY KEY ("licenceId", "contratId")
);

CREATE INDEX IF NOT EXISTS "LicenceContrat_contratId_idx" ON "LicenceContrat"("contratId");

CREATE TABLE IF NOT EXISTS "LicenceProcessus" (
    "licenceId" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceProcessus_pkey" PRIMARY KEY ("licenceId", "processusId")
);

CREATE INDEX IF NOT EXISTS "LicenceProcessus_processusId_idx" ON "LicenceProcessus"("processusId");

CREATE TABLE IF NOT EXISTS "LicenceClientFournisseur" (
    "licenceId" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceClientFournisseur_pkey" PRIMARY KEY ("licenceId", "clientFournisseurId")
);

CREATE INDEX IF NOT EXISTS "LicenceClientFournisseur_clientFournisseurId_idx" ON "LicenceClientFournisseur"("clientFournisseurId");

ALTER TABLE "LicenceContrat" DROP CONSTRAINT IF EXISTS "LicenceContrat_licenceId_fkey";
ALTER TABLE "LicenceContrat" ADD CONSTRAINT "LicenceContrat_licenceId_fkey"
  FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenceContrat" DROP CONSTRAINT IF EXISTS "LicenceContrat_contratId_fkey";
ALTER TABLE "LicenceContrat" ADD CONSTRAINT "LicenceContrat_contratId_fkey"
  FOREIGN KEY ("contratId") REFERENCES "Contrat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenceProcessus" DROP CONSTRAINT IF EXISTS "LicenceProcessus_licenceId_fkey";
ALTER TABLE "LicenceProcessus" ADD CONSTRAINT "LicenceProcessus_licenceId_fkey"
  FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenceProcessus" DROP CONSTRAINT IF EXISTS "LicenceProcessus_processusId_fkey";
ALTER TABLE "LicenceProcessus" ADD CONSTRAINT "LicenceProcessus_processusId_fkey"
  FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenceClientFournisseur" DROP CONSTRAINT IF EXISTS "LicenceClientFournisseur_licenceId_fkey";
ALTER TABLE "LicenceClientFournisseur" ADD CONSTRAINT "LicenceClientFournisseur_licenceId_fkey"
  FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenceClientFournisseur" DROP CONSTRAINT IF EXISTS "LicenceClientFournisseur_clientFournisseurId_fkey";
ALTER TABLE "LicenceClientFournisseur" ADD CONSTRAINT "LicenceClientFournisseur_clientFournisseurId_fkey"
  FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copier les anciennes FKs simples vers les tables de liaison
INSERT INTO "LicenceContrat" ("licenceId", "contratId", "createdAt")
SELECT "id", "contratId", CURRENT_TIMESTAMP FROM "Licence"
WHERE "contratId" IS NOT NULL
ON CONFLICT ("licenceId", "contratId") DO NOTHING;

INSERT INTO "LicenceProcessus" ("licenceId", "processusId", "createdAt")
SELECT "id", "processusId", CURRENT_TIMESTAMP FROM "Licence"
WHERE "processusId" IS NOT NULL
ON CONFLICT ("licenceId", "processusId") DO NOTHING;

INSERT INTO "LicenceClientFournisseur" ("licenceId", "clientFournisseurId", "createdAt")
SELECT "id", "clientFournisseurId", CURRENT_TIMESTAMP FROM "Licence"
WHERE "clientFournisseurId" IS NOT NULL
ON CONFLICT ("licenceId", "clientFournisseurId") DO NOTHING;

-- Retirer les colonnes et contraintes historiques sur Licence
ALTER TABLE "Licence" DROP CONSTRAINT IF EXISTS "Licence_contratId_fkey";
ALTER TABLE "Licence" DROP CONSTRAINT IF EXISTS "Licence_processusId_fkey";
ALTER TABLE "Licence" DROP CONSTRAINT IF EXISTS "Licence_clientFournisseurId_fkey";

ALTER TABLE "Licence" DROP COLUMN IF EXISTS "contratId";
ALTER TABLE "Licence" DROP COLUMN IF EXISTS "processusId";
ALTER TABLE "Licence" DROP COLUMN IF EXISTS "clientFournisseurId";
