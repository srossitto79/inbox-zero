-- CreateEnum
CREATE TYPE "BackgroundJobKind" AS ENUM ('BULK_RULES', 'CHAT_REPLY', 'CLEANUP', 'CATEGORIZE_SENDERS');

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "kind" "BackgroundJobKind" NOT NULL,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundJob_status_nextRunAt_idx" ON "BackgroundJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_heartbeatAt_idx" ON "BackgroundJob"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_emailAccountId_status_idx" ON "BackgroundJob"("emailAccountId", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_emailAccountId_createdAt_idx" ON "BackgroundJob"("emailAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
