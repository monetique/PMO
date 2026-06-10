-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'contributeur', 'lecteur');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('actif', 'inactif', 'suspendu');

-- CreateEnum
CREATE TYPE "EntiteType" AS ENUM ('direction', 'departement', 'service', 'cellule', 'division', 'equipe');

-- CreateEnum
CREATE TYPE "ProcessusStatut" AS ENUM ('brouillon', 'en_revision', 'valide', 'actif', 'archive', 'obsolete');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('processus', 'projet', 'general', 'procedure', 'formulaire');

-- CreateEnum
CREATE TYPE "RefType" AS ENUM ('processus', 'projet', 'entite');

-- CreateEnum
CREATE TYPE "DocStatut" AS ENUM ('brouillon', 'en_revision', 'valide', 'archive');

-- CreateEnum
CREATE TYPE "LogAction" AS ENUM ('connexion', 'deconnexion', 'lecture', 'creation', 'modification', 'suppression', 'telechargement', 'export');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('processus', 'projet', 'document', 'entite', 'utilisateur');

-- CreateEnum
CREATE TYPE "PermissionResource" AS ENUM ('processus', 'projet', 'document', 'entite');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('lecture', 'modification', 'suppression', 'gestion');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'contributeur',
    "entiteId" TEXT,
    "avatarUrl" TEXT,
    "statut" "UserStatus" NOT NULL DEFAULT 'actif',
    "derniereConnexion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entite" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "EntiteType" NOT NULL,
    "parentId" TEXT,
    "responsableId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategorieProcessus" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "couleur" TEXT,
    "icone" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorieProcessus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Processus" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "codeProcessus" TEXT NOT NULL,
    "categorieId" TEXT,
    "description" TEXT,
    "statut" "ProcessusStatut" NOT NULL DEFAULT 'brouillon',
    "versionActuelle" TEXT,
    "proprietaireId" TEXT,
    "entiteId" TEXT,
    "dateValidation" TIMESTAMP(3),
    "dateProchaineRevision" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Processus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projet" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "codeProjet" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3),
    "dateFinPrevue" TIMESTAMP(3),
    "dateFinReelle" TIMESTAMP(3),
    "budgetPrevu" DECIMAL(15,2),
    "budgetConsomme" DECIMAL(15,2),
    "responsableId" TEXT,
    "gestionnaireId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Projet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjetEntite" (
    "id" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "roleEntite" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjetEntite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "typeDocument" "DocType" NOT NULL,
    "referenceId" TEXT,
    "referenceType" "RefType",
    "version" TEXT,
    "versionMajeure" INTEGER DEFAULT 1,
    "versionMineure" INTEGER DEFAULT 0,
    "fichierUrl" TEXT NOT NULL,
    "fichierNomOriginal" TEXT NOT NULL,
    "fichierTaille" INTEGER NOT NULL,
    "fichierType" TEXT NOT NULL,
    "description" TEXT,
    "statut" "DocStatut" NOT NULL DEFAULT 'brouillon',
    "estConfidentiel" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "valideById" TEXT,
    "dateValidation" TIMESTAMP(3),
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionDocument" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fichierUrl" TEXT NOT NULL,
    "commentaireVersion" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAcces" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "LogAction" NOT NULL,
    "ressourceType" "ResourceType" NOT NULL,
    "ressourceId" TEXT,
    "ressourceNom" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalAcces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ressourceType" "PermissionResource" NOT NULL,
    "ressourceId" TEXT NOT NULL,
    "permission" "PermissionType" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_entiteId_idx" ON "User"("entiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Entite_responsableId_key" ON "Entite"("responsableId");

-- CreateIndex
CREATE UNIQUE INDEX "Entite_code_key" ON "Entite"("code");

-- CreateIndex
CREATE INDEX "Entite_parentId_idx" ON "Entite"("parentId");

-- CreateIndex
CREATE INDEX "Entite_code_idx" ON "Entite"("code");

-- CreateIndex
CREATE INDEX "CategorieProcessus_parentId_idx" ON "CategorieProcessus"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Processus_codeProcessus_key" ON "Processus"("codeProcessus");

-- CreateIndex
CREATE INDEX "Processus_statut_idx" ON "Processus"("statut");

-- CreateIndex
CREATE INDEX "Processus_entiteId_idx" ON "Processus"("entiteId");

-- CreateIndex
CREATE INDEX "Processus_codeProcessus_idx" ON "Processus"("codeProcessus");

-- CreateIndex
CREATE UNIQUE INDEX "Projet_codeProjet_key" ON "Projet"("codeProjet");

-- CreateIndex
CREATE INDEX "Projet_statut_idx" ON "Projet"("statut");

-- CreateIndex
CREATE INDEX "Projet_codeProjet_idx" ON "Projet"("codeProjet");

-- CreateIndex
CREATE INDEX "ProjetEntite_projetId_idx" ON "ProjetEntite"("projetId");

-- CreateIndex
CREATE INDEX "ProjetEntite_entiteId_idx" ON "ProjetEntite"("entiteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjetEntite_projetId_entiteId_key" ON "ProjetEntite"("projetId", "entiteId");

-- CreateIndex
CREATE INDEX "Document_referenceId_referenceType_idx" ON "Document"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "Document_typeDocument_idx" ON "Document"("typeDocument");

-- CreateIndex
CREATE INDEX "Document_statut_idx" ON "Document"("statut");

-- CreateIndex
CREATE INDEX "VersionDocument_documentId_idx" ON "VersionDocument"("documentId");

-- CreateIndex
CREATE INDEX "JournalAcces_userId_idx" ON "JournalAcces"("userId");

-- CreateIndex
CREATE INDEX "JournalAcces_ressourceType_ressourceId_idx" ON "JournalAcces"("ressourceType", "ressourceId");

-- CreateIndex
CREATE INDEX "JournalAcces_timestamp_idx" ON "JournalAcces"("timestamp");

-- CreateIndex
CREATE INDEX "JournalAcces_action_idx" ON "JournalAcces"("action");

-- CreateIndex
CREATE INDEX "Permission_userId_idx" ON "Permission"("userId");

-- CreateIndex
CREATE INDEX "Permission_ressourceType_ressourceId_idx" ON "Permission"("ressourceType", "ressourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_userId_ressourceType_ressourceId_permission_key" ON "Permission"("userId", "ressourceType", "ressourceId", "permission");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entite" ADD CONSTRAINT "Entite_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entite" ADD CONSTRAINT "Entite_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorieProcessus" ADD CONSTRAINT "CategorieProcessus_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CategorieProcessus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processus" ADD CONSTRAINT "Processus_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "CategorieProcessus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processus" ADD CONSTRAINT "Processus_proprietaireId_fkey" FOREIGN KEY ("proprietaireId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processus" ADD CONSTRAINT "Processus_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processus" ADD CONSTRAINT "Processus_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjetEntite" ADD CONSTRAINT "ProjetEntite_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjetEntite" ADD CONSTRAINT "ProjetEntite_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_valideById_fkey" FOREIGN KEY ("valideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalAcces" ADD CONSTRAINT "JournalAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
