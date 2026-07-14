-- CreateTable
CREATE TABLE "PageLayout" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "draftConfig" JSONB NOT NULL,
    "publishedConfig" JSONB NOT NULL,
    "previousPublishedConfig" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "publishedById" TEXT,

    CONSTRAINT "PageLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageLayout_pageKey_key" ON "PageLayout"("pageKey");

-- CreateIndex
CREATE INDEX "PageLayout_pageKey_idx" ON "PageLayout"("pageKey");

-- CreateIndex
CREATE INDEX "PageLayout_updatedById_idx" ON "PageLayout"("updatedById");

-- CreateIndex
CREATE INDEX "PageLayout_publishedById_idx" ON "PageLayout"("publishedById");

-- AddForeignKey
ALTER TABLE "PageLayout" ADD CONSTRAINT "PageLayout_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLayout" ADD CONSTRAINT "PageLayout_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
