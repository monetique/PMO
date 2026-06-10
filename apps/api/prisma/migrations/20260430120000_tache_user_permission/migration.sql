-- Droits délégués par assignation sur une tâche (aligné sur PermissionType processus)
ALTER TABLE "TacheUser" ADD COLUMN IF NOT EXISTS "permission" "PermissionType" NOT NULL DEFAULT 'lecture';
