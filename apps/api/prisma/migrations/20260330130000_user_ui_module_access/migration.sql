-- CreateEnum
CREATE TYPE "UiModule" AS ENUM (
  'dashboard',
  'processus',
  'projets',
  'taches',
  'clients_fournisseurs',
  'contrats',
  'ocr',
  'licences',
  'entites',
  'documents',
  'users',
  'journal',
  'configuration',
  'corbeille'
);

-- CreateEnum
CREATE TYPE "UiModuleLevel" AS ENUM ('none', 'lecture', 'modification');

-- CreateTable
CREATE TABLE "UserUiModuleAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "UiModule" NOT NULL,
    "level" "UiModuleLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserUiModuleAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserUiModuleAccess_userId_module_key" ON "UserUiModuleAccess"("userId", "module");

-- CreateIndex
CREATE INDEX "UserUiModuleAccess_userId_idx" ON "UserUiModuleAccess"("userId");

-- AddForeignKey
ALTER TABLE "UserUiModuleAccess" ADD CONSTRAINT "UserUiModuleAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
