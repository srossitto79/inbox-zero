import { z } from "zod";
import { LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";

const dryRunCondition = z.object({
  type: z.enum([ConditionType.AI, ConditionType.STATIC]),
  instructions: z.string().nullish(),
  to: z.string().nullish(),
  from: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.string().nullish(),
});

export const dryRunRuleBody = z.object({
  messageId: z.string().min(1),
  rule: z.object({
    name: z.string(),
    conditions: z.array(dryRunCondition).min(1).max(10),
    conditionalOperator: z
      .enum([LogicalOperator.AND, LogicalOperator.OR])
      .optional(),
    runOnThreads: z.boolean().nullish(),
  }),
});
export type DryRunRuleBody = z.infer<typeof dryRunRuleBody>;
