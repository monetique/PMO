-- Alertes licence : mode date / récurrence, suivi d'envoi (après création LicenceNotification)
ALTER TABLE "LicenceNotification" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'before_end';
ALTER TABLE "LicenceNotification" ADD COLUMN IF NOT EXISTS "dateAlerte" TIMESTAMP(3);
ALTER TABLE "LicenceNotification" ADD COLUMN IF NOT EXISTS "recurrence" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "LicenceNotification" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);
