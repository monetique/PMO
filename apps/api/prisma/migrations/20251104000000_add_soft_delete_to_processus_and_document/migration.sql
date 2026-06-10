-- Soft delete + tags processus (idempotent pour bases déjà à jour)
ALTER TABLE "Processus" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Processus" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "Processus_deletedAt_idx" ON "Processus"("deletedAt");

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Document_deletedAt_idx" ON "Document"("deletedAt");
