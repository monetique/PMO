-- Table des emails de notification non délivrés (diagnostic + renvoi admin)

CREATE TABLE "NotificationEmailFailure" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toUserId" TEXT,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEmailFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationEmailFailure_createdAt_idx" ON "NotificationEmailFailure"("createdAt");
CREATE INDEX "NotificationEmailFailure_kind_idx" ON "NotificationEmailFailure"("kind");

ALTER TABLE "NotificationEmailFailure" ADD CONSTRAINT "NotificationEmailFailure_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
