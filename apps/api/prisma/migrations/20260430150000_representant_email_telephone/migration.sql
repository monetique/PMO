-- Coordonnées optionnelles pour les représentants légaux
ALTER TABLE "RepresentantLegal" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "RepresentantLegal" ADD COLUMN IF NOT EXISTS "telephone" TEXT;
