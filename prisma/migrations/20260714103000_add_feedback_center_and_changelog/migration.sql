ALTER TYPE "FeedbackStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "FeedbackStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';
ALTER TYPE "FeedbackType" ADD VALUE IF NOT EXISTS 'EXPERIENCE';

CREATE TYPE "ChangelogType" AS ENUM ('FEATURE', 'IMPROVEMENT', 'FIX', 'SECURITY', 'CONTENT');
CREATE TYPE "ChangelogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

ALTER TABLE "Feedback"
  ADD COLUMN IF NOT EXISTS "contact" TEXT,
  ADD COLUMN IF NOT EXISTS "adminUnread" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "userUnread" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastReplyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastUserReplyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAdminReplyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

ALTER TABLE "FeedbackReply"
  ADD COLUMN IF NOT EXISTS "authorRole" TEXT NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN IF NOT EXISTS "isReadByUser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isReadByAdmin" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "FeedbackAttachment" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "feedbackId" TEXT NOT NULL,
  "replyId" TEXT,

  CONSTRAINT "FeedbackAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Changelog" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "major" INTEGER NOT NULL,
  "minor" INTEGER NOT NULL,
  "patch" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" "ChangelogType" NOT NULL,
  "isMajor" BOOLEAN NOT NULL DEFAULT false,
  "status" "ChangelogStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,

  CONSTRAINT "Changelog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Changelog_version_key" ON "Changelog"("version");
CREATE INDEX "Changelog_status_publishedAt_idx" ON "Changelog"("status", "publishedAt");
CREATE INDEX "Changelog_major_minor_patch_idx" ON "Changelog"("major", "minor", "patch");
CREATE INDEX "Changelog_createdById_createdAt_idx" ON "Changelog"("createdById", "createdAt");
CREATE INDEX "Feedback_lastReplyAt_idx" ON "Feedback"("lastReplyAt");
CREATE INDEX "Feedback_adminUnread_updatedAt_idx" ON "Feedback"("adminUnread", "updatedAt");
CREATE INDEX "FeedbackAttachment_feedbackId_idx" ON "FeedbackAttachment"("feedbackId");
CREATE INDEX "FeedbackAttachment_replyId_idx" ON "FeedbackAttachment"("replyId");
CREATE INDEX "FeedbackReply_adminId_createdAt_idx" ON "FeedbackReply"("adminId", "createdAt");

ALTER TABLE "FeedbackAttachment" ADD CONSTRAINT "FeedbackAttachment_feedbackId_fkey"
  FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackAttachment" ADD CONSTRAINT "FeedbackAttachment_replyId_fkey"
  FOREIGN KEY ("replyId") REFERENCES "FeedbackReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Changelog" ADD CONSTRAINT "Changelog_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
