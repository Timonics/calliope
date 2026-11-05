-- DropIndex
DROP INDEX "articles_excerpt_trgm_idx";

-- DropIndex
DROP INDEX "articles_title_trgm_idx";

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "corrections" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "coverImage" JSONB,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "readingTimeMinutes" INTEGER,
ADD COLUMN     "seo" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "seriesId" UUID,
ADD COLUMN     "seriesPosition" INTEGER,
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "authors" ADD COLUMN     "links" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "blogId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "series_blogId_slug_key" ON "series"("blogId", "slug");

-- CreateIndex
CREATE INDEX "articles_seriesId_status_idx" ON "articles"("seriesId", "status");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
