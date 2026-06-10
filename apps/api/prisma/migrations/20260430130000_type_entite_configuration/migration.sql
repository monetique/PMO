-- Types d'entité configurables (remplace l'enum EntiteType sur Entite)

CREATE TABLE "TypeEntite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TypeEntite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TypeEntite_code_key" ON "TypeEntite"("code");

INSERT INTO "TypeEntite" ("id", "code", "libelle", "ordre", "actif", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'direction', 'Direction', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'departement', 'Département', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'service', 'Service', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cellule', 'Cellule', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'division', 'Division', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'equipe', 'Équipe', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Entite" ADD COLUMN "typeEntiteId" TEXT;

UPDATE "Entite" AS e
SET "typeEntiteId" = t.id
FROM "TypeEntite" AS t
WHERE t.code = e."type"::text;

ALTER TABLE "Entite" ALTER COLUMN "typeEntiteId" SET NOT NULL;

ALTER TABLE "Entite" DROP COLUMN "type";

ALTER TABLE "Entite" ADD CONSTRAINT "Entite_typeEntiteId_fkey" FOREIGN KEY ("typeEntiteId") REFERENCES "TypeEntite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Entite_typeEntiteId_idx" ON "Entite"("typeEntiteId");

DROP TYPE "EntiteType";
