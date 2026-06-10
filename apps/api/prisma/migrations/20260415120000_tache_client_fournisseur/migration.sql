-- CreateTable
CREATE TABLE "TacheClientFournisseur" (
    "id" TEXT NOT NULL,
    "tacheId" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacheClientFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TacheClientFournisseur_tacheId_clientFournisseurId_key" ON "TacheClientFournisseur"("tacheId", "clientFournisseurId");

-- CreateIndex
CREATE INDEX "TacheClientFournisseur_tacheId_idx" ON "TacheClientFournisseur"("tacheId");

-- CreateIndex
CREATE INDEX "TacheClientFournisseur_clientFournisseurId_idx" ON "TacheClientFournisseur"("clientFournisseurId");

-- AddForeignKey
ALTER TABLE "TacheClientFournisseur" ADD CONSTRAINT "TacheClientFournisseur_tacheId_fkey" FOREIGN KEY ("tacheId") REFERENCES "Tache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheClientFournisseur" ADD CONSTRAINT "TacheClientFournisseur_clientFournisseurId_fkey" FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
