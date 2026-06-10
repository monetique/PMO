-- Enums (journal d'accès, documents, etc.) — PostgreSQL 15+
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'contrat';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'client_fournisseur';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'template';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'tache';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'licence';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'autre';

ALTER TYPE "RefType" ADD VALUE IF NOT EXISTS 'clientFournisseur';
ALTER TYPE "RefType" ADD VALUE IF NOT EXISTS 'licence';

ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'licence';

ALTER TYPE "PermissionResource" ADD VALUE IF NOT EXISTS 'clientFournisseur';

-- Ancienne table Licence (colonne "type" en enum) → schéma Prisma actuel (typeLicence TEXT, etc.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Licence') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Licence' AND column_name = 'type'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Licence' AND column_name = 'typeLicence'
    ) THEN
      DROP INDEX IF EXISTS "Licence_type_idx";
      ALTER TABLE "Licence" DROP CONSTRAINT IF EXISTS "Licence_createdById_fkey";
      ALTER TABLE "Licence" ALTER COLUMN "statut" TYPE TEXT USING ("statut"::text);
      ALTER TABLE "Licence" ALTER COLUMN "type" TYPE TEXT USING ("type"::text);
      ALTER TABLE "Licence" RENAME COLUMN "type" TO "typeLicence";
      UPDATE "Licence" SET "reference" = 'LIC-' || "id" WHERE "reference" IS NULL OR trim("reference") = '';
      ALTER TABLE "Licence" ALTER COLUMN "reference" SET NOT NULL;
      ALTER TABLE "Licence" ALTER COLUMN "devise" DROP NOT NULL;
      ALTER TABLE "Licence" ALTER COLUMN "createdById" DROP NOT NULL;
      ALTER TABLE "Licence" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
      CREATE UNIQUE INDEX IF NOT EXISTS "Licence_reference_key" ON "Licence"("reference");
      CREATE INDEX IF NOT EXISTS "Licence_deletedAt_idx" ON "Licence"("deletedAt");
      CREATE INDEX IF NOT EXISTS "Licence_createdById_idx" ON "Licence"("createdById");
      ALTER TABLE "Licence" ALTER COLUMN "typeLicence" DROP DEFAULT;
      ALTER TABLE "Licence" ALTER COLUMN "statut" DROP DEFAULT;
      ALTER TABLE "Licence" ALTER COLUMN "statut" SET DEFAULT 'active';
    END IF;
  END IF;
END $$;

-- Table Licence (bases sans module licence)
CREATE TABLE IF NOT EXISTS "Licence" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "typeLicence" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'active',
    "cout" DECIMAL(15,2),
    "devise" TEXT,
    "nombreSieges" INTEGER,
    "dateDebut" TIMESTAMP(3),
    "dateFin" TIMESTAMP(3),
    "description" TEXT,
    "contratId" TEXT,
    "processusId" TEXT,
    "clientFournisseurId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Licence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Licence_reference_key" ON "Licence"("reference");
CREATE INDEX IF NOT EXISTS "Licence_statut_idx" ON "Licence"("statut");
CREATE INDEX IF NOT EXISTS "Licence_deletedAt_idx" ON "Licence"("deletedAt");
CREATE INDEX IF NOT EXISTS "Licence_createdById_idx" ON "Licence"("createdById");

-- Liaison documents (si absente, ex. base uniquement prisma migrate du dépôt minimal)
CREATE TABLE IF NOT EXISTS "LicenceDocument" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LicenceDocument_licenceId_documentId_key" ON "LicenceDocument"("licenceId", "documentId");
CREATE INDEX IF NOT EXISTS "LicenceDocument_licenceId_idx" ON "LicenceDocument"("licenceId");
CREATE INDEX IF NOT EXISTS "LicenceDocument_documentId_idx" ON "LicenceDocument"("documentId");

CREATE TABLE IF NOT EXISTS "LicencePermission" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicencePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LicenceCommentaire" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "assigneAId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceCommentaire_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LicenceNotification" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "joursAvant" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "destinataireIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenceNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LicencePermission_licenceId_userId_key" ON "LicencePermission"("licenceId", "userId");
CREATE INDEX IF NOT EXISTS "LicencePermission_licenceId_idx" ON "LicencePermission"("licenceId");
CREATE INDEX IF NOT EXISTS "LicencePermission_userId_idx" ON "LicencePermission"("userId");

CREATE INDEX IF NOT EXISTS "LicenceCommentaire_licenceId_idx" ON "LicenceCommentaire"("licenceId");
CREATE INDEX IF NOT EXISTS "LicenceNotification_licenceId_idx" ON "LicenceNotification"("licenceId");

-- FK Licence (schéma Prisma : createdBy supprimable → SET NULL)
ALTER TABLE "Licence" DROP CONSTRAINT IF EXISTS "Licence_createdById_fkey";
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Licence_contratId_fkey') THEN
    ALTER TABLE "Licence" ADD CONSTRAINT "Licence_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "Contrat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Licence_processusId_fkey') THEN
    ALTER TABLE "Licence" ADD CONSTRAINT "Licence_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Licence_clientFournisseurId_fkey') THEN
    ALTER TABLE "Licence" ADD CONSTRAINT "Licence_clientFournisseurId_fkey" FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicencePermission_licenceId_fkey') THEN
    ALTER TABLE "LicencePermission" ADD CONSTRAINT "LicencePermission_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicencePermission_userId_fkey') THEN
    ALTER TABLE "LicencePermission" ADD CONSTRAINT "LicencePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceDocument_licenceId_fkey') THEN
    ALTER TABLE "LicenceDocument" ADD CONSTRAINT "LicenceDocument_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceDocument_documentId_fkey') THEN
    ALTER TABLE "LicenceDocument" ADD CONSTRAINT "LicenceDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceCommentaire_licenceId_fkey') THEN
    ALTER TABLE "LicenceCommentaire" ADD CONSTRAINT "LicenceCommentaire_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceCommentaire_userId_fkey') THEN
    ALTER TABLE "LicenceCommentaire" ADD CONSTRAINT "LicenceCommentaire_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceCommentaire_assigneAId_fkey') THEN
    ALTER TABLE "LicenceCommentaire" ADD CONSTRAINT "LicenceCommentaire_assigneAId_fkey" FOREIGN KEY ("assigneAId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenceNotification_licenceId_fkey') THEN
    ALTER TABLE "LicenceNotification" ADD CONSTRAINT "LicenceNotification_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
