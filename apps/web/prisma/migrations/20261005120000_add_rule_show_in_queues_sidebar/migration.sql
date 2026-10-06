-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "showInQueuesSidebar" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: queues used to be derived from these label names directly, so only
-- rules that actually apply one of them keep a queue after the switch. Rules
-- whose labels never showed a queue stay unchecked.
UPDATE "Rule"
SET "showInQueuesSidebar" = true
WHERE EXISTS (
  SELECT 1
  FROM "Action" a
  WHERE a."ruleId" = "Rule".id
    AND a."type" = 'LABEL'
    AND lower(trim(a."label")) IN (
      'to reply',
      'awaiting reply',
      'fyi',
      'newsletter',
      'receipt',
      'calendar'
    )
);
