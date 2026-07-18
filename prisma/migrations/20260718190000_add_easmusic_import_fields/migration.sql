-- AlterTable
ALTER TABLE "MusicAlbum"
ADD COLUMN "era" TEXT,
ADD COLUMN "albumType" TEXT;

-- AlterTable
ALTER TABLE "MusicSong"
ADD COLUMN "language" TEXT,
ADD COLUMN "tags" TEXT,
ADD COLUMN "era" TEXT,
ADD COLUMN "trackType" TEXT,
ADD COLUMN "concertVersion" TEXT,
ADD COLUMN "mood" TEXT,
ADD COLUMN "scene" TEXT,
ADD COLUMN "recommendLevel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MusicSong_albumId_title_key" ON "MusicSong"("albumId", "title");
