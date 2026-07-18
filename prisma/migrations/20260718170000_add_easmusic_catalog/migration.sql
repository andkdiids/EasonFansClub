-- CreateTable
CREATE TABLE "MusicAlbum" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "artist" TEXT NOT NULL DEFAULT '陈奕迅',
  "releaseYear" INTEGER NOT NULL,
  "coverUrl" TEXT,
  "description" TEXT,
  "language" TEXT NOT NULL DEFAULT '粤语',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MusicAlbum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicSong" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL DEFAULT '陈奕迅',
  "albumId" TEXT NOT NULL,
  "trackNumber" INTEGER NOT NULL,
  "releaseYear" INTEGER NOT NULL,
  "duration" INTEGER,
  "coverUrl" TEXT,
  "composer" TEXT,
  "lyricist" TEXT,
  "arranger" TEXT,
  "producer" TEXT,
  "story" TEXT,
  "lyrics" TEXT,
  "sourceType" TEXT,
  "sourceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MusicSong_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MusicAlbum_name_artist_releaseYear_key" ON "MusicAlbum"("name", "artist", "releaseYear");

-- CreateIndex
CREATE INDEX "MusicAlbum_releaseYear_createdAt_idx" ON "MusicAlbum"("releaseYear", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MusicSong_albumId_trackNumber_key" ON "MusicSong"("albumId", "trackNumber");

-- CreateIndex
CREATE INDEX "MusicSong_albumId_trackNumber_idx" ON "MusicSong"("albumId", "trackNumber");

-- CreateIndex
CREATE INDEX "MusicSong_title_artist_idx" ON "MusicSong"("title", "artist");

-- AddForeignKey
ALTER TABLE "MusicSong" ADD CONSTRAINT "MusicSong_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "MusicAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;
