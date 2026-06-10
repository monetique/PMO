-- Agile ACL créateur : Epic / User story / Tâche (exclusion admin + délégations explicites)

ALTER TABLE "UserStory"
ADD COLUMN IF NOT EXISTS "createdById" TEXT;

UPDATE "UserStory" us
SET "createdById" = e."createdById"
FROM "Epic" e
WHERE us."epicId" = e."id"
  AND us."createdById" IS NULL;

CREATE TABLE IF NOT EXISTS "TacheAdminSansAcces" (
  "id" TEXT NOT NULL,
  "tacheId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TacheAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EpicPermission" (
  "id" TEXT NOT NULL,
  "epicId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "PermissionType" NOT NULL DEFAULT 'lecture',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpicPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EpicAdminSansAcces" (
  "id" TEXT NOT NULL,
  "epicId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpicAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserStoryPermission" (
  "id" TEXT NOT NULL,
  "userStoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "PermissionType" NOT NULL DEFAULT 'lecture',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserStoryPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserStoryAdminSansAcces" (
  "id" TEXT NOT NULL,
  "userStoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserStoryAdminSansAcces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TacheAdminSansAcces_tacheId_userId_key"
  ON "TacheAdminSansAcces"("tacheId", "userId");
CREATE INDEX IF NOT EXISTS "TacheAdminSansAcces_tacheId_idx"
  ON "TacheAdminSansAcces"("tacheId");
CREATE INDEX IF NOT EXISTS "TacheAdminSansAcces_userId_idx"
  ON "TacheAdminSansAcces"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "EpicPermission_epicId_userId_key"
  ON "EpicPermission"("epicId", "userId");
CREATE INDEX IF NOT EXISTS "EpicPermission_epicId_idx"
  ON "EpicPermission"("epicId");
CREATE INDEX IF NOT EXISTS "EpicPermission_userId_idx"
  ON "EpicPermission"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "EpicAdminSansAcces_epicId_userId_key"
  ON "EpicAdminSansAcces"("epicId", "userId");
CREATE INDEX IF NOT EXISTS "EpicAdminSansAcces_epicId_idx"
  ON "EpicAdminSansAcces"("epicId");
CREATE INDEX IF NOT EXISTS "EpicAdminSansAcces_userId_idx"
  ON "EpicAdminSansAcces"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserStoryPermission_userStoryId_userId_key"
  ON "UserStoryPermission"("userStoryId", "userId");
CREATE INDEX IF NOT EXISTS "UserStoryPermission_userStoryId_idx"
  ON "UserStoryPermission"("userStoryId");
CREATE INDEX IF NOT EXISTS "UserStoryPermission_userId_idx"
  ON "UserStoryPermission"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserStoryAdminSansAcces_userStoryId_userId_key"
  ON "UserStoryAdminSansAcces"("userStoryId", "userId");
CREATE INDEX IF NOT EXISTS "UserStoryAdminSansAcces_userStoryId_idx"
  ON "UserStoryAdminSansAcces"("userStoryId");
CREATE INDEX IF NOT EXISTS "UserStoryAdminSansAcces_userId_idx"
  ON "UserStoryAdminSansAcces"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserStory_createdById_fkey'
  ) THEN
    ALTER TABLE "UserStory"
      ADD CONSTRAINT "UserStory_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TacheAdminSansAcces_tacheId_fkey'
  ) THEN
    ALTER TABLE "TacheAdminSansAcces"
      ADD CONSTRAINT "TacheAdminSansAcces_tacheId_fkey"
      FOREIGN KEY ("tacheId") REFERENCES "Tache"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TacheAdminSansAcces_userId_fkey'
  ) THEN
    ALTER TABLE "TacheAdminSansAcces"
      ADD CONSTRAINT "TacheAdminSansAcces_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EpicPermission_epicId_fkey'
  ) THEN
    ALTER TABLE "EpicPermission"
      ADD CONSTRAINT "EpicPermission_epicId_fkey"
      FOREIGN KEY ("epicId") REFERENCES "Epic"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EpicPermission_userId_fkey'
  ) THEN
    ALTER TABLE "EpicPermission"
      ADD CONSTRAINT "EpicPermission_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EpicAdminSansAcces_epicId_fkey'
  ) THEN
    ALTER TABLE "EpicAdminSansAcces"
      ADD CONSTRAINT "EpicAdminSansAcces_epicId_fkey"
      FOREIGN KEY ("epicId") REFERENCES "Epic"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EpicAdminSansAcces_userId_fkey'
  ) THEN
    ALTER TABLE "EpicAdminSansAcces"
      ADD CONSTRAINT "EpicAdminSansAcces_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserStoryPermission_userStoryId_fkey'
  ) THEN
    ALTER TABLE "UserStoryPermission"
      ADD CONSTRAINT "UserStoryPermission_userStoryId_fkey"
      FOREIGN KEY ("userStoryId") REFERENCES "UserStory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserStoryPermission_userId_fkey'
  ) THEN
    ALTER TABLE "UserStoryPermission"
      ADD CONSTRAINT "UserStoryPermission_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserStoryAdminSansAcces_userStoryId_fkey'
  ) THEN
    ALTER TABLE "UserStoryAdminSansAcces"
      ADD CONSTRAINT "UserStoryAdminSansAcces_userStoryId_fkey"
      FOREIGN KEY ("userStoryId") REFERENCES "UserStory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserStoryAdminSansAcces_userId_fkey'
  ) THEN
    ALTER TABLE "UserStoryAdminSansAcces"
      ADD CONSTRAINT "UserStoryAdminSansAcces_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
