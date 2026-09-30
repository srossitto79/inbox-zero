import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { dryRunRuleBody } from "@/app/api/user/rules/dry-run/validation";
import { getEmailAccountForRuleExecution } from "@/utils/user/get";
import { assertHasAiAccess } from "@/utils/premium/limits";
import { dryRunRuleOnMessage } from "@/utils/rule/dry-run";
import { ConditionType } from "@/utils/config";

export type DryRunRuleResponse = Awaited<
  ReturnType<typeof dryRunRuleOnMessage>
>;

// Read-only: fetches one message and evaluates the unsaved rule against it.
// It never runs actions and never writes executed rules.
export const POST = withEmailProvider("user/rules/dry-run", async (request) => {
  const { emailProvider } = request;
  const { emailAccountId } = request.auth;

  const { messageId, rule } = dryRunRuleBody.parse(await request.json());

  const emailAccount = await getEmailAccountForRuleExecution({
    emailAccountId,
  });
  if (!emailAccount) {
    return NextResponse.json(
      { error: "Email account not found" },
      { status: 404 },
    );
  }

  const usesAi = rule.conditions.some(
    (condition) =>
      condition.type === ConditionType.AI && !!condition.instructions?.trim(),
  );
  if (usesAi) {
    await assertHasAiAccess({
      userId: emailAccount.userId,
      hasUserApiKey: !!emailAccount.user.aiApiKey,
    });
  }

  const message = await emailProvider.getMessage(messageId);

  const outcome = await dryRunRuleOnMessage({
    rule,
    message,
    isThread: emailProvider.isReplyInThread(message),
    emailAccount,
    logger: request.logger.with({ messageId }),
  });

  return NextResponse.json(outcome);
});
