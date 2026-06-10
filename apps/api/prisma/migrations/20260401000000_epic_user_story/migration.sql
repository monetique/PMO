-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "projetId" TEXT NOT NULL,
    "entiteId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStory" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "epicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpicDocument" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpicDocument_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Tache" ADD COLUMN     "userStoryId" TEXT;

-- CreateIndex
CREATE INDEX "Epic_projetId_idx" ON "Epic"("projetId");

-- CreateIndex
CREATE INDEX "Epic_entiteId_idx" ON "Epic"("entiteId");

-- CreateIndex
CREATE INDEX "UserStory_epicId_idx" ON "UserStory"("epicId");

-- CreateIndex
CREATE INDEX "EpicDocument_documentId_idx" ON "EpicDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EpicDocument_epicId_documentId_key" ON "EpicDocument"("epicId", "documentId");

-- CreateIndex
CREATE INDEX "Tache_userStoryId_idx" ON "Tache"("userStoryId");

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_entiteId_fkey" FOREIGN KEY ("entiteId") REFERENCES "Entite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStory" ADD CONSTRAINT "UserStory_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicDocument" ADD CONSTRAINT "EpicDocument_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicDocument" ADD CONSTRAINT "EpicDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "UserStory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
