-- CreateTable
CREATE TABLE "LicenceAdminSansAcces" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenceAdminSansAcces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenceAdminSansAcces_licenceId_userId_key" ON "LicenceAdminSansAcces"("licenceId", "userId");

-- CreateIndex
CREATE INDEX "LicenceAdminSansAcces_licenceId_idx" ON "LicenceAdminSansAcces"("licenceId");

-- CreateIndex
CREATE INDEX "LicenceAdminSansAcces_userId_idx" ON "LicenceAdminSansAcces"("userId");

-- AddForeignKey
ALTER TABLE "LicenceAdminSansAcces" ADD CONSTRAINT "LicenceAdminSansAcces_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenceAdminSansAcces" ADD CONSTRAINT "LicenceAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
