CREATE TABLE "JourFerie" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "libelle" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JourFerie_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JourFerie_date_key" ON "JourFerie"("date");
CREATE INDEX "JourFerie_date_idx" ON "JourFerie"("date");
