-- CreateEnum
CREATE TYPE "VideoType" AS ENUM ('LONG', 'SHORTS');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "avgComments" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "avgLikes" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "viewsPerSubs" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CreatorStat" ADD COLUMN     "avgComments" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "avgLikes" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalComments" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalLikes" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "duration" TEXT NOT NULL,
    "type" "VideoType" NOT NULL DEFAULT 'LONG',
    "viewCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "likeCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commentCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_creatorId_publishedAt_idx" ON "Video"("creatorId", "publishedAt");

-- CreateIndex
CREATE INDEX "Video_type_idx" ON "Video"("type");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
