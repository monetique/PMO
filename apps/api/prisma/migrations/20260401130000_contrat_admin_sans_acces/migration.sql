-- Exclusions explicites : admin sans ligne ContratPermission ne voit plus le contrat (sauf si une ligne est accordée par le créateur)
CREATE TABLE "ContratAdminSansAcces" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContratAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContratAdminSansAcces_contratId_userId_key" ON "ContratAdminSansAcces"("contratId", "userId");
CREATE INDEX "ContratAdminSansAcces_contratId_idx" ON "ContratAdminSansAcces"("contratId");
CREATE INDEX "ContratAdminSansAcces_userId_idx" ON "ContratAdminSansAcces"("userId");

ALTER TABLE "ContratAdminSansAcces" ADD CONSTRAINT "ContratAdminSansAcces_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "Contrat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratAdminSansAcces" ADD CONSTRAINT "ContratAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
