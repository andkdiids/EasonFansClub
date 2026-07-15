CREATE TYPE "ProfileWallVisibility" AS ENUM ('PUBLIC', 'FRIENDS', 'CLOSED');

ALTER TABLE "Profile"
ADD COLUMN "wallVisibility" "ProfileWallVisibility" NOT NULL DEFAULT 'PUBLIC';

CREATE TABLE "ProfileWallMessage" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "senderId" TEXT NOT NULL,
  "receiverId" TEXT NOT NULL,
  "parentId" TEXT,

  CONSTRAINT "ProfileWallMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FriendActivity" (
  "id" TEXT NOT NULL,
  "mood" TEXT,
  "content" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "checkInId" TEXT,
  "dailyMessageId" TEXT,

  CONSTRAINT "FriendActivity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProfileWallMessage"
ADD CONSTRAINT "ProfileWallMessage_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileWallMessage"
ADD CONSTRAINT "ProfileWallMessage_receiverId_fkey"
FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileWallMessage"
ADD CONSTRAINT "ProfileWallMessage_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "ProfileWallMessage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "FriendActivity"
ADD CONSTRAINT "FriendActivity_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendActivity"
ADD CONSTRAINT "FriendActivity_checkInId_fkey"
FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FriendActivity"
ADD CONSTRAINT "FriendActivity_dailyMessageId_fkey"
FOREIGN KEY ("dailyMessageId") REFERENCES "DailyMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Profile_wallVisibility_idx" ON "Profile"("wallVisibility");
CREATE INDEX "ProfileWallMessage_receiverId_createdAt_idx" ON "ProfileWallMessage"("receiverId", "createdAt");
CREATE INDEX "ProfileWallMessage_senderId_createdAt_idx" ON "ProfileWallMessage"("senderId", "createdAt");
CREATE INDEX "ProfileWallMessage_parentId_idx" ON "ProfileWallMessage"("parentId");
CREATE INDEX "ProfileWallMessage_deletedAt_idx" ON "ProfileWallMessage"("deletedAt");
CREATE INDEX "FriendActivity_actorId_createdAt_idx" ON "FriendActivity"("actorId", "createdAt");
CREATE INDEX "FriendActivity_checkInId_idx" ON "FriendActivity"("checkInId");
CREATE INDEX "FriendActivity_dailyMessageId_idx" ON "FriendActivity"("dailyMessageId");
