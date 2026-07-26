-- AlterEnum
ALTER TYPE "PointActionType" ADD VALUE IF NOT EXISTS 'ENTERTAINMENT_DAILY_DRAW';

-- CreateTable
CREATE TABLE "LyricPrescription" (
  "id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "songTitle" TEXT NOT NULL,
  "albumTitle" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "displayCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LyricPrescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntertainmentDailyDraw" (
  "id" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "prescriptionCode" TEXT NOT NULL,
  "lyricText" TEXT,
  "songTitle" TEXT,
  "albumTitle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "lyricPrescriptionId" TEXT,

  CONSTRAINT "EntertainmentDailyDraw_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PointLog" ADD COLUMN "dailyDrawId" TEXT;

-- CreateIndex
CREATE INDEX "LyricPrescription_enabled_createdAt_idx" ON "LyricPrescription"("enabled", "createdAt");
CREATE INDEX "LyricPrescription_displayCount_idx" ON "LyricPrescription"("displayCount");
CREATE UNIQUE INDEX "EntertainmentDailyDraw_prescriptionCode_key" ON "EntertainmentDailyDraw"("prescriptionCode");
CREATE UNIQUE INDEX "EntertainmentDailyDraw_userId_dateKey_key" ON "EntertainmentDailyDraw"("userId", "dateKey");
CREATE INDEX "EntertainmentDailyDraw_userId_idx" ON "EntertainmentDailyDraw"("userId");
CREATE INDEX "EntertainmentDailyDraw_dateKey_idx" ON "EntertainmentDailyDraw"("dateKey");
CREATE INDEX "EntertainmentDailyDraw_lyricPrescriptionId_idx" ON "EntertainmentDailyDraw"("lyricPrescriptionId");
CREATE INDEX "EntertainmentDailyDraw_userId_createdAt_idx" ON "EntertainmentDailyDraw"("userId", "createdAt");
CREATE UNIQUE INDEX "PointLog_dailyDrawId_key" ON "PointLog"("dailyDrawId");

-- AddForeignKey
ALTER TABLE "EntertainmentDailyDraw" ADD CONSTRAINT "EntertainmentDailyDraw_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntertainmentDailyDraw" ADD CONSTRAINT "EntertainmentDailyDraw_lyricPrescriptionId_fkey"
  FOREIGN KEY ("lyricPrescriptionId") REFERENCES "LyricPrescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointLog" ADD CONSTRAINT "PointLog_dailyDrawId_fkey"
  FOREIGN KEY ("dailyDrawId") REFERENCES "EntertainmentDailyDraw"("id") ON DELETE SET NULL ON UPDATE CASCADE;
