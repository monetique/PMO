-- Alignement des accès PV sur le modèle contrat (permissions + admin sans accès implicite)

CREATE TABLE "PvReunionPermission" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PvReunionAdminSansAcces" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PvReunionPermission_pvReunionId_userId_key" ON "PvReunionPermission"("pvReunionId", "userId");
CREATE INDEX "PvReunionPermission_pvReunionId_idx" ON "PvReunionPermission"("pvReunionId");
CREATE INDEX "PvReunionPermission_userId_idx" ON "PvReunionPermission"("userId");

CREATE UNIQUE INDEX "PvReunionAdminSansAcces_pvReunionId_userId_key" ON "PvReunionAdminSansAcces"("pvReunionId", "userId");
CREATE INDEX "PvReunionAdminSansAcces_pvReunionId_idx" ON "PvReunionAdminSansAcces"("pvReunionId");
CREATE INDEX "PvReunionAdminSansAcces_userId_idx" ON "PvReunionAdminSansAcces"("userId");

ALTER TABLE "PvReunionPermission" ADD CONSTRAINT "PvReunionPermission_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PvReunionPermission" ADD CONSTRAINT "PvReunionPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PvReunionAdminSansAcces" ADD CONSTRAINT "PvReunionAdminSansAcces_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PvReunionAdminSansAcces" ADD CONSTRAINT "PvReunionAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Anciens délégués modification → ligne « modification » (accès partagé)
INSERT INTO "PvReunionPermission" ("id", "pvReunionId", "userId", "niveau", "createdAt")
SELECT gen_random_uuid()::text, d."pvReunionId", d."userId", 'modification', NOW()
FROM "PvReunionModificationDelegue" d;
