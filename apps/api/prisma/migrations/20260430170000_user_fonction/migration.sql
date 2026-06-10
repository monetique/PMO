-- Fonction / poste utilisateur (facultatif)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fonction" TEXT;
