-- CreateTable
CREATE TABLE "EpicCommentaire" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "pieceJointeNom" TEXT,
    "pieceJointePath" TEXT,
    "pieceJointeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpicCommentaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStoryCommentaire" (
    "id" TEXT NOT NULL,
    "userStoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "pieceJointeNom" TEXT,
    "pieceJointePath" TEXT,
    "pieceJointeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStoryCommentaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EpicCommentaire_epicId_idx" ON "EpicCommentaire"("epicId");

-- CreateIndex
CREATE INDEX "EpicCommentaire_userId_idx" ON "EpicCommentaire"("userId");

-- CreateIndex
CREATE INDEX "UserStoryCommentaire_userStoryId_idx" ON "UserStoryCommentaire"("userStoryId");

-- CreateIndex
CREATE INDEX "UserStoryCommentaire_userId_idx" ON "UserStoryCommentaire"("userId");

-- AddForeignKey
ALTER TABLE "EpicCommentaire" ADD CONSTRAINT "EpicCommentaire_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicCommentaire" ADD CONSTRAINT "EpicCommentaire_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoryCommentaire" ADD CONSTRAINT "UserStoryCommentaire_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "UserStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoryCommentaire" ADD CONSTRAINT "UserStoryCommentaire_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
