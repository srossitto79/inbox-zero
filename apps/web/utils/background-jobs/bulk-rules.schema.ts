import { z } from "zod";

export const bulkRulesPayloadSchema = z.object({
  startDate: z.string().datetime(),
  before: z.string().datetime().optional(),
  includeRead: z.boolean(),
  rerun: z.boolean(),
  generateDraftReplies: z.boolean(),
  maxEmails: z.number().int().positive().optional(),
  // Resume cursor: the next page to list, and the threads of the current page
  // that already ran, so a resumed page does not run them twice on a rerun.
  nextPageToken: z.string().optional(),
  pageProcessedThreadIds: z.array(z.string()).default([]),
});
export type BulkRulesPayload = z.infer<typeof bulkRulesPayloadSchema>;

const bulkRulesEntrySchema = z.object({
  threadId: z.string(),
  messageId: z.string(),
  from: z.string(),
  subject: z.string(),
  ruleName: z.string().nullable(),
  failed: z.boolean(),
});
export type BulkRulesEntry = z.infer<typeof bulkRulesEntrySchema>;

export const bulkRulesResultSchema = z.object({
  processed: z.number().int().default(0),
  matched: z.number().int().default(0),
  failed: z.number().int().default(0),
  recent: z.array(bulkRulesEntrySchema).default([]),
});
export type BulkRulesResult = z.infer<typeof bulkRulesResultSchema>;
