-- DropForeignKey
ALTER TABLE "articles" DROP CONSTRAINT "articles_categoryId_fkey";

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "blogId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "articleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_blogId_endpoint_key" ON "idempotency_keys"("key", "blogId", "endpoint");

-- CreateIndex
CREATE INDEX "articles_blogId_authorId_idx" ON "articles"("blogId", "authorId");

-- CreateIndex
CREATE INDEX "blogs_tenantId_idx" ON "blogs"("tenantId");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigram GIN indexes backing the management/public `q` search
-- (ILIKE with ESCAPE '\\' in articles.service). ILIKE on a leading-
-- wildcard pattern cannot use a btree index; pg_trgm's gin_trgm_ops
-- covers `col ILIKE '%term% ESCAPE ...' directly.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "articles_title_trgm_idx" ON "articles" USING gin ("title" gin_trgm_ops);

CREATE INDEX "articles_excerpt_trgm_idx" ON "articles" USING gin ("excerpt" gin_trgm_ops);
