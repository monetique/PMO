-- Favoris (idempotent)
CREATE TABLE IF NOT EXISTS "FavorisProcessus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processusId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavorisProcessus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FavorisDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavorisDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FavorisProcessus_userId_processusId_key" ON "FavorisProcessus"("userId", "processusId");
CREATE INDEX IF NOT EXISTS "FavorisProcessus_userId_idx" ON "FavorisProcessus"("userId");
CREATE INDEX IF NOT EXISTS "FavorisProcessus_processusId_idx" ON "FavorisProcessus"("processusId");

CREATE UNIQUE INDEX IF NOT EXISTS "FavorisDocument_userId_documentId_key" ON "FavorisDocument"("userId", "documentId");
CREATE INDEX IF NOT EXISTS "FavorisDocument_userId_idx" ON "FavorisDocument"("userId");
CREATE INDEX IF NOT EXISTS "FavorisDocument_documentId_idx" ON "FavorisDocument"("documentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FavorisProcessus_userId_fkey') THEN
    ALTER TABLE "FavorisProcessus" ADD CONSTRAINT "FavorisProcessus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FavorisProcessus_processusId_fkey') THEN
    ALTER TABLE "FavorisProcessus" ADD CONSTRAINT "FavorisProcessus_processusId_fkey" FOREIGN KEY ("processusId") REFERENCES "Processus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FavorisDocument_userId_fkey') THEN
    ALTER TABLE "FavorisDocument" ADD CONSTRAINT "FavorisDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FavorisDocument_documentId_fkey') THEN
    ALTER TABLE "FavorisDocument" ADD CONSTRAINT "FavorisDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
