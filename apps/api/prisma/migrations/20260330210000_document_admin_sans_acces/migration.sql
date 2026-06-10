-- Exclusions admin sur documents confidentiels uploadés nativement depuis la fiche projet (typeDocument = projet).

CREATE TABLE "DocumentAdminSansAcces" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentAdminSansAcces_documentId_userId_key" ON "DocumentAdminSansAcces"("documentId", "userId");
CREATE INDEX "DocumentAdminSansAcces_documentId_idx" ON "DocumentAdminSansAcces"("documentId");
CREATE INDEX "DocumentAdminSansAcces_userId_idx" ON "DocumentAdminSansAcces"("userId");

ALTER TABLE "DocumentAdminSansAcces" ADD CONSTRAINT "DocumentAdminSansAcces_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentAdminSansAcces" ADD CONSTRAINT "DocumentAdminSansAcces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
