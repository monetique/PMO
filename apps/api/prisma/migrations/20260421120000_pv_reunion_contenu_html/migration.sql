-- PV de réunion : contenu HTML + historique des versions
ALTER TABLE "PvReunion" ADD COLUMN "contenuHtml" TEXT;
ALTER TABLE "PvReunion" ADD COLUMN "contenuUpdatedAt" TIMESTAMP(3);

CREATE TABLE "PvReunionContenuVersion" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "contenuHtml" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionContenuVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PvReunionContenuVersion_pvReunionId_idx" ON "PvReunionContenuVersion"("pvReunionId");
CREATE INDEX "PvReunionContenuVersion_createdById_idx" ON "PvReunionContenuVersion"("createdById");

ALTER TABLE "PvReunionContenuVersion" ADD CONSTRAINT "PvReunionContenuVersion_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PvReunionContenuVersion" ADD CONSTRAINT "PvReunionContenuVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
