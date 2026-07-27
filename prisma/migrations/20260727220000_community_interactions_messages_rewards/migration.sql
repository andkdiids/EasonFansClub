ALTER TYPE "PointActionType" ADD VALUE IF NOT EXISTS 'POST_DAILY_FIRST';
ALTER TYPE "PointActionType" ADD VALUE IF NOT EXISTS 'POST_COMMENT_DAILY';

ALTER TABLE "ProfileWallMessage"
ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProfileWallLike" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "ProfileWallLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileWallLike_messageId_userId_key"
ON "ProfileWallLike"("messageId", "userId");
CREATE INDEX "ProfileWallLike_userId_createdAt_idx"
ON "ProfileWallLike"("userId", "createdAt");
ALTER TABLE "ProfileWallLike"
ADD CONSTRAINT "ProfileWallLike_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "ProfileWallMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileWallLike"
ADD CONSTRAINT "ProfileWallLike_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendActivity"
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CHECKIN',
ADD COLUMN "targetUrl" TEXT;

ALTER TABLE "PointLog"
ADD COLUMN "dateKey" TEXT,
ADD COLUMN "businessKey" TEXT;
CREATE UNIQUE INDEX "PointLog_businessKey_key" ON "PointLog"("businessKey");

ALTER TABLE "Conversation"
ADD COLUMN "lastMessageAt" TIMESTAMP(3),
ADD COLUMN "pairKey" TEXT;
CREATE UNIQUE INDEX "Conversation_pairKey_key" ON "Conversation"("pairKey");
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");
