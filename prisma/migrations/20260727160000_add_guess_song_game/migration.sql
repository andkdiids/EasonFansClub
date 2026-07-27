-- CreateEnum
CREATE TYPE "GuessSongDifficulty" AS ENUM ('EASY', 'ADVANCED', 'HARD');
CREATE TYPE "GuessSongMode" AS ENUM ('EASY', 'ADVANCED', 'HARD', 'ENDLESS');
CREATE TYPE "GuessSongProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "GuessSongSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'EXPIRED');
CREATE TYPE "GuessSongPeriodType" AS ENUM ('WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "GuessSongQuestion" (
  "id" TEXT NOT NULL,
  "songTitle" TEXT NOT NULL,
  "albumTitle" TEXT,
  "difficulty" "GuessSongDifficulty" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "allowEndless" BOOLEAN NOT NULL DEFAULT true,
  "correctAnswer" TEXT NOT NULL,
  "wrongOption1" TEXT NOT NULL,
  "wrongOption2" TEXT NOT NULL,
  "wrongOption3" TEXT NOT NULL,
  "sourceAudioPath" TEXT,
  "audioDurationMs" INTEGER,
  "processingStatus" "GuessSongProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "processingError" TEXT,
  "playCount" INTEGER NOT NULL DEFAULT 0,
  "answerCount" INTEGER NOT NULL DEFAULT 0,
  "correctCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "musicSongId" TEXT,
  CONSTRAINT "GuessSongQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuessSongAudioVariant" (
  "id" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "questionId" TEXT NOT NULL,
  CONSTRAINT "GuessSongAudioVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuessSongSession" (
  "id" TEXT NOT NULL,
  "activeKey" TEXT,
  "mode" "GuessSongMode" NOT NULL,
  "status" "GuessSongSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "score" INTEGER NOT NULL DEFAULT 0,
  "correctCount" INTEGER NOT NULL DEFAULT 0,
  "wrongCount" INTEGER NOT NULL DEFAULT 0,
  "currentStreak" INTEGER NOT NULL DEFAULT 0,
  "maxStreak" INTEGER NOT NULL DEFAULT 0,
  "livesRemaining" INTEGER NOT NULL DEFAULT 0,
  "totalPlayCount" INTEGER NOT NULL DEFAULT 0,
  "currentPosition" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "GuessSongSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuessSongSessionQuestion" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "playbackDurationSeconds" INTEGER NOT NULL,
  "maxPlayCount" INTEGER NOT NULL,
  "playCount" INTEGER NOT NULL DEFAULT 0,
  "optionsSnapshot" JSONB NOT NULL,
  "correctOptionKey" TEXT NOT NULL,
  "selectedOptionKey" TEXT,
  "isCorrect" BOOLEAN,
  "awardedScore" INTEGER NOT NULL DEFAULT 0,
  "answerDeadlineAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sessionId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  CONSTRAINT "GuessSongSessionQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuessSongPlayRequest" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "playCountAfter" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sessionQuestionId" TEXT NOT NULL,
  "audioVariantId" TEXT NOT NULL,
  CONSTRAINT "GuessSongPlayRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuessSongLeaderboardEntry" (
  "id" TEXT NOT NULL,
  "mode" "GuessSongMode" NOT NULL,
  "periodType" "GuessSongPeriodType" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "correctCount" INTEGER NOT NULL,
  "maxStreak" INTEGER NOT NULL,
  "totalPlayCount" INTEGER NOT NULL,
  "achievedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  CONSTRAINT "GuessSongLeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuessSongQuestion_difficulty_enabled_idx" ON "GuessSongQuestion"("difficulty", "enabled");
CREATE INDEX "GuessSongQuestion_allowEndless_enabled_idx" ON "GuessSongQuestion"("allowEndless", "enabled");
CREATE INDEX "GuessSongQuestion_processingStatus_idx" ON "GuessSongQuestion"("processingStatus");
CREATE INDEX "GuessSongQuestion_songTitle_idx" ON "GuessSongQuestion"("songTitle");
CREATE INDEX "GuessSongQuestion_musicSongId_idx" ON "GuessSongQuestion"("musicSongId");
CREATE INDEX "GuessSongQuestion_createdAt_idx" ON "GuessSongQuestion"("createdAt");
CREATE UNIQUE INDEX "GuessSongAudioVariant_questionId_durationSeconds_key" ON "GuessSongAudioVariant"("questionId", "durationSeconds");
CREATE INDEX "GuessSongAudioVariant_questionId_idx" ON "GuessSongAudioVariant"("questionId");
CREATE INDEX "GuessSongSession_userId_mode_status_idx" ON "GuessSongSession"("userId", "mode", "status");
CREATE INDEX "GuessSongSession_userId_completedAt_idx" ON "GuessSongSession"("userId", "completedAt");
CREATE INDEX "GuessSongSession_status_expiresAt_idx" ON "GuessSongSession"("status", "expiresAt");
CREATE INDEX "GuessSongSession_createdAt_idx" ON "GuessSongSession"("createdAt");
CREATE UNIQUE INDEX "GuessSongSession_activeKey_key" ON "GuessSongSession"("activeKey");
CREATE UNIQUE INDEX "GuessSongSessionQuestion_publicId_key" ON "GuessSongSessionQuestion"("publicId");
CREATE UNIQUE INDEX "GuessSongSessionQuestion_sessionId_position_key" ON "GuessSongSessionQuestion"("sessionId", "position");
CREATE INDEX "GuessSongSessionQuestion_sessionId_answeredAt_idx" ON "GuessSongSessionQuestion"("sessionId", "answeredAt");
CREATE INDEX "GuessSongSessionQuestion_questionId_idx" ON "GuessSongSessionQuestion"("questionId");
CREATE INDEX "GuessSongSessionQuestion_publicId_idx" ON "GuessSongSessionQuestion"("publicId");
CREATE UNIQUE INDEX "GuessSongPlayRequest_sessionQuestionId_requestKey_key" ON "GuessSongPlayRequest"("sessionQuestionId", "requestKey");
CREATE INDEX "GuessSongPlayRequest_sessionQuestionId_createdAt_idx" ON "GuessSongPlayRequest"("sessionQuestionId", "createdAt");
CREATE UNIQUE INDEX "GuessSongLeaderboardEntry_userId_mode_periodType_periodKey_key" ON "GuessSongLeaderboardEntry"("userId", "mode", "periodType", "periodKey");
CREATE INDEX "GuessSongLeaderboardEntry_periodType_periodKey_mode_score_idx" ON "GuessSongLeaderboardEntry"("periodType", "periodKey", "mode", "score");
CREATE INDEX "GuessSongLeaderboardEntry_userId_periodType_periodKey_idx" ON "GuessSongLeaderboardEntry"("userId", "periodType", "periodKey");
CREATE INDEX "GuessSongLeaderboardEntry_sessionId_idx" ON "GuessSongLeaderboardEntry"("sessionId");

-- AddForeignKey
ALTER TABLE "GuessSongQuestion" ADD CONSTRAINT "GuessSongQuestion_musicSongId_fkey" FOREIGN KEY ("musicSongId") REFERENCES "MusicSong"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuessSongAudioVariant" ADD CONSTRAINT "GuessSongAudioVariant_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GuessSongQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuessSongSession" ADD CONSTRAINT "GuessSongSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuessSongSessionQuestion" ADD CONSTRAINT "GuessSongSessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GuessSongSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuessSongSessionQuestion" ADD CONSTRAINT "GuessSongSessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GuessSongQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuessSongPlayRequest" ADD CONSTRAINT "GuessSongPlayRequest_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "GuessSongSessionQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuessSongPlayRequest" ADD CONSTRAINT "GuessSongPlayRequest_audioVariantId_fkey" FOREIGN KEY ("audioVariantId") REFERENCES "GuessSongAudioVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuessSongLeaderboardEntry" ADD CONSTRAINT "GuessSongLeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuessSongLeaderboardEntry" ADD CONSTRAINT "GuessSongLeaderboardEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GuessSongSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
