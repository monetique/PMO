-- CreateTable
CREATE TABLE "EpicClientFournisseur" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpicClientFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EpicClientFournisseur_epicId_clientFournisseurId_key" ON "EpicClientFournisseur"("epicId", "clientFournisseurId");

-- CreateIndex
CREATE INDEX "EpicClientFournisseur_epicId_idx" ON "EpicClientFournisseur"("epicId");

-- CreateIndex
CREATE INDEX "EpicClientFournisseur_clientFournisseurId_idx" ON "EpicClientFournisseur"("clientFournisseurId");

-- AddForeignKey
ALTER TABLE "EpicClientFournisseur" ADD CONSTRAINT "EpicClientFournisseur_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicClientFournisseur" ADD CONSTRAINT "EpicClientFournisseur_clientFournisseurId_fkey" FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
