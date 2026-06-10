-- PV de réunion — enums (PostgreSQL 15+)
ALTER TYPE "UiModule" ADD VALUE IF NOT EXISTS 'pv_reunion';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'pv_reunion';
ALTER TYPE "RefType" ADD VALUE IF NOT EXISTS 'pvReunion';
ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'pvReunion';

-- CreateTable
CREATE TABLE "PvReunion" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "dateReunion" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "liensExplicites" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvReunionPresentUser" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionPresentUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvReunionPresentClientFournisseur" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "clientFournisseurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionPresentClientFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvReunionProjet" (
    "pvReunionId" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionProjet_pkey" PRIMARY KEY ("pvReunionId","projetId")
);

-- CreateTable
CREATE TABLE "PvReunionTache" (
    "pvReunionId" TEXT NOT NULL,
    "tacheId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionTache_pkey" PRIMARY KEY ("pvReunionId","tacheId")
);

-- CreateTable
CREATE TABLE "PvReunionUserStory" (
    "pvReunionId" TEXT NOT NULL,
    "userStoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionUserStory_pkey" PRIMARY KEY ("pvReunionId","userStoryId")
);

-- CreateTable
CREATE TABLE "PvReunionEpic" (
    "pvReunionId" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionEpic_pkey" PRIMARY KEY ("pvReunionId","epicId")
);

-- CreateTable
CREATE TABLE "PvReunionContrat" (
    "pvReunionId" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionContrat_pkey" PRIMARY KEY ("pvReunionId","contratId")
);

-- CreateTable
CREATE TABLE "PvReunionProcessus" (
    "pvReunionId" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionProcessus_pkey" PRIMARY KEY ("pvReunionId","processusId")
);

-- CreateTable
CREATE TABLE "PvReunionModificationDelegue" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionModificationDelegue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvReunionCommentaire" (
    "id" TEXT NOT NULL,
    "pvReunionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "assigneAId" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvReunionCommentaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PvReunion_createdById_idx" ON "PvReunion"("createdById");

-- CreateIndex
CREATE INDEX "PvReunion_documentId_idx" ON "PvReunion"("documentId");

-- CreateIndex
CREATE INDEX "PvReunion_deletedAt_idx" ON "PvReunion"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PvReunionPresentUser_pvReunionId_userId_key" ON "PvReunionPresentUser"("pvReunionId", "userId");

-- CreateIndex
CREATE INDEX "PvReunionPresentUser_userId_idx" ON "PvReunionPresentUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PvReunionPresentClientFournisseur_pvReunionId_clientFournisseurId_key" ON "PvReunionPresentClientFournisseur"("pvReunionId", "clientFournisseurId");

-- CreateIndex
CREATE INDEX "PvReunionPresentClientFournisseur_clientFournisseurId_idx" ON "PvReunionPresentClientFournisseur"("clientFournisseurId");

-- CreateIndex
CREATE INDEX "PvReunionProjet_projetId_idx" ON "PvReunionProjet"("projetId");

-- CreateIndex
CREATE INDEX "PvReunionTache_tacheId_idx" ON "PvReunionTache"("tacheId");

-- CreateIndex
CREATE INDEX "PvReunionUserStory_userStoryId_idx" ON "PvReunionUserStory"("userStoryId");

-- CreateIndex
CREATE INDEX "PvReunionEpic_epicId_idx" ON "PvReunionEpic"("epicId");

-- CreateIndex
CREATE INDEX "PvReunionContrat_contratId_idx" ON "PvReunionContrat"("contratId");

-- CreateIndex
CREATE INDEX "PvReunionProcessus_processusId_idx" ON "PvReunionProcessus"("processusId");

-- CreateIndex
CREATE UNIQUE INDEX "PvReunionModificationDelegue_pvReunionId_userId_key" ON "PvReunionModificationDelegue"("pvReunionId", "userId");

-- CreateIndex
CREATE INDEX "PvReunionModificationDelegue_userId_idx" ON "PvReunionModificationDelegue"("userId");

-- CreateIndex
CREATE INDEX "PvReunionCommentaire_pvReunionId_idx" ON "PvReunionCommentaire"("pvReunionId");

-- CreateIndex
CREATE INDEX "PvReunionCommentaire_userId_idx" ON "PvReunionCommentaire"("userId");

-- CreateIndex
CREATE INDEX "PvReunionCommentaire_assigneAId_idx" ON "PvReunionCommentaire"("assigneAId");

-- AddForeignKey
ALTER TABLE "PvReunion" ADD CONSTRAINT "PvReunion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunion" ADD CONSTRAINT "PvReunion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionPresentUser" ADD CONSTRAINT "PvReunionPresentUser_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionPresentUser" ADD CONSTRAINT "PvReunionPresentUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionPresentClientFournisseur" ADD CONSTRAINT "PvReunionPresentClientFournisseur_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionPresentClientFournisseur" ADD CONSTRAINT "PvReunionPresentClientFournisseur_clientFournisseurId_fkey" FOREIGN KEY ("clientFournisseurId") REFERENCES "ClientFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionProjet" ADD CONSTRAINT "PvReunionProjet_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionProjet" ADD CONSTRAINT "PvReunionProjet_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionTache" ADD CONSTRAINT "PvReunionTache_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionTache" ADD CONSTRAINT "PvReunionTache_tacheId_fkey" FOREIGN KEY ("tacheId") REFERENCES "Tache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionUserStory" ADD CONSTRAINT "PvReunionUserStory_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionUserStory" ADD CONSTRAINT "PvReunionUserStory_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "UserStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionEpic" ADD CONSTRAINT "PvReunionEpic_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionEpic" ADD CONSTRAINT "PvReunionEpic_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionContrat" ADD CONSTRAINT "PvReunionContrat_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionContrat" ADD CONSTRAINT "PvReunionContrat_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "Contrat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionProcessus" ADD CONSTRAINT "PvReunionProcessus_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionProcessus" ADD CONSTRAINT "PvReunionProcessus_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionModificationDelegue" ADD CONSTRAINT "PvReunionModificationDelegue_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionModificationDelegue" ADD CONSTRAINT "PvReunionModificationDelegue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionCommentaire" ADD CONSTRAINT "PvReunionCommentaire_pvReunionId_fkey" FOREIGN KEY ("pvReunionId") REFERENCES "PvReunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionCommentaire" ADD CONSTRAINT "PvReunionCommentaire_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionCommentaire" ADD CONSTRAINT "PvReunionCommentaire_assigneAId_fkey" FOREIGN KEY ("assigneAId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvReunionCommentaire" ADD CONSTRAINT "PvReunionCommentaire_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
