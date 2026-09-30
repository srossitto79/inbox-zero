import { LogicalOperator } from "@/generated/prisma/enums";
import { aiChooseRule } from "@/utils/ai/choose-rule/ai-choose-rule";
import {
  evaluateRuleConditions,
  matchesStaticRule,
} from "@/utils/ai/choose-rule/match-rules";
import { flattenConditions } from "@/utils/condition";
import type { ZodCondition } from "@/utils/actions/rule.validation";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { Logger } from "@/utils/logger";
import type { ParsedMessage, RuleWithActions } from "@/utils/types";

const MAX_REASON_LENGTH = 200;

export type DryRunRuleInput = {
  name: string;
  conditions: ZodCondition[];
  conditionalOperator?: LogicalOperator;
  runOnThreads?: boolean | null;
};

export type DryRunOutcome = {
  matched: boolean;
  method: "static" | "ai" | "skipped";
  reason: string;
};

/**
 * Read-only check of an unsaved rule against one message. Reuses the engine's
 * condition evaluation and AI rule choice, and never executes actions or writes
 * anything. Learned patterns, cold email detection and conversation tracking are
 * not part of the check.
 */
export async function dryRunRuleOnMessage({
  rule,
  message,
  isThread,
  emailAccount,
  logger,
}: {
  rule: DryRunRuleInput;
  message: ParsedMessage;
  isThread: boolean;
  emailAccount: EmailAccountWithAI;
  logger: Logger;
}): Promise<DryRunOutcome> {
  if (isThread && !rule.runOnThreads) {
    return {
      matched: false,
      method: "skipped",
      reason: "Reply in a conversation",
    };
  }

  const fields = flattenConditions(rule.conditions, logger);
  const draftRule = {
    name: rule.name,
    from: fields.from ?? null,
    to: fields.to ?? null,
    subject: fields.subject ?? null,
    body: fields.body ?? null,
    instructions: fields.instructions ?? null,
    groupId: null,
    conditionalOperator: rule.conditionalOperator ?? LogicalOperator.AND,
    runOnThreads: !!rule.runOnThreads,
    // The evaluation only reads condition fields, never the persisted columns.
  } as RuleWithActions;

  const evaluation = evaluateRuleConditions({
    rule: draftRule,
    message,
    logger,
  });

  if (evaluation.matched) {
    return {
      matched: true,
      method: "static",
      reason: "Matches the sender, recipient or subject conditions",
    };
  }

  if (evaluation.potentialAiMatch && draftRule.instructions) {
    const result = await aiChooseRule({
      email: getEmailForLLM(message),
      rules: [{ name: draftRule.name, instructions: draftRule.instructions }],
      emailAccount,
      modelType: "chat",
      logger,
    });

    const matched = result.rules.length > 0;
    const fallbackReason = matched
      ? "Matches the description"
      : "Does not match the description";

    return {
      matched,
      method: "ai",
      reason: truncateReason(result.reason) || fallbackReason,
    };
  }

  return {
    matched: false,
    method: "skipped",
    reason: describeStaticMismatch({ fields, message, logger }),
  };
}

export function describeStaticMismatch({
  fields,
  message,
  logger,
}: {
  fields: {
    from?: string | null;
    to?: string | null;
    subject?: string | null;
    body?: string | null;
  };
  message: ParsedMessage;
  logger: Logger;
}): string {
  const checks: { label: string; key: "from" | "to" | "subject" | "body" }[] = [
    { label: "sender", key: "from" },
    { label: "recipient", key: "to" },
    { label: "subject", key: "subject" },
    { label: "body", key: "body" },
  ];

  const failing = checks
    .filter(({ key }) => !!fields[key])
    .filter(
      ({ key }) =>
        !matchesStaticRule(
          {
            from: null,
            to: null,
            subject: null,
            body: null,
            [key]: fields[key],
          },
          message,
          logger,
        ),
    )
    .map(({ label }) => label);

  if (!failing.length) return "No conditions to match";

  return `Does not match ${failing.join(", ")}`;
}

function truncateReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length <= MAX_REASON_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_REASON_LENGTH - 1)}…`;
}
