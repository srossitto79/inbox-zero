-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'PAUSED', 'ERROR', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN     "calendarListSyncedAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT;

-- AlterTable
ALTER TABLE "Calendar" ADD COLUMN     "canEdit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "fullSyncStartedAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncCursor" TEXT,
ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncPageToken" TEXT,
ADD COLUMN     "syncRetryAt" TIMESTAMP(3),
ADD COLUMN     "syncStartedAt" TIMESTAMP(3),
ADD COLUMN     "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN     "syncWindowEnd" TIMESTAMP(3),
ADD COLUMN     "syncWindowStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "calendarId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "iCalUid" TEXT,
    "etag" TEXT,
    "providerUpdatedAt" TIMESTAMPTZ(3),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMPTZ(3) NOT NULL,
    "endTime" TIMESTAMPTZ(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "isBusy" BOOLEAN NOT NULL DEFAULT true,
    "organizerEmail" TEXT,
    "organizerName" TEXT,
    "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
    "selfResponseStatus" TEXT,
    "attendees" JSONB,
    "recurringEventId" TEXT,
    "recurrence" TEXT[],
    "originalStartTime" TIMESTAMPTZ(3),
    "videoLink" TEXT,
    "htmlLink" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarId_startTime_endTime_idx" ON "CalendarEvent"("calendarId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarId_recurringEventId_idx" ON "CalendarEvent"("calendarId", "recurringEventId");

-- CreateIndex
CREATE INDEX "CalendarEvent_iCalUid_idx" ON "CalendarEvent"("iCalUid");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_calendarId_providerEventId_key" ON "CalendarEvent"("calendarId", "providerEventId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

