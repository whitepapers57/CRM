-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "records" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_method_startedAt_idx" ON "SyncRun"("method", "startedAt");
