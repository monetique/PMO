-- Add priority and complexity fields on agile tasks.
ALTER TABLE "Tache"
ADD COLUMN "priorite" TEXT NOT NULL DEFAULT 'basse',
ADD COLUMN "complexite" TEXT NOT NULL DEFAULT 'basse';
