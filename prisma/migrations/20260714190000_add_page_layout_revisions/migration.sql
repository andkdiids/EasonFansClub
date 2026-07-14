-- CreateEnum
CREATE TYPE "PageLayoutRevisionSource" AS ENUM ('MANUAL', 'ROLLBACK', 'DEFAULT');

-- CreateTable
CREATE TABLE "PageLayoutRevision" (
    "id" TEXT NOT NULL,
    "pageLayoutId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "note" TEXT,
    "source" "PageLayoutRevisionSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "PageLayoutRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageLayoutRevision_pageLayoutId_version_key" ON "PageLayoutRevision"("pageLayoutId", "version");

-- CreateIndex
CREATE INDEX "PageLayoutRevision_pageLayoutId_createdAt_idx" ON "PageLayoutRevision"("pageLayoutId", "createdAt");

-- CreateIndex
CREATE INDEX "PageLayoutRevision_publishedById_idx" ON "PageLayoutRevision"("publishedById");

-- CreateIndex
CREATE INDEX "PageLayoutRevision_source_idx" ON "PageLayoutRevision"("source");

-- AddForeignKey
ALTER TABLE "PageLayoutRevision" ADD CONSTRAINT "PageLayoutRevision_pageLayoutId_fkey" FOREIGN KEY ("pageLayoutId") REFERENCES "PageLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLayoutRevision" ADD CONSTRAINT "PageLayoutRevision_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
