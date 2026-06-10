-- CreateTable
CREATE TABLE "TypeContrat" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TypeContrat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TypeContrat_code_key" ON "TypeContrat"("code");

-- AlterTable
ALTER TABLE "Contrat" ADD COLUMN "codeContrat" TEXT;
ALTER TABLE "Contrat" ADD COLUMN "typeContratId" TEXT;

-- Type par défaut pour les contrats existants
INSERT INTO "TypeContrat" ("id", "code", "libelle", "createdAt")
VALUES (gen_random_uuid()::text, 'GEN', 'Général (hérité)', CURRENT_TIMESTAMP);

-- Backfill codeContrat (unique : préfixe + UUID sans tirets)
UPDATE "Contrat" SET "codeContrat" = 'MIG-' || REPLACE(CAST("id" AS TEXT), '-', '')
WHERE "codeContrat" IS NULL;

UPDATE "Contrat" SET "typeContratId" = (SELECT "id" FROM "TypeContrat" WHERE "code" = 'GEN' LIMIT 1)
WHERE "typeContratId" IS NULL;

ALTER TABLE "Contrat" ALTER COLUMN "codeContrat" SET NOT NULL;

CREATE UNIQUE INDEX "Contrat_codeContrat_key" ON "Contrat"("codeContrat");

ALTER TABLE "Contrat" ADD CONSTRAINT "Contrat_typeContratId_fkey" FOREIGN KEY ("typeContratId") REFERENCES "TypeContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Contrat_typeContratId_idx" ON "Contrat"("typeContratId");
