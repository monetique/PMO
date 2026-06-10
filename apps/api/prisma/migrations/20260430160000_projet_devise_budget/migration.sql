-- Devise du budget projet (référence table Configuration > Devises)
ALTER TABLE "Projet" ADD COLUMN IF NOT EXISTS "deviseId" TEXT;

CREATE INDEX IF NOT EXISTS "Projet_deviseId_idx" ON "Projet"("deviseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Projet_deviseId_fkey'
  ) THEN
    ALTER TABLE "Projet"
      ADD CONSTRAINT "Projet_deviseId_fkey"
      FOREIGN KEY ("deviseId") REFERENCES "Devise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
