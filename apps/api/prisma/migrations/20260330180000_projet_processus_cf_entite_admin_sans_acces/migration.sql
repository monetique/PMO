-- Alignement accès admin (exclusion implicite) sur Projet, Processus, ClientFournisseur, Entité — comme ContratAdminSansAcces.

CREATE TABLE "EntiteAdminSansAcces" (
    "id" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "EntiteAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntiteAdminSansAcces_entiteId_userId_key" ON "EntiteAdminSansAcces"("entiteId", "userId");
CREATE INDEX "EntiteAdminSansAcces_entiteId_idx" ON "EntiteAdminSansAcces"("entiteId");
CREATE INDEX "EntiteAdminSansAcces_userId_idx" ON "EntiteAdminSansAcces"("userId");

ALTER TABLE "EntiteAdminSansAcces" ADD CONSTRAINT "EntiteAdminSansAcces_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntiteAdminSansAcces" ADD CONSTRAINT "EntiteAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProcessusAdminSansAcces" (
    "id" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "ProcessusAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessusAdminSansAcces_processusId_userId_key" ON "ProcessusAdminSansAcces"("processusId", "userId");
CREATE INDEX "ProcessusAdminSansAcces_processusId_idx" ON "ProcessusAdminSansAcces"("processusId");
CREATE INDEX "ProcessusAdminSansAcces_userId_idx" ON "ProcessusAdminSansAcces"("userId");

ALTER TABLE "ProcessusAdminSansAcces" ADD CONSTRAINT "ProcessusAdminSansAcces_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessusAdminSansAcces" ADD CONSTRAINT "ProcessusAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjetAdminSansAcces" (
    "id" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "ProjetAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjetAdminSansAcces_projetId_userId_key" ON "ProjetAdminSansAcces"("projetId", "userId");
CREATE INDEX "ProjetAdminSansAcces_projetId_idx" ON "ProjetAdminSansAcces"("projetId");
CREATE INDEX "ProjetAdminSansAcces_userId_idx" ON "ProjetAdminSansAcces"("userId");

ALTER TABLE "ProjetAdminSansAcces" ADD CONSTRAINT "ProjetAdminSansAcces_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjetAdminSansAcces" ADD CONSTRAINT "ProjetAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClientFournisseurAdminSansAcces" (
    "id" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "ClientFournisseurAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFournisseurAdminSansAcces_clientFournisseurId_userId_key" ON "ClientFournisseurAdminSansAcces"("clientFournisseurId", "userId");
CREATE INDEX "ClientFournisseurAdminSansAcces_clientFournisseurId_idx" ON "ClientFournisseurAdminSansAcces"("clientFournisseurId");
CREATE INDEX "ClientFournisseurAdminSansAcces_userId_idx" ON "ClientFournisseurAdminSansAcces"("userId");

ALTER TABLE "ClientFournisseurAdminSansAcces" ADD CONSTRAINT "ClientFournisseurAdminSansAcces_clientFournisseurId_fkey" FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFournisseurAdminSansAcces" ADD CONSTRAINT "ClientFournisseurAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
