-- CreateEnum
CREATE TYPE "ExperienceLogType" AS ENUM ('CHECKIN', 'TASK', 'POST', 'COMMENT', 'LIKE', 'ACTIVITY', 'ADMIN', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "experience" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing experience from the legacy exp field.
UPDATE "User" SET "experience" = COALESCE("exp", 0);

-- CreateTable
CREATE TABLE "GrowthLevelConfig" (
  "id" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "requiredExp" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthLevelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceLog" (
  "id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "type" "ExperienceLogType" NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,

  CONSTRAINT "ExperienceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyExperienceRecord" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "DailyExperienceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "expReward" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthLevelConfig_level_key" ON "GrowthLevelConfig"("level");

-- CreateIndex
CREATE INDEX "GrowthLevelConfig_requiredExp_idx" ON "GrowthLevelConfig"("requiredExp");

-- CreateIndex
CREATE INDEX "ExperienceLog_userId_createdAt_idx" ON "ExperienceLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperienceLog_type_createdAt_idx" ON "ExperienceLog"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyExperienceRecord_userId_date_key" ON "DailyExperienceRecord"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyExperienceRecord_date_idx" ON "DailyExperienceRecord"("date");

-- CreateIndex
CREATE INDEX "Task_enabled_idx" ON "Task"("enabled");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "User_experience_idx" ON "User"("experience");

-- AddForeignKey
ALTER TABLE "ExperienceLog" ADD CONSTRAINT "ExperienceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyExperienceRecord" ADD CONSTRAINT "DailyExperienceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default growth levels.
INSERT INTO "GrowthLevelConfig" ("id", "level", "name", "requiredExp", "updatedAt")
VALUES
  ('growth-level-1', 1, '初入E院', 0, CURRENT_TIMESTAMP),
  ('growth-level-2', 2, '观察期', 1000, CURRENT_TIMESTAMP),
  ('growth-level-3', 3, '稳定治疗', 3000, CURRENT_TIMESTAMP),
  ('growth-level-4', 4, '长期住院', 7000, CURRENT_TIMESTAMP),
  ('growth-level-5', 5, '资深病友', 12000, CURRENT_TIMESTAMP),
  ('growth-level-6', 6, '核心成员', 18000, CURRENT_TIMESTAMP),
  ('growth-level-7', 7, '终身病友', 25000, CURRENT_TIMESTAMP)
ON CONFLICT ("level") DO NOTHING;
