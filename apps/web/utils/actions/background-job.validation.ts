import { z } from "zod";

export const startBulkRulesJobBody = z
  .object({
    startDate: z.coerce.date(),
    // Exclusive upper bound, already moved to the start of the day after the
    // selected end date in the user's time zone.
    before: z.coerce.date().optional(),
    includeRead: z.boolean().default(false),
    rerun: z.boolean().default(false),
    generateDraftReplies: z.boolean().default(false),
    maxEmails: z.number().int().positive().optional(),
  })
  .refine((body) => !body.before || body.before > body.startDate, {
    message: "End date must not be before the start date",
  });
export type StartBulkRulesJobBody = z.infer<typeof startBulkRulesJobBody>;

export const cancelBackgroundJobBody = z.object({
  jobId: z.string().min(1),
});

export const markBackgroundJobsSeenBody = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(50),
});
