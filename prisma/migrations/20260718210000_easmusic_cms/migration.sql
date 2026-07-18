-- CreateEnum
CREATE TYPE "MusicPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "MusicAlbum"
ADD COLUMN "releaseDate" TIMESTAMP(3),
ADD COLUMN "company" TEXT,
ADD COLUMN "story" TEXT,
ADD COLUMN "status" "MusicPublicationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MusicSong" ADD COLUMN "description" TEXT;

-- CreateIndex
CREATE INDEX "MusicAlbum_status_displayOrder_releaseYear_idx" ON "MusicAlbum"("status", "displayOrder", "releaseYear");
