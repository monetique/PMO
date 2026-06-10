-- CreateTable
CREATE TABLE "Devise" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Devise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Devise_code_key" ON "Devise"("code");

-- Données initiales (modifiables dans Configuration)
INSERT INTO "Devise" ("id", "code", "libelle", "createdAt") VALUES
  (gen_random_uuid()::text, 'TND', 'Dinar tunisien', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EUR', 'Euro', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'USD', 'Dollar US', CURRENT_TIMESTAMP);
