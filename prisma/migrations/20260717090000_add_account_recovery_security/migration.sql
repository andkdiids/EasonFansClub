-- Existing users remain valid and may add security questions after login.
CREATE TYPE "PasswordResetType" AS ENUM ('SECURITY_QUESTION', 'EMAIL');
CREATE TYPE "PasswordResetStage" AS ENUM ('CHALLENGE', 'RESET_CODE', 'RESET_TOKEN');

ALTER TABLE "User"
ADD COLUMN "securityQuestionRecoveryEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Notification"
ADD COLUMN "key" TEXT,
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Notification_recipientId_key_key" ON "Notification"("recipientId", "key");

-- Legacy reset rows were development placeholders. They are retained as email reset tokens.
ALTER TABLE "PasswordResetToken"
RENAME COLUMN "usedAt" TO "consumedAt";

ALTER TABLE "PasswordResetToken"
ADD COLUMN "type" "PasswordResetType" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN "stage" "PasswordResetStage" NOT NULL DEFAULT 'RESET_TOKEN',
ADD COLUMN "codeHash" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "PasswordResetToken_userId_type_stage_createdAt_idx"
ON "PasswordResetToken"("userId", "type", "stage", "createdAt");
CREATE INDEX "PasswordResetToken_codeHash_idx" ON "PasswordResetToken"("codeHash");

CREATE TABLE "UserSecurityQuestion" (
  "id" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answerHash" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "UserSecurityQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSecurityQuestion_userId_sortOrder_key"
ON "UserSecurityQuestion"("userId", "sortOrder");
CREATE INDEX "UserSecurityQuestion_userId_idx" ON "UserSecurityQuestion"("userId");
ALTER TABLE "UserSecurityQuestion"
ADD CONSTRAINT "UserSecurityQuestion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccountSecurityLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "AccountSecurityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountSecurityLog_userId_createdAt_idx" ON "AccountSecurityLog"("userId", "createdAt");
CREATE INDEX "AccountSecurityLog_action_createdAt_idx" ON "AccountSecurityLog"("action", "createdAt");
ALTER TABLE "AccountSecurityLog"
ADD CONSTRAINT "AccountSecurityLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SiteSetting" ("id", "key", "value", "valueType", "group", "label", "createdAt", "updatedAt") VALUES
('security_require_questions', 'security.requireQuestionsForNewUsers', 'true', 'BOOLEAN', 'security', '新用户必须设置密保问题', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('security_notify_legacy', 'security.notifyLegacyUsers', 'true', 'BOOLEAN', 'security', '通知历史用户设置密保问题', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('security_enable_questions', 'security.enableQuestionRecovery', 'true', 'BOOLEAN', 'security', '启用密保问题找回', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('security_enable_email', 'security.enableEmailPasswordReset', 'false', 'BOOLEAN', 'security', '启用邮箱验证码重置密码', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
